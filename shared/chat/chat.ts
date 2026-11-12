import type { ResourceChatMessage } from './messages/resource-message';
import { ResourceMessageType } from './messages/resource-message';
import { parseReplyId } from './messages/message-reply';
import { validateRecallContent } from './messages/recall-message';
import {
  encodeReceivedVideo,
  validateVideo,
  videoMessageBody,
} from '../media/video/video';
import { encodeReceivedFile } from '../media/file/file-message';
import {
  encodeReceivedVoice,
  validateVoice,
  voiceMessageBody,
} from '../media/voice/voice';
import type { Message } from '../storage/database';
import { validateUploadPlaceholder } from './messages/upload-placeholder';
import { encodeReceivedEmojiContent } from './emoji';
import { encodeReceivedRtcCall } from './messages/rtc-call-message';
import { encodeReceivedSystemMessage } from './messages/system-message';
import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import { isDeletionMessageId } from './conversations/conversation-deletion';
import {
  encodeReceivedImageContent,
  parseImageName,
  parseImageSize,
  parseImageUrl,
} from '../media/image/image';

/** 后端文件助手会话类型。 */
export const FILE_ASSISTANT_TYPE = 3 as const;
export type ChatRoomType = 1 | 2 | typeof FILE_ASSISTANT_TYPE;

/** 后端最近会话列表中的单条会话，Long 字段兼容数字或字符串下发。 */
export interface ChatRoom {
  /** 仅用于本次详情的界面提示，操作权限始终由服务端复核。 */
  canRecallMembers?: boolean;
  /** 已离群时只返回本人会话状态，不能覆盖本地名称、摘要或消息。 */
  groupRemoved?: boolean;
  roomId: string;
  /** 单聊对方 UID；群聊、文件助手或旧服务未返回时为空。 */
  participantId: string | null;
  /** 房间类型：1 群聊、2 单聊、3 文件助手。 */
  type: ChatRoomType;
  /** 是否置顶：0 否、1 是。 */
  isTop: number;
  /** 消息免打扰；旧服务缺省时不覆盖已同步的设置。 */
  notDisturb?: 0 | 1;
  /** 最新一条消息预览。 */
  text: string | null;
  /** 会话名称。 */
  name: string;
  /** 会话头像地址，可能为空。 */
  avatarUidList: string[];
  avatar: string | null;
  /** 房间最后活跃时间，Unix 毫秒时间戳。 */
  activeTime: number;
  /** 未读消息数。 */
  unreadCount: number;
  /** 与未读数同一快照的统计边界，旧服务缺省时不猜测。 */
  lastMsgId?: string;
  lastReadMsgId?: string;
}

/** 免打扰只接受二值枚举，旧服务缺省时保留未知状态。 */
const parseNotDisturb = (value: unknown): 0 | 1 | undefined => {
  if (value === undefined) return undefined;
  if (value !== 0 && value !== 1) throw new Error('会话免打扰状态无效');
  return value;
};

/** 已读及房间快照允许零值，但禁止浮点雪花 ID。 */
const parseReadBoundary = (value: unknown): string | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !isDeletionMessageId(value))
    throw new Error('会话已读边界无效');
  return value;
};

/** 退出标记只适用于群聊，拒绝把字符串或其他房间类型当作退出状态。 */
const parseGroupRemoved = (value: unknown, type: ChatRoomType): boolean => {
  if (
    (value !== undefined && typeof value !== 'boolean') ||
    (value === true && type !== 1)
  )
    throw new Error('会话退出状态无效');
  return value === true;
};

/** 远端聊天记录分页结果；游标和消息 ID 均按字符串处理，避免 Long 精度丢失。 */
export interface MessagePage {
  cursor: string | null;
  isFirst: boolean;
  isLast: boolean;
  list: ResourceChatMessage[];
}

