import type { ApiClient } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import { parseFriendUid } from './friend';
import {
  parseFriendApplicationResponse,
  parseFriendSettingsDraft,
} from './friend-application';
import type { FriendSettingsDraft } from './friend-application';

export interface FriendApplication {
  applyId: string;
  uid: string;
  peerUid: string;
  direction: 'RECEIVED' | 'SENT';
  name: string;
  avatar: string | null;
  messages: FriendApplicationMessage[];
  message: string;
  status: 1 | 2 | 3;
}

export interface FriendApplicationMessage {
  uid: string;
  message: string;
}

export interface FriendApplicationReply {
  applyId: string;
  msg: string;
}

/** 回复仅接受原申请标识和有界文本，拒绝页面传入操作者身份。 */
export const parseFriendApplicationReply = (
  value: unknown,
): FriendApplicationReply => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('好友申请回复参数无效');
  const data = value as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== 'applyId' && key !== 'msg'))
    throw new Error('好友申请回复包含不支持的字段');
  if (typeof data.msg !== 'string' || !data.msg.trim() || data.msg.length > 200)
    throw new Error('回复内容应为 1 至 200 字');
  return { applyId: parseFriendUid(data.applyId), msg: data.msg.trim() };
};

/** 在原申请内回复，不创建反向申请或执行审批，也不自动重试。 */
export const requestReplyFriendApplication = async (
  api: ApiClient,
  value: unknown,
): Promise<void> => {
  const request = parseFriendApplicationReply(value);
  await api.request({
    path: '/capi/user/friend/replay',
    method: 'POST',
    body: { ...request },
    serviceName: '好友申请回复',
    networkError: '网络异常，尚未确认回复结果，请核对申请消息后重试',
    parse: (response: unknown): void => {
      const result = parseApiResult(response, '好友申请回复');
      if (result.data !== null) throw new Error('好友申请回复响应无效');
    },
  });
};

export interface FriendApplicationPage {
  list: FriendApplication[];
  isLast: boolean;
}

export interface FriendApplicationUnread {
  /** 当前阅读者的对方 UID，包含收到的申请及发出申请的新回复。 */
  uid: string;
  applyStatus: 1 | 2 | 3;
}

/** 申请列表与详情按收发方向展示状态，不把阅读申请当作添加成功。 */
export const friendApplicationStatusLabel = (
  application: Pick<FriendApplication, 'status' | 'direction'>,
): string => {
  switch (application.status) {
    case 1:
      return application.direction === 'SENT' ? '等待对方通过' : '等待验证';
    case 2:
      return '已添加';
    case 3:
      return application.direction === 'SENT' ? '对方已拒绝' : '已拒绝';
  }
};

/** 只有收到的待审批申请才能打开验证入口，最终权限仍由后端检查。 */
export const canApproveFriendApplication = (
  application: Pick<FriendApplication, 'status' | 'direction'>,
): boolean => application.direction === 'RECEIVED' && application.status === 1;

/** 收到与发出的待审批申请均可回复，最终归属和状态由后端检查。 */
export const canReplyFriendApplication = (
  application: Pick<FriendApplication, 'status'>,
): boolean => application.status === 1;

/** 双向申请均按对方 UID 匹配未读摘要，已处理记录不显示待审批红点。 */
export const isFriendApplicationUnread = (
  application: Pick<FriendApplication, 'status' | 'peerUid'>,
  unreadUids: ReadonlySet<string>,
): boolean => application.status === 1 && unreadUids.has(application.peerUid);

/** 明确确认后通过指定申请，不自动重试可能已经提交的审批。 */
export const requestApproveFriendApplication = async (
  api: ApiClient,
  applyId: string,
  friendId: string,
  settings?: FriendSettingsDraft,
): Promise<void> => {
  const request = {
    applyId: parseFriendUid(applyId),
    friendId: parseFriendUid(friendId),
  };
  if (request.friendId === api.userId) throw new Error('不能验证自己的申请');
  await api.request({
    path: '/capi/user/friend/agreeApply',
    method: 'POST',
    body:
      settings === undefined
        ? request
        : { ...request, settings: parseFriendSettingsDraft(settings) },
    serviceName: '好友验证',
    networkError: '网络异常，尚未确认验证结果，请稍后重新打开新的朋友核对',
    parse: parseFriendApplicationResponse,
  });
};

/** 校验成功响应，保留后端业务错误，不把请求失败当作零未读。 */
const readData = (value: unknown): Record<string, unknown> => {
  const root = parseApiResult(value, '好友申请');
  if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data))
    throw new Error('好友申请响应无效');
  return root.data as Record<string, unknown>;
};

/** 校验当前账号的未读申请摘要，UID 仍按字符串保留精度。 */
export const parseFriendUnread = (
  value: unknown,
): FriendApplicationUnread[] => {
  const root = parseApiResult(value, '好友申请');
  if (!Array.isArray(root.data) || root.data.length > 1000)
    throw new Error('好友申请未读列表无效');
  return root.data.map((item: unknown): FriendApplicationUnread => {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new Error('好友申请未读记录无效');
    const data = item as Record<string, unknown>;
    const uid = parseFriendUid(data.uid);
    if (
      typeof data.applyStatus !== 'number' ||
      !Number.isInteger(data.applyStatus) ||
      ![1, 2, 3].includes(data.applyStatus)
    )
      throw new Error('好友申请未读状态无效');
    return { uid, applyStatus: data.applyStatus as 1 | 2 | 3 };
  });
};

