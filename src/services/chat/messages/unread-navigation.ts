import type { Message } from '../../../../shared/storage/database';
import { compareMessageIds } from '../../../../shared/chat/conversations/conversation-deletion';

interface UnreadTarget {
  needsOlder: boolean;
  messageId: string | null;
}

/** 先确认分页已覆盖已读边界，再定位第一条真实的对方未读消息。 */
export const findUnreadTarget = (
  messages: readonly Message[],
  afterId: string,
  userId: string,
  hasMore: boolean,
): UnreadTarget => {
  let boundaryReached = !hasMore;
  let messageId: string | null = null;
  for (const message of messages) {
    if (message.status !== 'sent' || !/^[1-9]\d{0,18}$/.test(message.id))
      continue;
    if (compareMessageIds(message.id, afterId) <= 0) {
      boundaryReached = true;
    } else if (
      messageId === null &&
      message.senderId !== userId &&
      !message.deletedAt
    ) {
      messageId = message.id;
    }
  }
  return { needsOlder: !boundaryReached, messageId };
};
