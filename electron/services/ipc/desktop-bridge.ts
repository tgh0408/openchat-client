import { invokeIpc } from './invoke';
import type { ServerSettings } from '../../../shared/runtime/server-settings';
import { parseGroupExitedNotification } from '../../../shared/contacts/group-notification';
import { ipcRenderer, webUtils } from 'electron';
import { parseFriendRemarkSettings } from '../../../shared/contacts/friend-remark';
import type {
  Contact,
  Conversation,
  ConversationSummary,
  LocalSettings,
  Message,
  MessagePosition,
  CachedMessagePage,
  HistoryQuery,
  StoredFile,
} from '../../../shared/storage/database';
import type {
  ConversationReadState,
  DesktopApi,
  HistoryRtcCallRequest,
  ResourceSseMessage,
  ResourceSseStatus,
} from '../../../shared/windows/desktop';
import type {
  AuthSession,
  LoginState,
  SessionAccess,
  SessionInvalidationReason,
} from '../../../shared/auth/auth';
import type { StartupPhase } from '../../../shared/runtime/startup';
import { isStartupPhase } from '../../../shared/runtime/startup';
import type { SendMessageRequest } from '../../../shared/chat/chat';
import type { Friend, FriendDetail } from '../../../shared/contacts/friend';
import type { FriendProfileRtcCallRequest } from '../../../shared/contacts/friend-profile';
import { parseRestoredFriendNotification } from '../../../shared/contacts/friend-application';
import type {
  FriendApplicationPage,
  FriendApplicationUnread,
} from '../../../shared/contacts/friend-notification';
import type {
  GroupDirectoryItem,
  GroupMemberItem,
  UpdateGroupInfoRequest,
} from '../../../shared/contacts/group';
import type { UserEmoji } from '../../../shared/chat/emoji';
import type { ImagePreviewRequest } from '../../../shared/windows/image-preview';
import type { MessageDragRequest } from '../../../shared/chat/messages/message-drag';
import type {
  SelectedVideoDraft,
  StoredVideoContent,
  VideoMetadata,
  VideoUploadProgress,
  VideoDraftProcessingProgress,
  TemporaryVideoContent,
  LocalVideoUpload,
} from '../../../shared/media/video/video';
import {
  isVideoDraftProcessingProgress,
  isVideoUploadProgress,
} from '../../../shared/media/video/video';
import {
  MAX_FILE_BYTES,
  isFileDraftProcessingProgress,
} from '../../../shared/media/file/file-message';
import type {
  SelectedFileDraft,
  FileDraftProcessingProgress,
  FileAvailability,
} from '../../../shared/media/file/file-message';
import type { LocalImageData } from '../../../shared/media/image/image';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DRAFT_BYTES,
  MAX_IMAGE_DRAFTS,
} from '../../../shared/media/image/image';
import type { StoredImageContent } from '../../../shared/media/image/image';
import type {
  MediaDraftSelection,
  MediaDropResult,
} from '../../../shared/media/media-drafts';
import {
  type RtcCallView,
  type RtcOngoingCall,
  type RtcJoinCredential,
  RtcMediaMode,
} from '../../../shared/rtc/rtc';

let conversationMode = false;

/** 子窗口仅通过受限入口复用现有协议。 */
export const useConversationBridge = (): void => {
  conversationMode = true;
};

/** 主进程分别校验主页面和独立会话窗口，预加载层不改变业务参数。 */
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => {
  if (conversationMode)
    return invokeIpc<T>('conversation:invoke', channel, args);
  return invokeIpc<T>(channel, ...args);
};

/** 请求主进程关闭当前窗口，不向页面暴露原始 IPC 对象。 */
const closeWindow = async (): Promise<void> => {
  await invoke('window:close');
};

/** 通过主进程创建视频或语音呼叫，不向页面暴露授权凭据。 */
const rtcCreateCall = async (
  roomId: string,
  mediaMode: RtcMediaMode,
  clientRequestId: string,
  participantUids?: string[],
  replaceCallIds?: string[],
): Promise<RtcCallView> =>
  invoke(
    'rtc:create',
    roomId,
    mediaMode,
    clientRequestId,
    participantUids,
    replaceCallIds,
  );

/** 打开绑定指定呼叫的独立视频通话窗口。 */
const openRtcCall = async (callId: string): Promise<void> => {
  await invoke('rtc-call:open', callId);
};

/** 用户确认恢复后请求主进程重连原呼叫。 */
const resumeRtcCall = (callId: string): Promise<void> =>
  invoke('rtc-call:resume', callId);

/** 登录后查询当前授权账号的单聊恢复候选。 */
const rtcGetOngoingCalls = (): Promise<RtcOngoingCall[]> =>
  invoke('rtc:ongoing');

/** 呼出前读取当前授权账号的活动通话，供工作台展示确认框。 */
const rtcGetActiveCalls = (): Promise<RtcCallView[]> => invoke('rtc:active');

/** 通过受控主进程查询群房间的唯一活动通话。 */
const rtcGetGroupActiveCall = (roomId: string): Promise<RtcCallView | null> =>
  invoke('rtc:group-active', roomId);

/** 订阅独立视频通话窗口关闭通知，供主聊天页清理本地呼叫状态。 */
const onRtcCallClosed = (callback: (callId: string) => void): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    callId: unknown,
  ): void => {
    if (typeof callId === 'string' && callId.trim()) callback(callId);
  };
  ipcRenderer.on('rtc-call:closed', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-call:closed', listener);
  };
};

/** 读取当前账号可见的 RTC 呼叫。 */
const rtcGetCall = async (callId: string): Promise<RtcCallView> =>
  invoke('rtc:get', callId);

/** 获取当前 RTC 呼叫的 LiveKit 凭证。 */
const rtcIssueToken = async (callId: string): Promise<RtcJoinCredential> =>
  invoke('rtc:token', callId);

/** 通过主进程原子领取或释放群视频席位。 */
const rtcSetVideoEnabled = async (
  callId: string,
  enabled: boolean,
): Promise<boolean> => invoke('rtc:video', callId, enabled);

/** 提交 RTC 状态转换，状态版本由主进程校验参数后发送。 */
const rtcAction = async (
  channel:
    | 'rtc:accept'
    | 'rtc:reject'
    | 'rtc:cancel'
    | 'rtc:expire'
    | 'rtc:hangup'
    | 'rtc:leave',
  callId: string,
  clientRequestId: string,
  expectedVersion: number,
): Promise<RtcCallView> =>
  invoke(channel, callId, clientRequestId, expectedVersion);

