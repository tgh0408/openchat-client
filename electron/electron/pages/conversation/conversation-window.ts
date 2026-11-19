import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage, WebContents } from 'electron';
import path from 'node:path';
import type { ContextMenuOwner } from '../context-menu/context-menu-window';
import { requireAuthenticatedSession } from '../../services/auth/auth';
import {
  getStorageOwner,
  listConversations,
  requireRemoteConversation,
  readOutgoingMessage,
  saveMessage,
} from '../../services/database/database';
import type { AuthSession } from '../../../shared/auth/auth';
import type { Message } from '../../../shared/storage/database';
import type { ResourceSseMessage } from '../../../shared/windows/desktop';
import { parseFriendProfileAnchor } from '../../../shared/contacts/friend-profile';
import type { FriendRemarkUpdated } from '../../../shared/contacts/friend-remark';
import type { GroupExitedNotification } from '../../../shared/contacts/group-notification';
import type { ConversationWindowContext } from '../../../shared/windows/conversation-window';
import {
  conversationChannels,
  conversationChannelRoom,
} from '../../../shared/windows/conversation-window';
import { dispatchChatIpc } from '../../services/ipc/chat-ipc';
import { parseText } from '../../services/database/database-validation';
import { parseMessage } from '../../services/database/database-validation';
import { sendWindowNotification } from '../../services/ipc/window-notifications';
import { flushConversationReads } from '../../services/chat/conversation-reads';
import {
  closeConversationDrag,
  registerConversationDrag,
} from '../workspace/conversations/conversation-drag';

interface Entry {
  window: BrowserWindow;
  roomId: string;
  url: string;
  session: AuthSession;
  pending: Set<string>;
}
const windows = new Map<number, Entry>();
const authorizedCalls = new WeakMap<IpcMainInvokeEvent, Entry>();
const escapedDrags = new WeakSet<BrowserWindow>();

/** 麦克风权限只授予仍属于原授权的独立聊天主框架。 */
export const canConversationRecord = (
  contents: WebContents | null,
  url: string,
  main: boolean,
): boolean => {
  if (!contents || !main) return false;
  const entry = windows.get(contents.id);
  return (
    !!entry &&
    !entry.window.isDestroyed() &&
    contents.getURL() === entry.url &&
    url === entry.url &&
    requireAuthenticatedSession() === entry.session
  );
};

/** 退出、重载或删除会话时销毁对应独立窗口。 */
export const closeConversationWindows = (roomId?: string): void => {
  closeConversationDrag(roomId);
  for (const entry of [...windows.values()])
    if (!roomId || entry.roomId === roomId) entry.window.destroy();
};

/** 每个调用和异步回调均重新核对窗口、框架、URL、原授权和会话存在性。 */
const validate = (event: IpcMainInvokeEvent): Entry => {
  const entry = windows.get(event.sender.id);
  if (
    !entry ||
    entry.window.isDestroyed() ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== entry.url ||
    requireAuthenticatedSession() !== entry.session ||
    getStorageOwner() !== entry.session.user.id
  )
    throw new Error('独立聊天窗口已失效');
  requireRemoteConversation(entry.roomId);
  return entry;
};

/** 原处理器只接受经专用入口验证过的调用，不放宽主窗口原有 IPC。 */
export const isConversationCall = (event: IpcMainInvokeEvent): boolean => {
  const entry = authorizedCalls.get(event);
  if (!entry) return false;
  return validate(event) === entry;
};

/** 菜单仅借用原会话窗口的来源校验，不扩大其业务 IPC 白名单。 */
export const resolveConversationMenuOwner = (
  event: IpcMainInvokeEvent,
): ContextMenuOwner | undefined => {
  if (!windows.has(event.sender.id)) return undefined;
  const entry = validate(event);
  return {
    window: entry.window,
    validate: (): void => {
      if (validate(event) !== entry) throw new Error('会话窗口已变化');
    },
  };
};

/** 落库后推送真实记录，子窗口不再次解析或保存 SSE 消息。 */
export const notifyConversationMessage = (
  message: Message,
  sourceId?: number,
): void => {
  for (const entry of windows.values())
    if (entry.roomId === message.conversationId) {
      if (message.status !== 'pending' && message.clientMsgId)
        entry.pending.delete(message.clientMsgId);
      if (entry.window.webContents.id !== sourceId)
        sendWindowNotification(entry.window, 'conversation:message', message);
    }
};

