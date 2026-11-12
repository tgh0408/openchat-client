import type {
  Contact,
  Conversation,
  ConversationSummary,
  LocalSettings,
  Message,
  IncomingMessageResult,
  MessagePosition,
  CachedMessagePage,
  HistoryQuery,
  HistoryReplyPage,
  StoredFile,
} from '../storage/database';
import type {
  AuthSession,
  LoginState,
  Registration,
  SessionAccess,
  SessionInvalidationReason,
} from '../auth/auth';
import type { SendMessageRequest } from '../chat/chat';
import type { Friend, FriendDetail } from '../contacts/friend';
import type {
  FriendProfileAnchor,
  FriendProfileRtcCallRequest,
} from '../contacts/friend-profile';
import type { FriendRemarkUpdated } from '../contacts/friend-remark';
import type {
  FriendApplicationPage,
  FriendApplicationUnread,
} from '../contacts/friend-notification';
import type { FriendApplicationSubmission } from '../contacts/friend-application';
import type {
  GroupDirectoryItem,
  GroupDepartureAction,
  GroupMemberItem,
  UpdateGroupInfoRequest,
} from '../contacts/group';
import type { UserEmoji } from '../chat/emoji';
import type { ImagePreviewRequest } from './image-preview';
import type { MessageDragApi } from '../chat/messages/message-drag';
import type { MessageCopyApi } from '../chat/messages/message-copy';
import type {
  VideoMessageApi,
  SelectedVideoDraft,
  StoredVideoContent,
  VideoMetadata,
  VideoDraftProcessingProgress,
  VideoUploadProgress,
  TemporaryVideoContent,
} from '../media/video/video';
import type { StoredImageContent, LocalImageData } from '../media/image/image';
import type {
  MediaDropResult,
  MediaDraftSelection,
} from '../media/media-drafts';
import type { FileSendApi, FileMessageApi } from '../media/file/file-message';
import type { StartupPhase } from '../runtime/startup';
import type {
  RtcCallView,
  RtcJoinCredential,
  RtcMediaMode,
  RtcOngoingCall,
} from '../rtc/rtc';

/** 主进程转发的单条 SSE 事件，data 保留后端原始文本。 */
export interface ResourceSseMessage {
  event: string;
  id: string | null;
  data: string;
  receivedAt: string;
}

/** 历史通话记录请求主聊天窗口回拨的受控参数。 */
export interface HistoryRtcCallRequest {
  conversationId: string;
  mediaMode: RtcMediaMode;
}

/** 已读确认或实时消息落库后的会话未读状态，仅用于当前账号列表同步。 */
export interface ConversationReadState {
  userId: string;
  conversationId: string;
  unreadCount: number;
  notDisturb?: 0 | 1;
}

/** 当前账号资源 SSE 的连接状态。 */
export type ResourceSseStatus =
  'connecting' | 'connected' | 'reconnecting' | 'stopped';

/** SSE 建连原因，与后端 connectionType 请求参数保持一致。 */
export type ResourceSseConnectionType = 'LOGIN' | 'RECONNECT';

/** 原生文件选择器与浏览器文件选择器共用的文件元数据。 */
export interface SelectedFile {
  name: string;
  size: number;
}