/** 首屏只读取初始化状态，不触碰设置库或登录会话。 */
const getStartupPhase = async (): Promise<StartupPhase> => {
  const phase: unknown = await invoke('startup:get-phase');
  if (!isStartupPhase(phase)) throw new Error('无效的启动状态');
  return phase;
};

/** 通知主进程登录首屏已绘制，不接受初始化参数或授权数据。 */
const startupRendered = async (): Promise<void> => {
  await invoke('startup:rendered');
};

/** 订阅有界启动状态，卸载时移除同一个监听器。 */
const onStartupPhase = (
  callback: (phase: StartupPhase) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    phase: unknown,
  ): void => {
    if (isStartupPhase(phase)) callback(phase);
  };
  ipcRenderer.on('startup:phase', listener);
  return (): void => {
    ipcRenderer.removeListener('startup:phase', listener);
  };
};

/** 请求原生文件选择器，取消选择时返回空数组。 */
const chooseFiles = async (): Promise<StoredFile[]> => {
  return invoke('files:choose');
};

/** 读取本地非敏感设置。 */
const getLocalSettings = async (): Promise<LocalSettings> => {
  return invoke('database:get-settings');
};

/** 读取当前有效的服务器和 LiveKit 地址。 */
const getServerSettings = async (): Promise<ServerSettings> =>
  invoke('server:get-settings');

/** 保存登录窗口提交的地址，主进程再次校验参数与来源。 */
const saveServerSettings = async (
  settings: ServerSettings,
): Promise<ServerSettings> =>
  invoke('server:save-settings', { ...settings });

/** 保存本地非敏感设置。 */
const saveLocalSettings = async (rememberAccount: boolean): Promise<void> => {
  await invoke('database:save-settings', rememberAccount);
};

/** 通过主进程校验后保存调试开关，不向页面暴露开发者工具实例。 */
const saveDebugMode = async (enabled: boolean): Promise<void> => {
  await invoke('window:debug-mode', enabled);
};

/** 由主进程向真实后端提交账号密码。 */
const login: DesktopApi['login'] = async (
  credentials,
): Promise<AuthSession> => {
  return invoke('auth:login', credentials);
};

/** 由主进程向真实后端提交注册表单。 */
const register: DesktopApi['register'] = async (
  registration,
): Promise<void> => {
  await invoke('auth:register', registration);
};

/** 仅选择注册头像，不读写账号内容库或开放任意路径。 */
const chooseRegistrationAvatar = async (): Promise<Uint8Array | null> => {
  return invoke('auth:choose-registration-avatar');
};

/** 离开注册入口后取消选图或裁剪，不修改已有头像。 */
const cancelRegistrationAvatar = async (): Promise<void> => {
  await invoke('auth:cancel-registration-avatar');
};

/** 取消当前登录请求，清理未接收的服务端响应。 */
const cancelLogin = async (): Promise<void> => {
  await invoke('auth:cancel-login');
};

/** 只提交 JWT，用户资料由主进程验证后返回。 */
const authorizeSession = async (accessToken: string): Promise<AuthSession> => {
  return invoke('auth:authorize', accessToken);
};

/** 读取主进程恢复的会话，用于显示账号和快捷进入按钮。 */
const getLoginState = async (
  checkServer: boolean = true,
): Promise<LoginState> => {
  return invoke('auth:get-login-state', checkServer);
};

/** 只提交历史账号标识，令牌和用户身份由主进程读取。 */
const selectLoginAccount = async (id: string | null): Promise<LoginState> => {
  return invoke('auth:select-account', id);
};

/** 请求恢复主进程保留的会话，不传入账号或 JWT。 */
const resumeSession = async (): Promise<AuthSession> => {
  return invoke('auth:resume');
};

/** 退出授权并关闭内容数据库，不创建 guest 数据库。 */
const endSession = async (): Promise<void> => {
  await invoke('auth:end');
};

/** 查询当前页面的只读状态，不重新校验或切换账号。 */
const getSessionAccess = async (): Promise<SessionAccess> =>
  invoke('auth:get-access');

/** 订阅主进程授权到期通知，不向页面暴露原始 IPC 事件。 */
const onSessionExpired = (
  callback: (userId: string, reason?: SessionInvalidationReason) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (typeof value === 'string') {
      callback(value);
      return;
    }
    if (
      !value ||
      typeof value !== 'object' ||
      !('userId' in value) ||
      typeof value.userId !== 'string'
    )
      return;
    const reason = 'reason' in value ? value.reason : undefined;
    switch (reason) {
      case 'SESSION_REPLACED':
      case 'SESSION_EXPIRED':
        callback(value.userId, reason);
        return;
      default:
        callback(value.userId);
    }
  };
  ipcRenderer.on('auth:expired', listener);
  return (): void => {
    ipcRenderer.removeListener('auth:expired', listener);
  };
};

/** 订阅主进程转发的资源 SSE 原始事件。 */
const onResourceMessage = (
  callback: (message: ResourceSseMessage) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    message: ResourceSseMessage,
  ): void => {
    callback(message);
  };
  ipcRenderer.on('resource:sse-message', listener);
  return (): void => {
    ipcRenderer.removeListener('resource:sse-message', listener);
  };
};

/** 订阅资源 SSE 的连接、重连和停止状态。 */
const onResourceStatus = (
  callback: (status: ResourceSseStatus) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    status: ResourceSseStatus,
  ): void => {
    callback(status);
  };
  ipcRenderer.on('resource:sse-status', listener);
  return (): void => {
    ipcRenderer.removeListener('resource:sse-status', listener);
  };
};

/** 读取主进程当前资源 SSE 状态，避免错过页面挂载前的状态通知。 */
const getResourceSseStatus = async (): Promise<ResourceSseStatus> => {
  return invoke('resource:get-status');
};

/** 请求主进程同步后端最近会话到本地数据库，返回落库数量。 */
const syncRemoteContacts = async (): Promise<number> => {
  return invoke('chat:sync-contacts');
};

/** 请求主进程拉取当前账号好友联系人，不向页面暴露 JWT 或分页游标。 */
const listFriends = async (): Promise<Friend[]> => {
  return invoke('chat:list-friends');
};

/** 读取当前账号的未读好友申请。 */
const getFriendUnread = async (): Promise<FriendApplicationUnread[]> =>
  invoke('friend-application:unread');