/** 请求当前账号权威的未读申请列表，不接收页面提供的接收人标识。 */
export const requestFriendUnread = async (
  api: ApiClient,
): Promise<FriendApplicationUnread[]> =>
  api.request({
    path: '/capi/user/friend/apply/unread',
    method: 'GET',
    serviceName: '好友申请',
    parse: parseFriendUnread,
  });

/** 只确认当前点击的申请，不把打开申请列表当作批量已读。 */
export const requestReadFriendApplication = async (
  api: ApiClient,
  applyId: string,
): Promise<void> => {
  const id = parseFriendUid(applyId);
  await api.request({
    path: `/capi/user/friend/apply/read/${id}`,
    method: 'GET',
    serviceName: '好友申请',
    parse: (value: unknown): void => {
      parseApiResult(value, '好友申请');
    },
  });
};

/** 页码在 IPC 和 HTTP 请求两侧均校验，单页固定十条。 */
export const parseFriendApplicationPageNo = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 1_000_000
  )
    throw new Error('好友申请页码无效');
  return value;
};

/** 核对当前账号的收发方向与对方身份；头像继续由客户端查询。 */
export const parseFriendApplications = (
  value: unknown,
  currentUid: string,
): FriendApplicationPage => {
  const ownerUid = parseFriendUid(currentUid);
  const data = readData(value);
  if (
    typeof data.isLast !== 'boolean' ||
    !Array.isArray(data.list) ||
    data.list.length > 10
  )
    throw new Error('好友申请列表无效');
  const list = data.list.map((value: unknown): FriendApplication => {
    if (!value || typeof value !== 'object')
      throw new Error('好友申请记录无效');
    const item = value as Record<string, unknown>;
    if (
      item.type !== 1 ||
      typeof item.name !== 'string' ||
      item.name.length > 256 ||
      !Array.isArray(item.msg) ||
      ![1, 2, 3].includes(Number(item.status)) ||
      typeof item.status !== 'number' ||
      !Number.isInteger(item.status)
    )
      throw new Error('好友申请记录无效');
    const uid = parseFriendUid(item.uid);
    const peerUid = parseFriendUid(item.peerUid);
    if (peerUid === ownerUid) throw new Error('好友申请对方身份无效');
    let messageUid: string;
    switch (item.direction) {
      case 'RECEIVED':
        if (uid !== peerUid) throw new Error('好友申请方向与身份不匹配');
        messageUid = uid;
        break;
      case 'SENT':
        if (uid !== ownerUid) throw new Error('好友申请方向与身份不匹配');
        messageUid = uid;
        break;
      default:
        throw new Error('好友申请方向无效');
    }
    const messages = item.msg.map(
      (messageValue: unknown): FriendApplicationMessage => {
        if (
          !messageValue ||
          typeof messageValue !== 'object' ||
          Array.isArray(messageValue)
        )
          throw new Error('好友申请消息无效');
        const messageData = messageValue as Record<string, unknown>;
        const messageUid = parseFriendUid(messageData.uid);
        if (
          typeof messageData.msg !== 'string' ||
          messageData.msg.length > 2048
        )
          throw new Error('好友申请消息无效');
        return { uid: messageUid, message: messageData.msg };
      },
    );
    const visibleMessages = messages.filter(
      (messageValue) => messageValue.uid === messageUid,
    );
    const latestMessage = visibleMessages[visibleMessages.length - 1];
    if (!latestMessage) throw new Error('好友申请消息无效');
    return {
      applyId: parseFriendUid(item.applyId),
      uid,
      peerUid,
      direction: item.direction,
      name: item.name,
      avatar: null,
      messages,
      message: latestMessage.message,
      status: item.status as FriendApplication['status'],
    };
  });
  return { list, isLast: data.isLast };
};

/** 统一读取收发申请；分页只读，不确认任何一侧的已读状态。 */
export const requestFriendApplications = async (
  api: ApiClient,
  pageNo: number,
): Promise<FriendApplicationPage> =>
  api.request({
    path: '/capi/user/friend/apply/page',
    method: 'POST',
    body: { pageNo: parseFriendApplicationPageNo(pageNo), pageSize: 10 },
    serviceName: '好友申请',
    parse: (value: unknown): FriendApplicationPage =>
      parseFriendApplications(value, api.userId),
  });

/** 只接受属于当前账号的好友申请事件，其他事件交给原聊天分发器。 */
export const isFriendApplyNotification = (
  data: string,
  uid: string,
): boolean => {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object') return false;
    const event = value as Record<string, unknown>;
    return (
      event.eventType === 'FRIEND_APPLY' &&
      parseFriendUid(event.targetUid) === uid
    );
  } catch {
    return false;
  }
};
