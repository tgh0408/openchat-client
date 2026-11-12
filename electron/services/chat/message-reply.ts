import {
  canReplyToMessage,
  parseReplyId,
} from '../../../shared/chat/messages/message-reply';
import { getHistoryMessage } from '../database/database';

/** 引用目标只从当前授权库的同会话读取，服务端仍负责最终权限校验。 */
export const validateReplyTarget = (
  roomId: string,
  value: unknown,
): string | null => {
  const replyId = parseReplyId(value);
  if (replyId && !canReplyToMessage(getHistoryMessage(roomId, replyId)))
    throw new Error('引用消息已失效，请取消引用后重新发送');
  return replyId;
};
