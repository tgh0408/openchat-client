import type {
  ResourceChatMessage,
  ResourceTextBody,
} from '../../../shared/chat/messages/resource-message';
import { ResourceMessageType } from '../../../shared/chat/messages/resource-message';
import { parseReplyId } from '../../../shared/chat/messages/message-reply';
import type { ResourceSseMessage } from '../../../shared/windows/desktop';

/** 判断值是否为文本消息内容体，避免把未知结构当作文本正文。 */
const isTextBody = (value: unknown): value is ResourceTextBody =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).content === 'string';

/** 把后端 Long 字段统一转为字符串；接受数字或字符串，非法返回 null。 */
const readLongId = (value: unknown): string | null =>
  typeof value === 'string' && /^[1-9]\d{0,63}$/.test(value)
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value) && value > 0
      ? String(value)
      : null;

/** 把 SSE data 解析为后端聊天消息；非聊天消息或字段不合法时返回 null。 */
const parseResourceChatMessage = (data: string): ResourceChatMessage | null => {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    console.error('SSE 推送 JSON 解析失败，未记录消息正文。');
    return null;
  }
  if (typeof value !== 'object' || value === null) {
    console.error('SSE 推送数据结构无效。');
    return null;
  }
  const root = value as Record<string, unknown>;
  if (root.eventType !== undefined) return null;
  const fromUser = root.fromUser;
  const message = root.message;
  if (
    typeof fromUser !== 'object' ||
    fromUser === null ||
    typeof message !== 'object' ||
    message === null
  ) {
    console.error('SSE 推送缺少有效的发送者或消息字段。');
    return null;
  }
  const user = fromUser as Record<string, unknown>;
  const detail = message as Record<string, unknown>;
  const uid = readLongId(user.uid);
  const id = readLongId(detail.id);
  const roomId = readLongId(detail.roomId);
  if (
    !uid ||
    !id ||
    !roomId ||
    typeof detail.sendTime !== 'number' ||
    !Number.isSafeInteger(detail.sendTime) ||
    detail.sendTime < 0 ||
    !Number.isFinite(new Date(detail.sendTime).getTime()) ||
    typeof detail.type !== 'number' ||
    !Number.isSafeInteger(detail.type) ||
    (detail.clientMsgId != null &&
      (typeof detail.clientMsgId !== 'string' ||
        !detail.clientMsgId.trim() ||
        detail.clientMsgId.length > 64 ||
        detail.clientMsgId.includes('\0')))
  ) {
    console.error('SSE 推送消息字段校验失败。');
    return null;
  }
  let replyId: string | null;
  try {
    replyId = parseReplyId(detail.replyId);
  } catch {
    console.error('SSE 引用消息字段无效。');
    return null;
  }
  return {
    fromUser: { uid },
    message: {
      id,
      roomId,
      replyId,
      sendTime: detail.sendTime,
      type: detail.type,
      body: detail.body ?? null,
      clientMsgId:
        typeof detail.clientMsgId === 'string' ? detail.clientMsgId : null,
    },
  };
};

/** 读取文本消息正文，非文本或结构不符时返回空串。 */
export const readTextContent = (message: ResourceChatMessage): string =>
  isTextBody(message.message.body) ? message.message.body.content : '';

/** 分发已接入的文本、图片和表情，正文在共用转换入口校验。 */
const dispatchResourceMessage = (
  raw: ResourceSseMessage,
  onMessage: (message: ResourceChatMessage) => void | Promise<void>,
): void => {
  const message = parseResourceChatMessage(raw.data);
  if (!message) return;
  switch (message.message.type) {
    case ResourceMessageType.Text:
    case ResourceMessageType.Emoji:
    case ResourceMessageType.Image:
    case ResourceMessageType.Video:
    case ResourceMessageType.Temporary:
    case ResourceMessageType.File:
    case ResourceMessageType.Sound:
    case ResourceMessageType.Recall:
    case ResourceMessageType.RtcCall:
    case ResourceMessageType.System:
      try {
        const pending = onMessage(message);
        if (pending)
          void pending.catch(() => {
            console.error('SSE 推送消息异步处理失败。');
          });
      } catch {
        console.error('SSE 推送消息处理失败。');
      }
      break;
    default:
      // 其他类型尚未接入，不伪造本地记录。
      break;
  }
};

export { dispatchResourceMessage, parseResourceChatMessage };
