import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import type { AuthSession } from '../../../../shared/auth/auth';
import { SessionExpiredError } from '../../../../shared/auth/auth';
import {
  parseAddFriendQuery,
  requestAddFriend,
  resolveAddFriendRelationship,
} from '../../../../shared/contacts/add-friend';
import type { AddFriendSearchResult } from '../../../../shared/contacts/add-friend';
import { requestFriendDetail } from '../../../../shared/contacts/friend';
import type { Friend, FriendDetail } from '../../../../shared/contacts/friend';
import type { FriendRemarkSettings } from '../../../../shared/contacts/friend-remark';
import type { ContextMenuOwner } from '../../context-menu/context-menu-window';
import { RtcMediaMode } from '../../../../shared/rtc/rtc';
import { sendWindowNotification } from '../../../services/ipc/window-notifications';
import {
  getActiveSession,
  requireAuthenticatedSession,
} from '../../../services/auth/auth';
import { createAuthenticatedApiClient } from '../../../services/network/api-client';
import { createFriendApplicationController } from '../application/friend-application-window';
import {
  buildRestoredFriend,
  submitFriendApplication,
} from '../../../../shared/contacts/friend-application';
import type {
  FriendApplicationContext,
  FriendApplicationSubmission,
} from '../../../../shared/contacts/friend-application';

interface AddFriendEntry {
  window: BrowserWindow;
  session: AuthSession;
  url: string;
  searching: boolean;
  calling: boolean;
  editing: boolean;
  result: AddFriendSearchResult | null;
}

interface AddFriendDependencies {
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  getDefaultIcon: () => NativeImage;
  validateMainSender: (event: IpcMainInvokeEvent) => void;
  expireSession: (session: AuthSession, error?: SessionExpiredError) => void;
  onFriendAdded: (friend: Friend) => Friend;
  requestCall: (roomId: string, uid: string, mediaMode: RtcMediaMode) => void;
  openRemark: (
    parent: BrowserWindow,
    detail: FriendDetail,
    validate: () => void,
  ) => Promise<FriendRemarkSettings | null>;
  setBlacklisted: (
    roomId: string,
    uid: string,
    blocked: boolean,
    validate: () => void,
  ) => Promise<void>;
  deleteFriend: (
    roomId: string,
    clearHistory: boolean,
    validate: () => void,
  ) => Promise<void>;
}

let current: AddFriendEntry | undefined;
let application:
  ReturnType<typeof createFriendApplicationController> | undefined;

/** 退出、重载或授权失效时销毁窗口，清除搜索资料。 */
export const closeAddFriendWindow = (): void => {
  const entry = current;
  current = undefined;
  if (entry) application?.close(entry.window);
  if (entry && !entry.window.isDestroyed()) entry.window.destroy();
};

/** 搜索窗和群成员资料窗复用同一申请入口，目标及授权由主进程绑定。 */
export const openFriendApplicationWindow = async (
  parent: BrowserWindow,
  context: FriendApplicationContext,
  validate: () => void,
): Promise<FriendApplicationSubmission | null> => {
  validate();
  if (!application) throw new Error('申请窗口暂不可用');
  return application.openAndWaitResult(parent, context, validate);
};

/** 校验专属窗口、主框架、来源地址及创建时的授权会话。 */
const validateSender = (event: IpcMainInvokeEvent): AddFriendEntry => {
  const entry = current;
  if (
    !entry ||
    entry.window.isDestroyed() ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== entry.url ||
    requireAuthenticatedSession() !== entry.session
  )
    throw new Error('添加朋友窗口或登录状态已失效');
  return entry;
};

