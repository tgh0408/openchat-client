import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import { parseFriendUid } from './friend';

/** 群公告记录，Long 标识统一按字符串处理。 */
export interface GroupNotice {
  description: string;
  createTime: string;
  uid: string;
}

/** 群二维码记录，Long 标识统一按字符串处理。 */
export interface GroupQRCode {
  url: string;
  createTime: string;
  expireTime: string | null;
  keyword: string | null;
}

/** 通讯录中的群聊摘要，Long 标识统一按字符串处理。 */
export interface GroupDirectoryItem {
  groupId: string;
  roomId: string;
  name: string;
  /** 客户端补齐的显示名，不用于提交群名称编辑。 */
  displayName?: string;
  avatar: string | null;
  memberCount: number;
  avatarList: (string | null)[];
  avatarUidList: string[];
  notice: GroupNotice | null;
  qrCode: GroupQRCode[];
  root: boolean;
  create: boolean;
}

/** 群详情中的成员公开资料，Long 标识统一按字符串处理。 */
export interface GroupMemberItem {
  uid: string;
  username: string;
  avatar: string | null;
  nickname: string | null;
  role: number | null;
}

export interface AddGroupMembersRequest {
  roomId: string;
  uids: string[];
}

export interface CreateGroupRequest {
  uids: string[];
}

/** 创建只接受好友 UID，不允许页面指定群主、角色或房间。 */
export const parseCreateGroupRequest = (value: unknown): CreateGroupRequest => {
  if (!value || typeof value !== 'object')
    throw new Error('无效的创建群聊参数');
  const request = value as Record<string, unknown>;
  if (
    !Array.isArray(request.uids) ||
    request.uids.length < 1 ||
    request.uids.length > 100
  )
    throw new Error('请选择 1 至 100 位好友');
  return { uids: [...new Set(request.uids.map(parseFriendUid))] };
};

/** 创建结果复用群资料校验，不将空成功响应视为已创建群聊。 */
export const parseCreateGroupResponse = (
  value: unknown,
): GroupDirectoryItem => {
  const root = parseApiResult(value, '创建群聊');
  const [group] = parseGroupList({ ...root, data: [root.data] });
  if (!group) throw new Error('创建群聊响应无效');
  parseFriendUid(group.roomId);
  parseFriendUid(group.groupId);
  return group;
};

/** 仅提交所选好友，创建请求不自动重试，实际入群名单以服务端为准。 */
export const createRemoteGroup = async (
  api: ApiClient,
  request: CreateGroupRequest,
): Promise<GroupDirectoryItem> =>
  api.request({
    path: '/capi/group/create',
    method: 'POST',
    body: { ...parseCreateGroupRequest(request) },
    serviceName: '创建群聊',
    parse: parseCreateGroupResponse,
  });

export interface RemoveGroupMembersRequest {
  roomId: string;
  uids: string[];
}

export type GroupDepartureAction = 'exit' | 'dissolve';

/** 群主只能解散，管理员与普通成员只能退出，未知角色不开放操作。 */
export const getGroupDepartureAction = (
  role: number | null | undefined,
): GroupDepartureAction | null => {
  switch (role) {
    case 1:
      return 'dissolve';
    case 2:
    case 3:
      return 'exit';
    default:
      return null;
  }
};

/** 退出或解散仅接受正数 Long 字符串，避免路径注入和标识精度损失。 */
export const parseExitGroupRoomId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(value) ||
    BigInt(value) > 9223372036854775807n
  )
    throw new Error('无效的群聊 ID');
  return value;
};

/** 只接受服务端明确的空成功响应，保留群主限制等业务错误。 */
export const parseExitGroupResponse = (value: unknown): void => {
  const root = parseApiResult(value, '退出群聊');
  if (root.data != null) throw new Error('退出群聊响应无效');
};

/** 退出本人所在群聊，不提交操作者身份，也不自动重试写请求。 */
export const exitRemoteGroup = async (
  api: ApiClient,
  roomId: string,
): Promise<void> => {
  const room = parseExitGroupRoomId(roomId);
  await api.request({
    path: `/capi/group/exitGroup/${room}`,
    method: 'POST',
    serviceName: '退出群聊',
    parse: parseExitGroupResponse,
  });
};