/** 统一分页读取收发申请，不向主进程传递任意账号。 */
const listFriendApplications = async (
  pageNo: number,
): Promise<FriendApplicationPage> => invoke('friend-application:list', pageNo);

/** 只确认当前点击的好友申请。 */
const readFriendApplication = async (applyId: string): Promise<void> => {
  await invoke('friend-application:mark-read', applyId);
};

/** 只提交原申请标识和回复文本，身份由主进程绑定。 */
const replyFriendApplication = async (
  applyId: string,
  msg: string,
): Promise<void> => {
  await invoke('friend-application:reply', { applyId, msg });
};

/** 打开绑定所选申请的验证窗口，只有实际审批成功才返回 true。 */
const openFriendVerification = async (
  applyId: string,
  friendId: string,
): Promise<boolean> => {
  return invoke('friend-verification:open', applyId, friendId);
};

/** 请求主进程拉取当前账号群聊列表，不向页面暴露 JWT。 */
const listGroups = async (): Promise<GroupDirectoryItem[]> => {
  return invoke('chat:list-groups');
};

/** 创建群聊仅提交好友标识，由主进程绑定当前已验证身份。 */
const createGroup = async (uids: string[]): Promise<GroupDirectoryItem> =>
  invoke('chat:create-group', { uids });

/** 请求主进程读取指定群成员，不向页面暴露 JWT。 */
const listGroupMembers = async (roomId: string): Promise<GroupMemberItem[]> => {
  return invoke('chat:list-group-members', roomId);
};

/** 添加好友到指定群，身份和好友关系由主进程及后端核对。 */
const addGroupMembers = async (
  roomId: string,
  uids: string[],
): Promise<void> => {
  await invoke('chat:add-group-members', { roomId, uids });
};

/** 通过受控主进程接口移出群成员，权限由后端当前角色核验。 */
const removeGroupMembers = async (
  roomId: string,
  uids: string[],
): Promise<void> => {
  await invoke('chat:remove-group-members', { roomId, uids });
};

/** 只向主进程提交群房间标识，由当前已验证账号执行退出。 */
const exitGroup = async (roomId: string): Promise<void> => {
  await invoke('chat:exit-group', roomId);
};

/** 解散仅提交群房间标识，群主身份由后端核验。 */
const dissolveGroup = async (roomId: string): Promise<void> => {
  await invoke('chat:dissolve-group', roomId);
};

/** 通过主进程更新群资料，页面不接触认证令牌。 */
const updateGroupInfo = async (
  request: UpdateGroupInfoRequest,
): Promise<void> => {
  await invoke('chat:update-group-info', request);
};

/** 通过主进程读取当前账号的好友详细资料。 */
const getFriendDetail = async (
  uid: string,
  roomId: string,
): Promise<FriendDetail> => {
  return invoke('chat:friend-detail', uid, roomId);
};

/** 只提交房间和目标 UID，由主进程校验授权并请求后端。 */
const blockRoomUser = async (roomId: string, uid: string): Promise<void> => {
  await invoke('chat:block-room-user', roomId, uid);
};

/** 通过受控主进程接口移出房间黑名单。 */
const unblockRoomUser = async (roomId: string, uid: string): Promise<void> => {
  await invoke('chat:unblock-room-user', roomId, uid);
};

/** 通过受控 IPC 获取当前账号的表情包，不向页面提供授权凭据。 */
const listEmojis = async (): Promise<UserEmoji[]> => invoke('chat:list-emojis');

/** 删除收藏只传服务端标识，由主进程复核授权及本地归属。 */
const deleteEmoji = async (imgId: string): Promise<void> => {
  await invoke('chat:delete-emoji', imgId);
};

/** 只向主进程提交目标表情标识，不由页面分配排序值。 */
const moveEmojiToFront = async (imgId: string): Promise<UserEmoji[]> =>
  invoke('chat:front-emoji', imgId);

/** 仅传递消息标识，由主进程核对原会话、图片状态和当前授权。 */
const addImageEmoji = async (request: ImagePreviewRequest): Promise<void> => {
  await invoke('chat:add-image-emoji', request);
};

/** 查询绑定图片或表情的本地收藏状态，不向页面开放任意摘要查询。 */
const isImageEmojiCollected = async (
  request: ImagePreviewRequest,
): Promise<boolean> => invoke('chat:image-emoji-status', request);

/** 读取当前已授权账号的表情缓存，不接受任意用户标识。 */
const listCachedEmojis = async (): Promise<UserEmoji[]> =>
  invoke('chat:cached-emojis');

/** 请求主进程刷新指定房间详情，返回落库后的会话摘要。 */
const refreshConversationInfo = async (
  roomId: string,
): Promise<ConversationSummary> => {
  return invoke('chat:refresh-conversation', roomId);
};

/** 仅查询当前授权账号的文件助手，隐藏后仍可从联系人入口定位。 */
const getFileAssistantRoomId = async (): Promise<string> =>
  invoke('chat:file-assistant');

/** 上报实际展示的消息标识，落库和一秒合并均由主进程负责。 */
const recordConversationRead = async (
  roomId: string,
  messageId: string,
): Promise<boolean> => {
  return invoke('chat:read-conversation', roomId, messageId);
};

/** 请求主进程调用服务端逻辑删除当前会话 contact。 */
const removeRemoteConversation = async (roomId: string): Promise<void> => {
  await invoke('chat:remove-conversation', roomId);
};

/** 请求主进程调用服务端隐藏当前会话 contact，不删除本地历史。 */
const hideRemoteConversation = async (roomId: string): Promise<void> => {
  await invoke('chat:hide-conversation', roomId);
};

/** 请求主进程更新当前账号的会话置顶状态，不向页面暴露 JWT。 */
const setConversationTop = async (
  roomId: string,
  status: 0 | 1,
): Promise<void> => {
  return invoke('chat:set-conversation-top', roomId, status);
};

/** 仅提交会话与目标状态，由主进程复核授权并保存后端确认结果。 */
const setConversationNotDisturb = async (
  roomId: string,
  status: 0 | 1,
): Promise<void> => invoke('chat:set-conversation-not-disturb', roomId, status);

/** 请求主进程向后端发送一条聊天消息。 */
const sendMessage = async (request: SendMessageRequest): Promise<void> => {
  await invoke('chat:send-message', request);
};

/** 原生多选仅返回临时预览，不提前上传文件。 */
const chooseImages = async (roomId: string): Promise<MediaDraftSelection> =>
  invoke('chat:choose-images', roomId);

