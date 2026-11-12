import { requestApi } from '../../api/api-client';
import { parseApiResult } from '../../api/api-response';
import type { AuthSession } from '../../auth/auth';
import { parseMessagePage, toHistoryMessage } from '../chat';
import type { Message } from '../../storage/database';

/** 核对当前会话已有记录的终态，不以本地消息 ID 猜测历史连续性。 */
export const requestMessageState = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  roomId: string,
  msgIds: string[],
): Promise<Message[]> => {
  if (
    !/^[1-9]\d{0,63}$/.test(roomId) ||
    msgIds.length < 1 ||
    msgIds.length > 50 ||
    msgIds.some((id) => !/^[1-9]\d{0,63}$/.test(id))
  )
    throw new Error('消息状态查询参数无效');
  const result = await requestApi(
    { base, session, clientId },
    {
      path: '/capi/chat/msg/state',
      method: 'POST',
      body: { roomId, msgIds },
      serviceName: '消息状态查询',
      parse: (value: unknown): Record<string, unknown> =>
        parseApiResult(value, '消息状态查询'),
    },
  );
  if (
    !('data' in result) ||
    !Array.isArray(result.data) ||
    result.data.length > msgIds.length
  )
    throw new Error('消息状态响应无效');
  const page = parseMessagePage({
    success: true,
    code: 200,
    data: { list: result.data, cursor: null, isFirst: true, isLast: true },
  });
  const messages: Message[] = [];
  const seen = new Set<string>();
  for (const remote of page.list) {
    if (
      remote.message.roomId !== roomId ||
      !msgIds.includes(remote.message.id) ||
      seen.has(remote.message.id)
    )
      throw new Error('消息状态标识不匹配');
    seen.add(remote.message.id);
    const message = toHistoryMessage(remote);
    if (message) messages.push(message);
  }
  return messages;
};
