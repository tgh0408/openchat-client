import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';

export interface FriendRemarkSettings {
  version: number;
  remark: string | null;
  tags: string[];
  phones: string[];
  description: string;
}

export interface FriendRemarkDraft {
  remark: string;
  tags: string[];
  phones: string[];
  description: string;
}

export interface FriendRemarkUpdated {
  userId: string;
  uid: string;
  roomId: string;
  name: string;
  settings: FriendRemarkSettings;
}

/** 备注窗口只接收主进程核对过的好友名称，不接收账号或任意查询参数。 */
export interface FriendRemarkContext {
  uid: string;
  roomId: string;
  name: string;
  remark: string | null;
  settings?: FriendRemarkSettings;
}

export interface FriendRemarkApi {
  read: () => Promise<FriendRemarkContext>;
  submit: (draft: FriendRemarkDraft) => Promise<FriendRemarkSettings>;
  close: () => Promise<void>;
}

/** 读取有界列表，不允许未知类型、空白项或超限值静默丢失。 */
const readStrings = (
  value: unknown,
  count: number,
  length: number,
): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > count ||
    value.some(
      (item) =>
        typeof item !== 'string' || !item.trim() || item.length > length,
    )
  )
    throw new Error('备注列表参数无效');
  const result = (value as string[]).map((item) => item.trim());
  if (new Set(result).size !== result.length)
    throw new Error('备注列表不能包含重复项');
  return result;
};

/** 校验服务端版本和全部可编辑字段，旧服务缺少字段时不以空白覆盖。 */
export const parseFriendRemarkSettings = (
  value: unknown,
): FriendRemarkSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('备注数据无效，请确认服务器已升级');
  const data = value as Record<string, unknown>;
  if (
    typeof data.version !== 'number' ||
    !Number.isInteger(data.version) ||
    data.version < 0 ||
    data.version > 2147483647 ||
    (data.remark !== null &&
      (typeof data.remark !== 'string' || data.remark.length > 64)) ||
    typeof data.description !== 'string' ||
    data.description.length > 512
  )
    throw new Error('备注数据无效，请重新打开');
  return {
    version: data.version,
    remark: data.remark as string | null,
    tags: readStrings(data.tags, 10, 32),
    phones: readStrings(data.phones, 5, 32),
    description: data.description,
  };
};

/** 子窗口只能提交文本编辑字段，不提交身份或版本。 */
export const parseFriendRemarkDraft = (value: unknown): FriendRemarkDraft => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('备注表单无效');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !['remark', 'tags', 'phones', 'description'].includes(key),
    ) ||
    typeof data.remark !== 'string' ||
    data.remark.length > 64 ||
    typeof data.description !== 'string' ||
    data.description.length > 512
  )
    throw new Error('备注名或描述超出长度限制');
  return {
    remark: data.remark.trim(),
    tags: readStrings(data.tags, 10, 32),
    phones: readStrings(data.phones, 5, 32),
    description: data.description.trim(),
  };
};

/** 单次 JSON 提交文本备注，身份和原版本使用主进程绑定的详情。 */
export const requestFriendRemark = async (
  api: ApiClient,
  context: FriendRemarkContext,
  draft: FriendRemarkDraft,
): Promise<FriendRemarkSettings> => {
  const settings = parseFriendRemarkSettings(context.settings);
  const parsed = parseFriendRemarkDraft(draft);
  return api.request({
    path: '/capi/user/friend/remark',
    method: 'POST',
    body: {
      targetUid: context.uid,
      roomId: context.roomId,
      version: settings.version,
      ...parsed,
    },
    serviceName: '好友备注',
    parse: (value: unknown): FriendRemarkSettings => {
      const root = parseApiResult(value, '备注保存');
      const result = parseFriendRemarkSettings(root.data);
      if (result.version !== settings.version + 1)
        throw new Error('备注保存版本不匹配，请重新打开确认');
      return result;
    },
  });
};
