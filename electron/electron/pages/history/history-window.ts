import { BrowserWindow, ipcMain, nativeImage, screen, shell } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import type { ContextMenuOwner } from '../context-menu/context-menu-window';
import { handleChatIpc } from '../../services/ipc/chat-ipc';
import type { HistoryWindowContext } from '../../../shared/windows/desktop';
import {
  getHistoryContext,
  getHistoryIconSource,
  getHistoryMessage,
  readMessageReply,
  readHistoryReplyPage,
  getStorageOwner,
  searchMessages,
} from '../../services/database/database';
import type { Contact, Message } from '../../../shared/storage/database';
import { sendWindowNotification } from '../../services/ipc/window-notifications';
import {
  parseBoolean,
  parseHistoryQuery,
  parseText,
} from '../../services/database/database-validation';
import { requireLocalUser } from '../../services/auth/auth';
import type { ImagePreviewRequest } from '../../../shared/windows/image-preview';
import { parseImagePreviewRequest } from '../image-preview/image-preview-data';
import { createHistoryGroupIconScript } from './history-icon';
import { messageDisplayUid } from '../../../shared/chat/messages/recall-message';
import { RtcMediaMode } from '../../../shared/rtc/rtc';

interface HistoryEntry {
  window: BrowserWindow;
  owner: string;
  context: HistoryWindowContext;
  url: string;
}

interface HistoryDependencies {
  getDefaultIcon: () => NativeImage;
  loadAvatarIcon: (
    avatar: string | null,
    validateSource: () => void,
  ) => Promise<NativeImage>;
  readContact: (
    uid: string,
    validateSource: () => void,
    roomId?: string,
    force?: boolean,
  ) => Promise<Contact | null>;
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  validateMainSender: (event: IpcMainInvokeEvent) => void;
  revealImage: (
    request: ImagePreviewRequest,
    validateSource: () => void,
  ) => Promise<string>;
}

const historyWindows = new Map<number, HistoryEntry>();

/** 校验历史回拨请求的媒体类型，不接受历史窗口构造的其他 RTC 参数。 */
const parseRtcMediaMode = (value: unknown): RtcMediaMode => {
  switch (value) {
    case RtcMediaMode.AUDIO:
    case RtcMediaMode.VIDEO:
      return value;
    default:
      throw new Error('无效的通话类型');
  }
};

/** 只向绑定会话的窗口发送撤回终态，不暴露其他会话数据或写入能力。 */
export const notifyHistoryRecall = (message: Message): void => {
  for (const entry of historyWindows.values()) {
    if (
      entry.context.conversationId === message.conversationId &&
      entry.owner === getStorageOwner()
    )
      sendWindowNotification(entry.window, 'history:message-recalled', message);
  }
};

/** 销毁旧数据空间的历史窗口，避免退出或重载后仍显示旧用户内容。 */
export const closeHistoryWindows = (): void => {
  for (const entry of [...historyWindows.values()]) entry.window.destroy();
  historyWindows.clear();
};

/** 会话删除成功后关闭对应的历史窗口。 */
export const closeConversationHistory = (conversationId: string): void => {
  for (const entry of [...historyWindows.values()]) {
    if (entry.context.conversationId === conversationId) entry.window.destroy();
  }
};

/** 校验窗口身份、主框架、URL 与数据空间，不扩展主窗口的 IPC 权限。 */
const validateHistorySender = (event: IpcMainInvokeEvent): HistoryEntry => {
  requireLocalUser();
  const entry = historyWindows.get(event.sender.id);
  if (
    !entry ||
    entry.window.isDestroyed() ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== entry.url ||
    entry.owner !== getStorageOwner() ||
    !entry.owner
  )
    throw new Error('无效的历史窗口调用');
  return entry;
};

/** 图片预览仅允许使用当前历史窗口绑定的会话，不扩展其他主窗口权限。 */
export const validateHistoryImageSender = (
  event: IpcMainInvokeEvent,
  conversationId: string,
): void => {
  if (validateHistorySender(event).context.conversationId !== conversationId)
    throw new Error('不能预览其他会话的图片');
};

/** 历史菜单沿用只读窗口归属，选择仍交回历史页原有受控操作。 */
export const resolveHistoryMenuOwner = (
  event: IpcMainInvokeEvent,
): ContextMenuOwner | undefined => {
  if (!historyWindows.has(event.sender.id)) return undefined;
  const entry = validateHistorySender(event);
  return {
    window: entry.window,
    validate: (): void => {
      if (validateHistorySender(event) !== entry)
        throw new Error('历史窗口已变化');
    },
  };
};

