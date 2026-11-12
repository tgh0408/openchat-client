import { ref, type Ref } from 'vue';
import type { Message } from '../../../../shared/storage/database';
import { parseRecallContent } from '../../../../shared/chat/messages/recall-message';

type RecallTarget = Pick<Message, 'id' | 'conversationId'>;

interface RecallFeedback extends RecallTarget {
  text: string;
}

interface RecallDependencies {
  active: () => boolean;
  context: () => number;
  userId: () => string;
  send: (target: RecallTarget) => Promise<void>;
  readText?: (target: RecallTarget) => Promise<string | null>;
}

interface RecallAttempt {
  target: RecallTarget;
  timer: ReturnType<typeof setTimeout>;
}

interface MessageRecall {
  pending: Ref<Set<string>>;
  feedback: Ref<RecallFeedback | null>;
  recall: (message: Message) => Promise<void>;
  acknowledge: (message: Message) => void;
  editText: (message: Message) => string | null;
  restore: (message: Message) => Promise<void>;
  forgetConversation: (conversationId: string) => void;
  clear: () => void;
}

/** 按目标消息管理撤回确认；HTTP 成功不确认，迟到失败不能覆盖 SSE 终态。 */
export const createMessageRecall = (
  dependencies: RecallDependencies,
): MessageRecall => {
  const pending = ref(new Set<string>());
  const feedback = ref<RecallFeedback | null>(null);
  const attempts = new Map<string, RecallAttempt>();
  const originals = ref(
    new Map<string, { conversationId: string; text: string }>(),
  );
  const restores = new Map<
    string,
    { conversationId: string; promise: Promise<void> }
  >();

  /** 提示只属于当前目标，不清除其他撤回或工作台操作的错误。 */
  const clearFeedback = (target: RecallTarget): void => {
    if (
      feedback.value?.id === target.id &&
      feedback.value.conversationId === target.conversationId
    )
      feedback.value = null;
  };

  /** 捕获稳定 ID 和页面代次，超时后允许重试但废弃旧请求的迟到结果。 */
  const recall = async (message: Message): Promise<void> => {
    if (!dependencies.active() || pending.value.has(message.id)) return;
    const target = { id: message.id, conversationId: message.conversationId };
    if (
      message.senderId === dependencies.userId() &&
      message.messageType === 'text' &&
      message.status === 'sent' &&
      !message.deletedAt
    )
      originals.value.set(target.id, {
        conversationId: target.conversationId,
        text: message.content,
      });
    const context = dependencies.context();
    clearFeedback(target);
    pending.value.add(target.id);
    const attempt: RecallAttempt = {
      target,
      timer: setTimeout((): void => {
        if (attempts.get(target.id) !== attempt) return;
        pending.value.delete(target.id);
        if (dependencies.active() && dependencies.context() === context)
          feedback.value = {
            ...target,
            text: '撤回尚未确认，请重试或重新进入会话',
          };
      }, 10000),
    };
    attempts.set(target.id, attempt);
    try {
      await dependencies.send(target);
    } catch (cause) {
      if (attempts.get(target.id) !== attempt) return;
      clearTimeout(attempt.timer);
      attempts.delete(target.id);
      pending.value.delete(target.id);
      if (dependencies.active() && dependencies.context() === context)
        feedback.value = {
          ...target,
          text: cause instanceof Error ? cause.message : '撤回失败，请重试',
        };
    }
  };

  /** SSE、历史及本地已确认记录共用此入口，迟到确认同时清理所属提示。 */
  const acknowledge = (message: Message): void => {
    if (message.messageType !== 'recalled' || message.status !== 'sent') return;
    const attempt = attempts.get(message.id);
    if (attempt?.target.conversationId === message.conversationId) {
      clearTimeout(attempt.timer);
      attempts.delete(message.id);
      pending.value.delete(message.id);
    }
    if (
      message.senderId !== dependencies.userId() ||
      parseRecallContent(message.content).recallUid !== dependencies.userId() ||
      message.deletedAt
    ) {
      originals.value.delete(message.id);
      restores.delete(message.id);
    }
    clearFeedback(message);
  };

  /** 仅本人确认撤回的文本可回填，原文只保留在本页面内存中。 */
  const editText = (message: Message): string | null => {
    if (
      !dependencies.active() ||
      message.messageType !== 'recalled' ||
      message.status !== 'sent' ||
      message.deletedAt ||
      message.senderId !== dependencies.userId() ||
      parseRecallContent(message.content).recallUid !== dependencies.userId()
    )
      return null;
    const original = originals.value.get(message.id);
    return original?.conversationId === message.conversationId
      ? original.text
      : null;
  };

  /** 历史读取或页面重载后按需补回本人原文，迟到结果不得跨账号或已删除会话。 */
  const restore = async (message: Message): Promise<void> => {
    if (
      !dependencies.active() ||
      !dependencies.readText ||
      message.messageType !== 'recalled' ||
      message.status !== 'sent' ||
      message.deletedAt ||
      message.senderId !== dependencies.userId() ||
      parseRecallContent(message.content).recallUid !== dependencies.userId() ||
      editText(message) !== null
    )
      return;
    const pending = restores.get(message.id);
    if (pending?.conversationId === message.conversationId)
      return pending.promise;
    const target = { id: message.id, conversationId: message.conversationId };
    const userId = dependencies.userId();
    const readText = dependencies.readText;
    /** 合并同条读取，结果返回时复核所属生命周期后再开放按钮。 */
    const load = async (): Promise<void> => {
      try {
        const text = await readText(target);
        if (
          !dependencies.active() ||
          dependencies.userId() !== userId ||
          restores.get(target.id) !== task ||
          text === null
        )
          return;
        originals.value.set(target.id, {
          conversationId: target.conversationId,
          text,
        });
      } finally {
        if (restores.get(target.id) === task) restores.delete(target.id);
      }
    };
    const task = {
      conversationId: target.conversationId,
      promise: Promise.resolve().then(load),
    };
    restores.set(target.id, task);
    await task.promise;
  };

  /** 删除会话时释放暂存原文和在途读取，持久副本由数据库级联清理。 */
  const forgetConversation = (conversationId: string): void => {
    for (const [id, original] of originals.value)
      if (original.conversationId === conversationId)
        originals.value.delete(id);
    for (const [id, task] of restores)
      if (task.conversationId === conversationId) restores.delete(id);
  };

  /** 退出或授权失效后取消计时，并让仍在途的请求失去反馈权限。 */
  const clear = (): void => {
    for (const attempt of attempts.values()) clearTimeout(attempt.timer);
    attempts.clear();
    pending.value.clear();
    feedback.value = null;
    originals.value.clear();
    restores.clear();
  };

  return {
    pending,
    feedback,
    recall,
    acknowledge,
    editText,
    restore,
    forgetConversation,
    clear,
  };
};
