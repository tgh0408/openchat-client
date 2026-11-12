/** 删除游标只接受无前导零的非负十进制 ID，不使用浮点数处理雪花 ID。 */
export const isDeletionMessageId = (value: string): boolean =>
  /^(0|[1-9]\d{0,18})$/.test(value) &&
  (value.length < 19 || value <= '9223372036854775807');

/** 按十进制长度和字典序比较已校验的消息 ID。 */
export const compareMessageIds = (left: string, right: string): number => {
  if (left.length !== right.length) return left.length - right.length;
  if (left === right) return 0;
  return left > right ? 1 : -1;
};

export interface ConversationDeletion {
  conversationId: string;
  lastDeleteId: string;
  revision: string;
  pending: number;
}
