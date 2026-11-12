import type { ApiClient } from '../../api/api-client';
import { parseApiResult } from '../../api/api-response';
import {
  compareMessageIds,
  isDeletionMessageId,
} from './conversation-deletion';

export interface PendingConversationRead {
  conversationId: string;
  lastReadMsgId: string;
}

/** 已读请求只接受 Java Long 范围内的正整数字符串。 */
export const parseReadMessageId = (value: unknown): string => {
  if (typeof value !== 'string' || value === '0' || !isDeletionMessageId(value))
    throw new Error('无效的已读消息 ID');
  return value;
};

/** 确认进度必须不小于提交值；响应丢失可用同一位置安全重试。 */
export const requestConversationRead = async (
  api: ApiClient,
  read: PendingConversationRead,
): Promise<string> => {
  parseReadMessageId(read.conversationId);
  parseReadMessageId(read.lastReadMsgId);
  return api.request({
    path: '/capi/chat/contact/read',
    method: 'POST',
    body: { roomId: read.conversationId, lastReadMsgId: read.lastReadMsgId },
    serviceName: '已读确认',
    timeoutMs: 3000,
    parse: (value: unknown): string => {
      const root = parseApiResult(value, '已读确认');
      const id = parseReadMessageId(root.data);
      if (compareMessageIds(id, read.lastReadMsgId) < 0)
        throw new Error('已读确认位置倒退');
      return id;
    },
  });
};
