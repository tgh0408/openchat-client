import type { Contact } from '../storage/database';

export const CONTACT_NAME_TTL_MS = 60_000;

/** 合并不同房间的并发资料响应，较旧请求不能覆盖更新名称或清除其他群昵称。 */
export const mergeContactProfiles = (
  previous: Contact | undefined,
  incoming: Contact,
): Contact => {
  if (!previous || previous.id !== incoming.id) return incoming;
  const result: Contact = {
    ...(previous.updatedAt > incoming.updatedAt ? previous : incoming),
    remark: incoming.remark,
    nameUpdatedAt: incoming.nameUpdatedAt,
  };
  if ((previous.nameUpdatedAt ?? '') > (incoming.nameUpdatedAt ?? '')) {
    result.remark = previous.remark;
    result.nameUpdatedAt = previous.nameUpdatedAt;
  }
  const groupNicknames = { ...previous.groupNicknames };
  const groupNamesUpdatedAt = { ...previous.groupNamesUpdatedAt };
  for (const [roomId, timestamp] of Object.entries(
    incoming.groupNamesUpdatedAt ?? {},
  )) {
    if (timestamp >= (groupNamesUpdatedAt[roomId] ?? '')) {
      groupNicknames[roomId] = incoming.groupNicknames?.[roomId] ?? null;
      groupNamesUpdatedAt[roomId] = timestamp;
    }
  }
  return { ...result, groupNicknames, groupNamesUpdatedAt };
};

/** 资料命中不代表本群名称已查询；空昵称也按有效结果缓存，过期后按需刷新。 */
export const isContactNameFresh = (
  contact: Contact | null | undefined,
  roomId?: string,
  timestamp: number = Date.now(),
): boolean => {
  if (!contact?.nameUpdatedAt) return false;
  const updatedAt = Date.parse(contact.nameUpdatedAt);
  if (
    !Number.isFinite(updatedAt) ||
    timestamp < updatedAt ||
    timestamp - updatedAt >= CONTACT_NAME_TTL_MS
  )
    return false;
  if (!roomId) return true;
  const groupUpdatedAt = Date.parse(
    contact.groupNamesUpdatedAt?.[roomId] ?? '',
  );
  return (
    Number.isFinite(groupUpdatedAt) &&
    timestamp >= groupUpdatedAt &&
    timestamp - groupUpdatedAt < CONTACT_NAME_TTL_MS
  );
};