/** 只向主进程请求当前会话截图，不接受图片、屏幕来源或路径参数。 */
const captureScreenshot = async (
  roomId: string,
  hideWindow: boolean = true,
): Promise<MediaDraftSelection> =>
  invoke('chat:capture-screenshot', roomId, hideWindow);

/** 只允许上传主进程已登记的会话图片标识。 */
const uploadImageDraft = async (
  roomId: string,
  id: string,
): Promise<StoredImageContent> => invoke('chat:upload-image-draft', roomId, id);

/** 释放临时草稿，不删除原文件或持久化数据。 */
const releaseImageDrafts = async (
  roomId: string,
  ids: string[],
): Promise<void> => {
  await invoke('chat:release-image-drafts', roomId, ids);
};

/** 仅从真实拖放或粘贴事件提取媒体，不向页面开放路径或剪贴板读取接口。 */
const onMediaDrop = (
  callback: (result: MediaDropResult) => Promise<void>,
): (() => void) => {
  let active = true;
  let pending = false;
  /** 拦截文件拖放默认导航，不影响普通文本拖选。 */
  const preventFileNavigation = (event: DragEvent): void => {
    if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  };
  /** 拖放和粘贴共享忙碌状态、原会话绑定及取消订阅后的句柄释放。 */
  const receiveSelection = (
    roomId: string,
    load: () => Promise<MediaDraftSelection>,
  ): void => {
    pending = true;
    void callback({
      roomId,
      images: [],
      videos: [],
      files: [],
      error: null,
      pending: true,
    })
      .then((): Promise<MediaDraftSelection> => {
        if (!active) throw new Error('页面已变化，请重新选择图片');
        return load();
      })
      .then(async (selection): Promise<void> => {
        if (active) {
          await callback({ roomId, ...selection, error: null, pending: false });
        } else {
          await releaseImageDrafts(
            roomId,
            selection.images.map((image) => image.id),
          ).catch(() => {});
          await Promise.all([
            ...selection.videos.map((video) =>
              releaseVideoDraft(roomId, video.id).catch(() => {}),
            ),
            ...selection.files.map((file) =>
              invoke('file:release', roomId, file.id).catch(() => {}),
            ),
          ]);
        }
      })
      .catch(async (error: unknown): Promise<void> => {
        if (active)
          await callback({
            roomId,
            images: [],
            videos: [],
            files: [],
            pending: false,
            error: error instanceof Error ? error.message : '读取媒体失败',
          });
      })
      .finally((): void => {
        pending = false;
      });
  };
  /** 在事件同步阶段提取文件，异步结果仍绑定最初的目标会话。 */
  const receiveDrop = (event: DragEvent): void => {
    preventFileNavigation(event);
    if (!event.isTrusted || !event.dataTransfer?.files.length || pending)
      return;
    const target =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>('[data-media-drop-room]')
        : null;
    const roomId = target?.dataset.mediaDropRoom;
    if (!roomId || target?.dataset.mediaDropEnabled !== 'true') return;
    const paths = Array.from(event.dataTransfer.files, (file) =>
      webUtils.getPathForFile(file),
    );
    receiveSelection(roomId, (): Promise<MediaDraftSelection> =>
      invoke('chat:stage-dropped-media', roomId, paths),
    );
  };
  /** 原生文件按原名进入媒体草稿，无路径图片才按剪贴板字节读取。 */
  const receivePaste = (event: ClipboardEvent): void => {
    if (
      !event.isTrusted ||
      !event.clipboardData ||
      !(event.target instanceof HTMLTextAreaElement)
    )
      return;
    const target = event.target.closest<HTMLElement>('[data-media-drop-room]');
    const roomId = target?.dataset.mediaDropRoom;
    if (!roomId) return;
    const files = Array.from(event.clipboardData.files);
    if (!files.length) return;
    event.preventDefault();
    if (pending || target?.dataset.mediaDropEnabled !== 'true') return;
    const paths = files.map((file) => webUtils.getPathForFile(file));
    if (paths.every((filePath) => Boolean(filePath))) {
      receiveSelection(roomId, (): Promise<MediaDraftSelection> =>
        invoke('chat:stage-dropped-media', roomId, paths),
      );
      return;
    }
    receiveSelection(roomId, async (): Promise<MediaDraftSelection> => {
      if (files.some((file) => !file.type.startsWith('image/')))
        throw new Error('无法读取粘贴文件，请从文件夹重新复制');
      if (files.length > MAX_IMAGE_DRAFTS)
        throw new Error(`图片草稿最多保留 ${MAX_IMAGE_DRAFTS} 张`);
      if (files.some((file) => !file.size || file.size > MAX_IMAGE_BYTES))
        throw new Error('请选择不超过 50 MiB 的图片');
      if (
        files.reduce((sum, file) => sum + file.size, 0) > MAX_IMAGE_DRAFT_BYTES
      )
        throw new Error('图片草稿总大小不能超过 200 MiB');
      const images: { contentType: string; bytes: Uint8Array }[] = [];
      for (const file of files) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (!active) throw new Error('页面已变化，请重新粘贴图片');
        images.push({ contentType: file.type, bytes });
      }
      return invoke('chat:stage-clipboard-images', roomId, images);
    });
  };
  document.addEventListener('dragover', preventFileNavigation, true);
  document.addEventListener('drop', receiveDrop, true);
  document.addEventListener('paste', receivePaste, true);
  return (): void => {
    active = false;
    document.removeEventListener('dragover', preventFileNavigation, true);
    document.removeEventListener('drop', receiveDrop, true);
    document.removeEventListener('paste', receivePaste, true);
  };
};

/** 请求主进程按需同步历史，不向页面暴露 JWT、Clientid 或远端游标。 */
const syncMessageHistory = async (
  roomId: string,
  mode: 'latest' | 'older',
): Promise<void> => {
  await invoke('chat:sync-history', roomId, mode);
};

/** 按稳定位置读取本地缓存，分页请求自身不访问服务器。 */
const readCachedMessagePage = async (
  roomId: string,
  before: MessagePosition | null,
): Promise<CachedMessagePage> => {
  return invoke('database:read-message-page', roomId, before);
};

/** 回读当前会话已浏览消息的正文，不新增历史区间或访问远端。 */
const readCachedMessageBatch = async (
  roomId: string,
  ids: string[],
): Promise<Message[]> => invoke('database:read-message-batch', roomId, ids);

/** 请求主进程按需读取对方资料，手动刷新时跳过本地缓存。 */
const getContactProfile = async (
  uid: string,
  force: boolean = false,
  roomId?: string,
): Promise<Contact> => {
  return invoke('contact:get-profile', uid, force, roomId);
};