/** 预加载脚本向渲染进程开放的最小桌面接口。 */
export interface DesktopApi
  extends VideoMessageApi, FileSendApi, MessageDragApi, MessageCopyApi {
  /** 打开绑定指定呼叫的独立视频通话窗口。 */
  openRtcCall: (callId: string) => Promise<void>;
  /** 用户确认后恢复原单聊，并打开绑定原 callId 的窗口。 */
  resumeRtcCall: (callId: string) => Promise<void>;
  /** 查询本人已接听且尚未结束的单聊。 */
  rtcGetOngoingCalls: () => Promise<RtcOngoingCall[]>;
  /** 呼出前查询本人仍参与的活动通话，包含响铃和群通话。 */
  rtcGetActiveCalls: () => Promise<RtcCallView[]>;
  /** 查询当前群的活动通话，包含本人未受邀或已经退出的通话。 */
  rtcGetGroupActiveCall: (roomId: string) => Promise<RtcCallView | null>;
  /** 订阅独立视频通话窗口关闭通知。 */
  onRtcCallClosed: (callback: (callId: string) => void) => () => void;
  /** 通过主进程创建 RTC 呼叫，仅替换用户已明确确认的通话。 */
  rtcCreateCall: (
    roomId: string,
    mediaMode: RtcMediaMode,
    clientRequestId: string,
    participantUids?: string[],
    replaceCallIds?: string[],
  ) => Promise<RtcCallView>;
  /** 读取当前账号可见的 RTC 呼叫。 */
  rtcGetCall: (callId: string) => Promise<RtcCallView>;
  /** 通过主进程获取当前 RTC 呼叫的 LiveKit 凭证。 */
  rtcIssueToken: (callId: string) => Promise<RtcJoinCredential>;
  /** 推进 RTC 呼叫状态并保留服务端版本校验。 */
  rtcAcceptCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcRejectCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcCancelCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  /** 发起端在截止时请求结束未接听邀请。 */
  rtcExpireCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcHangupCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  /** 群成员离开当前通话，不结束其他参与者的通话。 */
  rtcLeaveCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  /** 领取或释放当前群视频席位。 */
  rtcSetVideoEnabled: (callId: string, enabled: boolean) => Promise<boolean>;
  beginConversationDrag: () => Promise<void>;
  showConversationDrag: (
    request: import('../chat/conversations/conversation-drag').ConversationDragRequest,
  ) => Promise<void>;
  closeConversationDrag: (id: string) => Promise<void>;
  openConversation: (roomId: string, outside?: boolean) => Promise<void>;
  onConversationMessage: (callback: (message: Message) => void) => () => void;
  deleteMessage: (target: ImagePreviewRequest) => Promise<void>;
  /** 同步已落库的未读增量及主窗口或独立窗口的已读确认。 */
  onConversationRead: (
    callback: (state: ConversationReadState) => void,
  ) => () => void;
  /** 仅读取本地启动阶段，不开放数据库或授权。 */
  getStartupPhase: () => Promise<StartupPhase>;
  /** 登录首屏绘制后显示原生窗口并开始初始化。 */
  startupRendered: () => Promise<void>;
  onStartupPhase: (callback: (phase: StartupPhase) => void) => () => void;
  uploadVoice: (
    roomId: string,
    bytes: Uint8Array,
  ) => Promise<import('../media/voice/voice').VoiceContent>;
  readVoice: (request: ImagePreviewRequest) => Promise<Uint8Array>;
  cancelUploadPlaceholder: (
    roomId: string,
    clientMsgId: string,
  ) => Promise<Message>;
  createVideoPlaceholder: (
    roomId: string,
    clientMsgId: string,
    content: TemporaryVideoContent,
  ) => Promise<Message>;
  completeVideoPlaceholder: (
    roomId: string,
    msgId: string,
    clientMsgId: string,
    content: StoredVideoContent,
  ) => Promise<void>;
  onVideoUploadProgress: (
    callback: (progress: VideoUploadProgress) => void,
  ) => () => void;
  onVideoDraftProcessingProgress: (
    callback: (progress: VideoDraftProcessingProgress) => void,
  ) => () => void;
  prepareVideoDraft: (roomId: string, id: string) => Promise<VideoMetadata>;
  chooseVideo: (roomId: string) => Promise<MediaDraftSelection>;
  persistVideoDraft: (
    roomId: string,
    id: string,
    clientMsgId: string,
    metadata: VideoMetadata,
  ) => Promise<void>;
  restoreVideoDraft: (
    request: ImagePreviewRequest,
  ) => Promise<SelectedVideoDraft>;
  uploadVideoDraft: (
    roomId: string,
    id: string,
    metadata: VideoMetadata,
  ) => Promise<StoredVideoContent>;
  releaseVideoDraft: (roomId: string, id: string) => Promise<void>;
  stopVideoDraft: (roomId: string, id: string) => Promise<void>;
  /** 仅按当前账号消息定位图片，不接受任意文件路径。 */
  showImageInFolder: (request: ImagePreviewRequest) => Promise<void>;
  /** 仅读取当前消息的图片，主进程本地优先并在授权有效时补下载。 */
  readMessageImage: (request: ImagePreviewRequest) => Promise<LocalImageData>;
  /** 只读取本地图片，未下载返回空，不触发网络请求。 */
  readLocalMessageImage: (
    request: ImagePreviewRequest,
  ) => Promise<LocalImageData | null>;
  /** 由主进程核对消息归属后打开独立图片窗口，不接受页面指定 URL。 */
  openImagePreview: (request: ImagePreviewRequest) => Promise<void>;
  /** 打开或聚焦指定会话的独立历史窗口。 */
  openHistory: (conversationId: string) => Promise<void>;
  /** 打开或聚焦当前账号的独立设置窗口。 */
  openSettings: () => Promise<void>;
  /** 打开或聚焦添加朋友窗口。 */
  openAddFriend: () => Promise<void>;
  /** 从真实单聊重新打开朋友验证，目标由主进程绑定。 */
  openConversationFriendApplication: (
    roomId: string,
  ) => Promise<FriendApplicationSubmission | null>;
  /** 从当前单聊头像打开可超出主窗口边界的资料窗。 */
  openFriendProfile: (
    roomId: string,
    anchor: FriendProfileAnchor,
    targetUid?: string,
  ) => Promise<void>;
  closeFriendProfile: () => Promise<void>;
  /** 按真实单聊及好友身份打开独立备注草稿窗口。 */
  openFriendRemark: (uid: string, roomId: string) => Promise<void>;
  onFriendProfileChat: (callback: (roomId: string) => void) => () => void;
  /** 资料窗只传递已绑定的好友单聊，通话由主工作台统一发起。 */
  onFriendProfileCallRequested: (
    callback: (request: FriendProfileRtcCallRequest) => void,
  ) => () => void;
  /** 已确认删除的单聊关系，只用于刷新通讯录，不删除聊天数据。 */
  onFriendDeleted: (
    callback: (roomId: string, clearHistory: boolean) => void,
  ) => () => void;
  /** 本机退出成功后通知原账号窗口，保留会话和本地历史。 */
  onGroupExited: (
    callback: (
      userId: string,
      roomId: string,
      action: GroupDepartureAction,
    ) => void,
  ) => () => void;
  /** 本次申请直接恢复成功后本地补入联系人，不发起远端关系确认。 */
  onFriendAdded: (
    callback: (userId: string, friend: Friend) => void,
  ) => () => void;
  /** 仅接收服务端已确认保存的备注及原账号归属。 */
  onFriendRemarkUpdated: (
    callback: (update: FriendRemarkUpdated) => void,
  ) => () => void;
  /** 接收添加朋友窗口确认的好友 UID，进入聊天时仍重新读取真实详情。 */
  onOpenFriendChat: (callback: (uid: string) => void) => () => void;
  /** 接收主进程从托盘选择的当前账号会话。 */
  onTrayConversation: (callback: (roomId: string) => void) => () => void;
  /** 接收历史窗口请求回拨的通话类型，由主聊天窗口复用现有 RTC 流程。 */
  onHistoryRtcCallRequested: (
    callback: (request: HistoryRtcCallRequest) => void,
  ) => () => void;
  /** 按当前会话和筛选条件查询一页历史记录。 */
  searchMessages: (query: HistoryQuery) => Promise<Message[]>;
  /** 登录授权后创建独立工作台并销毁登录窗口。 */
  openWorkspace: () => Promise<void>;
  /** 仅工作台读取主进程已验证的当前会话，不重新授权。 */
  getWorkspaceSession: () => Promise<AuthSession>;
  /** 工作台完成挂载后显示窗口并启动唯一资源 SSE。 */
  workspaceReady: () => Promise<void>;
  /** 工作台初始化失败或重载后撤销阅读权并重建登录窗口。 */
  returnToLogin: () => Promise<void>;
  /** 操作原生窗口，返回置顶或最大化状态。 */
  controlWindow: (action: 'minimize' | 'maximize' | 'pin') => Promise<boolean>;
  /** 关闭当前 Electron 窗口。 */
  close: () => Promise<void>;
  /** 选择本地文件；取消时返回空数组，不上传文件内容。 */
  chooseFiles: () => Promise<StoredFile[]>;
  /** 读取本地非敏感设置。 */
  getLocalSettings: () => Promise<LocalSettings>;
  /** 保存本地非敏感设置。 */
  saveLocalSettings: (rememberAccount: boolean) => Promise<void>;
  /** 保存调试开关并立即更新主窗口开发者工具状态。 */
  saveDebugMode: (enabled: boolean) => Promise<void>;
  /** 由主进程调用真实后端登录接口。 */
  login: (credentials: {
    account: string;
    password: string;
  }) => Promise<AuthSession>;
  /** 由主进程向真实后端提交账号注册。 */
  register: (registration: Registration) => Promise<void>;
  /** 未登录注册专用原生选择器，只返回有界图片字节，不开放文件路径。 */
  chooseRegistrationAvatar: () => Promise<Uint8Array | null>;
  cancelRegistrationAvatar: () => Promise<void>;
  /** 取消尚未完成或尚未接收的登录请求。 */
  cancelLogin: () => Promise<void>;
  /** 接收刚从后端取得的授权并打开对应 uid 数据库。 */
  authorizeSession: (accessToken: string) => Promise<AuthSession>;
  /** 默认向后端校验当前会话；失败后可只读取状态，不能据此进入数据库。 */
  getLoginState: (checkServer?: boolean) => Promise<LoginState>;
  /** 切换历史账号或进入新账号登录，不直接打开内容库。 */
  selectLoginAccount: (id: string | null) => Promise<LoginState>;
  /** 用户确认后恢复已有会话及其数据库，不接受页面指定身份。 */
  resumeSession: () => Promise<AuthSession>;
  /** 清理内存和持久化授权，关闭用户数据库和历史窗口。 */
  endSession: () => Promise<void>;
  /** 获取当前页面的本地阅读权限，不恢复授权或打开其他账号内容库。 */
  getSessionAccess: () => Promise<SessionAccess>;
  /** 授权失效时通知当前页面返回登录，返回取消监听方法。 */
  onSessionExpired: (
    callback: (userId: string, reason?: SessionInvalidationReason) => void,
  ) => () => void;
  /** 订阅当前账号的资源 SSE 事件，data 保留后端原始文本。 */
  onResourceMessage: (
    callback: (message: ResourceSseMessage) => void,
  ) => () => void;
  /** 订阅当前账号资源 SSE 的连接状态。 */
  onResourceStatus: (
    callback: (status: ResourceSseStatus) => void,
  ) => () => void;
  /** 读取当前资源 SSE 状态，供页面挂载后同步连接状态。 */
  getResourceSseStatus: () => Promise<ResourceSseStatus>;
  /** 同步后端最近会话到本地，返回落库的会话数量。 */
  syncRemoteContacts: () => Promise<number>;
  /** 拉取当前账号好友联系人，数据只保留在当前页面内存。 */
  listFriends: () => Promise<Friend[]>;
  getFriendUnread: () => Promise<FriendApplicationUnread[]>;
  listFriendApplications: (pageNo: number) => Promise<FriendApplicationPage>;
  readFriendApplication: (applyId: string) => Promise<void>;
  replyFriendApplication: (applyId: string, msg: string) => Promise<void>;
  openFriendVerification: (
    applyId: string,
    friendId: string,
  ) => Promise<boolean>;
  /** 拉取当前账号加入的群聊，数据只保留在当前页面内存。 */
  listGroups: () => Promise<GroupDirectoryItem[]>;
  createGroup: (uids: string[]) => Promise<GroupDirectoryItem>;
  /** 拉取指定群的成员列表，数据只保留在当前页面内存。 */
  listGroupMembers: (roomId: string) => Promise<GroupMemberItem[]>;
  addGroupMembers: (roomId: string, uids: string[]) => Promise<void>;
  removeGroupMembers: (roomId: string, uids: string[]) => Promise<void>;
  exitGroup: (roomId: string) => Promise<void>;
  dissolveGroup: (roomId: string) => Promise<void>;
  updateGroupInfo: (request: UpdateGroupInfoRequest) => Promise<void>;
  getFriendDetail: (uid: string, roomId: string) => Promise<FriendDetail>;
  /** 仅对指定房间拉黑目标，不封禁账号或 IP。 */
  blockRoomUser: (roomId: string, uid: string) => Promise<void>;
  deleteFriend: (roomId: string, clearHistory: boolean) => Promise<void>;
  /** 仅解除当前账号在指定房间对目标设置的限制。 */
  unblockRoomUser: (roomId: string, uid: string) => Promise<void>;
  /** 获取当前授权用户的图片表情列表。 */
  listEmojis: () => Promise<UserEmoji[]>;
  /** 读取当前账号 SQLite 中的表情元数据缓存。 */
  listCachedEmojis: () => Promise<UserEmoji[]>;
  /** 删除当前账号的收藏，服务端确认后同步移除本地缓存。 */
  deleteEmoji: (imgId: string) => Promise<void>;
  /** 将本人收藏移到最前，返回服务端确认且已落库的完整列表。 */
  moveEmojiToFront: (imgId: string) => Promise<UserEmoji[]>;
  /** 按已确认的普通图片消息添加表情，不接受图片地址或本地路径。 */
  addImageEmoji: (request: ImagePreviewRequest) => Promise<void>;
  /** 仅查账号本地收藏缓存，表情按 ID、普通图片按原始字节摘要匹配。 */
  isImageEmojiCollected: (request: ImagePreviewRequest) => Promise<boolean>;
  /** 点击会话时获取服务端详情并刷新本地摘要与未读数。 */
  refreshConversationInfo: (roomId: string) => Promise<ConversationSummary>;
  recordConversationRead: (
    roomId: string,
    messageId: string,
  ) => Promise<boolean>;
  /** 请求服务端逻辑删除会话 contact，成功后由页面清理本地会话。 */
  removeRemoteConversation: (roomId: string) => Promise<void>;
  /** 请求服务端隐藏当前账号的会话，成功后由页面移除当前列表项但保留本地历史。 */
  hideRemoteConversation: (roomId: string) => Promise<void>;
  /** 更新当前账号的会话置顶状态，服务端成功后才改变本地排序。 */
  setConversationTop: (roomId: string, status: 0 | 1) => Promise<void>;
  setConversationNotDisturb: (roomId: string, status: 0 | 1) => Promise<void>;
  /** 向后端发送一条聊天消息，成功与否由 SSE 推送确认。 */
  sendMessage: (request: SendMessageRequest) => Promise<void>;
  /** 原生多选只加入临时草稿，点击发送后才上传。 */
  chooseImages: (roomId: string) => Promise<MediaDraftSelection>;
  /** 默认隐藏主窗口后框选；传 false 保留窗口，确认加入图片草稿，取消返回空选择。 */
  captureScreenshot: (
    roomId: string,
    hideWindow?: boolean,
  ) => Promise<MediaDraftSelection>;
  /** 订阅 preload 接收的真实文件拖入和图片粘贴，不暴露任意路径或剪贴板接口。 */
  onMediaDrop: (
    callback: (result: MediaDropResult) => Promise<void>,
  ) => () => void;
  /** 上传当前页面、账号和会话绑定的图片草稿。 */
  uploadImageDraft: (roomId: string, id: string) => Promise<StoredImageContent>;
  openImageDraftPreview: (roomId: string, id: string) => Promise<void>;
  /** 释放当前会话指定的临时图片，不删除原文件。 */
  releaseImageDrafts: (roomId: string, ids: string[]) => Promise<void>;
  /** 按需补齐最新缺口或一页旧历史，进度由主进程管理。 */
  syncMessageHistory: (
    roomId: string,
    mode: 'latest' | 'older',
  ) => Promise<void>;
  /** 只读本地一页消息并返回缓存与远端历史余量。 */
  readCachedMessagePage: (
    roomId: string,
    before: MessagePosition | null,
  ) => Promise<CachedMessagePage>;
  /** 按已知消息身份回读占位正文，单批最多五十条且限定当前会话。 */
  readCachedMessageBatch: (roomId: string, ids: string[]) => Promise<Message[]>;
  /** 按 uid 优先读取本地公开资料，force 为 true 时重新请求后端。 */
  getContactProfile: (
    uid: string,
    force?: boolean,
    roomId?: string,
  ) => Promise<Contact>;
  /** 读取本地缓存的对方公开资料。 */
  listContacts: () => Promise<Contact[]>;
  /** 将当前内容库备份到程序旁的 backups 目录。 */
  backupDatabase: () => Promise<boolean>;
  /** 读取文件元数据列表。 */
  listStoredFiles: (limit?: number, offset?: number) => Promise<StoredFile[]>;
  /** 删除文件元数据记录。 */
  deleteStoredFile: (id: number) => Promise<void>;
  /** 保存本地会话摘要。 */
  saveConversation: (
    conversation: Pick<Conversation, 'id' | 'title' | 'participantId'>,
  ) => Promise<Conversation>;
  /** 读取本地会话摘要列表。 */
  listConversations: (
    limit?: number,
    offset?: number,
  ) => Promise<ConversationSummary[]>;
  /** 删除当前用户会话及其消息。 */
  deleteConversation: (id: string) => Promise<void>;
  /** 物理删除当前用户会话、消息及不再引用的应用媒体缓存。 */
  clearConversation: (id: string) => Promise<void>;
  /** 保存本地聊天消息。 */
  saveMessage: (message: Message) => Promise<boolean>;
  /** 仅主窗口将实时接收消息与未读增量一起提交。 */
  saveIncomingMessage: (
    message: Message,
    incrementUnread: boolean,
  ) => Promise<IncomingMessageResult>;
  /** 分页读取当前账号跨会话的未确认普通消息。 */
  listUnconfirmedMessages: (
    after: MessagePosition | null,
  ) => Promise<Message[]>;
  /** 按本人 clientMsgId 重新核对原会话消息，不接受任意用户身份。 */
  readOutgoingMessage: (
    roomId: string,
    clientMsgId: string,
  ) => Promise<Message | null>;
  /** 发送确认后把消息 id 从本地 UUID 更新为后端消息 id，并标记已发送。 */
  confirmMessage: (clientMsgId: string, serverId: string) => Promise<void>;
  /** 只读取本人已撤回文本的本地编辑副本，不能读取其他用户或房间的消息。 */
  readRecalledMessageText: (
    conversationId: string,
    messageId: string,
  ) => Promise<string | null>;
  /** 只读本条消息实际引用的同会话缓存，不推进已读或拉取远端历史。 */
  readMessageReply: (
    conversationId: string,
    messageId: string,
  ) => Promise<Message | null>;
  /** 分页读取本地聊天消息。 */
  listMessages: (
    conversationId: string,
    limit?: number,
    offset?: number,
  ) => Promise<Message[]>;
}

