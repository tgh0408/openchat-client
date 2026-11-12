import { BrowserWindow, ipcMain, screen, session } from 'electron';
import type { IpcMainInvokeEvent, NativeImage, WebContents } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { handleChatIpc } from '../../services/ipc/chat-ipc';
import type { ImagePreviewRequest } from '../../../shared/windows/image-preview';
import {
  parseVideoContent,
  parseVideoPlaybackProgress,
} from '../../../shared/media/video/video';
import type { VideoPlaybackProgress } from '../../../shared/media/video/video';
import {
  getStorageOwner,
  getVideoMessage,
  getVideoPlaybackPosition,
  saveVideoPlaybackProgress,
} from '../../services/database/database';
import { getSessionAccess, requireLocalUser } from '../../services/auth/auth';
import { parseImagePreviewRequest } from '../image-preview/image-preview-data';
import { videoFileResponse } from '../../services/media/video/video-stream';
import type { VideoFileStore } from '../../services/media/video/video-files';
import { sendWindowNotification } from '../../services/ipc/window-notifications';

interface VideoWindowEntry {
  window: BrowserWindow;
  request: ImagePreviewRequest;
  owner: string;
  url: string;
  mediaUrl: string;
  filePath: string;
  resourceUrl: string;
  progress?: VideoPlaybackProgress;
  lastSavedAt: number;
  closeTimer?: ReturnType<typeof setTimeout>;
  flushProgress: () => void;
}

const windows = new Map<number, VideoWindowEntry>();

/** 退出和主页面重载销毁播放器；删除会话仅关闭其绑定窗口。 */
export const closeVideoWindows = (
  conversationId?: string,
  messageId?: string,
): void => {
  for (const entry of [...windows.values()])
    if (
      (!conversationId || entry.request.conversationId === conversationId) &&
      (!messageId || entry.request.messageId === messageId)
    ) {
      try {
        if (!messageId) entry.flushProgress();
      } catch {
        console.warn('视频窗口关闭时未能保存播放位置');
      } finally {
        entry.window.destroy();
      }
    }
};