/** 解析会话列表响应；会话接口以 code === 200 表示成功。 */
export const parseContactList = (value: unknown): ChatRoom[] => {
  const root = parseApiResult(value, '会话列表');
  const data = root.data;
  if (!Array.isArray(data)) throw new Error('会话列表服务返回的数据无效');
  return data.map((item: unknown): ChatRoom => {
    if (typeof item !== 'object' || item === null)
      throw new Error('会话列表服务返回的数据无效');
    const room = item as Record<string, unknown>;
    const roomId = readLongValue(room.roomId);
    if (
      !roomId ||
      (room.type !== 1 &&
        room.type !== 2 &&
        room.type !== FILE_ASSISTANT_TYPE) ||
      (room.isTop !== 0 && room.isTop !== 1)
    )
      throw new Error('会话列表服务返回的数据无效');
    return {
      roomId,
      groupRemoved: parseGroupRemoved(room.groupRemoved, room.type),
      participantId: parseParticipantId(room.participantId, room.type),
      type: room.type,
      isTop: room.isTop,
      notDisturb: parseNotDisturb(room.notDisturb),
      text: typeof room.text === 'string' ? room.text : null,
      name: typeof room.name === 'string' ? room.name : '',
      avatarUidList: readAvatarUidList(room.avatarUidList),
      avatar: null,
      activeTime: typeof room.activeTime === 'number' ? room.activeTime : 0,
      unreadCount: typeof room.unreadCount === 'number' ? room.unreadCount : 0,
      lastMsgId: parseReadBoundary(room.lastMsgId),
      lastReadMsgId: parseReadBoundary(room.lastReadMsgId),
    };
  });
};

/** 把后端 Long 字段统一为无精度损失的正整数字符串。 */
const readLongValue = (value: unknown): string | null => {
  switch (typeof value) {
    case 'string':
      return /^[1-9]\d{0,63}$/.test(value) ? value : null;
    case 'number':
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    default:
      return null;
  }
};

/** 鏍￠獙缇ゅご鍍忛瑙堢敤鎴风殑 UID 鍒楄〃銆?*/
const readAvatarUidList = (value: unknown): string[] => {
  if (value == null) return [];
  if (
    !Array.isArray(value) ||
    value.length > 9 ||
    value.some((item) => !readLongValue(item))
  )
    throw new Error('缇よ亰澶村儚 UID 鍒楄〃鏃犳晥');
  return value.map((item) => readLongValue(item)!);
};

/** 只接受单聊的有效对方 UID，旧服务缺省时不猜测身份。 */
const parseParticipantId = (
  value: unknown,
  type: ChatRoomType,
): string | null => {
  if (value == null) return null;
  const uid = readLongValue(value);
  if (type !== 2 || !uid) throw new Error('会话对方用户 ID 无效');
  return uid;
};

/** 校验会话详情响应，拒绝串房间、非法时间及无效未读数，避免覆盖本地有效数据。 */
export const parseContactInfo = (
  value: unknown,
  expectedRoomId: string,
): ChatRoom => {
  const root = parseApiResult(value, '会话详情');
  if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data))
    throw new Error('会话详情服务返回的数据无效');
  const room = root.data as Record<string, unknown>;
  const actualRoomId = readLongValue(room.roomId);
  if (
    !actualRoomId ||
    actualRoomId !== expectedRoomId ||
    (room.type !== 1 && room.type !== 2 && room.type !== FILE_ASSISTANT_TYPE) ||
    (room.isTop !== 0 && room.isTop !== 1) ||
    typeof room.name !== 'string' ||
    room.name.length > 256 ||
    room.name.includes('\0') ||
    (room.text !== null &&
      (typeof room.text !== 'string' ||
        room.text.length > 65536 ||
        room.text.includes('\0'))) ||
    typeof room.activeTime !== 'number' ||
    !Number.isSafeInteger(room.activeTime) ||
    room.activeTime < 0 ||
    !Number.isFinite(new Date(room.activeTime).getTime()) ||
    typeof room.unreadCount !== 'number' ||
    !Number.isSafeInteger(room.unreadCount) ||
    room.unreadCount < 0 ||
    (room.canRecallMembers !== undefined &&
      typeof room.canRecallMembers !== 'boolean')
  )
    throw new Error('会话详情服务返回的数据无效');
  if (typeof room.avatar === 'string') {
    let url: URL;
    try {
      url = new URL(room.avatar);
    } catch {
      throw new Error('会话头像地址无效');
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('会话头像地址无效');
  }
  return {
    roomId: actualRoomId,
    groupRemoved: parseGroupRemoved(room.groupRemoved, room.type),
    participantId: parseParticipantId(room.participantId, room.type),
    type: room.type,
    isTop: room.isTop,
    notDisturb: parseNotDisturb(room.notDisturb),
    name: room.name,
    text: room.text,
    avatarUidList: readAvatarUidList(room.avatarUidList),
    avatar: null,
    activeTime: room.activeTime,
    unreadCount: room.unreadCount,
    lastMsgId: parseReadBoundary(room.lastMsgId),
    lastReadMsgId: parseReadBoundary(room.lastReadMsgId),
    canRecallMembers: room.type === 1 && room.canRecallMembers === true,
  };
};

