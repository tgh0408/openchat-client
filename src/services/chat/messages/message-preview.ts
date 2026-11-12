import type { Contact, Message } from '../../../../shared/storage/database';
import {
  formatRecallMessage,
  parseRecallContent,
  resolveMessageName,
  shouldKeepRecalledMessage,
} from '../../../../shared/chat/messages/recall-message';

export interface MessagePreview {
  text: string;
  senderId?: string;
  messageType?: string | null;
  messageId?: string | null;
  clientMsgId?: string | null;
  createdAt?: string | null;
}

/** 只返回当前摘要需要的联系人，避免将整个联系人表作为行组件依赖。 */
export const messagePreviewUid = (
  preview: MessagePreview | undefined,
): string | undefined => {
  switch (preview?.messageType) {
    case 'system':
    case 'local-notice':
      return undefined;
    case 'recalled':
      return parseRecallContent(preview.text).recallUid ?? undefined;
    default:
      return preview?.senderId;
  }
};

/** 按单个会话格式化摘要，沿用备注、群昵称和撤回者的现有规则。 */
export const formatMessagePreview = (
  preview: MessagePreview | undefined,
  conversationId: string,
  userId: string,
  userNickname: string,
  contact?: Contact,
): string => {
  if (!preview) return '';
  switch (preview.messageType) {
    case 'system':
    case 'local-notice':
      return preview.text;
    case 'recalled':
      return formatRecallMessage(
        preview.text,
        userId,
        conversationId,
        contact ? { [contact.id]: contact } : {},
      );
    default: {
      const uid = preview.senderId;
      if (!uid) return preview.text;
      const nickname =
        uid === userId
          ? userNickname
          : resolveMessageName(uid, conversationId, contact);
      return `${nickname || `用户 ${uid}`}:${preview.text}`;
    }
  }
};

/** 相同摘要保留对象引用，确认换 ID、撤回和来源时间变化仍须更新。 */
export const isSameMessagePreview = (
  previous: MessagePreview | undefined,
  incoming: MessagePreview,
): boolean =>
  previous !== undefined &&
  previous.text === incoming.text &&
  previous.senderId === incoming.senderId &&
  previous.messageType === incoming.messageType &&
  previous.messageId === incoming.messageId &&
  previous.clientMsgId === incoming.clientMsgId &&
  previous.createdAt === incoming.createdAt;

/** 只跳过完全相同的消息视图，不能仅凭 ID 忽略状态或正文的原位变化。 */
export const isSameMessageView = (
  previous: Message,
  incoming: Message,
): boolean =>
  previous.id === incoming.id &&
  (previous.replyId ?? null) === (incoming.replyId ?? null) &&
  previous.clientMsgId === incoming.clientMsgId &&
  previous.conversationId === incoming.conversationId &&
  previous.senderId === incoming.senderId &&
  previous.content === incoming.content &&
  previous.messageType === incoming.messageType &&
  previous.status === incoming.status &&
  previous.autoRetryReason === incoming.autoRetryReason &&
  previous.createdAt === incoming.createdAt &&
  previous.editedAt === incoming.editedAt &&
  previous.deletedAt === incoming.deletedAt;

/** 按摘要来源更新原位消息，不把会话活跃时间当作消息身份或撤回时间。 */
export const shouldUpdateMessagePreview = (
  preview: MessagePreview | undefined,
  message: Message,
  activeAt: string,
): boolean => {
  if (!preview?.text) return true;
  const sameMessage =
    preview.messageId === message.id ||
    (!!message.clientMsgId &&
      (preview.messageId === message.clientMsgId ||
        preview.clientMsgId === message.clientMsgId));
  if (sameMessage)
    return !shouldKeepRecalledMessage(
      { messageType: preview.messageType ?? '', content: preview.text },
      message,
    );
  const createdAt = preview.createdAt ?? activeAt;
  if (message.createdAt !== createdAt) return message.createdAt > createdAt;
  if (preview.messageId) return message.id > preview.messageId;
  return message.messageType === 'recalled';
};
