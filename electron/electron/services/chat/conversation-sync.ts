import { requestRemoveConversation } from '../../../shared/chat/conversations/conversation-preferences';
import type { AuthSession } from '../../../shared/auth/auth';
import { createAuthenticatedApiClient } from '../network/api-client';
import { requireAuthenticatedSession } from '../auth/auth';
import {
  listPendingConversationDeletions,
  acknowledgeConversationDeletion,
} from '../database/database';
import { consumeConversationDeletions } from './conversation-deletions';

const deletionRequests = new WeakMap<AuthSession, Promise<void>>();

/** 当前授权内合并删除队列消费；异步完成只确认当时提交的数据库版本。 */
export const flushConversationDeletions = async (
  validateCurrent: () => void,
): Promise<void> => {
  validateCurrent();
  const session = requireAuthenticatedSession();
  const existing = deletionRequests.get(session);
  if (existing) {
    await existing;
    validateCurrent();
    return;
  }
  const api = createAuthenticatedApiClient(validateCurrent);
  const operation = consumeConversationDeletions({
    list: listPendingConversationDeletions,
    submit: (deletion): Promise<void> =>
      requestRemoveConversation(
        api,
        deletion.conversationId,
        deletion.lastDeleteId,
      ),
    acknowledge: acknowledgeConversationDeletion,
    validate: (): void => {
      validateCurrent();
      api.validateCurrent();
    },
  });
  deletionRequests.set(session, operation);
  try {
    await operation;
  } finally {
    if (deletionRequests.get(session) === operation)
      deletionRequests.delete(session);
  }
};
