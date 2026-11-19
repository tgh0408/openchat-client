import {
  isImageOcrAvailable,
  recognizeImageText,
  stopImageOcrProcess,
} from '../../services/media/image/image-ocr';
import type { ImageOcrResult } from '../../../shared/media/image/image-ocr';
import { app, BrowserWindow, ipcMain, screen } from 'electron';
import { createImageOcrQueue } from '../../services/media/image/image-ocr-queue';
import type { IpcMainInvokeEvent, WebContents } from 'electron';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { handleChatIpc } from '../../services/ipc/chat-ipc';
import { getApplicationIcon } from '../../services/runtime/application-icon';
import type {
  ImagePreviewContext,
  ImagePreviewRequest,
  ImagePreviewWindowState,
} from '../../../shared/windows/image-preview';
import {
  requireAuthenticatedSession,
  requireLocalUser,
} from '../../services/auth/auth';
import {
  findAdjacentImageMessage,
  getStorageOwner,
  getImagePreviewMessage,
  getImageOcrCache,
  saveImageOcrCache,
} from '../../services/database/database';
import type { LocalImageData } from '../../../shared/media/image/image';
import { parseText } from '../../services/database/database-validation';
import {
  parseImagePreviewRequest,
  readImagePreview,
} from './image-preview-data';

interface PreviewEntry {
  window: BrowserWindow;
  owner: string;
  request: ImagePreviewRequest;
  url: string;
  temporary?: TemporaryImagePreview;
  recognitions: Map<string, () => void>;
}

/** 主进程绑定的临时图片，仅开放当前草稿的受控读取。 */
export interface TemporaryImagePreview {
  context: ImagePreviewContext;
  validate: () => void;
  read: (validate: () => void) => Promise<LocalImageData>;
  source?: WebContents;
}

interface PreviewDependencies {
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  readImage: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<LocalImageData>;
  validateSource: (
    event: IpcMainInvokeEvent,
    request: ImagePreviewRequest,
  ) => void;
}

const previews = new Map<number, PreviewEntry>();

const recognitionQueue = createImageOcrQueue();

/** 临时草稿随窗口失效；已落库图片的任务不依赖预览窗口存活。 */
const cancelTemporaryRecognition = (entry: PreviewEntry): void => {
  if (entry.temporary)
    for (const cancel of entry.recognitions.values()) cancel();
};

app.once('before-quit', () => recognitionQueue.cancel(() => true));

/** 退出、主页面重载或关闭时销毁旧账号预览；删除会话时只销毁对应窗口。 */
export const closeImagePreviews = (
  conversationId?: string,
  messageId?: string,
): void => {
  recognitionQueue.cancel(
    (task) =>
      (!conversationId || task.conversationId === conversationId) &&
      (!messageId || task.messageIds.includes(messageId)),
  );
  if (!conversationId && !messageId) stopImageOcrProcess();
  for (const [id, entry] of [...previews.entries()]) {
    if (
      (!conversationId || entry.request.conversationId === conversationId) &&
      (!messageId || entry.request.messageId === messageId)
    ) {
      cancelTemporaryRecognition(entry);
      previews.delete(id);
      entry.window.destroy();
    }
  }
};

/** 校验窗口、主框架、入口 URL 与当前本地阅读身份，过期账号不获得新授权。 */
const validatePreviewSender = (event: IpcMainInvokeEvent): PreviewEntry => {
  requireLocalUser();
  const entry = previews.get(event.sender.id);
  if (
    !entry ||
    entry.window.isDestroyed() ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== entry.url ||
    !entry.owner ||
    entry.owner !== getStorageOwner()
  )
    throw new Error('无效的图片预览窗口调用');
  entry.temporary?.validate();
  return entry;
};

/** 只返回预览窗口自身的非敏感状态。 */
const windowState = (window: BrowserWindow): ImagePreviewWindowState => ({
  pinned: window.isAlwaysOnTop(),
  maximized: window.isMaximized(),
  fullscreen: window.isFullScreen(),
});