/** 退出确认只送达原授权下绑定该群的窗口，历史仍可留在窗口中查看。 */
export const notifyConversationGroupExited = (
  notification: GroupExitedNotification,
): void => {
  const session = requireAuthenticatedSession();
  for (const entry of windows.values()) {
    if (entry.session === session && entry.roomId === notification.roomId)
      sendWindowNotification(entry.window, 'chat:group-exited', notification);
  }
};

/** 向当前账号独立窗口同步连接状态。 */
export const notifyConversationStatus = (status: string): void => {
  for (const entry of windows.values())
    sendWindowNotification(entry.window, 'resource:sse-status', status);
};

/** 补历史提示只转发给当前授权下绑定同一会话的独立窗口。 */
export const notifyConversationHistorySync = (
  roomId: string,
  message: ResourceSseMessage,
): void => {
  const session = requireAuthenticatedSession();
  for (const entry of windows.values()) {
    if (entry.session === session && entry.roomId === roomId)
      sendWindowNotification(entry.window, 'resource:sse-message', message);
  }
};

/** 备注确认只发送到原账号、原单聊，不广播给不相关窗口。 */
export const notifyConversationRemark = (update: FriendRemarkUpdated): void => {
  for (const entry of windows.values()) {
    if (
      entry.session.user.id === update.userId &&
      entry.roomId === update.roomId
    )
      sendWindowNotification(entry.window, 'friend-remark:updated', update);
  }
};