/** 读取主进程缓存的对方公开资料。 */
const listContacts = async (): Promise<Contact[]> => {
  return invoke('contact:list');
};

/** 将当前内容库在线备份到程序旁的 backups 目录。 */
const backupDatabase = async (): Promise<boolean> => {
  return invoke('database:backup');
};

/** 读取文件元数据列表。 */
const listStoredFiles = async (
  limit?: number,
  offset?: number,
): Promise<StoredFile[]> => {
  return invoke('database:list-files', limit, offset);
};

/** 删除文件元数据记录。 */
const deleteStoredFile = async (id: number): Promise<void> => {
  await invoke('database:delete-file', id);
};

/** 保存本地会话摘要。 */
const saveConversation = async (
  conversation: Pick<Conversation, 'id' | 'title' | 'participantId'>,
): Promise<Conversation> => {
  return invoke('database:save-conversation', conversation);
};

/** 读取本地会话摘要列表。 */
const listConversations = async (
  limit?: number,
  offset?: number,
): Promise<ConversationSummary[]> => {
  return invoke('database:list-conversations', limit, offset);
};

/** 删除当前数据空间中的会话及全部消息。 */
const deleteConversation = async (id: string): Promise<void> => {
  await invoke('database:delete-conversation', id);
};

/** 物理删除会话消息及不再引用的应用媒体缓存文件。 */
const clearConversation = async (id: string): Promise<void> => {
  await invoke('database:clear-conversation', id);
};

/** 保存本地聊天消息。 */
const saveMessage = async (message: Message): Promise<boolean> => {
  return invoke('database:save-message', message);
};

/** 分页读取当前账号跨会话的未确认消息。 */
const listUnconfirmedMessages = async (
  after: MessagePosition | null,
): Promise<Message[]> => invoke('database:list-unconfirmed-messages', after);

/** 重试前读取原会话内本人的最新消息状态。 */
const readOutgoingMessage = async (
  roomId: string,
  clientMsgId: string,
): Promise<Message | null> =>
  invoke('database:read-outgoing-message', roomId, clientMsgId);

/** 发送确认后把消息 id 更新为后端消息 id。 */
const confirmMessage = async (
  clientMsgId: string,
  serverId: string,
): Promise<void> => {
  await invoke('database:confirm-message', clientMsgId, serverId);
};

/** 按消息标识读取本人撤回文本，不允许页面传入原文或任意查询。 */
const readRecalledMessageText = async (
  conversationId: string,
  messageId: string,
): Promise<string | null> =>
  invoke('database:read-recalled-message-text', conversationId, messageId);

/** 读取已存消息引用的同会话原记录，不接受页面指定引用目标。 */
const readMessageReply = async (
  conversationId: string,
  messageId: string,
): Promise<Message | null> =>
  invoke('database:read-message-reply', conversationId, messageId);

/** 分页读取本地聊天消息。 */
const listMessages = async (
  conversationId: string,
  limit?: number,
  offset?: number,
): Promise<Message[]> => {
  return invoke('database:list-messages', conversationId, limit, offset);
};

/** 请求主进程创建工作台并释放登录窗口。 */
const openWorkspace = async (): Promise<void> => invoke('workspace:open');

/** 读取当前工作台绑定的已验证会话，不接收页面指定身份。 */
const getWorkspaceSession = async (): Promise<AuthSession> =>
  invoke('workspace:session');

/** 通知主进程工作台订阅已挂载，可以显示窗口并接收消息。 */
const workspaceReady = async (): Promise<void> => invoke('workspace:ready');

/** 请求释放当前工作台并返回独立登录窗口。 */
const returnToLogin = async (): Promise<void> =>
  invoke('workspace:return-login');

/** 请求主进程执行受限窗口操作。 */
const controlWindow: DesktopApi['controlWindow'] = async (
  action,
): Promise<boolean> => {
  return invoke('window:control', action);
};

/** 查询当前会话的历史消息，不允许传入 SQL。 */
const searchMessages = async (query: HistoryQuery): Promise<Message[]> => {
  return invoke('database:search-messages', query);
};

/** 请求主进程为当前会话打开独立历史窗口。 */
const openHistory = async (conversationId: string): Promise<void> => {
  await invoke('history:open', conversationId);
};

/** 请求主进程打开当前账号的独立设置窗口。 */
const openSettings = async (): Promise<void> => {
  await invoke('settings:open');
};

/** 请求主进程打开独立添加朋友窗口。 */
const openAddFriend = async (): Promise<void> => {
  await invoke('add-friend:open');
};

/** 只提交单聊房间，由主进程读取并绑定申请对象。 */
const openConversationFriendApplication: DesktopApi['openConversationFriendApplication'] =
  async (
    roomId: string,
  ): ReturnType<DesktopApi['openConversationFriendApplication']> =>
    invoke('chat:apply-conversation-friend', roomId);

/** 仅提交原会话和头像位置，资料由主进程读取。 */
const openFriendProfile: DesktopApi['openFriendProfile'] = async (
  roomId,
  anchor,
  targetUid,
): Promise<void> => {
  await invoke('friend-profile:open', roomId, anchor, targetUid);
};

/** 主页面切换会话或收起侧栏时销毁资料窗。 */
const closeFriendProfile = async (): Promise<void> => {
  await invoke('friend-profile:dismiss');
};

/** 只转发已绑定的会话标识，主页面再核对当前选择。 */
const onFriendProfileChat: DesktopApi['onFriendProfileChat'] = (
  callback,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (typeof value === 'string' && /^[1-9]\d{0,18}$/.test(value))
      callback(value);
  };
  ipcRenderer.on('friend-profile:chat-requested', listener);
  return (): void => {
    ipcRenderer.removeListener('friend-profile:chat-requested', listener);
  };
};

/** 退出确认包含原账号，只开放固定事件且支持卸载清理。 */
const onGroupExited: DesktopApi['onGroupExited'] = (callback): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    const notification = parseGroupExitedNotification(value);
    if (notification)
      callback(notification.userId, notification.roomId, notification.action);
  };
  ipcRenderer.on('chat:group-exited', listener);
  return (): void => {
    ipcRenderer.removeListener('chat:group-exited', listener);
  };
};

