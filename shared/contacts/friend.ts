import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import type { FriendRemarkSettings } from './friend-remark';
import { parseFriendRemarkSettings } from './friend-remark';

/** 后端好友联系人单条记录，Long 标识统一按字符串处理。 */
export interface Friend {
  uid: string;
  roomId: string | null;
  name: string;
  remark: string | null;
  displayName: string;
  indexLetter: string;
  /** 好友列表不返回头像，此字段由本地资料或好友详情补齐。 */
  avatar: string | null;
}

/** 好友详情仅驻留当前页面内存，不作为后续发送消息的权限凭证。 */
export interface FriendDetail {
  remarkSettings?: FriendRemarkSettings;
  uid: string;
  roomId: string | null;
  blacklisted: boolean;
  name: string;
  remark: string | null;
  displayName: string;
  avatar: string | null;
  sex: number | null;
  personalitySignature: string | null;
  addedAt: string | null;
}

/** 校验详情请求的用户标识，不转换可能丢失精度的数字。 */
export const parseFriendUid = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new Error('好友 UID 无效');
  return value;
};

/** 读取有界可选文本，缺省及空白统一为 null。 */
const readDetailText = (value: unknown, limit: number): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string' || value.length > limit)
    throw new Error('好友详情服务返回的数据无效');
  return value.trim() || null;
};

/** 读取可选好友头像，无效值降级为默认头像。 */
const readFriendAvatar = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) return null;
  const avatar = value.trim();
  if (!avatar) return null;
  let url: URL;
  try {
    url = new URL(avatar);
  } catch {
    return null;
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return null;
  return avatar;
};

/** 校验详情身份和字段，拒绝串号及无时区时间。 */
export const parseFriendDetail = (
  value: unknown,
  uid: string,
): FriendDetail => {
  const root = parseApiResult(value, '好友详情');
  if (!root.data || typeof root.data !== 'object')
    throw new Error('好友详情服务返回的数据无效');
  const data = root.data as Record<string, unknown>;
  if (parseFriendUid(data.uid) !== uid)
    throw new Error('好友详情返回的 UID 不匹配');
  const roomId = data.roomId == null ? null : parseFriendUid(data.roomId);
  if (data.blacklisted != null && typeof data.blacklisted !== 'boolean')
    throw new Error('好友详情黑名单状态无效');
  const name = readDetailText(data.name, 256);
  const remark = readDetailText(data.remark, 256);
  const avatar = readFriendAvatar(data.avatar);
  if (!name) throw new Error('好友详情缺少昵称');
  if (
    data.sex != null &&
    (typeof data.sex !== 'number' || !Number.isSafeInteger(data.sex))
  )
    throw new Error('好友详情性别无效');
  const addedAt = readDetailText(data.addedAt, 40);
  if (
    addedAt &&
    (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|[+-]\d{2}:\d{2})$/.test(
      addedAt,
    ) ||
      !Number.isFinite(Date.parse(addedAt)))
  )
    throw new Error('好友详情时间无效');
  return {
    uid,
    roomId,
    blacklisted: data.blacklisted === true,
    name,
    remark,
    displayName: remark ?? name,
    avatar,
    sex: typeof data.sex === 'number' ? data.sex : null,
    personalitySignature: readDetailText(data.personalitySignature, 512),
    addedAt,
    remarkSettings:
      data.remarkSettings == null
        ? undefined
        : parseFriendRemarkSettings(data.remarkSettings),
  };
};

/** 绑定真实单聊或群聊房间查询资料，认证失效沿用统一退出处理。 */
export const requestFriendDetail = async (
  api: ApiClient,
  targetUid: string,
  roomId: string,
): Promise<FriendDetail> => {
  const uid = parseFriendUid(targetUid);
  if (!roomId) throw new Error('缺少资料查询的房间 ID，请刷新后重试');
  const room = parseFriendUid(roomId);
  return api.request({
    path: '/capi/user/friend/info',
    method: 'POST',
    body: { targetUid: uid, roomId: room },
    serviceName: '好友详情',
    networkError: '无法连接好友详情服务或请求超时，请重试',
    parse: (value: unknown): FriendDetail => parseFriendDetail(value, uid),
  });
};

/** 校验删除好友的空成功响应，是否清空会话由本次请求选项决定。 */
export const parseFriendDeletionResult = (value: unknown): void => {
  const root = parseApiResult(value, '删除好友');
  if (root.data != null) throw new Error('删除好友服务返回的数据无效');
};

/** 按真实单聊房间删除当前账号的好友关系，不提交 UID 或自动重试写请求。 */
export const requestFriendDeletion = async (
  api: ApiClient,
  roomId: string,
  clearHistory: boolean = false,
): Promise<void> => {
  const room = parseFriendUid(roomId);
  if (typeof clearHistory !== 'boolean')
    throw new Error('清空聊天记录选项无效');
  return api.request({
    path: `/capi/user/friend/del/${room}`,
    method: 'POST',
    ...(clearHistory ? { body: { clearHistory: true } } : {}),
    serviceName: '删除好友',
    parse: parseFriendDeletionResult,
  });
};