/** 注册历史窗口专属 IPC，仅允许主窗口创建，子窗口只读绑定会话。 */
export const registerHistoryIpc = (dependencies: HistoryDependencies): void => {
  /** 同一会话复用已有窗口；新窗口不设模态父级，可独立移动与最小化。 */
  const openHistory = async (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): Promise<void> => {
    dependencies.validateMainSender(event);
    const conversationId = parseText(value);
    const context = getHistoryContext(conversationId);
    const iconSource = getHistoryIconSource(conversationId);
    const localUser = requireLocalUser();
    const owner = getStorageOwner();
    if (!owner) throw new Error('请先登录');
    const existing = [...historyWindows.values()].find(
      (entry) =>
        entry.owner === owner &&
        entry.context.conversationId === conversationId,
    );
    if (existing) {
      if (existing.window.isMinimized()) existing.window.restore();
      existing.window.show();
      existing.window.focus();
      return;
    }
    const main = dependencies.getMainWindow();
    if (!main) throw new Error('主窗口已关闭');
    const workArea = screen.getDisplayMatching(main.getBounds()).workArea;
    const width = Math.min(570, workArea.width);
    const height = Math.min(720, workArea.height);
    const window = new BrowserWindow({
      width,
      height,
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      minWidth: Math.min(360, workArea.width),
      minHeight: Math.min(420, workArea.height),
      frame: false,
      resizable: true,
      maximizable: false,
      fullscreenable: false,
      show: false,
      backgroundColor: '#fafafa',
      title: `与“${context.conversationTitle}”的聊天记录`,
      icon: dependencies.getDefaultIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'history-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    const url = new URL(dependencies.getRendererUrl());
    url.hash = 'history';
    const entry: HistoryEntry = { window, owner, context, url: url.href };
    const id = window.webContents.id;
    historyWindows.set(id, entry);
    /** 图标异步返回后仍须属于原窗口、页面和已验证账号。 */
    const validateIconSource = (): void => {
      if (
        window.isDestroyed() ||
        historyWindows.get(id) !== entry ||
        requireLocalUser() !== localUser ||
        getStorageOwner() !== owner ||
        window.webContents.getURL() !== entry.url
      )
        throw new Error('历史窗口图标请求已失效');
    };
    /** 单聊使用会话头像，群聊只在本地绘制名称首字，失败保留默认图标。 */
    const updateIcon = async (): Promise<void> => {
      try {
        validateIconSource();
        let icon: NativeImage;
        switch (iconSource.type) {
          case 1: {
            const png: unknown =
              await window.webContents.executeJavaScriptInIsolatedWorld(1001, [
                { code: createHistoryGroupIconScript(iconSource.title) },
              ]);
            if (
              typeof png !== 'string' ||
              !png.startsWith('data:image/png;base64,') ||
              png.length > 128 * 1024
            )
              return;
            icon = nativeImage.createFromDataURL(png);
            break;
          }
          case 2:
            icon = await dependencies.loadAvatarIcon(
              iconSource.avatar,
              validateIconSource,
            );
            break;
          default:
            return;
        }
        validateIconSource();
        if (!icon.isEmpty()) window.setIcon(icon);
      } catch {
        // 图标不可用或窗口已关闭时不影响历史阅读。
      }
    };
    window.on('closed', () => {
      historyWindows.delete(id);
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
      if (owner !== getStorageOwner() || !dependencies.getMainWindow()) {
        window.destroy();
        return;
      }
      window.show();
      window.focus();
      void updateIcon();
    } catch (error) {
      if (window.isDestroyed()) return;
      window.destroy();
      throw error;
    }
  };

  handleChatIpc('history:open', openHistory);
  ipcMain.handle('history:context', (event) => {
    const entry = validateHistorySender(event);
    return getHistoryContext(entry.context.conversationId);
  });
  ipcMain.handle('history:search', (event, value: unknown) => {
    const entry = validateHistorySender(event);
    const query = parseHistoryQuery(value);
    if (query.conversationId !== entry.context.conversationId)
      throw new Error('不能查询其他会话');
    return searchMessages(query);
  });
  ipcMain.handle(
    'history:message-reply',
    (event, roomId: unknown, messageId: unknown) => {
      const entry = validateHistorySender(event);
      const conversationId = parseText(roomId, 64);
      if (conversationId !== entry.context.conversationId)
        throw new Error('不能查询其他会话的引用消息');
      return readMessageReply(conversationId, parseText(messageId, 64));
    },
  );
  ipcMain.handle('history:reply-page', (event, messageId: unknown) => {
    const entry = validateHistorySender(event);
    return readHistoryReplyPage(
      entry.context.conversationId,
      parseText(messageId, 64),
    );
  });
  ipcMain.handle('history:rtc-call-request', (event, value: unknown): void => {
    const entry = validateHistorySender(event);
    const main = dependencies.getMainWindow();
    if (!main) throw new Error('主聊天窗口已关闭');
    const mediaMode = parseRtcMediaMode(value);
    sendWindowNotification(main, 'history:rtc-call-requested', {
      conversationId: entry.context.conversationId,
      mediaMode,
    });
  });
  ipcMain.handle(
    'history:message-contact',
    async (
      event,
      value: unknown,
      force: unknown = false,
    ): Promise<Contact | null> => {
      const entry = validateHistorySender(event);
      const messageId = parseText(value, 64);
      const uid = messageDisplayUid(
        getHistoryMessage(entry.context.conversationId, messageId),
      );
      if (!uid) return null;
      /** 异步资料返回前重新核对窗口、绑定会话及消息归属。 */
      const validateSource = (): void => {
        if (
          validateHistorySender(event) !== entry ||
          messageDisplayUid(
            getHistoryMessage(entry.context.conversationId, messageId),
          ) !== uid
        )
          throw new Error('历史消息已变化');
      };
      const contact = await dependencies.readContact(
        uid,
        validateSource,
        entry.context.conversationId,
        parseBoolean(force),
      );
      validateSource();
      return contact;
    },
  );
  ipcMain.handle(
    'history:show-image-in-folder',
    async (event, value: unknown): Promise<void> => {
      const request = parseImagePreviewRequest(value);
      const entry = validateHistorySender(event);
      if (request.conversationId !== entry.context.conversationId)
        throw new Error('图片不属于当前历史会话');
      const filePath = await dependencies.revealImage(request, () => {
        validateHistoryImageSender(event, request.conversationId);
      });
      validateHistoryImageSender(event, request.conversationId);
      shell.showItemInFolder(filePath);
    },
  );
  ipcMain.handle('history:minimize', (event) => {
    validateHistorySender(event).window.minimize();
  });
  ipcMain.handle('history:close', (event) => {
    validateHistorySender(event).window.close();
  });
};
