import { ApiRequestTimeoutError } from '../../../shared/api/api-client';
import type { ApiClient } from '../../../shared/api/api-client';
import { requestSendMessage } from '../../../shared/chat/chat';
import type { SendMessageRequest } from '../../../shared/chat/chat';
import { parseMessageRejection } from '../../../shared/chat/messages/message-rejection';
import {
  readOutgoingMessage,
  saveMessageRejection,
  setMessageAutoRetryReason,
} from '../database/database';
import { validateReplyTarget } from './message-reply';

/** 主进程在每次提交前消费旧资格，仅明确请求超时才重新加入自动重试。 */
export const sendOutgoingMessage = async (
  api: ApiClient,
  request: SendMessageRequest,
): Promise<void> => {
  api.validateCurrent();
  const local = readOutgoingMessage(request.roomId, request.clientMsgId);
  if (!local) throw new Error('待发送消息已移除或不属于当前账号');
  if (local.status === 'sent') return;
  if ((request.replyId ?? null) !== (local.replyId ?? null))
    throw new Error('引用消息与本地发送记录不一致');
  validateReplyTarget(request.roomId, local.replyId);
  setMessageAutoRetryReason(request.roomId, request.clientMsgId, null);
  try {
    await requestSendMessage(api, request);
  } catch (error) {
    const rejection =
      error instanceof Error ? parseMessageRejection(error.message) : null;
    if (rejection !== null) {
      api.validateCurrent();
      saveMessageRejection(request.roomId, request.clientMsgId, rejection);
    }
    if (error instanceof ApiRequestTimeoutError) {
      api.validateCurrent();
      setMessageAutoRetryReason(request.roomId, request.clientMsgId, 'timeout');
    }
    throw error;
  }
};
