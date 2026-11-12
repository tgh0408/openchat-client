import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import { handleChatIpc } from '../../services/ipc/chat-ipc';
import { requireLocalUser } from '../../services/auth/auth';
import { parseUpdateReleaseInfo } from '../update/update-window';
import {
  parseLogLevel,
  type LogLevel,
  type SettingsAccount,
} from '../../../shared/windows/settings-window';
import type { UpdateReleaseInfo } from '../../../shared/update/update';

interface SettingsEntry {
  window: BrowserWindow;
  url: string;
}

interface SettingsDependencies {
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  getDefaultIcon: () => NativeImage;
  validateMainSender: (event: IpcMainInvokeEvent) => void;
  getAccount: () => SettingsAccount;
  logout: () => Promise<void>;
  getLogLevel: () => LogLevel;
  setLogLevel: (level: LogLevel) => void;
  checkForUpdate: () => Promise<UpdateReleaseInfo | null>;
  openUpdate: (release: UpdateReleaseInfo) => Promise<void>;
}

let current: SettingsEntry | undefined;

/** 退出登录、主窗口关闭或授权失效时销毁设置窗口。 */
export const closeSettingsWindow = (): void => {
  const entry = current;
  current = undefined;
  if (entry && !entry.window.isDestroyed()) entry.window.destroy();
};

/** 只允许当前设置窗口调用设置相关 IPC。 */
const validateSender = (event: IpcMainInvokeEvent): SettingsEntry => {
  const entry = current;
  if (
    !entry ||
    entry.window.isDestroyed() ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== entry.url
  )
    throw new Error('设置窗口已失效');
  return entry;
};

/** 注册设置窗口的打开、账号读取、登出和更新检查 IPC。 */
export const registerSettingsIpc = (
  dependencies: SettingsDependencies,
): void => {
  handleChatIpc('settings:open', async (event): Promise<void> => {
    dependencies.validateMainSender(event);
    requireLocalUser();
    const existing = current;
    if (existing && !existing.window.isDestroyed()) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return;
    }
    closeSettingsWindow();
    const main = dependencies.getMainWindow();
    if (!main || main.isDestroyed()) throw new Error('主窗口已关闭');
    const workArea = screen.getDisplayMatching(main.getBounds()).workArea;
    const width = Math.min(640, workArea.width);
    const height = Math.min(560, workArea.height);
    const window = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      minWidth: Math.min(560, workArea.width),
      minHeight: Math.min(460, workArea.height),
      frame: false,
      transparent: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      show: false,
      backgroundColor: '#fbfbfb',
      title: '设置',
      icon: dependencies.getDefaultIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'settings-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const url = new URL(dependencies.getRendererUrl());
    url.hash = 'settings';
    const entry: SettingsEntry = { window, url: url.href };
    current = entry;
    window.on('closed', () => {
      if (current === entry) current = undefined;
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (navigation) =>
      navigation.preventDefault(),
    );
    window.webContents.on('render-process-gone', () => {
      if (!window.isDestroyed()) window.destroy();
    });
    try {
      await window.loadURL(entry.url);
      if (window.isDestroyed()) return;
      dependencies.validateMainSender(event);
      requireLocalUser();
      if (current !== entry) throw new Error('设置窗口已失效');
      window.show();
      window.focus();
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  });
  ipcMain.handle('settings:context', (event): SettingsAccount => {
    validateSender(event);
    return dependencies.getAccount();
  });
  ipcMain.handle('settings:close', (event): void => {
    validateSender(event).window.close();
  });
  ipcMain.handle('settings:logout', async (event): Promise<void> => {
    const entry = validateSender(event);
    await dependencies.logout();
    if (!entry.window.isDestroyed()) entry.window.close();
  });
  ipcMain.handle('settings:get-log-level', (event): LogLevel => {
    validateSender(event);
    return dependencies.getLogLevel();
  });
  ipcMain.handle('settings:set-log-level', (event, value: unknown): void => {
    validateSender(event);
    dependencies.setLogLevel(parseLogLevel(value));
  });
  ipcMain.handle(
    'settings:check-update',
    (event): Promise<UpdateReleaseInfo | null> => {
      validateSender(event);
      return dependencies.checkForUpdate();
    },
  );
  ipcMain.handle(
    'settings:open-update',
    async (event, value: unknown): Promise<void> => {
      validateSender(event);
      await dependencies.openUpdate(parseUpdateReleaseInfo(value));
    },
  );
};