/** 仅转发主进程确认删除的房间，不提供任意事件订阅。 */
const onFriendDeleted: DesktopApi['onFriendDeleted'] = (
  callback,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (!value || typeof value !== 'object') return;
    const { roomId, clearHistory } = value as Record<string, unknown>;
    if (
      typeof roomId === 'string' &&
      /^[1-9]\d{0,18}$/.test(roomId) &&
      typeof clearHistory === 'boolean'
    )
      callback(roomId, clearHistory);
  };
  ipcRenderer.on('chat:friend-deleted', listener);
  return (): void => {
    ipcRenderer.removeListener('chat:friend-deleted', listener);
  };
};

/** 仅转发主进程从本次提交结果构建的联系人，并保留账号归属供页面复核。 */
const onFriendAdded: DesktopApi['onFriendAdded'] = (callback): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    const notification = parseRestoredFriendNotification(value);
    if (notification) callback(notification.userId, notification.friend);
  };
  ipcRenderer.on('chat:friend-added', listener);
  return (): void => {
    ipcRenderer.removeListener('chat:friend-added', listener);
  };
};

/** 备注通知按账号及真实房间校验，不向页面暴露原始 IPC。 */
const onFriendRemarkUpdated: DesktopApi['onFriendRemarkUpdated'] = (
  callback,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (
      typeof data.userId !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(data.userId) ||
      typeof data.uid !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(data.uid) ||
      typeof data.roomId !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(data.roomId) ||
      typeof data.name !== 'string' ||
      data.name.length > 256
    )
      return;
    let settings;
    try {
      settings = parseFriendRemarkSettings(data.settings);
    } catch {
      return;
    }
    callback({
      userId: data.userId,
      uid: data.uid,
      roomId: data.roomId,
      name: data.name,
      settings,
    });
  };
  ipcRenderer.on('friend-remark:updated', listener);
  return (): void => {
    ipcRenderer.removeListener('friend-remark:updated', listener);
  };
};

/** 仅转发已校验好友的 UID，不暴露原始 IPC 事件。 */
const onOpenFriendChat = (callback: (uid: string) => void): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, uid: unknown): void => {
    if (typeof uid === 'string' && /^[1-9]\d{0,18}$/.test(uid)) callback(uid);
  };
  ipcRenderer.on('add-friend:chat-requested', listener);
  return (): void => {
    ipcRenderer.removeListener('add-friend:chat-requested', listener);
  };
};

/** 转发托盘已校验的房间标识，不开放发送原始 IPC 的能力。 */
const onTrayConversation = (
  callback: (roomId: string) => void,
): (() => void) => {
  const listener = (_event: Electron.IpcRendererEvent, id: unknown): void => {
    if (typeof id === 'string' && /^[1-9]\d{0,63}$/.test(id)) callback(id);
  };
  ipcRenderer.on('tray-preview:open-conversation', listener);
  return (): void => {
    ipcRenderer.removeListener('tray-preview:open-conversation', listener);
  };
};

/** 只转发资料窗绑定的好友单聊及媒体类型，不暴露原始 IPC 事件。 */
const onFriendProfileCallRequested = (
  callback: (request: FriendProfileRtcCallRequest) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return;
    const data = value as Record<string, unknown>;
    if (
      typeof data.roomId !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(data.roomId) ||
      typeof data.uid !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(data.uid) ||
      (data.mediaMode !== RtcMediaMode.AUDIO &&
        data.mediaMode !== RtcMediaMode.VIDEO)
    )
      return;
    callback({
      roomId: data.roomId,
      uid: data.uid,
      mediaMode: data.mediaMode,
    });
  };
  ipcRenderer.on('friend-profile:call-requested', listener);
  return (): void => {
    ipcRenderer.removeListener('friend-profile:call-requested', listener);
  };
};

/** 只转发主进程校验后的历史回拨请求，不暴露原始 IPC 事件。 */
const onHistoryRtcCallRequested = (
  callback: (request: HistoryRtcCallRequest) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return;
    const data = value as Record<string, unknown>;
    if (
      typeof data.conversationId !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(data.conversationId) ||
      (data.mediaMode !== RtcMediaMode.AUDIO &&
        data.mediaMode !== RtcMediaMode.VIDEO)
    )
      return;
    callback({
      conversationId: data.conversationId,
      mediaMode: data.mediaMode,
    });
  };
  ipcRenderer.on('history:rtc-call-requested', listener);
  return (): void => {
    ipcRenderer.removeListener('history:rtc-call-requested', listener);
  };
};

/** 请求独立图片预览，主进程核对当前账号的消息归属，不接受图片 URL。 */
const openImagePreview = async (
  request: ImagePreviewRequest,
): Promise<void> => {
  await invoke('image-preview:open', request);
};

/** 仅用当前会话的草稿标识打开独立预览，不传递路径或图片地址。 */
const openImageDraftPreview = async (
  roomId: string,
  id: string,
): Promise<void> => {
  await invoke('image-preview:open-draft', roomId, id);
};

/** 按消息读取普通图片，不向页面开放任意本地路径或下载 URL。 */
const readMessageImage = async (
  request: ImagePreviewRequest,
): Promise<LocalImageData> => invoke('image:read-message', request);

/** 只查询已落盘图片，缺失时由页面展示下载入口。 */
const readLocalMessageImage = async (
  request: ImagePreviewRequest,
): Promise<LocalImageData | null> =>
  invoke('image:read-local-message', request);

/** 请求主进程定位当前账号消息的图片文件。 */
const showImageInFolder = async (
  request: ImagePreviewRequest,
): Promise<void> => {
  await invoke('image:show-in-folder', request);
};

/** 仅按消息准备拖出文件，页面只取得不含路径的短期凭据。 */
const prepareMessageDrag = async (
  request: MessageDragRequest,
): Promise<string | null> => invoke('message-drag:prepare', request);

/** 在原拖动手势中请求主进程交付已授权附件。 */
const startMessageDrag = async (ticket: string): Promise<void> => {
  await invoke('message-drag:start', ticket);
};

/** 查询本地视频状态，不触发下载。 */
const videoStatus = async (request: ImagePreviewRequest): Promise<boolean> =>
  invoke('video:status', request);
/** 封面单独读取，不请求视频正文。 */
const readVideoPoster = async (
  request: ImagePreviewRequest,
): Promise<LocalImageData> => invoke('video:poster', request);
/** 按消息标识定位视频，原生路径只在主进程解析。 */
const showVideoInFolder = async (request: ImagePreviewRequest): Promise<void> =>
  invoke('video:show-in-folder', request);