/** 点击会话时读取服务器当前摘要，使用本次授权和平台 clientId。 */
export const requestContactInfo = async (
  api: ApiClient,
  roomId: string,
): Promise<ChatRoom> => {
  if (readLongValue(roomId) !== roomId) throw new Error('无效的会话 ID');
  return api.request({
    path: `/capi/chat/contact/info/${encodeURIComponent(roomId)}`,
    method: 'POST',
    serviceName: '会话详情',
    parse: (value: unknown): ChatRoom => parseContactInfo(value, roomId),
  });
};

/** 解析后端返回的倒序聊天记录分页，拒绝缺少关键字段的响应。 */
export const parseMessagePage = (value: unknown): MessagePage => {
  const root = parseApiResult(value, '聊天记录');
  if (!root.data || typeof root.data !== 'object')
    throw new Error('聊天记录服务返回的数据无效');
  const data = root.data as Record<string, unknown>;
  if (
    typeof data.isFirst !== 'boolean' ||
    typeof data.isLast !== 'boolean' ||
    !Array.isArray(data.list) ||
    data.list.length > 200
  )
    throw new Error('聊天记录服务返回的数据无效');
  const cursor =
    data.cursor == null || data.cursor === ''
      ? null
      : readLongValue(data.cursor);
  if (
    (data.cursor != null && data.cursor !== '' && cursor === null) ||
    (!data.isLast && cursor === null)
  )
    throw new Error('聊天记录服务返回的游标无效');
  const list = data.list.map((item): ResourceChatMessage => {
    if (!item || typeof item !== 'object')
      throw new Error('聊天记录服务返回的数据无效');
    const entry = item as Record<string, unknown>;
    if (
      !entry.fromUser ||
      typeof entry.fromUser !== 'object' ||
      !entry.message ||
      typeof entry.message !== 'object'
    )
      throw new Error('聊天记录服务返回的数据无效');
    const fromUser = entry.fromUser as Record<string, unknown>;
    const message = entry.message as Record<string, unknown>;
    const uid = readLongValue(fromUser.uid);
    const id = readLongValue(message.id);
    const roomId = readLongValue(message.roomId);
    if (
      !uid ||
      !id ||
      !roomId ||
      typeof message.sendTime !== 'number' ||
      !Number.isSafeInteger(message.sendTime) ||
      !Number.isFinite(new Date(message.sendTime).getTime()) ||
      message.sendTime < 0 ||
      typeof message.type !== 'number' ||
      !Number.isSafeInteger(message.type) ||
      (message.clientMsgId != null &&
        (typeof message.clientMsgId !== 'string' ||
          !message.clientMsgId.trim() ||
          message.clientMsgId.length > 64))
    )
      throw new Error('聊天记录服务返回的数据无效');
    return {
      fromUser: { uid },
      message: {
        id,
        roomId,
        replyId: parseReplyId(message.replyId),
        sendTime: message.sendTime,
        type: message.type,
        body: message.body ?? null,
        clientMsgId:
          typeof message.clientMsgId === 'string' ? message.clientMsgId : null,
      },
    };
  });
  return {
    cursor,
    isFirst: data.isFirst,
    isLast: data.isLast,
    list,
  };
};