/** 常驻菜单只绑定当前好友快照，搜索、操作或授权变化后拒绝旧选择。 */
export const resolveAddFriendMenuOwner = (
  event: IpcMainInvokeEvent,
): ContextMenuOwner | undefined => {
  if (
    !current ||
    current.window.isDestroyed() ||
    current.window.webContents !== event.sender
  )
    return undefined;
  const entry = validateSender(event);
  const result = entry.result;
  /** 显示和选择时均复核来源，不让旧菜单作用于下一次搜索。 */
  const validate = (): void => {
    if (
      validateSender(event) !== entry ||
      entry.result !== result ||
      entry.searching ||
      entry.calling ||
      entry.editing ||
      result?.relationship !== 'friend' ||
      result.uid === entry.session.user.id ||
      !result.friend?.roomId
    )
      throw new Error('好友资料已变化，请重新打开菜单');
  };
  validate();
  return { window: entry.window, validate };
};

/** 注册独立添加朋友窗口及绑定搜索结果的申请窗口。 */
export const registerAddFriendIpc = (
  dependencies: AddFriendDependencies,
): void => {
  /** 编辑操作串行绑定原搜索，异步详情与提交阶段均核对真实好友及授权。 */
  const withCurrentFriend = async <T>(
    event: IpcMainInvokeEvent,
    operation: (
      entry: AddFriendEntry,
      detail: FriendDetail & { roomId: string },
      validate: () => void,
    ) => Promise<T>,
  ): Promise<T> => {
    const entry = validateSender(event);
    const result = entry.result;
    const roomId = result?.friend?.roomId;
    if (
      entry.searching ||
      entry.calling ||
      entry.editing ||
      result?.relationship !== 'friend' ||
      result.uid === entry.session.user.id ||
      !roomId
    )
      throw new Error('当前好友不可操作或操作正在进行');
    /** 表单和请求只允许访问原窗口、原搜索对象与原授权。 */
    const validate = (): void => {
      if (
        validateSender(event) !== entry ||
        entry.result !== result ||
        entry.searching ||
        result.relationship !== 'friend' ||
        result.friend?.roomId !== roomId
      )
        throw new Error('搜索结果已变化，请重新搜索');
    };
    entry.editing = true;
    try {
      const detail = await requestFriendDetail(
        createAuthenticatedApiClient(validate),
        result.uid,
        roomId,
      );
      validate();
      if (detail.uid !== result.uid || detail.roomId !== roomId)
        throw new Error('好友关系已变化，请重新搜索');
      return await operation(entry, { ...detail, roomId }, validate);
    } catch (cause) {
      if (
        cause instanceof SessionExpiredError &&
        current === entry &&
        getActiveSession() === entry.session
      )
        dependencies.expireSession(entry.session, cause);
      throw cause;
    } finally {
      entry.editing = false;
    }
  };

  application = createFriendApplicationController(
    dependencies.getRendererUrl,
    dependencies.getDefaultIcon,
    async (context, draft, validate): Promise<FriendApplicationSubmission> => {
      const session = requireAuthenticatedSession();
      try {
        const api = createAuthenticatedApiClient(validate);
        const result = await submitFriendApplication(
          api,
          context.targetUid,
          draft,
        );
        validate();
        if (result.status === 'PENDING') return result;
        const friend = dependencies.onFriendAdded(
          buildRestoredFriend(context, draft, result),
        );
        const entry = current;
        if (entry?.session === session && entry.result?.uid === friend.uid) {
          // 保留原对象身份，原申请窗口的绑定校验仍然有效。
          entry.result.relationship = 'friend';
          entry.result.friend = {
            ...friend,
            blacklisted: false,
            sex: entry.result.sex,
            personalitySignature: entry.result.personalitySignature,
            addedAt: null,
          };
          const bounds = entry.window.getBounds();
          const area = screen.getDisplayMatching(bounds).workArea;
          const height = Math.min(654, area.height);
          entry.window.setBounds({
            ...bounds,
            height,
            y: Math.max(
              area.y,
              Math.min(bounds.y, area.y + area.height - height),
            ),
          });
        }
        return { status: 'ADDED', friend };
      } catch (cause) {
        if (cause instanceof SessionExpiredError)
          dependencies.expireSession(session, cause);
        throw cause;
      }
    },
  );
  ipcMain.handle('add-friend:open', async (event): Promise<void> => {
    dependencies.validateMainSender(event);
    const session = requireAuthenticatedSession();
    if (
      current &&
      current.session === session &&
      !current.window.isDestroyed()
    ) {
      if (current.window.isMinimized()) current.window.restore();
      if (current.window.webContents.isLoading()) return;
      current.window.show();
      current.window.focus();
      return;
    }
    closeAddFriendWindow();
    const main = dependencies.getMainWindow();
    if (!main || main.isDestroyed()) throw new Error('主窗口已关闭');
    const workArea = screen.getDisplayMatching(main.getBounds()).workArea;
    const width = Math.min(423, workArea.width);
    const height = Math.min(560, workArea.height);
    const window = new BrowserWindow({
      width,
      height,
      useContentSize: true,
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      title: '添加朋友',
      icon: dependencies.getDefaultIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'add-friend-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const url = new URL(dependencies.getRendererUrl());
    url.hash = 'add-friend';
    const entry: AddFriendEntry = {
      window,
      session,
      url: url.href,
      searching: false,
      calling: false,
      editing: false,
      result: null,
    };
    current = entry;
    window.on('closed', () => {
      if (current === entry) {
        application?.close(entry.window);
        current = undefined;
      }
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
      if (current !== entry || requireAuthenticatedSession() !== session)
        throw new Error('添加朋友窗口已失效');
      window.show();
      window.focus();
    } catch (error) {
      if (window.isDestroyed()) return;
      window.destroy();
      throw error;
    }
  });
  ipcMain.handle('add-friend:search', async (event, value: unknown) => {
    const entry = validateSender(event);
    const query = parseAddFriendQuery(value);
    if (entry.searching || entry.editing)
      throw new Error('请等待当前搜索或好友操作完成');
    application?.close(entry.window);
    entry.searching = true;
    entry.result = null;
    try {
      const api = createAuthenticatedApiClient((): void => {
        if (validateSender(event) !== entry) throw new Error('搜索请求已失效');
      });
      const profile = await requestAddFriend(api, query);
      const result = await resolveAddFriendRelationship(api, profile);
      api.validateCurrent();
      entry.result = result;
      const bounds = entry.window.getBounds();
      const area = screen.getDisplayMatching(bounds).workArea;
      const height = Math.min(
        result.relationship === 'friend' ? 654 : 560,
        area.height,
      );
      entry.window.setBounds({
        ...bounds,
        height,
        y: Math.max(area.y, Math.min(bounds.y, area.y + area.height - height)),
      });
      return result;
    } catch (error) {
      if (error instanceof SessionExpiredError)
        dependencies.expireSession(entry.session, error);
      throw error;
    } finally {
      entry.searching = false;
    }
  });
  ipcMain.handle('add-friend:open-chat', async (event): Promise<void> => {
    const entry = validateSender(event);
    const result = entry.result;
    if (entry.searching || entry.editing || result?.relationship !== 'friend')
      throw new Error('请先搜索已添加的好友');
    try {
      const api = createAuthenticatedApiClient((): void => {
        if (validateSender(event) !== entry) throw new Error('搜索请求已失效');
      });
      if (!result.friend?.roomId) throw new Error('该好友会话暂不可用');
      const detail = await requestFriendDetail(
        api,
        result.uid,
        result.friend.roomId,
      );
      if (
        validateSender(event) !== entry ||
        entry.result !== result ||
        entry.searching ||
        entry.editing
      )
        throw new Error('搜索结果已变化，请重试');
      if (!detail.roomId) throw new Error('该好友会话暂不可用');
      const main = dependencies.getMainWindow();
      if (!main || main.isDestroyed()) throw new Error('主窗口已关闭');
      sendWindowNotification(main, 'add-friend:chat-requested', detail.uid);
      if (main.isMinimized()) main.restore();
      main.show();
      main.focus();
    } catch (error) {
      if (error instanceof SessionExpiredError)
        dependencies.expireSession(entry.session, error);
      throw error;
    }
  });
  ipcMain.handle(
    'add-friend:call',
    async (event, value: unknown): Promise<void> => {
      const entry = validateSender(event);
      switch (value) {
        case RtcMediaMode.AUDIO:
        case RtcMediaMode.VIDEO:
          break;
        default:
          throw new Error('不支持的 RTC 媒体类型');
      }
      const result = entry.result;
      const friend = result?.friend;
      if (
        entry.searching ||
        entry.calling ||
        entry.editing ||
        result?.relationship !== 'friend' ||
        result.uid === entry.session.user.id ||
        !friend?.roomId ||
        friend.blacklisted
      )
        throw new Error('当前搜索结果不可发起通话');
      entry.calling = true;
      try {
        /** 搜索、窗口或账号变化后拒绝旧详情，不能拨打另一个搜索对象。 */
        const validate = (): void => {
          if (
            validateSender(event) !== entry ||
            entry.result !== result ||
            entry.searching
          )
            throw new Error('搜索结果已变化，请重试');
        };
        const detail = await requestFriendDetail(
          createAuthenticatedApiClient(validate),
          result.uid,
          friend.roomId,
        );
        validate();
        if (
          detail.uid !== result.uid ||
          detail.roomId !== friend.roomId ||
          detail.blacklisted
        )
          throw new Error('好友关系或黑名单状态已变化，请重新搜索');
        dependencies.requestCall(detail.roomId, detail.uid, value);
      } catch (error) {
        if (
          error instanceof SessionExpiredError &&
          current === entry &&
          entry.result === result
        )
          dependencies.expireSession(entry.session, error);
        throw error;
      } finally {
        entry.calling = false;
      }
    },
  );
  ipcMain.handle('add-friend:remark', (event) =>
    withCurrentFriend(event, async (entry, detail, validate) => {
      const saved = await dependencies.openRemark(
        entry.window,
        detail,
        validate,
      );
      validate();
      if (saved)
        entry.result!.friend = {
          ...detail,
          remark: saved.remark,
          remarkSettings: saved,
          displayName: saved.remark ?? detail.name,
        };
      return saved;
    }),
  );
  ipcMain.handle('add-friend:blacklist', (event, value: unknown) => {
    if (typeof value !== 'boolean') throw new Error('黑名单状态无效');
    return withCurrentFriend(
      event,
      async (entry, detail, validate): Promise<void> => {
        await dependencies.setBlacklisted(
          detail.roomId,
          detail.uid,
          value,
          validate,
        );
        validate();
        entry.result!.friend = { ...detail, blacklisted: value };
      },
    );
  });
  ipcMain.handle('add-friend:delete', (event, value: unknown) => {
    if (typeof value !== 'boolean') throw new Error('清空聊天记录选项无效');
    return withCurrentFriend(
      event,
      async (_entry, detail, validate): Promise<void> => {
        await dependencies.deleteFriend(detail.roomId, value, validate);
        validate();
        closeAddFriendWindow();
      },
    );
  });
  ipcMain.handle(
    'add-friend:open-application',
    async (
      event,
      targetUid: unknown,
    ): Promise<AddFriendSearchResult | null> => {
      const entry = validateSender(event);
      const result = entry.result;
      if (
        entry.searching ||
        result?.relationship !== 'stranger' ||
        targetUid !== result.uid
      )
        throw new Error('搜索结果已变化，请重新搜索后添加');
      if (!application) throw new Error('申请窗口暂不可用');
      const submitted = await application.openAndWaitResult(
        entry.window,
        {
          targetUid: result.uid,
          targetName: result.name,
          nickname: entry.session.user.nickname,
          avatar: result.avatar,
        },
        (): void => {
          if (
            validateSender(event) !== entry ||
            entry.result !== result ||
            entry.searching
          )
            throw new Error('申请对象或登录状态已变化');
        },
      );
      return submitted?.status === 'ADDED' ? { ...result } : null;
    },
  );
  ipcMain.handle('add-friend:close', (event): void => {
    validateSender(event).window.close();
  });
};
