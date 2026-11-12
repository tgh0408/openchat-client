import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import { parseFriendUid } from './friend';
import type { Friend } from './friend';

/** 空成功仍表示待审批；直接添加必须由本次提交响应明确确认。 */
export type FriendApplicationResult =
  | { status: 'PENDING' }
  | { status: 'ADDED'; uid: string; roomId: string; indexLetter: string };

/** 父窗口接收已由主进程补全的本地联系人，不再向服务端确认关系。 */
export type FriendApplicationSubmission =
  { status: 'PENDING' } | { status: 'ADDED'; friend: Friend };

/** 表单字段与服务端申请协议保持一致；朋友圈设置只预留，不代表权限已生效。 */
export interface FriendSettingsDraft {
  remark: string;
  tags: string[];
  permission: 'all' | 'chat';
  hideMine: boolean;
  hideTheirs: boolean;
}

export interface FriendApplicationDraft extends FriendSettingsDraft {
  message: string;
}

export interface FriendVerificationContext {
  applyId: string;
  targetUid: string;
  targetName: string;
}

export interface FriendVerificationApi {
  read: () => Promise<FriendVerificationContext>;
  submit: (draft: FriendSettingsDraft) => Promise<void>;
  close: () => Promise<void>;
}

/** 申请窗口仅接收当前搜索对象及本人昵称，不包含授权凭据。 */
export interface FriendApplicationContext {
  targetUid: string;
  targetName: string;
  nickname: string;
  avatar?: string | null;
}

/** 专属桥接不接受目标 UID 或授权凭据，申请对象由主进程绑定。 */
export interface FriendApplicationApi {
  read: () => Promise<FriendApplicationContext>;
  submit: (draft: FriendApplicationDraft) => Promise<void>;
  close: () => Promise<void>;
}

/** 校验并复制表单，拒绝额外身份字段、超长内容与无效预留值。 */
export const parseFriendApplicationDraft = (
  value: unknown,
): FriendApplicationDraft => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('好友申请参数无效');
  const data = value as Record<string, unknown>;
  const fields = [
    'message',
    'remark',
    'tags',
    'permission',
    'hideMine',
    'hideTheirs',
  ];
  if (Object.keys(data).some((key) => !fields.includes(key)))
    throw new Error('好友申请包含不支持的字段');
  if (
    typeof data.message !== 'string' ||
    !data.message.trim() ||
    data.message.length > 200
  )
    throw new Error('申请说明应为 1 至 200 字');
  return {
    message: data.message.trim(),
    ...parseFriendSettingsDraft({
      remark: data.remark,
      tags: data.tags,
      permission: data.permission,
      hideMine: data.hideMine,
      hideTheirs: data.hideTheirs,
    }),
  };
};

/** 校验双方各自的备注、标签和预留权限，不接收身份或申请说明。 */
export const parseFriendSettingsDraft = (
  value: unknown,
): FriendSettingsDraft => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('朋友设置参数无效');
  const data = value as Record<string, unknown>;
  const fields = ['remark', 'tags', 'permission', 'hideMine', 'hideTheirs'];
  if (Object.keys(data).some((key) => !fields.includes(key)))
    throw new Error('朋友设置包含不支持的字段');
  if (typeof data.remark !== 'string' || data.remark.length > 64)
    throw new Error('备注不能超过 64 字');
  if (!Array.isArray(data.tags) || data.tags.length > 10)
    throw new Error('最多添加 10 个标签');
  const tags = data.tags.map((tag: unknown): string => {
    if (typeof tag !== 'string' || !tag.trim() || tag.length > 32)
      throw new Error('每个标签应为 1 至 32 字');
    return tag.trim();
  });
  if (data.permission !== 'all' && data.permission !== 'chat')
    throw new Error('朋友权限参数无效');
  if (
    typeof data.hideMine !== 'boolean' ||
    typeof data.hideTheirs !== 'boolean'
  )
    throw new Error('朋友圈预留参数无效');
  return {
    remark: data.remark.trim(),
    tags: [...new Set(tags)],
    permission: data.permission,
    hideMine: data.hideMine,
    hideTheirs: data.hideTheirs,
  };
};