/** 解散只接受明确的空成功响应，权限错误保留服务端原文。 */
export const parseDissolveGroupResponse = (value: unknown): void => {
  const root = parseApiResult(value, '解散群聊');
  if (root.data != null) throw new Error('解散群聊响应无效');
};

/** 群主解散走独立接口，不能以退出代替，也不自动重试。 */
export const dissolveRemoteGroup = async (
  api: ApiClient,
  roomId: string,
): Promise<void> => {
  const room = parseExitGroupRoomId(roomId);
  await api.request({
    path: `/capi/group/delGroup/${room}`,
    method: 'POST',
    serviceName: '解散群聊',
    parse: parseDissolveGroupResponse,
  });
};

export interface UpdateGroupInfoRequest {
  roomId: string;
  groupName?: string;
  groupDescription?: string;
}

/** 成员操作仅接受正数 Long 字符串，IPC 与浏览器使用同一边界校验。 */
export const parseAddGroupMembersRequest = (
  value: unknown,
): AddGroupMembersRequest => {
  if (!value || typeof value !== 'object') throw new Error('无效的群成员参数');
  const request = value as Record<string, unknown>;
  /** 保留 Long 精度并拒绝超过 Java Long 上限的标识。 */
  const isId = (id: unknown): id is string =>
    typeof id === 'string' &&
    /^[1-9]\d{0,18}$/.test(id) &&
    BigInt(id) <= 9223372036854775807n;
  if (
    !isId(request.roomId) ||
    !Array.isArray(request.uids) ||
    !request.uids.length ||
    request.uids.length > 100 ||
    !request.uids.every(isId)
  )
    throw new Error('请选择 1 至 100 位成员，并使用有效的群聊和用户 ID');
  return { roomId: request.roomId, uids: [...new Set(request.uids)] };
};

/** 空成功响应只代表成员事务成功，不构造本地成员资料。 */
export const parseAddGroupMembersResponse = (value: unknown): void => {
  const root = parseApiResult(value, '添加群成员');
  if (root.data != null) throw new Error('添加群成员响应无效');
};

/** 使用本次绑定的真实授权直接拉好友入群，不自动重试写请求。 */
export const addRemoteGroupMembers = async (
  api: ApiClient,
  request: AddGroupMembersRequest,
): Promise<void> => {
  const body = parseAddGroupMembersRequest(request);
  await api.request({
    path: '/capi/group/members/add',
    method: 'POST',
    body: { roomId: body.roomId, uids: body.uids },
    serviceName: '添加群成员',
    parse: parseAddGroupMembersResponse,
  });
};

/** 移出操作复用成员标识边界，不接受页面指定操作者或角色。 */
export const parseRemoveGroupMembersRequest = (
  value: unknown,
): RemoveGroupMembersRequest => parseAddGroupMembersRequest(value);

/** 移出只接受明确的空成功响应，保留服务端权限或状态错误。 */
export const parseRemoveGroupMembersResponse = (value: unknown): void => {
  const root = parseApiResult(value, '移出群成员');
  if (root.data != null) throw new Error('移出群成员响应无效');
};

/** 使用真实授权移出群成员，不自动重试有副作用的写请求。 */
export const removeRemoteGroupMembers = async (
  api: ApiClient,
  request: RemoveGroupMembersRequest,
): Promise<void> => {
  const body = parseRemoveGroupMembersRequest(request);
  await api.request({
    path: '/capi/group/members/remove',
    method: 'POST',
    body: { roomId: body.roomId, uids: body.uids },
    serviceName: '移出群成员',
    parse: parseRemoveGroupMembersResponse,
  });
};

/** 校验群资料更新请求，只接受非空的群名称或群公告。 */
export const parseUpdateGroupInfoRequest = (
  value: unknown,
): UpdateGroupInfoRequest => {
  if (!value || typeof value !== 'object') throw new Error('无效的群资料参数');
  const request = value as Record<string, unknown>;
  if (
    typeof request.roomId !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(request.roomId)
  )
    throw new Error('群资料格式无效');
  let groupName: string | undefined;
  let groupDescription: string | undefined;
  if (request.groupName !== undefined) {
    if (typeof request.groupName !== 'string') throw new Error('群名称无效');
    groupName = request.groupName.trim();
    if (!groupName || groupName.length > 256) throw new Error('群名称无效');
  }
  if (request.groupDescription !== undefined) {
    if (typeof request.groupDescription !== 'string')
      throw new Error('群公告无效');
    groupDescription = request.groupDescription.trim();
    if (!groupDescription || groupDescription.length > 300)
      throw new Error('群公告无效');
  }
  if (!groupName && !groupDescription)
    throw new Error('至少填写群名称或群公告');
  return {
    roomId: request.roomId,
    ...(groupName ? { groupName } : {}),
    ...(groupDescription ? { groupDescription } : {}),
  };
};

