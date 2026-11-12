import type { ConversationDeletion } from '../../../shared/chat/conversations/conversation-deletion';
import { SessionExpiredError } from '../../../shared/auth/auth';

interface DeletionDependencies {
  list: (after: string) => ConversationDeletion[];
  submit: (deletion: ConversationDeletion) => Promise<void>;
  acknowledge: (deletion: ConversationDeletion) => void;
  validate: () => void;
}

/** 每轮按稳定会话游标消费，失败留库且不阻塞其他会话，旧授权不继续处理。 */
export const consumeConversationDeletions = async (
  dependencies: DeletionDependencies,
): Promise<void> => {
  let after = '';
  let failed = false;
  let failure: unknown;
  while (true) {
    dependencies.validate();
    const batch = dependencies.list(after);
    if (!batch.length) break;
    for (const deletion of batch) {
      dependencies.validate();
      try {
        await dependencies.submit(deletion);
        dependencies.validate();
        dependencies.acknowledge(deletion);
      } catch (cause) {
        dependencies.validate();
        if (cause instanceof SessionExpiredError) throw cause;
        failed = true;
        failure = cause;
      }
      after = deletion.conversationId;
    }
  }
  if (failed) throw failure;
};