/** 只按消息标识读取本机上传封面，不向页面传递原文件路径。 */
const readVideoUpload = async (
  request: ImagePreviewRequest,
): Promise<LocalVideoUpload | null> => invoke('video:read-upload', request);
/** 首次发送前持久化主进程已持有的草稿来源。 */
const persistVideoDraft = async (
  roomId: string,
  id: string,
  clientMsgId: string,
  metadata: VideoMetadata,
): Promise<void> =>
  invoke('video:persist-draft', roomId, id, clientMsgId, {
    duration: metadata.duration,
    thumbWidth: metadata.thumbWidth,
    thumbHeight: metadata.thumbHeight,
    poster: new Uint8Array(metadata.poster),
  });
/** 从当前账号的本机记录恢复临时句柄，不提供重新选择路径的入口。 */
const restoreVideoDraft = async (
  request: ImagePreviewRequest,
): Promise<SelectedVideoDraft> => invoke('video:restore-draft', request);
/** 显式下载但不播放，下载失败由页面提供重试。 */
const downloadVideo = async (request: ImagePreviewRequest): Promise<void> =>
  invoke('video:download', request);
/** 打开已落盘视频，主进程重新检查消息归属。 */
const openVideo = async (request: ImagePreviewRequest): Promise<void> =>
  invoke('video:open', request);

/** 原生视频选择只返回随机草稿句柄。 */
const chooseVideo = async (roomId: string): Promise<MediaDraftSelection> =>
  invoke('video:choose', roomId);

/** 文件进度只接收当前主进程报告的有界实际字节量。 */
const onFileUploadProgress = (
  callback: (progress: VideoUploadProgress) => void,
): (() => void) => {
  /** 文件和视频共用进度结构，但文件上限为 6 GiB。 */
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (!value || typeof value !== 'object') return;
    const data = value as Record<string, unknown>;
    if (
      typeof data.totalBytes !== 'number' ||
      !Number.isSafeInteger(data.totalBytes) ||
      data.totalBytes < 1 ||
      data.totalBytes > MAX_FILE_BYTES ||
      typeof data.uploadedBytes !== 'number' ||
      !Number.isSafeInteger(data.uploadedBytes) ||
      data.uploadedBytes < 0 ||
      data.uploadedBytes > data.totalBytes
    )
      return;
    if (isVideoUploadProgress({ ...data, totalBytes: 1, uploadedBytes: 0 }))
      callback(value as VideoUploadProgress);
  };
  ipcRenderer.on('file:upload-progress', listener);
  return (): void => {
    ipcRenderer.removeListener('file:upload-progress', listener);
  };
};
/** 上传已选中的视频及提取的封面，不向页面暴露签名地址。 */
const uploadVideoDraft = async (
  roomId: string,
  id: string,
  metadata: VideoMetadata,
): Promise<StoredVideoContent> =>
  invoke('video:upload', roomId, id, {
    duration: metadata.duration,
    thumbWidth: metadata.thumbWidth,
    thumbHeight: metadata.thumbHeight,
    poster: new Uint8Array(metadata.poster),
  });
/** 移除视频草稿，不删除原文件。 */
const releaseVideoDraft = async (roomId: string, id: string): Promise<void> =>
  invoke('video:release', roomId, id);

/** 中止当前传输但保留原生句柄，重新发送仍由主进程核对原文件。 */
const stopVideoDraft = async (roomId: string, id: string): Promise<void> =>
  invoke('video:stop', roomId, id);

/** 创建真实占位消息，不接受页面提供的账号信息。 */
const createVideoPlaceholder = async (
  roomId: string,
  clientMsgId: string,
  content: TemporaryVideoContent,
): Promise<Message> =>
  invoke('video:create-placeholder', roomId, clientMsgId, content);

/** 替换绑定的原占位，HTTP 成功后仍等待 SSE 确认。 */
const completeVideoPlaceholder = async (
  roomId: string,
  msgId: string,
  clientMsgId: string,
  content: StoredVideoContent,
): Promise<void> =>
  invoke('video:complete-placeholder', roomId, msgId, clientMsgId, content);

/** 进度事件仅传非敏感计量信息，取消订阅时移除原始 IPC 监听。 */
const onVideoUploadProgress = (
  callback: (progress: VideoUploadProgress) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (isVideoUploadProgress(value)) callback(value);
  };
  ipcRenderer.on('video:upload-progress', listener);
  return (): void => {
    ipcRenderer.removeListener('video:upload-progress', listener);
  };
};

/** 订阅原生视频草稿解析进度，不向页面暴露文件路径或进程信息。 */
const onVideoDraftProcessingProgress = (
  callback: (progress: VideoDraftProcessingProgress) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (isVideoDraftProcessingProgress(value)) callback(value);
  };
  ipcRenderer.on('video:draft-processing-progress', listener);
  return (): void => {
    ipcRenderer.removeListener('video:draft-processing-progress', listener);
  };
};

/** 只按已登记的会话和原生句柄解析视频，不接受页面指定路径。 */
const prepareVideoDraft = async (
  roomId: string,
  id: string,
): Promise<VideoMetadata> => invoke('video:prepare-draft', roomId, id);

/** 文件摘要读取只使用已登记句柄，不接收页面路径。 */
const prepareFileDraft = async (roomId: string, id: string): Promise<void> =>
  invoke('file:prepare-draft', roomId, id);

/** 仅向当前页面交付校验通过的文件准备进度。 */
const onFileDraftProcessingProgress = (
  callback: (progress: FileDraftProcessingProgress) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    value: unknown,
  ): void => {
    if (isFileDraftProcessingProgress(value)) callback(value);
  };
  ipcRenderer.on('file:draft-processing-progress', listener);
  return (): void => {
    ipcRenderer.removeListener('file:draft-processing-progress', listener);
  };
};

