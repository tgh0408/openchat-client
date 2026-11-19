import { BrowserWindow, ipcMain, nativeImage } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import { parseCroppedAvatar } from '../../../shared/media/image/avatar-crop';

interface CropOperation {
  window: BrowserWindow;
  url: string;
  bytes: Uint8Array | undefined;
  validate: () => void;
  finish: (bytes: Uint8Array | null, error?: Error) => void;
}

/** 注册专用沙箱窗口，仅持有本次选图，所有调用复核父页面及未登录状态。 */
export const createAvatarCropController = (
  getRendererUrl: () => string,
  getDefaultIcon: () => NativeImage,
): {
  open: (
    parent: BrowserWindow,
    bytes: Uint8Array,
    validate: () => void,
  ) => Promise<Uint8Array | null>;
  cancel: () => void;
} => {
  let active: CropOperation | undefined;

  /** 先撤销任务再销毁窗口，关闭事件不会重复交付结果。 */
  const cancel = (): void => active?.finish(null);

  /** 仅当前裁剪窗口的可信主框架可访问图片或提交结果。 */
  const validateSender = (event: IpcMainInvokeEvent): CropOperation => {
    const operation = active;
    if (
      !operation ||
      operation.window.isDestroyed() ||
      event.sender !== operation.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== operation.url
    )
      throw new Error('无效的头像裁剪窗口调用');
    try {
      operation.validate();
    } catch (cause) {
      cancel();
      throw cause;
    }
    return operation;
  };

  ipcMain.handle('avatar-crop:read', (event): Uint8Array => {
    const operation = validateSender(event);
    if (!operation.bytes) throw new Error('头像裁剪已结束');
    return operation.bytes;
  });
  ipcMain.handle('avatar-crop:confirm', (event, value: unknown): void => {
    const operation = validateSender(event);
    const bytes = parseCroppedAvatar(value);
    const image = nativeImage.createFromBuffer(Buffer.from(bytes));
    if (image.isEmpty()) throw new Error('裁剪图片无法读取，请重试');
    operation.validate();
    operation.finish(bytes);
  });
  ipcMain.handle('avatar-crop:cancel', (event): void => {
    validateSender(event).finish(null);
  });

  /** 创建独立原生模态窗口；关闭、重载、崩溃和加载失败均释放本次图片。 */
  const open = async (
    parent: BrowserWindow,
    bytes: Uint8Array,
    validate: () => void,
  ): Promise<Uint8Array | null> => {
    validate();
    if (active) throw new Error('请先完成当前头像裁剪');
    const window = new BrowserWindow({
      parent,
      modal: true,
      width: 464,
      height: 500,
      useContentSize: true,
      resizable: false,
      show: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      title: '裁剪头像',
      icon: getDefaultIcon(),
      backgroundColor: '#f9f9f9',
      webPreferences: {
        preload: path.join(__dirname, 'avatar-crop-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const url = new URL(getRendererUrl());
    url.hash = 'avatar-crop';
    return new Promise<Uint8Array | null>((resolve, reject) => {
      /** 父页面失效后拒绝继续裁剪，避免旧图回填新页面。 */
      const parentChanged = (): void => operation.finish(null);
      const operation: CropOperation = {
        window,
        url: url.href,
        bytes,
        validate,
        /** 原图从内存释放，结果最多交付一次。 */
        finish: (result: Uint8Array | null, error?: Error): void => {
          if (active !== operation) return;
          active = undefined;
          operation.bytes = undefined;
          clearTimeout(timer);
          parent.webContents.removeListener(
            'did-start-navigation',
            parentChanged,
          );
          parent.removeListener('closed', parentChanged);
          if (!window.isDestroyed()) window.destroy();
          if (error) reject(error);
          else resolve(result);
        },
      };
      active = operation;
      const timer = setTimeout(
        () => operation.finish(null, new Error('头像裁剪窗口加载超时，请重试')),
        15_000,
      );
      parent.webContents.on('did-start-navigation', parentChanged);
      parent.on('closed', parentChanged);
      window.on('closed', () => operation.finish(null));
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (event) => event.preventDefault());
      window.webContents.on('render-process-gone', () =>
        operation.finish(null, new Error('头像裁剪窗口已退出，请重试')),
      );
      void window
        .loadURL(operation.url)
        .then((): void => {
          if (active !== operation) return;
          validate();
          clearTimeout(timer);
          window.show();
        })
        .catch((cause: unknown) => {
          operation.finish(
            null,
            cause instanceof Error ? cause : new Error('头像裁剪窗口加载失败'),
          );
        });
    });
  };

  return { open, cancel };
};
