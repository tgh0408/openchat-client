import { isDeletionMessageId } from '../conversations/conversation-deletion';

/** 主进程只提取聊天路由字段用于删除过滤，完整正文仍由现有接收器校验。 */
export const readResourceChatIdentity = (
  data: string,
): { roomId: string; messageId: string } | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const root = parsed as Record<string, unknown>;
  if (
    root.eventType !== undefined ||
    !root.message ||
    typeof root.message !== 'object'
  )
    return null;
  const message = root.message as Record<string, unknown>;
  /** 兼容协议允许的安全整数，不接受已经丢失精度的数值。 */
  const readId = (value: unknown): string | null => {
    if (
      typeof value === 'string' &&
      value !== '0' &&
      isDeletionMessageId(value)
    )
      return value;
    if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0)
      return String(value);
    return null;
  };
  const roomId = readId(message.roomId);
  const messageId = readId(message.id);
  return roomId && messageId ? { roomId, messageId } : null;
};
