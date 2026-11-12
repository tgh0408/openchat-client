import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import { requestFriendDetail, requestFriendPage } from './friend';
import type { FriendDetail } from './friend';

/** 添加朋友搜索返回的公开用户资料。 */
export interface AddFriendResult {
  uid: string;
  name: string;
  avatar: string | null;
  sex: number | null;
  addFunction: number | null;
  personalitySignature: string | null;
}

/** 搜索结果与当前账号的真实关系；添加权限不代表好友关系。 */
export interface AddFriendSearchResult extends AddFriendResult {
  relationship: 'self' | 'friend' | 'stranger';
  friend: FriendDetail | null;
}

/** 按真实好友分页确认关系，每次异步读取后复核当前窗口和账号。 */
export const resolveAddFriendRelationship = async (
  api: ApiClient,
  profile: AddFriendResult,
  sourceRoomId?: string,
): Promise<AddFriendSearchResult> => {
  api.validateCurrent();
  if (profile.uid === api.userId)
    return { ...profile, relationship: 'self', friend: null };
  let cursor: string | null = null;
  const cursors = new Set<string>();
  while (true) {
    const page = await requestFriendPage(api, 100, cursor);
    const matched = page.list.find((item) => item.uid === profile.uid);
    if (matched) {
      const roomId = matched.roomId ?? sourceRoomId;
      if (!roomId) throw new Error('该好友缺少可用房间，请刷新后重试');
      const friend = await requestFriendDetail(api, profile.uid, roomId);
      return { ...profile, relationship: 'friend', friend };
    }
    if (page.isLast)
      return { ...profile, relationship: 'stranger', friend: null };
    if (!page.cursor || cursors.has(page.cursor))
      throw new Error('好友列表分页异常，请重试');
    cursors.add(page.cursor);
    cursor = page.cursor;
  }
};

/** 校验添加朋友搜索词，避免把空白或过长内容发送到服务端。 */
export const parseAddFriendQuery = (value: unknown): string => {
  if (typeof value !== 'string') throw new Error('请输入OpenChat号或手机号');
  const query = value.trim();
  if (!query || query.length > 128) throw new Error('请输入有效的搜索内容');
  return query;
};

/** 读取公开字符串字段，空白值统一按未设置处理。 */
const readPublicText = (value: unknown, limit: number): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > limit)
    throw new Error('添加朋友服务返回的数据无效');
  return value.trim() || null;
};

/** 校验添加朋友接口响应，保留 Long UID 的字符串精度。 */
export const parseAddFriendResult = (value: unknown): AddFriendResult => {
  const root = parseApiResult(value, '添加朋友');
  if (root.data === null) throw new Error('没有找到该用户');
  if (!root.data || typeof root.data !== 'object')
    throw new Error('添加朋友服务返回的数据无效');
  const data = root.data as Record<string, unknown>;
  const rawUid = data.uid;
  let uid = '';
  switch (typeof rawUid) {
    case 'string':
      uid = rawUid;
      break;
    case 'number':
      if (Number.isSafeInteger(rawUid)) uid = String(rawUid);
      break;
    default:
      break;
  }
  const name = readPublicText(data.name, 256);
  const avatar = readPublicText(data.avatar, 2048);
  if (!/^[1-9]\d{0,63}$/.test(uid) || !name)
    throw new Error('添加朋友服务返回的数据无效');
  if (avatar) {
    const url = new URL(avatar);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error('用户头像地址无效');
  }
  if (
    data.sex != null &&
    (typeof data.sex !== 'number' || !Number.isSafeInteger(data.sex))
  )
    throw new Error('用户性别字段无效');
  if (
    data.addFunction != null &&
    (typeof data.addFunction !== 'number' ||
      !Number.isSafeInteger(data.addFunction))
  )
    throw new Error('用户关系字段无效');
  return {
    uid,
    name,
    avatar,
    sex: typeof data.sex === 'number' ? data.sex : null,
    addFunction: typeof data.addFunction === 'number' ? data.addFunction : null,
    personalitySignature: readPublicText(data.personalitySignature, 512),
  };
};

/** 通过真实认证请求搜索用户，桌面端由主进程调用此方法。 */
export const requestAddFriend = async (
  api: ApiClient,
  query: string,
): Promise<AddFriendResult> => {
  const searchText = parseAddFriendQuery(query);
  return api.request({
    path: '/capi/user/target/info',
    method: 'POST',
    body: { searchText },
    serviceName: '搜索',
    networkError: '无法连接搜索服务或请求超时，请重试',
    parse: parseAddFriendResult,
  });
};