/** 历史与 SSE 共用文本、图片和表情转换，其他类型不伪造正文。 */
export const toHistoryMessage = (
  remote: ResourceChatMessage,
): Message | null => {
  if (remote.message.type === ResourceMessageType.Recall) {
    const recall = validateRecallContent(remote.message.body);
    return {
      id: remote.message.id,
      clientMsgId: remote.message.clientMsgId,
      conversationId: remote.message.roomId,
      senderId: remote.fromUser.uid,
      content: JSON.stringify(recall),
      messageType: 'recalled',
      status: 'sent',
      createdAt: new Date(remote.message.sendTime).toISOString(),
      editedAt: null,
      deletedAt: null,
    };
  }
  let messageType: Message['messageType'];
  switch (remote.message.type) {
    case ResourceMessageType.Text:
      messageType = 'text';
      break;
    case ResourceMessageType.Emoji:
      messageType = 'emoji';
      break;
    case ResourceMessageType.Image:
      messageType = 'image';
      break;
    case ResourceMessageType.Video:
      messageType = 'video';
      break;
    case ResourceMessageType.File:
      messageType = 'file';
      break;
    case ResourceMessageType.Sound:
      messageType = 'audio';
      break;
    case ResourceMessageType.Temporary:
      messageType = 'temporary';
      break;
    case ResourceMessageType.RtcCall:
      messageType = 'rtc-call';
      break;
    case ResourceMessageType.System:
      messageType = 'system';
      break;
    default:
      return null;
  }
  const body = remote.message.body;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('聊天记录服务返回的消息内容无效');
  const data = body as Record<string, unknown>;
  let content: string;
  if (messageType === 'temporary') {
    const extra = data.extra as Record<string, unknown> | null;
    try {
      const placeholder = validateUploadPlaceholder({
        targetType: extra?.targetType,
        cancelled: extra?.cancelled,
        fileName: extra?.fileName,
        fileSize: extra?.size,
        duration: extra?.duration,
        thumbWidth: extra?.thumbWidth,
        thumbHeight: extra?.thumbHeight,
      });
      content = JSON.stringify(placeholder);
      if (placeholder.cancelled) messageType = 'upload-cancelled';
    } catch {
      return null;
    }
  } else if (messageType === 'audio') {
    content = encodeReceivedVoice(data);
  } else if (messageType === 'file') {
    content = encodeReceivedFile(data);
  } else if (messageType === 'video') {
    content = encodeReceivedVideo(data);
  } else if (messageType === 'image') {
    content = encodeReceivedImageContent(data);
  } else if (messageType === 'emoji') {
    content = encodeReceivedEmojiContent(readEmojiId(data) ?? '', data.content);
  } else if (messageType === 'rtc-call') {
    content = encodeReceivedRtcCall(data);
  } else if (messageType === 'system') {
    if (remote.message.clientMsgId !== null)
      throw new Error('聊天记录服务返回的系统提示无效');
    content = encodeReceivedSystemMessage(data);
  } else {
    if (
      typeof data.content !== 'string' ||
      data.content.length > 65536 ||
      data.content.includes('\0')
    )
      throw new Error('聊天记录服务返回的消息内容无效');
    content = data.content;
  }
  return {
    id: remote.message.id,
    clientMsgId: remote.message.clientMsgId,
    replyId: parseReplyId(remote.message.replyId),
    conversationId: remote.message.roomId,
    senderId: remote.fromUser.uid,
    content,
    messageType,
    status: 'sent',
    createdAt: new Date(remote.message.sendTime).toISOString(),
    editedAt: null,
    deletedAt: null,
  };
};

