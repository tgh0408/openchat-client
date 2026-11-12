import type { ImageOcrProvider } from '../media/image/image-ocr';

/** 本机 OCR 后端及最后一次判断时间，时间使用 UTC ISO 字符串。 */
export interface StoredOcrProvider {
  provider: ImageOcrProvider;
  checkedAt: string;
}
/** 本地文件记录，不包含文件内容。 */
export interface StoredFile {
  id: number;
  name: string;
  size: number;
  createdAt: string;
}

/** 本地会话摘要。 */
export interface Conversation {
  id: string;
  title: string;
  participantId: string | null;
  /** 会话头像地址，本地会话为空。 */
  avatar: string | null;
  /** 房间类型：1 群聊、2 单聊、3 文件助手，本地会话为空。 */
  type: number | null;
  /** 是否置顶：0 否、1 是。 */
  isTop: number;
  /** 已同步的消息免打扰状态，未同步的旧快照可缺省。 */
  notDisturb?: 0 | 1;
  /** 未读消息数。 */
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

/** 会话列表的只读摘要，使用服务端摘要或时间更新的本地消息预览。 */
export interface ConversationSummary extends Conversation {
  /** 当前详情的有效已读位置，合并本地已读与服务端确认，用于本次未读定位。 */
  lastReadMsgId?: string;
  /** 当前详情请求的群管理权限提示，不持久化为本地授权。 */
  canRecallMembers?: boolean;
  /** 当前授权期间由详情接口确认的群退出状态，不作为登录授权。 */
  groupRemoved?: boolean;
  lastMessage: string | null;
  /** 本地消息摘要的发送者；服务端已格式化摘要、本地会话及删除提示为空。 */
  lastMessageSenderId: string | null;
  /** 本地撤回摘要保留完整元数据，交由当前阅读者解析名称。 */
  lastMessageType?: string | null;
  /** 摘要对应的本地消息标识；仅有远端摘要且无法关联时为空。 */
  lastMessageId?: string | null;
  /** 摘要来源时间，与可能受本地待发送消息影响的会话活跃时间分开。 */
  lastMessageCreatedAt?: string | null;
}

/** 本地聊天消息。 */
export interface Message {
  /** 后端全局唯一消息 id；发送确认前用本地 UUID，本地提示使用独立的 local-rejection 前缀。 */
  id: string;
  /** 客户端消息 id；发送时为本地生成的 UUID，接收时为发送方的 clientMsgId。 */
  clientMsgId: string | null;
  /** 引用的服务端消息 ID；缺省表示保留原引用，null 表示没有引用。 */
  replyId?: string | null;
  conversationId: string;
  senderId: string;
  /** 文本为正文；媒体、recalled、local-notice 和结构化 system 保存 JSON。本地媒体路径仅由主进程管理。 */
  content: string;
  messageType: string;
  status: string;
  /** 本地自动重试资格；缺省表示不改写，null 表示清除，不发送给服务端。 */
  autoRetryReason?: 'offline' | 'timeout' | null;
  createdAt: string;
  editedAt: string | null;
  /** 当前客户端的持久删除时间；非空记录不展示，同步不能清除此标记。 */
  deletedAt: string | null;
}

/** 实时消息落库后的会话计数，重复消息仍返回当前真实未读数。 */
export interface IncomingMessageResult {
  saved: boolean;
  unreadCount: number;
}

/** 本地消息的稳定分页位置，不随新增消息导致的行数变化而移动。 */
export interface MessagePosition {
  createdAt: string;
  id: string;
}

/** 会话已确认的连续历史区间；仅保存同步元数据，不保存页面状态。 */
export interface MessageSyncState {
  conversationId: string;
  latestId: string | null;
  olderCursor: string | null;
  oldest: MessagePosition | null;
  exhausted: boolean;
}

/** 本地消息页同时报告缓存余量与远端历史是否仍待补齐。 */
export interface CachedMessagePage {
  list: Message[];
  before: MessagePosition | null;
  hasMoreLocal: boolean;
  hasMoreRemote: boolean;
}

/** 历史记录界面允许使用的分类。 */
export type HistoryCategory =
  'all' | 'file' | 'media' | 'link' | 'music' | 'miniapp' | 'channel';

/** 历史查询只接收受控筛选条件，日期使用 UTC 半开区间。 */
export interface HistoryQuery {
  conversationId: string;
  keyword: string;
  category: HistoryCategory;
  startAt: string | null;
  endAt: string | null;
  offset: number;
}

/** 原文所在的本地历史页；偏移沿用按时间和 ID 倒序的历史查询。 */
export interface HistoryReplyPage {
  targetId: string;
  offset: number;
  list: Message[];
}

/** 页面允许使用的非敏感本地设置。 */
export interface LocalSettings {
  rememberAccount: boolean;
  debugMode: boolean;
}

/** 用户标识用于隔离本地数据，预览使用固定 ID，不包含登录账号或凭据。 */
export interface LocalProfile {
  id: string;
  nickname: string;
  databasePassword: string;
}

/** 当前账号缓存的对方资料及名称，用于聊天中展示头像与昵称。 */
export interface Contact {
  /** 用户 id（后端 uid 字符串）。 */
  id: string;
  nickname: string;
  avatar: string | null;
  signature: string | null;
  updatedAt: string;
  /** 当前账号的私有好友备注。 */
  remark?: string | null;
  /** 以 roomId 隔离的群成员昵称，不是群聊名称。 */
  groupNicknames?: Readonly<Record<string, string | null>>;
  /** 私有备注及各房间昵称的本地获取时间，按需过期刷新。 */
  nameUpdatedAt?: string;
  groupNamesUpdatedAt?: Readonly<Record<string, string>>;
}
