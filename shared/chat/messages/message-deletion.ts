import type { Message } from '../../storage/database';

/** 本地删除正常已确认消息，不限制发送者、消息年龄或网络状态。 */
export const canDeleteMessage = (message: Message): boolean =>
  !message.deletedAt &&
  message.status === 'sent' &&
  Boolean(message.id.trim()) &&
  Boolean(message.conversationId.trim()) &&
  ['text', 'image', 'video', 'file', 'audio', 'emoji', 'rtc-call'].includes(
    message.messageType,
  );