/** 从服务端表情消息扩展字段读取并校验表情标识。 */
const readEmojiId = (body: Record<string, unknown>): string | null => {
  const extra = body.extra;
  if (typeof extra !== 'object' || extra === null) return null;
  const emojiId = (extra as Record<string, unknown>).emojiId;
  switch (typeof emojiId) {
    case 'string':
      return /^[1-9]\d{0,63}$/.test(emojiId) ? emojiId : null;
    case 'number':
      return Number.isSafeInteger(emojiId) && emojiId > 0
        ? String(emojiId)
        : null;
    default:
      return null;
  }
};

/** 请求一页倒序聊天记录，首次请求使用空字符串游标。 */
export const requestMessagePage = async (
  api: ApiClient,
  roomId: string,
  pageSize: number,
  cursor: string | null,
): Promise<MessagePage> => {
  if (
    readLongValue(roomId) !== roomId ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 200 ||
    (cursor !== null && readLongValue(cursor) !== cursor)
  )
    throw new Error('无效的聊天记录分页参数');
  const parsedRoomId = Number(roomId);
  const requestRoomId =
    /^\d+$/.test(roomId) && Number.isSafeInteger(parsedRoomId)
      ? parsedRoomId
      : roomId;
  const page = await api.request({
    path: '/capi/chat/msg/page',
    method: 'POST',
    body: { roomId: requestRoomId, pageSize, cursor: cursor ?? '' },
    serviceName: '聊天记录',
    parse: parseMessagePage,
  });
  if (
    page.list.length > pageSize ||
    page.list.some((item) => item.message.roomId !== roomId) ||
    (!page.isLast && page.cursor === cursor)
  )
    throw new Error('聊天记录服务返回的会话或分页游标无效');
  return page;
};

/** 单次获取全部可见会话；未返回项不代表本地会话已删除。 */
export const listRemoteContacts = async (
  api: ApiClient,
): Promise<ChatRoom[]> => {
  return api.request({
    path: '/capi/chat/contact/list',
    method: 'POST',
    serviceName: '会话列表',
    parse: parseContactList,
  });
};

/** 发送消息请求体；msgType 区分文本与后续媒体类型。 */
export interface SendMessageRequest {
  roomId: string;
  replyId?: string | null;
  /** 消息类型：1 文本，2 撤回，4 图片，5 视频，8 语音条，9 图片表情。 */
  msgType: 1 | 2 | 4 | 5 | 8 | 9;
  clientMsgId: string;
  body: Record<string, unknown>;
}

