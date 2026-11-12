import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';

interface UpdateConfirmation {
  window: BrowserWindow;
  url: string;
  version: string;
  validate: () => void;
  finish: (confirmed: boolean, error?: Error) => void;
}

/** 管理独立升级确认窗口，结果绑定发起更新的原窗口及授权。 */
export const createUpdateConfirmController = (
  getRendererUrl: () => string,
  getDefaultIcon: () => NativeImage,
): {
  open: (
    parent: BrowserWindow,
    version: string,
    validate: () => void,
  ) => Promise<boolean>;
  cancel: () => void;
} => {
  let active: UpdateConfirmation | undefined;

  /** 取消待确认任务，父窗口失效时不继续关闭进程或下载。 */
  const cancel = (): void => active?.finish(false);

  /** 仅接受当前确认小窗的可信主框架调用。 */
  const validateSender = (event: IpcMainInvokeEvent): UpdateConfirmation => {
    const operation = active;
    if (
      !operation ||
      operation.window.isDestroyed() ||
      event.sender !== operation.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== operation.url
    )
      throw new Error('升级确认窗口已失效');
    try {
      operation.validate();
    } catch (cause) {
      cancel();
      throw cause;
    }
    return operation;
  };

  ipcMain.handle(
    'update-confirm:context',
    (event): string => validateSender(event).version,
  );
  ipcMain.handle(
    'update-confirm:respond',
    (event, confirmed: unknown): void => {
      const operation = validateSender(event);
      if (typeof confirmed !== 'boolean') throw new Error('无效的升级确认');
      operation.finish(confirmed);
    },
  );

  /** 创建与提示内容等大的原生模态窗口，不在更新页面中嵌入确认面板。 */
  const open = async (
    parent: BrowserWindow,
    version: string,
    validate: () => void,
  ): Promise<boolean> => {
    validate();
    if (active) throw new Error('请先完成当前升级确认');
    const bounds = parent.getBounds();
    const workArea = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(510, workArea.width);
    const height = Math.min(260, workArea.height);
    const window = new BrowserWindow({
      parent,
      modal: true,
      width,
      height,
      useContentSize: true,
      x: Math.max(
        workArea.x,
        Math.min(
          bounds.x + Math.round((bounds.width - width) / 2),
          workArea.x + workArea.width - width,
        ),
      ),
      y: Math.max(
        workArea.y,
        Math.min(
          bounds.y + Math.round((bounds.height - height) / 2),
          workArea.y + workArea.height - height,
        ),
      ),
      frame: false,
      transparent: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: '新版本',
      backgroundColor: '#f7f7f7',
      icon: getDefaultIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'update-confirm-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const url = new URL(getRendererUrl());
    url.hash = 'update-confirm';
    return new Promise<boolean>((resolve, reject) => {
      /** 父页面重载或关闭时废弃本次确认。 */
      const parentChanged = (): void => operation.finish(false);
      const operation: UpdateConfirmation = {
        window,
        url: url.href,
        version,
        validate,
        /** 撤销窗口权限后交付一次结果，并清理关联监听。 */
        finish: (confirmed: boolean, error?: Error): void => {
          if (active !== operation) return;
          active = undefined;
          clearTimeout(timer);
          parent.webContents.removeListener(
            'did-start-navigation',
            parentChanged,
          );
          parent.removeListener('closed', parentChanged);
          if (!window.isDestroyed()) window.destroy();
          if (error) reject(error);
          else resolve(confirmed);
        },
      };
      active = operation;
      const timer = setTimeout(
        () => operation.finish(false, new Error('升级确认窗口加载超时')),
        15_000,
      );
      parent.webContents.on('did-start-navigation', parentChanged);
      parent.on('closed', parentChanged);
      window.on('closed', () => operation.finish(false));
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('render-process-gone', () =>
        operation.finish(false, new Error('升级确认窗口已退出')),
      );
      void window
        .loadURL(operation.url)
        .then((): void => {
          if (active !== operation) return;
          validate();
          clearTimeout(timer);
          window.show();
          window.focus();
        })
        .catch((cause: unknown) => {
          operation.finish(
            false,
            cause instanceof Error ? cause : new Error('升级确认窗口加载失败'),
          );
        });
    });
  };

  return { open, cancel };
};