/** 消息与草稿共用同一独立窗口及沙箱预加载入口。 */
const openPreviewWindow = async (
  dependencies: Pick<PreviewDependencies, 'getMainWindow' | 'getRendererUrl'>,
  request: ImagePreviewRequest,
  validateSource: () => void,
  temporary?: TemporaryImagePreview,
): Promise<BrowserWindow> => {
  validateSource();
  const context = temporary?.context ?? readImagePreview(request);
  const owner = getStorageOwner();
  const main = dependencies.getMainWindow();
  if (!owner || !main || main.isDestroyed())
    throw new Error('主窗口已关闭或尚未登录');
  const existing = [...previews.values()].find(
    (entry) =>
      entry.owner === owner &&
      entry.request.conversationId === request.conversationId &&
      Boolean(entry.temporary) === Boolean(temporary) &&
      (!temporary ||
        (entry.request.messageId === request.messageId &&
          entry.temporary?.source === temporary.source)),
  );
  if (existing) {
    existing.request = request;
    existing.window.setTitle(context.image.fileName);
    existing.window.webContents.send('image-preview:changed');
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.show();
    existing.window.focus();
    return existing.window;
  }
  const area = screen.getDisplayMatching(main.getBounds()).workArea;
  const width = Math.min(960, area.width);
  const height = Math.min(780, area.height);
  const window = new BrowserWindow({
    width,
    height,
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    minWidth: Math.min(420, area.width),
    minHeight: Math.min(320, area.height),
    frame: false,
    show: false,
    resizable: true,
    maximizable: true,
    fullscreenable: true,
    backgroundColor: '#eeeeef',
    title: context.image.fileName,
    icon: getApplicationIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'image-preview-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const url = new URL(dependencies.getRendererUrl());
  url.hash = 'image-preview';
  const entry: PreviewEntry = {
    window,
    owner,
    request,
    url: url.href,
    temporary,
    recognitions: new Map(),
  };
  const id = window.webContents.id;
  previews.set(id, entry);
  /** 来源页面关闭或重载时撤销其临时图片窗口。 */
  const closeFromSource = (): void => {
    if (!window.isDestroyed()) window.destroy();
  };
  temporary?.source?.on('destroyed', closeFromSource);
  temporary?.source?.on('did-start-navigation', closeFromSource);
  temporary?.source?.on('render-process-gone', closeFromSource);
  window.webContents.on('did-start-navigation', () =>
    cancelTemporaryRecognition(entry),
  );
  window.on('closed', () => {
    cancelTemporaryRecognition(entry);
    previews.delete(id);

    temporary?.source?.removeListener('destroyed', closeFromSource);
    temporary?.source?.removeListener('did-start-navigation', closeFromSource);
    temporary?.source?.removeListener('render-process-gone', closeFromSource);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (navigation) =>
    navigation.preventDefault(),
  );
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) window.destroy();
  });
  /** 系统窗口操作与工具栏状态保持一致。 */
  const notifyState = (): void => {
    if (!window.isDestroyed())
      window.webContents.send('image-preview:state', windowState(window));
  };
  window.on('maximize', notifyState);
  window.on('unmaximize', notifyState);
  window.on('enter-full-screen', notifyState);
  window.on('leave-full-screen', notifyState);
  window.on('always-on-top-changed', notifyState);
  try {
    await window.loadURL(entry.url);
    if (window.isDestroyed()) throw new Error('图片预览已关闭');
    validateSource();
    if (owner !== getStorageOwner() || !dependencies.getMainWindow()) {
      window.destroy();
      throw new Error('图片预览已失效');
    }
    window.show();
    window.focus();
    return window;
  } catch (error) {
    if (window.isDestroyed()) throw error;
    window.destroy();
    throw error;
  }
};

/** 临时图片由主进程绑定来源与权限，不接受页面提交任意路径或地址。 */
export const openTemporaryImagePreview = async (
  dependencies: Pick<PreviewDependencies, 'getMainWindow' | 'getRendererUrl'>,
  request: ImagePreviewRequest,
  temporary: TemporaryImagePreview,
): Promise<BrowserWindow> =>
  openPreviewWindow(dependencies, request, temporary.validate, temporary);

