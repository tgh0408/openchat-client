import type { Message } from '../../storage/database';

/** 引用 ID 使用正数十进制字符串，不将雪花 ID 转为浮点数。 */
export const parseReplyId = (value: unknown): string | null => {
  if (value == null) return null;
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new Error('无效的引用消息 ID');
  return value;
};

/** 只允许已确认、未删除的远端普通消息作为引用目标。 */
export const canReplyToMessage = (message: Message): boolean => {
  if (
    message.status !== 'sent' ||
    message.deletedAt ||
    !/^[1-9]\d{0,18}$/.test(message.id) ||
    !/^[1-9]\d{0,18}$/.test(message.conversationId)
  )
    return false;
  switch (message.messageType) {
    case 'text':
    case 'image':
    case 'emoji':
    case 'audio':
    case 'video':
    case 'file':
      return true;
    default:
      return false;
  }
};
