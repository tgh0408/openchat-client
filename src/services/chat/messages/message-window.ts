import type { Message } from '../../../../shared/storage/database';

export const MESSAGE_CONTENT_LIMIT = 300;
export const MESSAGE_REFILL_BATCH = 50;

export interface MessageHeight {
  height: number;
  width: number;
  measured: boolean;
}

export interface MessagePlaceholder extends Message {
  placeholder: MessageHeight;
}

export interface MessageWindowUpdate {
  previous: Message;
  next: Message;
}

/** 识别只保留身份、分页位置与行高的消息占位。 */
export const isMessagePlaceholder = (
  message: Message,
): message is MessagePlaceholder => 'placeholder' in message;

/** 计算围绕可见消息的正文缓存范围，列表位置本身始终保留。 */
export const messageContentRange = (
  length: number,
  first: number,
  last: number,
): { start: number; end: number } => {
  const center = Math.floor((first + last) / 2);
  const start = Math.max(
    0,
    Math.min(
      length - MESSAGE_CONTENT_LIMIT,
      center - Math.floor(MESSAGE_CONTENT_LIMIT / 2),
    ),
  );
  return {
    start,
    end: Math.min(length, Math.max(last + 1, start + MESSAGE_CONTENT_LIMIT)),
  };
};

/** 将远离视口且已落库的正文替换成等高占位，不移除列表元素。 */
export const evictMessageContents = (
  messages: readonly Message[],
  first: number,
  last: number,
  getHeight: (message: Message, index: number) => MessageHeight,
): MessageWindowUpdate[] => {
  const range = messageContentRange(messages.length, first, last);
  const updates: MessageWindowUpdate[] = [];
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]!;
    if (
      (index >= range.start && index < range.end) ||
      isMessagePlaceholder(message) ||
      message.status !== 'sent'
    )
      continue;
    const placeholder: MessagePlaceholder = {
      ...message,
      content: '',
      placeholder: getHeight(message, index),
    };
    updates.push({ previous: message, next: placeholder });
  }
  return updates;
};

/** 按距视口的距离优先回读缺失正文，单批不超过数据库读取上限。 */
export const selectMessageRefill = (
  messages: readonly Message[],
  first: number,
  last: number,
  failed: ReadonlySet<string>,
): MessagePlaceholder[] => {
  const start = Math.max(0, first - MESSAGE_REFILL_BATCH);
  const end = Math.min(messages.length, last + MESSAGE_REFILL_BATCH + 1);
  const candidates: { message: MessagePlaceholder; distance: number }[] = [];
  for (let index = start; index < end; index++) {
    const message = messages[index]!;
    if (!isMessagePlaceholder(message) || failed.has(message.id)) continue;
    candidates.push({
      message,
      distance: Math.max(first - index, index - last, 0),
    });
  }
  return candidates
    .sort((left, right) => left.distance - right.distance)
    .slice(0, MESSAGE_REFILL_BATCH)
    .map((entry) => entry.message);
};

/** 仅替换请求发出时的原对象，拒绝覆盖期间到达的撤回、删除或实时确认。 */
export const applyMessageWindowUpdates = (
  messages: Message[],
  updates: readonly MessageWindowUpdate[],
): Message[] => {
  const replacements = new Map(
    updates.map((update) => [update.previous, update.next]),
  );
  return messages.map((message) => replacements.get(message) ?? message);
};
