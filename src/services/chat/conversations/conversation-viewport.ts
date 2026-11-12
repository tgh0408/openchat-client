import type { Conversation } from '../../../../shared/storage/database';

export const CONVERSATION_ROW_HEIGHT = 73;

/** 重排后保持首个可见会话和行内偏移；位于顶部时继续展示最新会话。 */
export const conversationScrollOffset = (
  previous: Conversation[],
  next: Conversation[],
  offset: number,
  height: number,
): number => {
  if (offset <= 0 || next.length === 0) return 0;
  const anchor = previous[Math.floor(offset / CONVERSATION_ROW_HEIGHT)];
  const index = next.findIndex((item) => item.id === anchor?.id);
  const anchored =
    index < 0
      ? offset
      : index * CONVERSATION_ROW_HEIGHT + (offset % CONVERSATION_ROW_HEIGHT);
  return Math.min(
    anchored,
    Math.max(0, next.length * CONVERSATION_ROW_HEIGHT - height),
  );
};