/** 注册会话绑定窗口及唯一的受限业务转发入口。 */
export const registerConversationWindows = (dependencies: {
  validateMain: (event: IpcMainInvokeEvent) => void;
  getMain: () => BrowserWindow | undefined;
  rendererUrl: () => string;
  icon: () => NativeImage;
  openFriendProfile: (
    parent: BrowserWindow,
    roomId: string,
    anchor: ReturnType<typeof parseFriendProfileAnchor>,
    targetUid: unknown,
    validate: () => void,
  ) => Promise<void>;
  closeFriendProfile: (roomId: string) => void;
}): void => {
  registerConversationDrag(dependencies.validateMain);
  const mainWindow = dependencies.getMain();
  mainWindow?.webContents.on('before-input-event', (_event, input) => {
    if (input.key === 'Escape') escapedDrags.add(mainWindow);
  });
  ipcMain.handle('conversation:drag-start', (event): void => {
    dependencies.validateMain(event);
    const main = dependencies.getMain();
    if (main) escapedDrags.delete(main);
  });
  ipcMain.handle(
    'conversation:open',
    async (event, value: unknown, outside: unknown = false): Promise<void> => {
      dependencies.validateMain(event);
      if (typeof outside !== 'boolean') throw new Error('无效的拖拽状态');
      const roomId = parseText(value, 64);
      requireRemoteConversation(roomId);
      const session = requireAuthenticatedSession();
      const main = dependencies.getMain();
      if (!main) throw new Error('主窗口已关闭');
      if (outside && escapedDrags.has(main)) return;
      const cursor = screen.getCursorScreenPoint();
      const bounds = main.getBounds();
      if (
        outside &&
        cursor.x >= bounds.x &&
        cursor.x < bounds.x + bounds.width &&
        cursor.y >= bounds.y &&
        cursor.y < bounds.y + bounds.height
      )
        return;
      const existing = [...windows.values()].find(
        (entry) => entry.roomId === roomId,
      );
      if (existing) {
        existing.window.restore();
        existing.window.show();
        existing.window.focus();
        return;
      }
      const area = screen.getDisplayNearestPoint(cursor).workArea;
      const width = Math.min(600, area.width);
      const height = Math.min(640, area.height);
      const window = new BrowserWindow({
        width,
        height,
        minWidth: Math.min(420, area.width),
        minHeight: Math.min(480, area.height),
        x: Math.max(
          area.x,
          Math.min(cursor.x - 100, area.x + area.width - width),
        ),
        y: Math.max(
          area.y,
          Math.min(cursor.y - 40, area.y + area.height - height),
        ),
        frame: false,
        show: false,
        backgroundColor: '#f8f8f8',
        title: requireRemoteConversation(roomId).title,
        icon: dependencies.icon(),
        autoHideMenuBar: true,
        webPreferences: {
          preload: path.join(__dirname, 'conversation-preload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      const url = new URL(dependencies.rendererUrl());
      url.hash = 'conversation';
      const entry: Entry = {
        window,
        roomId,
        session,
        url: url.href,
        pending: new Set(),
      };
      windows.set(window.webContents.id, entry);
      let closing = false;
      window.on('close', (event) => {
        if (closing) return;
        closing = true;
        event.preventDefault();
        // 队列绑定账号而非子窗口，关闭后仍能继续重试持久化进度。
        void flushConversationReads();
        window.destroy();
      });
      const windowId = window.webContents.id;
      window.on('closed', () => {
        windows.delete(windowId);
        try {
          if (requireAuthenticatedSession() !== session) return;
          for (const id of entry.pending) {
            const message = readOutgoingMessage(roomId, id);
            if (
              message?.status === 'pending' &&
              !['temporary', 'upload-cancelled'].includes(message.messageType)
            )
              saveMessage({ ...message, status: 'failed' });
          }
        } catch {
          /* 授权已撤销时不再写入旧账号。 */
        }
      });
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      window.webContents.on('will-navigate', (navigation) =>
        navigation.preventDefault(),
      );
      window.webContents.on('render-process-gone', () => window.destroy());
      try {
        await window.loadURL(entry.url);
        if (window.isDestroyed()) return;
        if (requireAuthenticatedSession() !== session)
          throw new Error('账号已变化');
        window.show();
        window.focus();
      } catch (error) {
        if (!window.isDestroyed()) window.destroy();
        throw error;
      }
    },
  );
  ipcMain.handle('conversation:context', (event): ConversationWindowContext => {
    const entry = validate(event);
    let offset = 0;
    while (true) {
      const page = listConversations(200, offset);
      const conversation = page.find((item) => item.id === entry.roomId);
      if (conversation) return { conversation, user: entry.session.user };
      if (page.length < 200) throw new Error('会话已移除');
      offset += page.length;
    }
  });
  ipcMain.handle('conversation:control', (event, action: unknown): boolean => {
    const { window } = validate(event);
    switch (action) {
      case 'close':
        window.close();
        return false;
      case 'minimize':
        window.minimize();
        return false;
      case 'maximize':
        if (window.isMaximized()) window.unmaximize();
        else window.maximize();
        return window.isMaximized();
      case 'pin':
        window.setAlwaysOnTop(!window.isAlwaysOnTop());
        return window.isAlwaysOnTop();
      default:
        throw new Error('无效的窗口操作');
    }
  });
  ipcMain.handle(
    'conversation:invoke',
    async (event, channel: unknown, args: unknown): Promise<unknown> => {
      const entry = validate(event);
      if (
        typeof channel !== 'string' ||
        !conversationChannels.has(channel) ||
        !Array.isArray(args) ||
        args.length > 5
      )
        throw new Error('独立窗口不允许此操作');
      const room = conversationChannelRoom(channel, args);
      if (room !== null && room !== entry.roomId)
        throw new Error('不能操作其他会话');
      if (channel === 'database:save-message') {
        const message = parseMessage(args[0]);
        if (message.senderId !== entry.session.user.id)
          throw new Error('不能修改他人消息');
        if (message.status === 'pending' && message.clientMsgId)
          entry.pending.add(message.clientMsgId);
      }
      if (channel === 'friend-profile:open') {
        if (args.length !== 3) throw new Error('资料窗口参数无效');
        const roomId = parseText(args[0], 64);
        const anchor = parseFriendProfileAnchor(args[1]);
        await dependencies.openFriendProfile(
          entry.window,
          roomId,
          anchor,
          args[2],
          () => validate(event),
        );
        validate(event);
        return;
      }
      if (channel === 'friend-profile:dismiss') {
        if (args.length !== 0) throw new Error('资料窗口参数无效');
        dependencies.closeFriendProfile(entry.roomId);
        return;
      }
      authorizedCalls.set(event, entry);
      const result = await dispatchChatIpc(channel, event, args);
      validate(event);
      return result;
    },
  );
};
