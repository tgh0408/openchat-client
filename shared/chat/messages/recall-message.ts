import type { Contact, Message } from '../../storage/database';

/** 撤回正文只保存真实操作者和公开用户名，不保存接收者私有备注。 */
export interface RecallContent {
  recallUid: string | null;
  recallName: string | null;
  recallGroupNickname?: string | null;
}

/** 校验撤回公开协议，旧版无身份提示保持未知，不能猜测为原发送者。 */
export const validateRecallContent = (value: unknown): RecallContent => {
  if (value === '消息已撤回') return { recallUid: null, recallName: null };
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('撤回消息格式无效');
  const data = value as Record<string, unknown>;
  // 兼容旧 MQ 将小 UID 还原为 Integer 的回包，不转换可能已丢失精度的数字。
  const recallUid =
    typeof data.recallUid === 'number' &&
    Number.isSafeInteger(data.recallUid) &&
    data.recallUid > 0
      ? String(data.recallUid)
      : data.recallUid;
  if (
    !Object.prototype.hasOwnProperty.call(data, 'recallUid') ||
    !Object.prototype.hasOwnProperty.call(data, 'recallName') ||
    (recallUid !== null &&
      (typeof recallUid !== 'string' || !/^[1-9]\d{0,63}$/.test(recallUid))) ||
    (data.recallName !== null &&
      (typeof data.recallName !== 'string' ||
        data.recallName.length > 64 ||
        data.recallName.includes('\0'))) ||
    (data.recallGroupNickname != null &&
      (typeof data.recallGroupNickname !== 'string' ||
        data.recallGroupNickname.length > 64 ||
        data.recallGroupNickname.includes('\0')))
  )
    throw new Error('撤回消息格式无效');
  const recall: RecallContent = {
    recallUid,
    recallName: recallUid === null ? null : data.recallName,
  };
  if (data.recallGroupNickname !== undefined)
    recall.recallGroupNickname =
      recallUid !== null && typeof data.recallGroupNickname === 'string'
        ? data.recallGroupNickname
        : null;
  return recall;
};

/** 本地旧提示或损坏内容只显示未知撤回，不把 JSON 或原文直接放到页面。 */
export const parseRecallContent = (content: string): RecallContent => {
  try {
    return validateRecallContent(JSON.parse(content));
  } catch {
    return { recallUid: null, recallName: null };
  }
};

/** 终态不能被旧正文恢复，已知撤回身份也不能降级为旧版无身份提示。 */
export const shouldKeepRecalledMessage = (
  previous: Pick<Message, 'messageType' | 'content'> | undefined,
  incoming: Pick<Message, 'messageType' | 'content'>,
): boolean =>
  previous?.messageType === 'recalled' &&
  (incoming.messageType !== 'recalled' ||
    (!!parseRecallContent(previous.content).recallUid &&
      !parseRecallContent(incoming.content).recallUid));

/** 统一展示名称：当前账号备注优先，本群昵称次之，最后回退公开用户名。 */
export const resolveMessageName = (
  uid: string,
  conversationId: string,
  contact?: Contact,
  fallbackName?: string | null,
  fallbackGroupNickname?: string | null,
): string => {
  const matched = contact?.id === uid ? contact : undefined;
  const groupNickname = Object.prototype.hasOwnProperty.call(
    matched?.groupNicknames ?? {},
    conversationId,
  )
    ? matched?.groupNicknames?.[conversationId]
    : fallbackGroupNickname;
  return (
    matched?.remark?.trim() ||
    groupNickname?.trim() ||
    matched?.nickname.trim() ||
    fallbackName?.trim() ||
    `用户 ${uid}`
  );
};

/** 根据当前阅读者生成撤回提示，不改写消息原发送者或持久化“我”。 */
export const formatRecallMessage = (
  content: string,
  userId: string,
  conversationId: string,
  contacts: Readonly<Record<string, Contact>> = {},
): string => {
  const recall = parseRecallContent(content);
  if (!recall.recallUid) return '消息已撤回';
  if (recall.recallUid === userId) return '你撤回了一条消息';
  return `${resolveMessageName(
    recall.recallUid,
    conversationId,
    contacts[recall.recallUid],
    recall.recallName,
    recall.recallGroupNickname,
  )}撤回了一条消息`;
};

/** 历史资料仅绑定到本条消息实际展示的人，管理员撤回不能沿用原发送者。 */
export const messageDisplayUid = (message: Message): string | null => {
  switch (message.messageType) {
    case 'system':
    case 'local-notice':
      return null;
    case 'recalled':
      return parseRecallContent(message.content).recallUid;
    default:
      return message.senderId;
  }
};