/** 注册独立预览权限；普通消息仍只接收已落库的标识。 */
export const registerImagePreviewIpc = (
  dependencies: PreviewDependencies,
): void => {
  handleChatIpc(
    'image-preview:open',
    async (event, value: unknown): Promise<void> => {
      const request = parseImagePreviewRequest(value);
      await openPreviewWindow(dependencies, request, (): void =>
        dependencies.validateSource(event, request),
      );
    },
  );
  ipcMain.handle('image-preview:context', (event) => {
    const entry = validatePreviewSender(event);
    return entry.temporary?.context ?? readImagePreview(entry.request);
  });
  ipcMain.handle(
    'image-preview:recognition-available',
    async (event): Promise<boolean> => {
      const entry = validatePreviewSender(event);
      const request = entry.request;
      const session = requireAuthenticatedSession();
      const source = entry.temporary
        ? undefined
        : getImagePreviewMessage(request.conversationId, request.messageId);
      /** 查询共享缓存也必须持有原授权和当前图片，拒绝切图后的迟到读取。 */
      const validate = (): void => {
        if (
          validatePreviewSender(event) !== entry ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('图片预览已失效');
        if (
          entry.request !== request ||
          (source &&
            getImagePreviewMessage(request.conversationId, request.messageId)
              .content !== source.content)
        )
          throw new Error('预览图片已切换');
      };
      const available = await isImageOcrAvailable();
      validate();
      if (available || entry.temporary) return available;
      const image = await dependencies.readImage(request, validate);
      validate();
      const sha256 = createHash('sha256').update(image.bytes).digest('hex');
      return (
        getImageOcrCache(request.conversationId, request.messageId, sha256) !==
        null
      );
    },
  );
  ipcMain.handle(
    'image-preview:read-image',
    async (event, value: unknown): Promise<LocalImageData> => {
      const entry = validatePreviewSender(event);
      const messageId = parseText(value, 64);
      const request = { ...entry.request };
      /** 图片切换后迟到的读取不能继续返回上一张内容。 */
      const validate = (): void => {
        if (
          validatePreviewSender(event) !== entry ||
          (entry.temporary
            ? entry.request.messageId
            : getImagePreviewMessage(
                entry.request.conversationId,
                entry.request.messageId,
              ).id) !== messageId
        )
          throw new Error('预览图片已切换');
      };
      validate();
      const image = await (entry.temporary
        ? entry.temporary.read(validate)
        : dependencies.readImage(request, validate));
      validate();
      return image;
    },
  );
  ipcMain.handle(
    'image-preview:recognize-text',
    async (
      event,
      value: unknown,
      job: unknown,
    ): Promise<ImageOcrResult | null> => {
      const entry = validatePreviewSender(event);
      const messageId = parseText(value, 64);
      const id = parseText(job, 64);
      const request = entry.request;
      const temporary = entry.temporary;
      const session = requireAuthenticatedSession();
      const source = temporary
        ? undefined
        : getImagePreviewMessage(request.conversationId, request.messageId);
      // 页面切换与已发出的 IPC 可能交错，旧显示请求直接结束，不作为识别错误。
      if (messageId !== request.messageId && messageId !== source?.id)
        return null;
      if (entry.recognitions.has(id)) throw new Error('重复的图片识别请求');
      const key = JSON.stringify([
        entry.owner,
        request.conversationId,
        source?.clientMsgId ?? source?.id ?? request.messageId,
        source?.content,
        temporary ? event.sender.id : null,
      ]);
      const controller = new AbortController();
      /** 后台任务只绑定原授权和消息资源，切图或关闭普通预览不撤销权限。 */
      const validate = (): void => {
        controller.signal.throwIfAborted();
        if (
          requireAuthenticatedSession() !== session ||
          getStorageOwner() !== entry.owner
        )
          throw new Error('图片识别授权已失效');
        if (temporary) {
          if (validatePreviewSender(event) !== entry)
            throw new Error('临时图片已失效');
          temporary.validate();
        } else if (
          getImagePreviewMessage(request.conversationId, request.messageId)
            .content !== source?.content
        )
          throw new Error('图片消息已变化');
      };
      /** 只向仍显示本图片且授权有效的窗口交付结果。 */
      const isCurrent = (): boolean => {
        try {
          validate();
          return (
            validatePreviewSender(event) === entry && entry.request === request
          );
        } catch {
          return false;
        }
      };
      /** 每次命中均验证原始字节摘要，不把另一版本图片的结果用于当前图片。 */
      const read = async (
        signal?: AbortSignal,
      ): Promise<{
        image: LocalImageData;
        sha256: string;
      }> => {
        /** 逐段读取时也响应队列撤销，避免取消后继续下载旧图片。 */
        const validateRead = (): void => {
          signal?.throwIfAborted();
          validate();
        };
        validateRead();
        const image = await (temporary
          ? temporary.read(validateRead)
          : dependencies.readImage(request, validateRead));
        validateRead();
        return {
          image,
          sha256: createHash('sha256').update(image.bytes).digest('hex'),
        };
      };
      entry.recognitions.set(id, (): void => {
        controller.abort();
        recognitionQueue.cancel(
          (task) => task.scope === session && task.key === key,
        );
      });
      try {
        // 已完成的图片直接查库，不必等待其他图片的模型推理。
        if (!temporary) {
          const { sha256 } = await read();
          const cached = getImageOcrCache(
            request.conversationId,
            request.messageId,
            sha256,
          );
          if (cached) return isCurrent() ? cached : null;
        }
        validate();
        const result = await recognitionQueue.enqueue({
          key,
          scope: session,
          conversationId: request.conversationId,
          messageIds: [
            request.messageId,
            source?.id,
            source?.clientMsgId,
          ].filter((item): item is string => Boolean(item)),
          execute: async (signal): Promise<ImageOcrResult> => {
            /** 取消与资源校验同时覆盖读取、推理及落库，不依赖当前显示图片。 */
            const validateTask = (): void => {
              signal.throwIfAborted();
              validate();
            };
            validateTask();
            const { image, sha256 } = await read(signal);
            validateTask();
            if (!temporary) {
              const cached = getImageOcrCache(
                request.conversationId,
                request.messageId,
                sha256,
              );
              if (cached) return cached;
            }
            const recognized = await recognizeImageText(image, signal);
            validateTask();
            if (temporary) return recognized;
            saveImageOcrCache(
              request.conversationId,
              request.messageId,
              sha256,
              recognized,
            );
            const saved = getImageOcrCache(
              request.conversationId,
              request.messageId,
              sha256,
            );
            if (!saved) throw new Error('图片识别结果保存失败，请重试');
            return saved;
          },
        });
        return isCurrent() ? result : null;
      } catch (error) {
        if (!isCurrent()) return null;
        throw error;
      } finally {
        entry.recognitions.delete(id);
      }
    },
  );
  ipcMain.handle(
    'image-preview:cancel-recognition',
    (event, job: unknown): void => {
      const entry = validatePreviewSender(event);
      entry.recognitions.get(parseText(job, 64))?.();
    },
  );
  ipcMain.handle('image-preview:navigate', (event, direction: unknown) => {
    const entry = validatePreviewSender(event);
    if (direction !== 'previous' && direction !== 'next')
      throw new Error('无效的图片切换方向');
    if (entry.temporary) return entry.temporary.context;
    const adjacent = findAdjacentImageMessage(
      entry.request.conversationId,
      entry.request.messageId,
      direction,
    );
    if (adjacent) {
      entry.request = { ...entry.request, messageId: adjacent.id };
    }
    const context = readImagePreview(entry.request);
    entry.window.setTitle(context.image.fileName);
    return context;
  });
  ipcMain.handle('image-preview:state', (event) =>
    windowState(validatePreviewSender(event).window),
  );
  ipcMain.handle(
    'image-preview:control',
    (event, action: unknown): ImagePreviewWindowState => {
      const { window } = validatePreviewSender(event);
      switch (action) {
        case 'minimize':
          window.minimize();
          break;
        case 'maximize':
          if (window.isMaximized()) window.unmaximize();
          else window.maximize();
          break;
        case 'fullscreen':
          window.setFullScreen(!window.isFullScreen());
          break;
        case 'pin':
          window.setAlwaysOnTop(!window.isAlwaysOnTop());
          break;
        case 'close': {
          const state = windowState(window);
          window.close();
          return state;
        }
        default:
          throw new Error('无效的图片窗口操作');
      }
      return windowState(window);
    },
  );
};
