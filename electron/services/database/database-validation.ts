import type {
  HistoryCategory,
  HistoryQuery,
  Message,
  MessagePosition,
} from '../../../shared/storage/database';
import { parseEmojiContent } from '../../../shared/chat/emoji';
import { validateRecallContent } from '../../../shared/chat/messages/recall-message';
import { parseImageContent } from '../../../shared/media/image/image';
import { parseVoice } from '../../../shared/media/voice/voice';
import {
  parseVideoContent,
  UNAVAILABLE_VIDEO_CONTENT,
} from '../../../shared/media/video/video';
import {
  parseFileContent,
  UNAVAILABLE_FILE_CONTENT,
} from '../../../shared/media/file/file-message';
import { parseRtcCallMessage } from '../../../shared/chat/messages/rtc-call-message';

/** 校验历史查询的类别、时间范围和分页参数。 */
export const parseHistoryQuery = (value: unknown): HistoryQuery => {
  const data = parseObject(value, [
    'conversationId',
    'keyword',
    'category',
    'startAt',
    'endAt',
    'offset',
  ]);
  const category = parseText(data.category, 16);
  if (
    !['all', 'file', 'media', 'link', 'music', 'miniapp', 'channel'].includes(
      category,
    )
  )
    throw new Error('不支持的历史分类');
  const startAt = data.startAt === null ? null : parseDate(data.startAt);
  const endAt = data.endAt === null ? null : parseDate(data.endAt);
  if (
    (startAt === null) !== (endAt === null) ||
    (startAt && endAt && startAt >= endAt)
  )
    throw new Error('无效的日期范围');
  return {
    conversationId: parseText(data.conversationId),
    keyword: parseText(data.keyword, 256, true).trim(),
    category: category as HistoryCategory,
    startAt,
    endAt,
    offset: parseInteger(data.offset, 0, 10_000_000),
  };
};

/** 检查 IPC 对象结构及字段白名单，不接收任意 SQL 或凭据对象。 */
export const parseObject = (
  value: unknown,
  keys: string[],
): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('无效的数据对象');
  }
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new Error('存在不支持的数据字段');
  }
  return value as Record<string, unknown>;
};

/** 校验有限长度字符串，不改变消息正文中的空白。 */
export const parseText = (
  value: unknown,
  max = 256,
  allowEmpty = false,
): string => {
  if (
    typeof value !== 'string' ||
    value.length > max ||
    (!allowEmpty && !value.trim()) ||
    value.includes('\0')
  ) {
    throw new Error('无效的文本字段');
  }
  return value;
};

/** 验证布尔设置，拒绝以字符串伪装的真假值。 */
export const parseBoolean = (value: unknown): boolean => {
  if (typeof value !== 'boolean') throw new Error('无效的设置值');
  return value;
};

/** 校验分页及记录编号，拒绝 NaN、负数与不安全整数。 */
export const parseInteger = (
  value: unknown,
  min: number,
  max: number,
): number => {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== 'number' ||
    value < min ||
    value > max
  ) {
    throw new Error('无效的分页参数或记录编号');
  }
  return value;
};

/** 规范化有效日期，使 SQLite 的文本时间排序稳定。 */
const parseDate = (value: unknown): string => {
  const text = parseText(value, 40);
  if (!Number.isFinite(Date.parse(text))) throw new Error('无效的时间字段');
  return new Date(text).toISOString();
};

/** 校验本地消息分页位置，空值表示读取最新页。 */
export const parseMessagePosition = (
  value: unknown,
): MessagePosition | null => {
  if (value === null) return null;
  const data = parseObject(value, ['createdAt', 'id']);
  return { createdAt: parseDate(data.createdAt), id: parseText(data.id) };
};

/** 限制占位回读的消息数量与身份长度，拒绝不受控批量读取。 */
export const parseMessageBatchIds = (value: unknown): string[] => {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    throw new Error('无效的消息回读数量');
  return [...new Set(value.map((id: unknown) => parseText(id, 64)))];
};

/** 严格检查消息输入，不允许用附加字段持久化认证信息。 */
export const parseMessage = (value: unknown): Message => {
  const data = parseObject(value, [
    'id',
    'clientMsgId',
    'replyId',
    'conversationId',
    'senderId',
    'content',
    'messageType',
    'status',
    'autoRetryReason',
    'createdAt',
    'editedAt',
    'deletedAt',
  ]);
  const messageType = parseText(data.messageType, 32);
  const status = parseText(data.status, 32);
  if (
    data.autoRetryReason !== undefined &&
    data.autoRetryReason !== null &&
    data.autoRetryReason !== 'offline' &&
    data.autoRetryReason !== 'timeout'
  )
    throw new Error('无效的消息自动重试原因');
  if (
    ![
      'text',
      'emoji',
      'image',
      'file',
      'audio',
      'video',
      'temporary',
      'upload-cancelled',
      'system',
      'recalled',
      'rtc-call',
    ].includes(messageType)
  ) {
    throw new Error('不支持的消息类型');
  }
  if (
    !['pending', 'sent', 'delivered', 'read', 'failed', 'recalled'].includes(
      status,
    )
  ) {
    throw new Error('不支持的消息状态');
  }
  const content = parseText(data.content, 65536, true);
  if (
    messageType === 'audio' &&
    data.deletedAt == null &&
    content !== '{}' &&
    !parseVoice(content)
  )
    throw new Error('无效的语音消息');
  if (messageType === 'recalled' && data.deletedAt == null) {
    if (content !== '消息已撤回') validateRecallContent(JSON.parse(content));
  }
  if (
    messageType === 'file' &&
    data.deletedAt == null &&
    content !== UNAVAILABLE_FILE_CONTENT &&
    !parseFileContent(content)
  )
    throw new Error('无效的文件消息');
  if (
    ['temporary', 'upload-cancelled'].includes(messageType) &&
    data.deletedAt == null &&
    (!parseUploadPlaceholder(content) ||
      parseUploadPlaceholder(content)!.cancelled !==
        (messageType === 'upload-cancelled'))
  )
    throw new Error('无效的文件占位');
  if (
    messageType === 'video' &&
    data.deletedAt == null &&
    content !== UNAVAILABLE_VIDEO_CONTENT &&
    !parseVideoContent(content)
  )
    throw new Error('无效的视频消息');
  if (
    messageType === 'emoji' &&
    data.deletedAt == null &&
    !parseEmojiContent(content)
  )
    throw new Error('无效的表情包消息');
  if (
    messageType === 'image' &&
    data.deletedAt == null &&
    !parseImageContent(content)
  )
    throw new Error('无效的图片消息');
  if (messageType === 'rtc-call' && data.deletedAt == null)
    parseRtcCallMessage(content);
  return {
    id: parseText(data.id),
    clientMsgId:
      data.clientMsgId == null ? null : parseText(data.clientMsgId, 64),
    ...(data.replyId !== undefined
      ? { replyId: parseReplyId(data.replyId) }
      : {}),
    conversationId: parseText(data.conversationId),
    senderId: parseText(data.senderId),
    content,
    messageType,
    status,
    ...(data.autoRetryReason !== undefined
      ? { autoRetryReason: data.autoRetryReason }
      : {}),
    createdAt: parseDate(data.createdAt),
    editedAt: data.editedAt == null ? null : parseDate(data.editedAt),
    deletedAt: data.deletedAt == null ? null : parseDate(data.deletedAt),
  };
};
import { parseUploadPlaceholder } from '../../../shared/chat/messages/upload-placeholder';
import { parseReplyId } from '../../../shared/chat/messages/message-reply';