/** 历史窗口所需的非敏感上下文，由主进程从当前用户数据库读取。 */
export interface HistoryWindowContext {
  conversationId: string;
  conversationTitle: string;
  userId: string;
}

/** 历史窗口的最小只读接口，不开放用户切换、文件和数据库写入能力。 */
export interface HistoryWindowApi
  extends VideoMessageApi, FileMessageApi, MessageDragApi, MessageCopyApi {
  /** 只定位绑定会话中本条回复的原文，返回最多五十条本地记录。 */
  readReplyPage: (messageId: string) => Promise<HistoryReplyPage | null>;
  readMessageReply: (
    conversationId: string,
    messageId: string,
  ) => Promise<Message | null>;
  readVoice: (request: ImagePreviewRequest) => Promise<Uint8Array>;
  /** 请求主聊天窗口回拨当前历史会话，不向历史窗口开放 RTC 写接口。 */
  requestRtcCall: (mediaMode: RtcMediaMode) => Promise<void>;
  onMessageRecalled: (listener: (message: Message) => void) => () => void;
  /** 只读绑定消息的展示者资料（撤回时为操作者），不开放任意用户查询。 */
  getMessageContact: (
    messageId: string,
    force?: boolean,
  ) => Promise<Contact | null>;
  readMessageImage: (request: ImagePreviewRequest) => Promise<LocalImageData>;
  readLocalMessageImage: (
    request: ImagePreviewRequest,
  ) => Promise<LocalImageData | null>;
  showImageInFolder: (request: ImagePreviewRequest) => Promise<void>;
  /** 仅允许预览当前历史窗口绑定会话内的普通图片。 */
  openImagePreview: (request: ImagePreviewRequest) => Promise<void>;
  getContext: () => Promise<HistoryWindowContext>;
  searchMessages: (query: HistoryQuery) => Promise<Message[]>;
  minimize: () => Promise<void>;
  close: () => Promise<void>;
}