export const desktop: DesktopApi = {
  openRtcCall,
  resumeRtcCall,
  rtcGetOngoingCalls,
  rtcGetActiveCalls,
  rtcGetGroupActiveCall,
  onRtcCallClosed,
  rtcCreateCall,
  rtcGetCall,
  rtcIssueToken,
  rtcAcceptCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    rtcAction('rtc:accept', callId, clientRequestId, expectedVersion),
  rtcRejectCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    rtcAction('rtc:reject', callId, clientRequestId, expectedVersion),
  rtcCancelCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    rtcAction('rtc:cancel', callId, clientRequestId, expectedVersion),
  rtcExpireCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    rtcAction('rtc:expire', callId, clientRequestId, expectedVersion),
  rtcHangupCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    rtcAction('rtc:hangup', callId, clientRequestId, expectedVersion),
  rtcLeaveCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    rtcAction('rtc:leave', callId, clientRequestId, expectedVersion),
  rtcSetVideoEnabled,
  beginConversationDrag: () => invoke('conversation:drag-start'),
  showConversationDrag: (request) =>
    invoke('conversation:drag-preview', request),
  closeConversationDrag: (id) => invoke('conversation:drag-preview-close', id),
  openConversation: (roomId, outside = false) =>
    invoke('conversation:open', roomId, outside),
  onConversationMessage: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      message: Message,
    ): void => callback(message);
    ipcRenderer.on('conversation:message', listener);
    return (): void => {
      ipcRenderer.removeListener('conversation:message', listener);
    };
  },
  deleteMessage: (target) => invoke('chat:delete-message', target),
  onConversationRead: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: ConversationReadState,
    ): void => callback(state);
    ipcRenderer.on('conversation:read', listener);
    return (): void => {
      ipcRenderer.removeListener('conversation:read', listener);
    };
  },
  onHistoryRtcCallRequested,
  getStartupPhase,
  startupRendered,
  onStartupPhase,
  prepareFileDraft,
  onFileDraftProcessingProgress,
  cancelUploadPlaceholder: async (roomId, clientMsgId): Promise<Message> =>
    invoke('video:cancel-placeholder', roomId, clientMsgId),
  createVideoPlaceholder,
  chooseAttachments: async (roomId: string): Promise<MediaDraftSelection> =>
    invoke('file:choose', roomId),
  releaseFileDraft: async (roomId: string, id: string): Promise<void> =>
    invoke('file:release', roomId, id),
  restoreFileDraft: async (
    request: ImagePreviewRequest,
  ): Promise<SelectedFileDraft> => invoke('file:restore', request),
  sendFileDraft: async (
    roomId: string,
    clientMsgId: string,
    draftId?: string,
  ): Promise<void> => invoke('file:send', roomId, clientMsgId, draftId),
  cancelFileUpload: async (
    roomId: string,
    clientMsgId: string,
  ): Promise<Message> => invoke('file:cancel', roomId, clientMsgId),
  fileStatus: async (request: ImagePreviewRequest): Promise<FileAvailability> =>
    invoke('file:status', request),
  downloadFile: async (request: ImagePreviewRequest): Promise<void> =>
    invoke('file:download', request),
  showFileInFolder: async (request: ImagePreviewRequest): Promise<void> =>
    invoke('file:show-in-folder', request),
  saveFileAs: async (request: ImagePreviewRequest): Promise<boolean> =>
    invoke('file:save-as', request),
  onFileUploadProgress,
  completeVideoPlaceholder,
  onVideoUploadProgress,
  onVideoDraftProcessingProgress,
  prepareVideoDraft,
  videoStatus,
  readVideoPoster,
  showVideoInFolder,
  readVideoUpload,
  persistVideoDraft,
  restoreVideoDraft,
  downloadVideo,
  openVideo,
  chooseVideo,
  uploadVideoDraft,
  releaseVideoDraft,
  stopVideoDraft,
  showImageInFolder,
  prepareMessageDrag,
  copyMessageAttachment: (request) =>
    invoke('message:copy-attachment', request),
  startMessageDrag,
  readMessageImage,
  readLocalMessageImage,
  openImagePreview,
  openHistory,
  openSettings,
  openAddFriend,
  openConversationFriendApplication,
  openFriendProfile,
  closeFriendProfile,
  /** 仅提交好友和房间标识，窗口初始资料由主进程读取。 */
  openFriendRemark: (uid: string, roomId: string): Promise<void> =>
    invoke('friend-remark:open', uid, roomId),
  onFriendProfileChat,
  onFriendProfileCallRequested,
  onFriendDeleted,
  onGroupExited,
  onFriendAdded,
  onFriendRemarkUpdated,
  onOpenFriendChat,
  onTrayConversation,
  searchMessages,
  openWorkspace,
  getWorkspaceSession,
  workspaceReady,
  returnToLogin,
  controlWindow,
  close: closeWindow,
  chooseFiles,
  getLocalSettings,
  getServerSettings,
  saveServerSettings,
  saveLocalSettings,
  saveDebugMode,
  login,
  register,
  chooseRegistrationAvatar,
  cancelRegistrationAvatar,
  cancelLogin,
  authorizeSession,
  getLoginState,
  selectLoginAccount,
  resumeSession,
  endSession,
  getSessionAccess,
  onSessionExpired,
  onResourceMessage,
  onResourceStatus,
  getResourceSseStatus,
  syncRemoteContacts,
  listFriends,
  getFriendUnread,
  listFriendApplications,
  readFriendApplication,
  replyFriendApplication,
  openFriendVerification,
  listGroups,
  createGroup,
  listGroupMembers,
  addGroupMembers,
  removeGroupMembers,
  exitGroup,
  dissolveGroup,
  updateGroupInfo,
  setConversationTop,
  setConversationNotDisturb,
  getFriendDetail,
  blockRoomUser,
  /** 删除好友只提交房间标识，不复用删除会话的接口。 */
  deleteFriend: (roomId: string, clearHistory: boolean): Promise<void> =>
    invoke('chat:delete-friend', roomId, clearHistory),
  unblockRoomUser,
  listEmojis,
  deleteEmoji,
  moveEmojiToFront,
  addImageEmoji,
  isImageEmojiCollected,
  listCachedEmojis,
  refreshConversationInfo,
  getFileAssistantRoomId,
  recordConversationRead,
  removeRemoteConversation,
  hideRemoteConversation,
  sendMessage,
  chooseImages,
  captureScreenshot,
  uploadImageDraft,
  uploadVoice: (roomId, bytes) => invoke('voice:upload', roomId, bytes),
  readVoice: (request) => invoke('voice:read', request),
  releaseImageDrafts,
  openImageDraftPreview,
  onMediaDrop,
  syncMessageHistory,
  readCachedMessagePage,
  readCachedMessageBatch,
  getContactProfile,
  listContacts,
  backupDatabase,
  listStoredFiles,
  deleteStoredFile,
  saveConversation,
  listConversations,
  deleteConversation,
  clearConversation,
  saveMessage,
  saveIncomingMessage: (message, incrementUnread) =>
    invoke('database:save-incoming-message', message, incrementUnread),
  listUnconfirmedMessages,
  readOutgoingMessage,
  confirmMessage,
  listMessages,
  readRecalledMessageText,
  readMessageReply,
};
