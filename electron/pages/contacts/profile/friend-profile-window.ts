import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import type { ContextMenuOwner } from '../../context-menu/context-menu-window';
import type {
  FriendProfileAnchor,
  FriendProfileContext,
  FriendProfileDetail,
} from '../../../../shared/contacts/friend-profile';
import { positionFriendProfile } from '../../../../shared/contacts/friend-profile';
import type { FriendApplicationSubmission } from '../../../../shared/contacts/friend-application';
import type { FriendRemarkSettings } from '../../../../shared/contacts/friend-remark';
import { RtcMediaMode } from '../../../../shared/rtc/rtc';

interface ProfileEntry {
  window: BrowserWindow;
  parent: BrowserWindow;
  url: string;
  roomId: string;
  groupMember: boolean;
  context: FriendProfileContext;
  detail: FriendProfileDetail | null;
  anchor: FriendProfileAnchor;
  applying: boolean;
  editingRemark: boolean;
  applied: boolean;
  changingBlacklist: boolean;
  deleting: boolean;
  detailVersion: number;
  validate: () => void;
  dispose: () => void;
}

/** 管理单个临时资料窗，不给子窗口开放主页面或任意联系人权限。 */
export const createFriendProfileController = (dependencies: {
  isContextMenuOpen?: (window: BrowserWindow) => boolean;
  getRendererUrl: () => string;
  getDefaultIcon: () => NativeImage;
  readDetail: (
    uid: string,
    roomId: string,
    groupMember: boolean,
    validate: () => void,
  ) => Promise<FriendProfileDetail>;
  openApplication: (
    parent: BrowserWindow,
    detail: FriendProfileDetail,
    validate: () => void,
  ) => Promise<FriendApplicationSubmission | null>;
  openRemark?: (
    parent: BrowserWindow,
    detail: FriendProfileDetail,
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
  returnToChat: (
    parent: BrowserWindow,
    roomId: string,
    targetUid?: string,
  ) => void;
  requestCall: (roomId: string, uid: string, mediaMode: RtcMediaMode) => void;
}): {
  open: (
    parent: BrowserWindow,
    roomId: string,
    context: FriendProfileContext,
    anchor: FriendProfileAnchor,
    validate: () => void,
    groupMember?: boolean,
  ) => Promise<void>;
  close: (roomId?: string) => void;
  resolveMenuOwner: (event: IpcMainInvokeEvent) => ContextMenuOwner | undefined;
} => {
  let current: ProfileEntry | undefined;

  /** 先撤销上下文再销毁，迟到的加载和网络回调不能作用于新窗口。 */
  const close = (roomId?: string): void => {
    const entry = current;
    if (!entry || (roomId && roomId !== entry.roomId)) return;
    current = undefined;
    entry.dispose();
    if (!entry.window.isDestroyed()) entry.window.destroy();
  };

  /** 校验子窗口、主框架、来源和原主页面授权。 */
  const validateSender = (event: IpcMainInvokeEvent): ProfileEntry => {
    const entry = current;
    if (
      !entry ||
      entry.window.isDestroyed() ||
      event.sender !== entry.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== entry.url
    )
      throw new Error('资料窗口已关闭');
    try {
      entry.validate();
    } catch (cause) {
      close();
      throw cause;
    }
    return entry;
  };

  ipcMain.handle('friend-profile:context', (event): FriendProfileContext => {
    return { ...validateSender(event).context };
  });
  ipcMain.handle(
    'friend-profile:read',
    async (event): Promise<FriendProfileDetail> => {
      const entry = validateSender(event);
      if (
        entry.changingBlacklist ||
        entry.applying ||
        entry.deleting ||
        entry.editingRemark
      )
        throw new Error('操作正在进行，请稍后重试');
      const version = entry.detailVersion;
      /** 每个异步阶段核对同一窗口，关闭后不交付私有备注。 */
      const validate = (): void => {
        if (validateSender(event) !== entry || version !== entry.detailVersion)
          throw new Error('资料窗口已变化');
      };
      const detail = await dependencies.readDetail(
        entry.context.uid,
        entry.roomId,
        entry.groupMember,
        validate,
      );
      validate();
      if (
        detail.uid !== entry.context.uid ||
        (!entry.groupMember && detail.relationship === 'self') ||
        (!entry.groupMember &&
          detail.relationship === 'friend' &&
          detail.roomId !== entry.roomId) ||
        (detail.relationship !== 'friend' && detail.roomId !== null) ||
        (entry.groupMember && detail.roomId === entry.roomId)
      )
        throw new Error('好友资料与当前聊天不匹配');
      entry.detail = detail;
      entry.window.setBounds(
        positionFriendProfile(
          entry.anchor,
          screen.getDisplayMatching(entry.anchor).workArea,
          detail.relationship === 'stranger',
        ),
      );
      return detail;
    },
  );
  ipcMain.handle(
    'friend-profile:remark',
    async (event): Promise<FriendRemarkSettings | null> => {
      const entry = validateSender(event);
      if (
        !dependencies.openRemark ||
        entry.detail?.relationship !== 'friend' ||
        !entry.detail.roomId ||
        entry.editingRemark ||
        entry.applying ||
        entry.changingBlacklist ||
        entry.deleting
      )
        throw new Error('当前资料不可编辑或操作正在进行');
      entry.editingRemark = true;
      entry.detailVersion++;
      /** 备注表单固定原资料窗与好友，不接受渲染层指定另一个目标。 */
      const validate = (): void => {
        if (validateSender(event) !== entry) throw new Error('资料窗口已变化');
      };
      try {
        const detail = await dependencies.readDetail(
          entry.context.uid,
          entry.roomId,
          entry.groupMember,
          validate,
        );
        validate();
        if (
          detail.uid !== entry.context.uid ||
          detail.relationship !== 'friend' ||
          detail.roomId !== entry.detail.roomId
        )
          throw new Error('好友关系已变化，请重新打开资料');
        const saved = await dependencies.openRemark(
          entry.window,
          detail,
          validate,
        );
        validate();
        if (saved) {
          entry.detail = {
            ...detail,
            remark: saved.remark,
            remarkSettings: saved,
            displayName: saved.remark ?? detail.name,
          };
        }
        return saved;
      } finally {
        entry.editingRemark = false;
        if (current === entry && !entry.window.isDestroyed())
          entry.window.focus();
      }
    },
  );
  ipcMain.handle(
    'friend-profile:application',
    async (event): Promise<FriendApplicationSubmission | null> => {
      const entry = validateSender(event);
      if (
        entry.detail?.relationship !== 'stranger' ||
        entry.applying ||
        entry.applied ||
        entry.editingRemark ||
        entry.changingBlacklist ||
        entry.deleting
      )
        throw new Error('当前用户不可申请添加或申请正在处理');
      entry.applying = true;
      entry.detailVersion++;
      /** 申请表单始终绑定原资料窗、原房间对方及原授权。 */
      const validate = (): void => {
        if (validateSender(event) !== entry) throw new Error('资料窗口已变化');
      };
      try {
        // 表单打开前重新确认关系和来源房间权限，不能沿用过期的非好友快照。
        const detail = await dependencies.readDetail(
          entry.context.uid,
          entry.roomId,
          entry.groupMember,
          validate,
        );
        validate();
        if (
          detail.uid !== entry.context.uid ||
          detail.relationship !== 'stranger' ||
          detail.roomId !== null
        )
          throw new Error('好友关系已变化，请重新打开资料');
        const submitted = await dependencies.openApplication(
          entry.window,
          detail,
          validate,
        );
        validate();
        if (
          submitted?.status === 'ADDED' &&
          (submitted.friend.uid !== entry.context.uid ||
            (!entry.groupMember && submitted.friend.roomId !== entry.roomId))
        )
          throw new Error('添加结果与当前聊天不匹配');
        entry.applied = submitted !== null;
        if (submitted?.status === 'ADDED') {
          entry.detail = {
            ...detail,
            ...submitted.friend,
            relationship: 'friend',
            blacklisted: false,
          };
          entry.window.setBounds(
            positionFriendProfile(
              entry.anchor,
              screen.getDisplayMatching(entry.anchor).workArea,
              false,
            ),
          );
        }
        return submitted;
      } finally {
        entry.applying = false;
        if (current === entry && !entry.window.isDestroyed())
          entry.window.focus();
      }
    },
  );
  ipcMain.handle(
    'friend-profile:blacklist',
    async (event, value: unknown): Promise<void> => {
      const entry = validateSender(event);
      if (typeof value !== 'boolean') throw new Error('黑名单状态无效');
      if (
        !entry.detail?.roomId ||
        entry.changingBlacklist ||
        entry.deleting ||
        entry.editingRemark
      )
        throw new Error('资料未就绪或黑名单正在更新');
      entry.changingBlacklist = true;
      entry.detailVersion++;
      /** 每次异步交接复核窗口和原授权，拒绝已关闭窗口的迟到结果。 */
      const validate = (): void => {
        if (validateSender(event) !== entry) throw new Error('资料窗口已变化');
      };
      try {
        await dependencies.setBlacklisted(
          entry.detail.roomId,
          entry.context.uid,
          value,
          validate,
        );
        validate();
        entry.detail = { ...entry.detail, blacklisted: value };
      } finally {
        entry.changingBlacklist = false;
      }
    },
  );
  ipcMain.handle(
    'friend-profile:delete',
    async (event, clearHistory: unknown): Promise<void> => {
      const entry = validateSender(event);
      if (typeof clearHistory !== 'boolean')
        throw new Error('清空聊天记录选项无效');
      if (
        !entry.detail?.roomId ||
        entry.detail.relationship !== 'friend' ||
        entry.deleting ||
        entry.editingRemark ||
        entry.changingBlacklist ||
        entry.applying
      )
        throw new Error('当前资料不可删除或操作正在进行');
      entry.deleting = true;
      entry.detailVersion++;
      /** 子窗口不能指定目标，异步阶段继续核对原窗口与授权。 */
      const validate = (): void => {
        if (validateSender(event) !== entry) throw new Error('资料窗口已变化');
      };
      try {
        await dependencies.deleteFriend(
          entry.detail.roomId,
          clearHistory,
          validate,
        );
        validate();
        close();
      } finally {
        entry.deleting = false;
      }
    },
  );
  ipcMain.handle('friend-profile:message', (event): void => {
    const entry = validateSender(event);
    if (
      !entry.detail?.roomId ||
      entry.detail.blacklisted ||
      entry.changingBlacklist ||
      entry.editingRemark ||
      entry.deleting
    )
      throw new Error('当前好友不可发起聊天');
    dependencies.returnToChat(
      entry.parent,
      entry.detail.roomId,
      entry.groupMember ? entry.context.uid : undefined,
    );
    close();
    if (!entry.parent.isDestroyed()) entry.parent.focus();
  });
  ipcMain.handle('friend-profile:call', (event, value: unknown): void => {
    const entry = validateSender(event);
    switch (value) {
      case RtcMediaMode.AUDIO:
      case RtcMediaMode.VIDEO:
        break;
      default:
        throw new Error('不支持的 RTC 媒体类型');
    }
    const detail = entry.detail;
    if (
      detail?.relationship !== 'friend' ||
      !detail.roomId ||
      detail.blacklisted ||
      entry.changingBlacklist ||
      entry.editingRemark ||
      entry.deleting ||
      entry.applying
    )
      throw new Error('当前好友不可发起通话');
    dependencies.requestCall(detail.roomId, entry.context.uid, value);
    close();
  });
  ipcMain.handle('friend-profile:close', (event): void => {
    validateSender(event);
    close();
  });

  /** 按主窗口内容坐标和实际缩放定位，允许伸出主窗口但不越过屏幕工作区。 */
  const open = async (
    parent: BrowserWindow,
    roomId: string,
    context: FriendProfileContext,
    anchor: FriendProfileAnchor,
    validate: () => void,
    groupMember: boolean = false,
  ): Promise<void> => {
    validate();
    close();
    const bounds = parent.getContentBounds();
    const zoom = parent.webContents.getZoomFactor();
    if (
      (anchor.x + anchor.width) * zoom > bounds.width + 1 ||
      (anchor.y + anchor.height) * zoom > bounds.height + 1
    )
      throw new Error('头像已不在当前窗口内');
    const screenAnchor = {
      x: Math.round(bounds.x + anchor.x * zoom),
      y: Math.round(bounds.y + anchor.y * zoom),
      width: Math.round(anchor.width * zoom),
      height: Math.round(anchor.height * zoom),
    };
    const area = screen.getDisplayMatching(screenAnchor).workArea;
    const window = new BrowserWindow({
      ...positionFriendProfile(screenAnchor, area),
      parent,
      frame: false,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      autoHideMenuBar: true,
      title: '朋友资料',
      icon: dependencies.getDefaultIcon(),
      webPreferences: {
        preload: path.join(__dirname, 'friend-profile-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const url = new URL(dependencies.getRendererUrl());
    url.hash = 'friend-profile';
    let blurTimer: ReturnType<typeof setTimeout> | undefined;
    /** 仅清理本次窗口，移动主窗口后不留下脱离头像的旧浮层。 */
    const dismiss = (): void => {
      if (current === entry) close();
    };
    const entry: ProfileEntry = {
      window,
      parent,
      url: url.href,
      roomId,
      groupMember,
      context: { ...context, groupMember },
      detail: null,
      anchor: screenAnchor,
      applying: false,
      editingRemark: false,
      applied: false,
      changingBlacklist: false,
      deleting: false,
      detailVersion: 0,
      validate,
      /** 移除原主窗口监听，避免反复开关累积回调。 */
      dispose: (): void => {
        clearTimeout(blurTimer);
        parent.removeListener('closed', dismiss);
        parent.removeListener('move', dismiss);
        parent.removeListener('resize', dismiss);
        parent.removeListener('hide', dismiss);
        parent.removeListener('minimize', dismiss);
        parent.webContents.removeListener('did-start-navigation', dismiss);
        parent.webContents.removeListener('render-process-gone', dismiss);
      },
    };
    current = entry;
    parent.on('closed', dismiss);
    parent.on('move', dismiss);
    parent.on('resize', dismiss);
    parent.on('hide', dismiss);
    parent.on('minimize', dismiss);
    parent.webContents.on('did-start-navigation', dismiss);
    parent.webContents.on('render-process-gone', dismiss);
    window.on('closed', dismiss);
    window.on('blur', () => {
      clearTimeout(blurTimer);
      blurTimer = setTimeout((): void => {
        if (
          !window.isDestroyed() &&
          !window.isFocused() &&
          !entry.applying &&
          !entry.editingRemark &&
          !dependencies.isContextMenuOpen?.(window)
        )
          dismiss();
      }, 80);
    });
    window.webContents.on('render-process-gone', dismiss);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        if (!entry.applying && !entry.editingRemark) dismiss();
      }
    });
    try {
      await window.loadURL(entry.url);
      if (current !== entry || window.isDestroyed()) return;
      validate();
      window.show();
      window.focus();
    } catch (cause) {
      dismiss();
      throw cause;
    }
  };
  return {
    open,
    close,
    /** 菜单绑定原资料页，离开菜单及资料窗口后才执行临时窗口清理。 */
    resolveMenuOwner: (event): ContextMenuOwner | undefined => {
      if (
        !current ||
        current.window.isDestroyed() ||
        current.window.webContents !== event.sender
      )
        return undefined;
      const entry = validateSender(event);
      return {
        window: entry.window,
        validate: (): void => {
          if (validateSender(event) !== entry)
            throw new Error('资料窗口已变化');
        },
        onDismiss: (): void => {
          if (
            current === entry &&
            !entry.window.isDestroyed() &&
            !entry.window.isFocused() &&
            !entry.applying &&
            !entry.editingRemark
          )
            close();
        },
      };
    },
  };
};