/** 仅确认真实的空成功响应，不将业务失败或假成功数据当作黑名单操作完成。 */
export const parseRoomBlacklistResult = (value: unknown): void => {
  const root = parseApiResult(value, '黑名单');
  if (root.data != null) throw new Error('黑名单服务返回的数据无效');
};

/** 按真实单聊房间拉黑对方；UID 仅用于本地校验，双方身份由服务端确定。 */
export const requestRoomBlacklist = async (
  api: ApiClient,
  roomId: string,
  targetUid: string,
): Promise<void> => {
  const room = parseFriendUid(roomId);
  const uid = parseFriendUid(targetUid);
  if (uid === api.userId) throw new Error('不能将自己加入黑名单');
  await api.request({
    path: `/capi/user/friend/black/${room}`,
    method: 'POST',
    serviceName: '黑名单',
    parse: parseRoomBlacklistResult,
  });
};

/** 解除本人对单聊对方的拉黑，不恢复已删除好友或修改反向关系，不自动重试。 */
export const requestRoomUnblacklist = async (
  api: ApiClient,
  roomId: string,
  targetUid: string,
): Promise<void> => {
  const room = parseFriendUid(roomId);
  const uid = parseFriendUid(targetUid);
  if (uid === api.userId) throw new Error('不能将自己移出黑名单');
  await api.request({
    path: `/capi/user/friend/unBlack/${room}`,
    method: 'POST',
    serviceName: '黑名单',
    parse: parseRoomBlacklistResult,
  });
};

/** 好友联系人分页结果。 */
export interface FriendPage {
  cursor: string | null;
  isLast: boolean;
  list: Friend[];
}

/** 读取后端 Long 字段，拒绝可能丢失精度的非安全数字。 */
const readLongValue = (value: unknown): string | null => {
  switch (typeof value) {
    case 'string':
      return /^[1-9]\d{0,63}$/.test(value) ? value : null;
    case 'number':
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    default:
      return null;
  }
};

/** 校验好友列表响应，避免无效资料进入联系人界面。 */
export const parseFriendPage = (value: unknown): FriendPage => {
  const root = parseApiResult(value, '好友联系人');
  if (!root.data || typeof root.data !== 'object')
    throw new Error('好友联系人服务返回的数据无效');
  const data = root.data as Record<string, unknown>;
  if (
    typeof data.isLast !== 'boolean' ||
    typeof data.isFirst !== 'boolean' ||
    !Array.isArray(data.list)
  )
    throw new Error('好友联系人服务返回的数据无效');
  const cursor =
    data.cursor == null || data.cursor === '' ? null : String(data.cursor);
  const list = data.list.map((item): Friend => {
    if (!item || typeof item !== 'object')
      throw new Error('好友联系人服务返回的数据无效');
    const friend = item as Record<string, unknown>;
    const uid = readLongValue(friend.uid);
    const roomId = friend.roomId == null ? null : readLongValue(friend.roomId);
    if (
      !uid ||
      (friend.roomId != null && !roomId) ||
      typeof friend.name !== 'string' ||
      typeof friend.displayName !== 'string' ||
      typeof friend.indexLetter !== 'string' ||
      !/^(?:[A-Z]|#)$/.test(friend.indexLetter) ||
      friend.name.length > 256 ||
      friend.displayName.length > 256 ||
      (friend.remark != null &&
        (typeof friend.remark !== 'string' || friend.remark.length > 256))
    )
      throw new Error('好友联系人服务返回的数据无效');
    return {
      uid,
      roomId,
      name: friend.name,
      remark: typeof friend.remark === 'string' ? friend.remark : null,
      displayName: friend.displayName,
      indexLetter: friend.indexLetter,
      avatar: null,
    };
  });
  if (!data.isLast && !cursor)
    throw new Error('好友联系人服务返回的分页游标无效');
  return { cursor, isLast: data.isLast, list };
};

/** 请求好友联系人分页，沿用操作绑定的授权及服务端游标。 */
export const requestFriendPage = async (
  api: ApiClient,
  pageSize: number,
  cursor: string | null,
): Promise<FriendPage> => {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw new Error('好友联系人分页参数无效');
  return api.request({
    path: '/capi/user/friend/page',
    method: 'POST',
    body: { pageSize, cursor: cursor ?? '' },
    serviceName: '好友联系人',
    parse: parseFriendPage,
  });
};

/** 使用不透明游标拉取当前账号全部好友，不在客户端猜测分页边界。 */
export const listRemoteFriends = async (
  api: ApiClient,
  pageSize = 100,
): Promise<Friend[]> => {
  const friends: Friend[] = [];
  let cursor: string | null = null;
  let isLast = false;
  do {
    const page = await requestFriendPage(api, pageSize, cursor);
    friends.push(...page.list);
    if (!page.isLast && page.cursor === cursor)
      throw new Error('好友联系人服务返回了重复分页游标');
    cursor = page.cursor;
    isLast = page.isLast;
  } while (!isLast);
  return friends;
};
