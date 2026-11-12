import type { Conversation } from '../../../../shared/storage/database';

/** 会话置顶优先，同组按活跃时间和 ID 倒序保持稳定排序。 */
export const compareConversations = (
  left: Conversation,
  right: Conversation,
): number =>
  right.isTop - left.isTop ||
  right.updatedAt.localeCompare(left.updatedAt) ||
  right.id.localeCompare(left.id);

/** 在有序列表中替换或插入单项，其他会话保持原有顺序及对象引用。 */
const placeConversation = (
  conversations: Conversation[],
  conversation: Conversation,
  previousIndex: number,
): Conversation[] => {
  const previous = conversations[previousIndex];
  const before = conversations[previousIndex - 1];
  const after = conversations[previousIndex + 1];
  if (
    previous &&
    (!before || compareConversations(before, conversation) <= 0) &&
    (!after || compareConversations(conversation, after) <= 0)
  ) {
    conversations[previousIndex] = conversation;
    return conversations;
  }
  const next = conversations.slice();
  if (previousIndex >= 0) next.splice(previousIndex, 1);
  let start = 0;
  let end = next.length;
  while (start < end) {
    const middle = Math.floor((start + end) / 2);
    if (compareConversations(next[middle]!, conversation) < 0)
      start = middle + 1;
    else end = middle;
  }
  next.splice(start, 0, conversation);
  return next;
};

/** 新增或刷新单个会话，调用方须先按统一规则初始化有序列表。 */
export const upsertOrderedConversation = (
  conversations: Conversation[],
  conversation: Conversation,
): Conversation[] =>
  placeConversation(
    conversations,
    conversation,
    conversations.findIndex((item) => item.id === conversation.id),
  );

/** 新消息只移动目标会话，重复或迟到消息保留原列表，不执行全量排序。 */
export const updateConversationActivity = (
  conversations: Conversation[],
  conversationId: string,
  createdAt: string,
): Conversation[] => {
  const index = conversations.findIndex((item) => item.id === conversationId);
  const current = conversations[index];
  if (!current || createdAt <= current.updatedAt) return conversations;
  return placeConversation(
    conversations,
    { ...current, updatedAt: createdAt },
    index,
  );
};