/** 校验发送消息请求，白名单仅开放已接入的文本、图片和表情字段。 */
export const parseSendMessageRequest = (value: unknown): SendMessageRequest => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('无效的发送请求');
  const data = value as Record<string, unknown>;
  if (
    typeof data.roomId !== 'string' ||
    readLongValue(data.roomId) !== data.roomId ||
    typeof data.msgType !== 'number' ||
    typeof data.clientMsgId !== 'string' ||
    !data.clientMsgId.trim() ||
    data.clientMsgId.length > 64 ||
    data.clientMsgId.includes('\0') ||
    Object.keys(data).some(
      (key) =>
        !['roomId', 'msgType', 'clientMsgId', 'replyId', 'body'].includes(key),
    ) ||
    typeof data.body !== 'object' ||
    data.body === null ||
    Array.isArray(data.body)
  )
    throw new Error('无效的发送请求');
  const body = data.body as Record<string, unknown>;
  const replyId = parseReplyId(data.replyId);
  const reply = replyId === null ? {} : { replyId };
  if (data.msgType === ResourceMessageType.Sound) {
    if (
      Object.keys(body).some(
        (key) =>
          ![
            'content',
            'uploadAddress',
            'fileName',
            'fileSize',
            'second',
          ].includes(key),
      )
    )
      throw new Error('语音消息字段无效');
    const voice = validateVoice({
      url: body.content,
      fileName: body.fileName,
      fileSize: body.fileSize,
      second: body.second,
    });
    if (body.uploadAddress !== voice.url) throw new Error('语音地址不一致');
    return {
      roomId: data.roomId,
      clientMsgId: data.clientMsgId,
      msgType: 8,
      ...reply,
      body: voiceMessageBody(JSON.stringify(voice)),
    };
  }
  if (data.msgType === ResourceMessageType.Recall) {
    if (replyId !== null) throw new Error('撤回请求不能附带引用消息');
    if (
      typeof body.msgId !== 'string' ||
      readLongValue(body.msgId) !== body.msgId ||
      Object.keys(body).some((key) => key !== 'msgId')
    )
      throw new Error('无效的撤回消息标识');
    return {
      roomId: data.roomId,
      msgType: 2,
      clientMsgId: data.clientMsgId,
      body: { msgId: body.msgId },
    };
  }
  if (data.msgType === ResourceMessageType.Video) {
    const body = data.body as Record<string, unknown>;
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some(
        (key) =>
          ![
            'content',
            'uploadAddress',
            'fileName',
            'fileSize',
            'thumbUrl',
            'thumbSize',
            'thumbWidth',
            'thumbHeight',
            'duration',
          ].includes(key),
      )
    )
      throw new Error('视频消息无效');
    const video = validateVideo({
      url: body.content,
      fileName: body.fileName,
      fileSize: body.fileSize,
      thumbUrl: body.thumbUrl,
      thumbSize: body.thumbSize,
      thumbWidth: body.thumbWidth,
      thumbHeight: body.thumbHeight,
      duration: body.duration,
    });
    if (parseImageUrl(body.uploadAddress) !== video.url)
      throw new Error('视频上传与下载地址不一致');
    return {
      roomId: data.roomId,
      msgType: 5,
      ...reply,
      clientMsgId: data.clientMsgId,
      body: videoMessageBody(JSON.stringify(video)),
    };
  }
  if (data.msgType === ResourceMessageType.Image) {
    if (
      Object.keys(body).some(
        (key) =>
          !['content', 'uploadAddress', 'fileName', 'fileSize'].includes(key),
      )
    )
      throw new Error('无效的图片消息字段');
    const content = parseImageUrl(body.content);
    if (parseImageUrl(body.uploadAddress) !== content)
      throw new Error('图片地址不一致');
    return {
      roomId: data.roomId,
      msgType: data.msgType,
      clientMsgId: data.clientMsgId,
      body: {
        content,
        uploadAddress: content,
        fileName: parseImageName(body.fileName),
        fileSize: String(parseImageSize(body.fileSize)),
      },
      ...reply,
    };
  }
  if (data.msgType === ResourceMessageType.Emoji) {
    if (
      typeof body.emojiId !== 'string' ||
      !/^[1-9]\d{0,63}$/.test(body.emojiId) ||
      Object.keys(body).some((key) => key !== 'emojiId')
    )
      throw new Error('无效的表情包标识');
    return {
      roomId: data.roomId,
      msgType: data.msgType,
      clientMsgId: data.clientMsgId,
      body: { emojiId: body.emojiId },
      ...reply,
    };
  }
  if (data.msgType !== ResourceMessageType.Text)
    throw new Error('不支持的消息类型');
  if (
    typeof body.content !== 'string' ||
    !body.content.trim() ||
    body.content.length > 5000 ||
    body.content.includes('\0') ||
    Object.keys(body).some(
      (key) => !['content', 'replyMsgId', 'atUidList'].includes(key),
    ) ||
    body.replyMsgId != null ||
    body.atUidList != null
  )
    throw new Error('无效的消息内容');
  return {
    roomId: data.roomId,
    msgType: data.msgType,
    clientMsgId: data.clientMsgId,
    body: { content: body.content },
    ...reply,
  };
};

/** 向后端提交一条聊天消息；成功与否由 SSE 推送的 clientMsgId 确认。 */
export const requestSendMessage = async (
  api: ApiClient,
  request: SendMessageRequest,
): Promise<void> => {
  const validated = parseSendMessageRequest(request);
  await api.request({
    path: '/capi/chat/msg',
    method: 'POST',
    body: { ...validated },
    serviceName: '聊天',
    httpError: '消息发送失败',
    parse: (): void => {},
  });
};
