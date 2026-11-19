import { app, BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import { spawn } from 'node:child_process';
import path from 'node:path';
import {
  requireAuthenticatedSession,
  requireLocalUser,
} from '../../services/auth/auth';
import { createUpdateConfirmController } from './update-confirm-window';
import type {
  UpdateDownloadProgress,
  UpdateReleaseInfo,
} from '../../../shared/update/update';

interface UpdateEntry {
  window: BrowserWindow;
  release: UpdateReleaseInfo;
  url: string;
  generation: number;
  updating: boolean;
}

interface UpdateDependencies {
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  getDefaultIcon: () => NativeImage;
  downloadUpdate: (
    releaseId: number,
    report: (progress: UpdateDownloadProgress) => void,
  ) => Promise<string>;
  cancelUpdate: () => void;
}

let dependencies: UpdateDependencies | undefined;
let current: UpdateEntry | undefined;
let confirmation: ReturnType<typeof createUpdateConfirmController> | undefined;

/** 启动已校验的 Windows 安装包，并让当前客户端退出释放文件锁。 */
const launchInstaller = async (installerPath: string): Promise<void> => {
  if (process.platform !== 'win32')
    throw new Error('当前平台暂不支持自动安装更新');
  const lowerPath = installerPath.toLowerCase();
  const isMsi = lowerPath.endsWith('.msi');
  const isExe = lowerPath.endsWith('.exe');
  if (!isMsi && !isExe)
    throw new Error('当前更新包不是可自动安装的 Windows 安装包');
  const command = isMsi ? 'msiexec.exe' : installerPath;
  const args = isMsi ? ['/i', installerPath] : [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
    child.once('error', reject);
  });
};

/** 校验从设置页面传入的发布信息，避免更新窗口接受任意页面数据。 */
export const parseUpdateReleaseInfo = (value: unknown): UpdateReleaseInfo => {
  if (!value || typeof value !== 'object') throw new Error('无效的版本信息');
  const data = value as Record<string, unknown>;
  const releaseId = data.releaseId;
  const version = data.version;
  const clientName = data.clientName;
  const fileSize = data.fileSize;
  const updateInfo = data.updateInfo;
  if (
    typeof releaseId !== 'number' ||
    !Number.isSafeInteger(releaseId) ||
    releaseId <= 0 ||
    typeof version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    typeof clientName !== 'string' ||
    !clientName.trim() ||
    typeof fileSize !== 'number' ||
    !Number.isSafeInteger(fileSize) ||
    fileSize <= 0 ||
    !Array.isArray(updateInfo) ||
    updateInfo.some((item) => typeof item !== 'string')
  )
    throw new Error('无效的版本信息');
  return {
    releaseId,
    version,
    clientName: clientName.trim(),
    fileSize,
    updateInfo: updateInfo.map((item) => item.trim()).filter(Boolean),
  };
};

/** 关闭更新窗口，并取消仍在进行的下载。 */
export const closeUpdateWindow = (): void => {
  const entry = current;
  current = undefined;
  confirmation?.cancel();
  dependencies?.cancelUpdate();
  if (entry && !entry.window.isDestroyed()) entry.window.destroy();
};

/** 校验独立更新窗口的来源和当前登录状态。 */
const validateSender = (event: IpcMainInvokeEvent): UpdateEntry => {
  const entry = current;
  requireLocalUser();
  if (
    !entry ||
    entry.window.isDestroyed() ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== entry.url
  )
    throw new Error('更新窗口已失效');
  return entry;
};

/** 打开或聚焦当前发布版本的独立更新窗口。 */
export const openUpdateWindow = async (
  release: UpdateReleaseInfo,
): Promise<void> => {
  if (!dependencies) throw new Error('更新服务尚未初始化');
  requireLocalUser();
  const existing = current;
  if (existing && !existing.window.isDestroyed()) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.show();
    existing.window.focus();
    return;
  }
  closeUpdateWindow();
  const main = dependencies.getMainWindow();
  if (!main || main.isDestroyed()) throw new Error('主窗口已关闭');
  const workArea = screen.getDisplayMatching(main.getBounds()).workArea;
  const width = Math.min(517, workArea.width);
  const height = Math.min(423, workArea.height);
  const window = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    x: workArea.x + Math.round((workArea.width - width) / 2),
    y: workArea.y + Math.round((workArea.height - height) / 2),
    minWidth: Math.min(400, workArea.width),
    minHeight: Math.min(320, workArea.height),
    frame: false,
    transparent: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    backgroundColor: '#e6e6e8',
    title: '新版本',
    icon: dependencies.getDefaultIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'update-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const url = new URL(dependencies.getRendererUrl());
  url.hash = 'update';
  const entry: UpdateEntry = {
    window,
    release,
    url: url.href,
    generation: 0,
    updating: false,
  };
  current = entry;
  window.on('closed', () => {
    if (current !== entry) return;
    current = undefined;
    confirmation?.cancel();
    dependencies?.cancelUpdate();
  });
  window.webContents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (!isMainFrame || isInPlace) return;
      entry.generation += 1;
      confirmation?.cancel();
      dependencies?.cancelUpdate();
    },
  );
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
    requireLocalUser();
    if (current !== entry) throw new Error('更新窗口已失效');
    window.show();
    window.focus();
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
};

/** 注册独立更新窗口的受控 IPC。 */
export const registerUpdateIpc = (
  nextDependencies: UpdateDependencies,
): void => {
  dependencies = nextDependencies;
  confirmation = createUpdateConfirmController(
    nextDependencies.getRendererUrl,
    nextDependencies.getDefaultIcon,
  );
  ipcMain.handle('update:context', (event): UpdateReleaseInfo => {
    return validateSender(event).release;
  });
  ipcMain.handle('update:close', (event): void => {
    validateSender(event).window.close();
  });
  ipcMain.handle('update:download', async (event): Promise<boolean> => {
    const entry = validateSender(event);
    const service = dependencies;
    const dialog = confirmation;
    if (!service || !dialog) throw new Error('更新服务尚未初始化');
    if (entry.updating) throw new Error('更新正在处理中');
    const session = requireAuthenticatedSession();
    const generation = entry.generation;
    /** 每次异步操作后复核原窗口、页面代次和授权，拒绝迟到确认。 */
    const validate = (): void => {
      if (
        validateSender(event) !== entry ||
        entry.generation !== generation ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('更新窗口已失效');
    };
    entry.updating = true;
    try {
      validate();
      const confirmed = await dialog.open(
        entry.window,
        entry.release.version,
        validate,
      );
      validate();
      if (!confirmed) return false;
      entry.window.webContents.send('update:progress', {
        loaded: 0,
        total: entry.release.fileSize,
        percent: 0,
        status: 'downloading',
      });
      const installerPath = await service.downloadUpdate(
        entry.release.releaseId,
        (progress) => {
          validate();
          entry.window.webContents.send('update:progress', progress);
        },
      );
      validate();
      await launchInstaller(installerPath);
      app.quit();
      return true;
    } finally {
      entry.updating = false;
    }
  });
  ipcMain.handle('update:cancel', (event): void => {
    validateSender(event);
    dependencies?.cancelUpdate();
  });
};