/** 群资料更新只接受明确的成功响应，权限和状态错误交由服务端返回。 */
export const parseUpdateGroupInfoResponse = (value: unknown): void => {
  const root = parseApiResult(value, '群资料更新');
  if (!root.data) throw new Error('群资料更新响应无效');
};

/** 通过真实授权更新群名称或公告，不在客户端伪造权限。 */
export const updateRemoteGroupInfo = async (
  api: ApiClient,
  request: UpdateGroupInfoRequest,
): Promise<void> => {
  const body = parseUpdateGroupInfoRequest(request);
  await api.request({
    path: '/capi/group/update',
    method: 'POST',
    body: { ...body },
    serviceName: '更新群资料',
    parse: parseUpdateGroupInfoResponse,
  });
};

/** 仅当前读取到的群主和管理员显示移出入口，最终授权由服务端执行。 */
export const canManageGroupMembers = (role: number | null): boolean => {
  switch (role) {
    case 1:
    case 2:
      return true;
    default:
      return false;
  }
};

/** 群主可移出管理员和普通成员，管理员只可移出普通成员，本人不可选。 */
export const canRemoveGroupMember = (
  operator: GroupMemberItem | undefined,
  target: GroupMemberItem,
): boolean => {
  if (!operator || operator.uid === target.uid) return false;
  switch (operator.role) {
    case 1:
      return target.role === 2 || target.role === 3;
    case 2:
      return target.role === 3;
    default:
      return false;
  }
};

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

/** 校验群头像地址，避免将不可信协议或凭据带入页面。 */
const readAvatar = (value: unknown): string | null => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048)
    throw new Error('群聊服务返回的头像地址无效');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('群聊服务返回的头像地址无效');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('群聊服务返回的头像地址无效');
  return value;
};

void readAvatar;

/** 读取服务端时间字符串，避免在页面中接受不可解析的记录。 */
const readRecordTime = (value: unknown, fieldName: string): string => {
  if (
    typeof value !== 'string' ||
    value.length > 64 ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error(`群聊服务返回的${fieldName}无效`);
  return value;
};

/** 读取群公告记录，要求公告带有服务端时间和写入用户。 */
const readNotice = (value: unknown): GroupNotice | null => {
  if (value == null || value === '') return null;
  if (!value || typeof value !== 'object')
    throw new Error('群聊服务返回的群公告无效');
  const notice = value as Record<string, unknown>;
  const uid = readLongValue(notice.uid);
  if (
    typeof notice.description !== 'string' ||
    !notice.description.trim() ||
    notice.description.length > 300 ||
    notice.description.includes('\0') ||
    !uid
  )
    throw new Error('群聊服务返回的群公告无效');
  return {
    description: notice.description,
    createTime: readRecordTime(notice.createTime, '公告时间'),
    uid,
  };
};

/** 读取群二维码图片地址，仅允许不带凭据的 HTTP(S) 地址。 */
const readQrCodeUrl = (value: unknown): string => {
  if (typeof value !== 'string' || value.length > 2048)
    throw new Error('群聊服务返回的二维码地址无效');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('群聊服务返回的二维码地址无效');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error('群聊服务返回的二维码地址无效');
  return value;
};

/** 读取群二维码记录，限制数量并校验生成、过期和密钥字段。 */
const readQrCodes = (value: unknown): GroupQRCode[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('群聊服务返回的二维码记录无效');
  return value.map((item): GroupQRCode => {
    if (!item || typeof item !== 'object')
      throw new Error('群聊服务返回的二维码记录无效');
    const qrCode = item as Record<string, unknown>;
    const expireTime =
      qrCode.expireTime == null
        ? null
        : readRecordTime(qrCode.expireTime, '二维码过期时间');
    let keyword: string | null = null;
    if (qrCode.keyword != null) {
      if (
        typeof qrCode.keyword !== 'string' ||
        qrCode.keyword.length > 256 ||
        qrCode.keyword.includes('\0')
      )
        throw new Error('群聊服务返回的二维码记录无效');
      keyword = qrCode.keyword;
    }
    return {
      url: readQrCodeUrl(qrCode.url),
      createTime: readRecordTime(qrCode.createTime, '二维码生成时间'),
      expireTime,
      keyword,
    };
  });
};

/** 将群公告或二维码记录的 ISO 时间展示为本地日期时间。 */
export const formatGroupRecordTime = (value: string): string =>
  new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));

