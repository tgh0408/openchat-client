import type { Message } from '../../storage/database';

/** 单聊拒收文案仅用于失败反馈，不代表服务端已经落库或送达。 */
export const MESSAGE_REJECTED_TEXT = '消息已发出，但被对方拒收了。';

/** 好友关系失效时展示验证入口，不将普通发送失败解释为好友删除。 */
export const FRIEND_VERIFICATION_REQUIRED_TEXT =
  '开启了朋友验证，你还不是他（她）朋友，请先发送朋友验证请求，对方验证通过后，才能聊天。';

/** 使用会话、发送者和原 clientMsgId 关联本地提示，不依赖服务端替换后的消息 ID。 */
export const messageRejectionKey = (
  message: Pick<Message, 'conversationId' | 'senderId' | 'clientMsgId' | 'id'>,
): string =>
  JSON.stringify([
    message.conversationId,
    message.senderId,
    message.clientMsgId ?? message.id,
  ]);

/** 只识别明确的关系或黑名单业务文案，不根据一般失败或超时猜测关系。 */
export const parseMessageRejection = (message: string): string | null => {
  switch (message) {
    case FRIEND_VERIFICATION_REQUIRED_TEXT:
    case '好友关系已解除，请重新添加好友':
    case '你们不是好友':
    case '你们还不是好友，请先添加好友':
    case '对方不是你的好友':
      return FRIEND_VERIFICATION_REQUIRED_TEXT;
    case MESSAGE_REJECTED_TEXT:
      return MESSAGE_REJECTED_TEXT;
    case '对方已在黑名单中，无法发送消息':
    case '对方已在黑名单中，无法发送消息。':
      return '对方已在黑名单中，无法发送消息。';
    case '你已被加入黑名单，无法发送消息':
    case '你已被加入黑名单，无法发送消息。':
      return '你已被加入黑名单，无法发送消息。';
    default:
      return null;
  }
};

/** 独立本地拒收记录的正文，不参与服务端消息确认或重试。 */
export interface MessageRejectionNotice {
  clientMsgId: string;
  text: string;
}

/** 仅解析本地提示类型和已知拒收文案，普通服务端正文不能生成验证入口。 */
export const parseMessageRejectionNotice = (
  message: Pick<Message, 'messageType' | 'content'>,
): MessageRejectionNotice | null => {
  if (message.messageType !== 'local-notice') return null;
  try {
    const value: unknown = JSON.parse(message.content);
    if (
      typeof value !== 'object' ||
      value === null ||
      !('clientMsgId' in value) ||
      typeof value.clientMsgId !== 'string' ||
      !value.clientMsgId ||
      value.clientMsgId.length > 64 ||
      !('text' in value) ||
      typeof value.text !== 'string' ||
      parseMessageRejection(value.text) !== value.text
    )
      return null;
    return { clientMsgId: value.clientMsgId, text: value.text };
  } catch {
    return null;
  }
};