/** 仅统一响应明确成功才确认提交，不把空 HTTP 正文或异常响应当作成功。 */
export const parseFriendApplicationResponse = (
  value: unknown,
): FriendApplicationResult => {
  const result = parseApiResult(value, '好友申请');
  if (result.data === null) return { status: 'PENDING' };
  if (
    result.data &&
    typeof result.data === 'object' &&
    !Array.isArray(result.data)
  ) {
    const data = result.data as Record<string, unknown>;
    if (
      data.status === 'ADDED' &&
      typeof data.indexLetter === 'string' &&
      /^(?:[A-Z]|#)$/.test(data.indexLetter)
    ) {
      return {
        status: 'ADDED',
        uid: parseFriendUid(data.uid),
        roomId: parseFriendUid(data.roomId),
        indexLetter: data.indexLetter,
      };
    }
  }
  throw new Error('好友申请未确认成功，请稍后核对申请状态');
};

/** 使用原授权会话提交绑定对象，不自动重试可能已在服务端提交的请求。 */
export const submitFriendApplication = async (
  api: ApiClient,
  targetUid: string,
  value: unknown,
): Promise<FriendApplicationResult> => {
  if (
    !/^[1-9]\d{0,18}$/.test(targetUid) ||
    BigInt(targetUid) > 9223372036854775807n
  )
    throw new Error('申请对象无效');
  if (targetUid === api.userId) throw new Error('不能添加自己为好友');
  const draft = parseFriendApplicationDraft(value);
  const result = await api.request({
    path: '/capi/user/friend/apply',
    method: 'POST',
    body: { targetUid, ...draft },
    serviceName: '好友申请',
    networkError: '网络异常，尚未确认申请结果，请稍后核对再重试',
    parse: parseFriendApplicationResponse,
  });
  api.validateCurrent();
  if (result.status === 'ADDED' && result.uid !== targetUid)
    throw new Error('好友添加结果与申请对象不匹配');
  return result;
};

/** 用绑定资料和本次成功结果补入本地联系人，不再请求好友列表或详情确认。 */
export const buildRestoredFriend = (
  context: FriendApplicationContext,
  draft: FriendApplicationDraft,
  result: Extract<FriendApplicationResult, { status: 'ADDED' }>,
  avatar: string | null = context.avatar ?? null,
): Friend => {
  if (result.uid !== context.targetUid) throw new Error('好友添加对象不匹配');
  const remark = draft.remark.trim() || null;
  return {
    uid: result.uid,
    roomId: result.roomId,
    name: context.targetName,
    remark,
    displayName: remark ?? context.targetName,
    indexLetter: result.indexLetter,
    avatar,
  };
};

/** 校验主进程本地成功事件，不接受账号或联系人标识缺失的载荷。 */
export const parseRestoredFriendNotification = (
  value: unknown,
): { userId: string; friend: Friend } | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (
    !data.friend ||
    typeof data.friend !== 'object' ||
    Array.isArray(data.friend)
  )
    return null;
  const friend = data.friend as Record<string, unknown>;
  try {
    const userId = parseFriendUid(data.userId);
    const uid = parseFriendUid(friend.uid);
    const roomId = parseFriendUid(friend.roomId);
    if (
      uid === userId ||
      typeof friend.name !== 'string' ||
      !friend.name.trim() ||
      friend.name.length > 256 ||
      typeof friend.displayName !== 'string' ||
      friend.displayName.length > 256 ||
      typeof friend.indexLetter !== 'string' ||
      !/^(?:[A-Z]|#)$/.test(friend.indexLetter) ||
      (friend.remark !== null &&
        (typeof friend.remark !== 'string' || friend.remark.length > 64)) ||
      (friend.avatar !== null &&
        (typeof friend.avatar !== 'string' || friend.avatar.length > 2048))
    )
      return null;
    if (typeof friend.avatar === 'string') {
      const url = new URL(friend.avatar);
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return null;
    }
    return {
      userId,
      friend: {
        uid,
        roomId,
        name: friend.name,
        remark: friend.remark as string | null,
        displayName: friend.displayName,
        indexLetter: friend.indexLetter,
        avatar: friend.avatar as string | null,
      },
    };
  } catch {
    return null;
  }
};