/** 独立沙箱窗口只可播放本次账号已落盘的单条视频。 */
export const registerVideoWindow = (dependencies: {
  files: VideoFileStore;
  getDefaultIcon: () => NativeImage;
  loadSenderIcon: (uid: string, validate: () => void) => Promise<NativeImage>;
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  validateSource: (
    event: IpcMainInvokeEvent,
    request: ImagePreviewRequest,
  ) => void;
}): void => {
  /** 持续核对本地阅读权与绑定消息，令牌过期不授予任何远端请求。 */
  const validateEntry = (entry: VideoWindowEntry): void => {
    if (
      entry.window.isDestroyed() ||
      windows.get(entry.window.webContents.id) !== entry ||
      requireLocalUser().id !== entry.owner ||
      getStorageOwner() !== entry.owner
    )
      throw new Error('视频窗口已失效');
    const message = getVideoMessage(
      entry.request.conversationId,
      entry.request.messageId,
    );
    if (parseVideoContent(message.content)?.url !== entry.resourceUrl)
      throw new Error('视频消息已变化');
  };
  handleChatIpc('video:open', async (event, value: unknown): Promise<void> => {
    const request = parseImagePreviewRequest(value);
    dependencies.validateSource(event, request);
    const user = requireLocalUser();
    const owner = user.id;
    /** 打开期间仍绑定最初的账号与来源窗口。 */
    const validate = (): void => {
      dependencies.validateSource(event, request);
      if (requireLocalUser() !== user) throw new Error('视频账号已变化');
    };
    const filePath = await dependencies.files.local(request, validate);
    validate();
    const message = getVideoMessage(request.conversationId, request.messageId);
    const video = parseVideoContent(message.content);
    if (!video?.url) throw new Error('视频信息无效');
    const existing = [...windows.values()].find(
      (entry) =>
        entry.owner === owner &&
        entry.request.conversationId === request.conversationId &&
        getVideoMessage(entry.request.conversationId, entry.request.messageId)
          .id === message.id,
    );
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return;
    }
    const main = dependencies.getMainWindow();
    if (!main || main.isDestroyed()) throw new Error('主窗口已关闭');
    const area = screen.getDisplayMatching(main.getBounds()).workArea;
    const token = randomUUID();
    const partition = session.fromPartition(`video-${token}`, { cache: false });
    partition.on('will-download', (download) => download.preventDefault());
    const window = new BrowserWindow({
      width: Math.min(960, area.width),
      height: Math.min(720, area.height),
      minWidth: Math.min(360, area.width),
      minHeight: Math.min(280, area.height),
      show: false,
      title: video.fileName,
      icon: dependencies.getDefaultIcon(),
      autoHideMenuBar: true,
      backgroundColor: '#141414',
      webPreferences: {
        session: partition,
        preload: path.join(__dirname, 'video-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const url = new URL(dependencies.getRendererUrl());
    url.hash = 'video-player';
    const entry: VideoWindowEntry = {
      window,
      owner,
      request,
      url: url.href,
      mediaUrl: `openchat-video://play/${token}`,
      filePath,
      resourceUrl: video.url,
      lastSavedAt: Date.now(),
      /** 强制关闭时同步保存最后上报位置，不等待即将销毁的渲染页面。 */
      flushProgress: (): void => {
        if (!entry.progress || getSessionAccess().readOnly) return;
        validateEntry(entry);
        saveVideoPlaybackProgress(entry.resourceUrl, entry.progress);
        entry.lastSavedAt = Date.now();
      },
    };
    const id = window.webContents.id;
    windows.set(id, entry);
    /** 仅向当前已授权播放器的主框架开放全屏，其他权限仍默认拒绝。 */
    const allowFullscreen = (
      contents: WebContents | null,
      permission: string,
      details: { isMainFrame: boolean; requestingUrl?: string },
    ): boolean => {
      if (
        permission !== 'fullscreen' ||
        contents !== window.webContents ||
        !details.isMainFrame ||
        details.requestingUrl !== entry.url
      )
        return false;
      try {
        validateEntry(entry);
        return contents.mainFrame.url === entry.url;
      } catch {
        return false;
      }
    };
    partition.setPermissionRequestHandler(
      (contents, permission, callback, details) =>
        callback(allowFullscreen(contents, permission, details)),
    );
    partition.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        allowFullscreen(contents, permission, details),
    );
    /** 图标异步更新不阻塞播放，关闭或账号变化后丢弃迟到的头像。 */
    const updateSenderIcon = async (): Promise<void> => {
      try {
        const icon = await dependencies.loadSenderIcon(message.senderId, () =>
          validateEntry(entry),
        );
        validateEntry(entry);
        if (!icon.isEmpty()) window.setIcon(icon);
      } catch {
        // 资料或头像不可用时保留默认头像，不影响本地视频播放。
      }
    };
    void updateSenderIcon();
    partition.protocol.handle(
      'openchat-video',
      async (mediaRequest): Promise<Response> => {
        try {
          validateEntry(entry);
          if (
            mediaRequest.url !== entry.mediaUrl ||
            !['GET', 'HEAD'].includes(mediaRequest.method)
          )
            return new Response(null, { status: 403 });
          return await videoFileResponse(
            entry.filePath,
            mediaRequest.headers.get('range'),
            () => validateEntry(entry),
            mediaRequest.method === 'HEAD',
          );
        } catch {
          return new Response(null, { status: 403 });
        }
      },
    );
    window.on('closed', () => {
      clearTimeout(entry.closeTimer);
      windows.delete(id);
      partition.protocol.unhandle('openchat-video');
    });
    window.on('close', (event) => {
      event.preventDefault();
      if (entry.closeTimer) return;
      // 正常关闭等待最后一帧；页面失去响应时用已上报位置兜底，不能阻塞退出。
      entry.closeTimer = setTimeout(() => {
        try {
          entry.flushProgress();
        } catch {
          console.warn('视频窗口关闭时未能保存播放位置');
        } finally {
          if (!window.isDestroyed()) window.destroy();
        }
      }, 1000);
      sendWindowNotification(window, 'video-player:closing', null);
    });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (navigation) =>
      navigation.preventDefault(),
    );
    window.webContents.on('render-process-gone', () => {
      try {
        entry.flushProgress();
      } catch {
        console.warn('视频播放异常退出，保留上次已保存的位置');
      } finally {
        if (!window.isDestroyed()) window.destroy();
      }
    });
    try {
      await window.loadURL(entry.url);
      validate();
      validateEntry(entry);
      window.show();
      window.focus();
    } catch (error) {
      if (!window.isDestroyed()) window.destroy();
      throw error;
    }
  });
  /** 播放器只能更新本窗口绑定的视频，不接受页面指定账号、消息或资源地址。 */
  const playerEntry = (event: IpcMainInvokeEvent): VideoWindowEntry => {
    const entry = windows.get(event.sender.id);
    if (
      !entry ||
      event.sender !== entry.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== entry.url
    )
      throw new Error('无效的视频窗口调用');
    validateEntry(entry);
    return entry;
  };
  ipcMain.handle('video-player:context', (event) => {
    const entry = playerEntry(event);
    entry.flushProgress();
    const video = parseVideoContent(
      getVideoMessage(entry.request.conversationId, entry.request.messageId)
        .content,
    );
    if (!video) throw new Error('视频信息无效');
    return {
      fileName: video.fileName,
      url: entry.mediaUrl,
      position: getVideoPlaybackPosition(entry.resourceUrl),
    };
  });
  ipcMain.handle('video-player:progress', (event, value: unknown) => {
    const entry = playerEntry(event);
    entry.progress = parseVideoPlaybackProgress(value);
    if (Date.now() - entry.lastSavedAt >= 5000) entry.flushProgress();
  });
  ipcMain.handle('video-player:save-progress', (event, value: unknown) => {
    const entry = playerEntry(event);
    if (value !== null) entry.progress = parseVideoPlaybackProgress(value);
    entry.flushProgress();
    if (entry.closeTimer && !entry.window.isDestroyed()) entry.window.destroy();
  });
};