/** 校验单个群成员的公开字段。 */
const parseGroupMember = (value: unknown): GroupMemberItem => {
  if (!value || typeof value !== 'object')
    throw new Error('群聊服务返回的成员数据无效');
  const member = value as Record<string, unknown>;
  const uid = readLongValue(member.uid);
  if (
    !uid ||
    typeof member.username !== 'string' ||
    member.username.length > 64 ||
    (member.nickname !== null &&
      member.nickname !== undefined &&
      (typeof member.nickname !== 'string' || member.nickname.length > 64)) ||
    (member.role !== null &&
      member.role !== undefined &&
      (!Number.isInteger(member.role) || (member.role as number) < 1))
  )
    throw new Error('群聊服务返回的成员数据无效');
  return {
    uid,
    username: member.username,
    avatar: null,
    nickname:
      typeof member.nickname === 'string'
        ? member.nickname.trim() || null
        : null,
    role: typeof member.role === 'number' ? member.role : null,
  };
};

/** 校验群成员列表响应，限制单次响应规模避免撑爆侧栏。 */
export const parseGroupMembers = (value: unknown): GroupMemberItem[] => {
  const root = parseApiResult(value, '群成员');
  if (!Array.isArray(root.data)) throw new Error('群聊服务返回的成员数据无效');
  if (root.data.length > 100000) throw new Error('群聊服务返回的成员数据无效');
  return root.data.map(parseGroupMember);
};

/** 请求当前账号在指定群中的成员列表。 */
export const listRemoteGroupMembers = async (
  api: ApiClient,
  roomId: string,
): Promise<GroupMemberItem[]> => {
  if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('无效的群聊 ID');
  return api.request({
    path: `/capi/group/page/groupMember/${roomId}`,
    method: 'POST',
    serviceName: '群成员',
    parse: parseGroupMembers,
  });
};

/** 校验群列表响应，限制头像数量和成员数量避免异常数据撑大界面。 */
export const parseGroupList = (value: unknown): GroupDirectoryItem[] => {
  const root = parseApiResult(value, '群聊');
  if (!Array.isArray(root.data)) throw new Error('群聊服务返回的数据无效');
  return root.data.map((item): GroupDirectoryItem => {
    if (!item || typeof item !== 'object')
      throw new Error('群聊服务返回的数据无效');
    const group = item as Record<string, unknown>;
    const groupId = readLongValue(group.groupId);
    const roomId = readLongValue(group.roomId);
    const memberCount = group.memberCount;
    if (
      !groupId ||
      !roomId ||
      typeof group.name !== 'string' ||
      group.name.length > 256 ||
      !Number.isSafeInteger(memberCount) ||
      (memberCount as number) < 0 ||
      (memberCount as number) > 100000 ||
      (group.avatarUidList != null &&
        (!Array.isArray(group.avatarUidList) ||
          group.avatarUidList.length > 9 ||
          group.avatarUidList.some((uid) => !readLongValue(uid))))
    )
      throw new Error('群聊服务返回的数据无效');
    const avatarUidList =
      group.avatarUidList == null
        ? []
        : group.avatarUidList.map((uid) => readLongValue(uid)!);
    return {
      groupId,
      roomId,
      name: group.name,
      avatar: null,
      memberCount: memberCount as number,
      avatarList: [],
      avatarUidList,
      notice: readNotice(group.notice),
      qrCode: readQrCodes(group.qrCode),
      root: group.root === true,
      create: group.create === true,
    };
  });
};

/** 请求当前账号加入的群聊列表，认证失效交由统一会话生命周期处理。 */
export const listRemoteGroups = async (
  api: ApiClient,
): Promise<GroupDirectoryItem[]> => {
  return api.request({
    path: '/capi/group/page/group',
    method: 'POST',
    serviceName: '群聊',
    parse: parseGroupList,
  });
};
