import { parseApiResult } from '../../api/api-response';
import type { ApiClient } from '../../api/api-client';
import { isDeletionMessageId } from './conversation-deletion';

/** 设置明确的免打扰目标值，不使用翻转接口，网络失败不自动重试。 */
export const requestConversationNotDisturb = async (
  api: ApiClient,
  roomId: string,
  status: 0 | 1,
): Promise<void> => {
  if (
    typeof roomId !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(roomId) ||
    BigInt(roomId) > 9223372036854775807n ||
    (status !== 0 && status !== 1)
  )
    throw new Error('会话免打扰参数无效');
  await api.request({
    path: '/capi/chat/contact/notDisturb',
    method: 'POST',
    body: { roomId, status },
    serviceName: '消息免打扰',
    parse: (value: unknown): Record<string, unknown> =>
      parseApiResult(value, '消息免打扰'),
  });
};

/** 校验会话标识和二值置顶状态。 */
const validateTopStatus = (roomId: string, status: number): void => {
  if (
    !/^[1-9]\d{0,18}$/.test(roomId) ||
    !Number.isInteger(status) ||
    ![0, 1].includes(status)
  )
    throw new Error('会话置顶参数无效');
};

/** 请求服务端更新当前用户的会话置顶状态，重复请求保持幂等。 */
export const requestConversationTopStatus = async (
  api: ApiClient,
  roomId: string,
  status: number,
): Promise<void> => {
  validateTopStatus(roomId, status);
  await api.request({
    path: '/capi/user/friend/topStatus',
    method: 'POST',
    body: { roomId, status },
    serviceName: '会话置顶',
    networkError: '无法连接会话置顶服务或请求超时，请重试',
    parse: (value: unknown): Record<string, unknown> =>
      parseApiResult(value, '会话置顶'),
  });
};

/** 提交本地观测到的删除边界；重试不得扩大到重连时的新消息。 */
export const requestRemoveConversation = async (
  api: ApiClient,
  roomId: string,
  lastDeleteId?: string,
): Promise<void> => {
  if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('会话 ID 无效');
  if (lastDeleteId !== undefined && !isDeletionMessageId(lastDeleteId))
    throw new Error('删除消息 ID 无效');
  await api.request({
    path: '/capi/chat/contact/remove',
    method: 'POST',
    body: { roomId, ...(lastDeleteId === undefined ? {} : { lastDeleteId }) },
    serviceName: '清除聊天记录',
    networkError: '无法连接清除聊天记录服务或请求超时，请重试',
    parse: (value: unknown): Record<string, unknown> =>
      parseApiResult(value, '清除聊天记录'),
  });
};

/** 请求服务端隐藏当前会话；隐藏边界由服务端读取房间最新消息确定。 */
export const requestHideConversation = async (
  api: ApiClient,
  roomId: string,
): Promise<void> => {
  if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('会话 ID 无效');
  await api.request({
    path: '/capi/chat/contact/hide',
    method: 'POST',
    body: { roomId },
    serviceName: '隐藏会话',
    networkError: '无法连接隐藏会话服务或请求超时，请重试',
    parse: (value: unknown): Record<string, unknown> =>
      parseApiResult(value, '隐藏会话'),
  });
};
