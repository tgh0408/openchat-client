import type { Message } from '../../../../shared/storage/database';

/** BubbleList 虚拟器支持的最小滚动接口，供位置缓存逻辑复用。 */
export interface MessageVirtualizer {
  readonly scrollOffset: number;
  findItemIndex: (offset: number) => number;
  getItemOffset: (index: number) => number;
  getItemSize?: (index: number) => number;
  scrollToIndex: (
    index: number,
    options: { align: 'start'; offset: number; smooth: boolean },
  ) => void;
}

/** 消息视口锚点的稳定身份，用于消息重排或删除后的邻近恢复。 */
export interface MessageAnchor {
  id: string;
  clientMsgId: string | null;
  senderId: string;
  createdAt: string;
}

/** 单个会话的消息视口锚点，使用消息身份和行内偏移抵抗高度变化。 */
export interface MessageScrollPosition {
  anchorId: string;
  anchorClientMsgId: string | null;
  anchorSenderId: string;
  anchorCreatedAt: string;
  offset: number;
  atBottom: boolean;
  before: MessageAnchor | null;
  after: MessageAnchor | null;
}

/** 判断对象是否提供了消息列表所需的虚拟滚动接口。 */
export const isMessageVirtualizer = (
  value: unknown,
): value is MessageVirtualizer =>
  typeof value === 'object' &&
  value !== null &&
  'scrollOffset' in value &&
  'findItemIndex' in value &&
  typeof value.findItemIndex === 'function' &&
  'getItemOffset' in value &&
  typeof value.getItemOffset === 'function' &&
  'scrollToIndex' in value &&
  typeof value.scrollToIndex === 'function';

/** 捕获当前消息列表的锚点位置，未挂载虚拟器时返回空值。 */
export const captureMessageScrollPosition = (
  messages: readonly Message[],
  virtualizer: MessageVirtualizer | undefined,
  atBottom: boolean,
  anchorIndex?: number,
  anchorOffset?: number,
): MessageScrollPosition | null => {
  if (!virtualizer) return null;
  const index =
    anchorIndex ?? virtualizer.findItemIndex(virtualizer.scrollOffset);
  const anchor = messages[index];
  if (!anchor) return null;
  const before = messages[index - 1];
  const after = messages[index + 1];
  return {
    anchorId: anchor.id,
    anchorClientMsgId: anchor.clientMsgId,
    anchorSenderId: anchor.senderId,
    anchorCreatedAt: anchor.createdAt,
    offset:
      anchorOffset ??
      virtualizer.scrollOffset - virtualizer.getItemOffset(index),
    atBottom,
    before: before
      ? {
          id: before.id,
          clientMsgId: before.clientMsgId,
          senderId: before.senderId,
          createdAt: before.createdAt,
        }
      : null,
    after: after
      ? {
          id: after.id,
          clientMsgId: after.clientMsgId,
          senderId: after.senderId,
          createdAt: after.createdAt,
        }
      : null,
  };
};

/** 按服务端 ID 或本地 clientMsgId 查找缓存位置对应的消息下标。 */
export const findMessagePositionIndex = (
  messages: readonly Message[],
  position: MessageScrollPosition,
): number => {
  const anchorIndex = messages.findIndex(
    (message) =>
      message.id === position.anchorId ||
      (position.anchorClientMsgId !== null &&
        message.clientMsgId === position.anchorClientMsgId &&
        message.senderId === position.anchorSenderId),
  );
  if (anchorIndex >= 0) return anchorIndex;

  const beforeIndex = messages.findIndex((message) =>
    matchesMessageAnchor(message, position.before),
  );
  if (beforeIndex >= 0) return Math.min(beforeIndex + 1, messages.length - 1);

  const afterIndex = messages.findIndex((message) =>
    matchesMessageAnchor(message, position.after),
  );
  if (afterIndex >= 0) return Math.max(afterIndex - 1, 0);

  return -1;
};

/** 判断消息是否与保存的邻近锚点指向同一条记录。 */
const matchesMessageAnchor = (
  message: Message,
  anchor: MessageAnchor | null,
): boolean =>
  Boolean(
    anchor &&
    (message.id === anchor.id ||
      (anchor.clientMsgId !== null &&
        message.clientMsgId === anchor.clientMsgId &&
        message.senderId === anchor.senderId)),
  );

/** 将缓存位置限制在有限范围内，避免异常数据造成虚拟器偏移异常。 */
export const normalizeMessageScrollOffset = (offset: number): number =>
  Number.isFinite(offset) ? Math.max(-2000, Math.min(2000, offset)) : 0;
