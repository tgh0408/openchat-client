import {
  listRemoteContacts,
  requestContactInfo,
  type ChatRoom,
} from '../../../../shared/chat/chat';
import type { ApiClient } from '../../../../shared/api/api-client';
import { formatGroupDisplayName } from '../../../../shared/contacts/group-name';
import {
  requestConversationTopStatus,
  requestConversationNotDisturb,
  requestHideConversation,
} from '../../../../shared/chat/conversations/conversation-preferences';
import type { ConversationSummary } from '../../../../shared/storage/database';
import { createAuthenticatedApiClient } from '../../../services/network/api-client';
import {
  getConversationDeletion,
  getConversationDeletionEpoch,
  getConversationReadCursor,
  saveRemoteConversation,
  setConversationTop,
  setConversationNotDisturb,
  updateRemoteConversation,
  getRemoteConversation,
  listConversations,
  setGroupRemoved,
  getContact,
} from '../../../services/database/database';
import { hydrateAvatarByUid } from '../../../services/chat/contact-avatar';
import { flushConversationDeletions } from '../../../services/chat/conversation-sync';
import { flushConversationReads } from '../../../services/chat/conversation-reads';

let notDisturbEpoch = 0;
const notDisturbRequests = new Set<string>();

/** 本机设置请求与读取重叠时保留已确认值，旧快照不能撤销刚完成的操作。 */
const preserveNotDisturb = (room: ChatRoom, epoch: number): ChatRoom => {
  if (epoch === notDisturbEpoch && !notDisturbRequests.has(room.roomId))
    return room;
  return {
    ...room,
    notDisturb: getRemoteConversation(room.roomId)?.notDisturb,
  };
};

/** 后端确认后才保存偏好；在途限制仅协调本机，跨节点并发由后端版本更新处理。 */
export const setUserConversationNotDisturb = async (
  roomId: string,
  status: 0 | 1,
  validateCurrent: () => void,
): Promise<void> => {
  validateCurrent();
  if (!getRemoteConversation(roomId)) throw new Error('远端会话不存在');
  if (notDisturbRequests.has(roomId)) throw new Error('免打扰设置正在提交');
  notDisturbRequests.add(roomId);
  notDisturbEpoch++;
  try {
    await requestConversationNotDisturb(
      createAuthenticatedApiClient(validateCurrent),
      roomId,
      status,
    );
    validateCurrent();
    setConversationNotDisturb(roomId, status);
  } finally {
    notDisturbRequests.delete(roomId);
    notDisturbEpoch++;
  }
};

/** 空群名复用头像资料缓存生成默认标题，列表和详情落库采用同一规则。 */
const hydrateConversation = async (
  api: ApiClient,
  room: ChatRoom,
  validateCurrent: () => void,
): Promise<ChatRoom> => {
  if (room.groupRemoved) return room;
  switch (room.type) {
    case 1: {
      if (room.name.trim()) return room;
      await Promise.all(
        room.avatarUidList.map((uid) =>
          hydrateAvatarByUid(api, uid, validateCurrent, room.roomId),
        ),
      );
      validateCurrent();
      return {
        ...room,
        name: formatGroupDisplayName(
          room.name,
          room.avatarUidList.map((uid) => getContact(uid)?.nickname),
        ),
      };
    }
    case 2:
      if (!room.participantId) return room;
      return {
        ...room,
        avatar: await hydrateAvatarByUid(
          api,
          room.participantId,
          validateCurrent,
          room.roomId,
        ),
      };
    default:
      return room;
  }
};

/** 单次同步全部可见会话并合并到本地，未返回的会话及历史保持不变。 */
export const syncRemoteContacts = async (
  validateCurrent: () => void,
): Promise<number> => {
  await flushConversationDeletions(validateCurrent);
  await flushConversationReads();
  validateCurrent();
  const deletionEpoch = getConversationDeletionEpoch();
  const api = createAuthenticatedApiClient(validateCurrent);
  const preferenceEpoch = notDisturbEpoch;
  const rooms = await listRemoteContacts(api);
  validateCurrent();
  const hydratedRooms = await Promise.all(
    rooms.map((room) => hydrateConversation(api, room, validateCurrent)),
  );
  validateCurrent();
  if (deletionEpoch !== getConversationDeletionEpoch())
    throw new Error('会话已清空，请重新同步');
  for (const room of hydratedRooms)
    saveRemoteConversation(preserveNotDisturb(room, preferenceEpoch));
  return hydratedRooms.length;
};

/** 更新当前账号的会话置顶状态，完成前后复核页面和授权账号。 */
export const setUserConversationTop = async (
  roomId: string,
  status: 0 | 1,
  validateCurrent: () => void,
): Promise<void> => {
  const api = createAuthenticatedApiClient(validateCurrent);
  await requestConversationTopStatus(api, roomId, status);
  validateCurrent();
  setConversationTop(roomId, status);
};

/** 请求服务端隐藏当前账号的会话，不删除本地历史或媒体记录。 */
export const hideUserConversation = async (
  roomId: string,
  validateCurrent: () => void,
): Promise<void> => {
  const api = createAuthenticatedApiClient(validateCurrent);
  await requestHideConversation(api, roomId);
  validateCurrent();
};

/** 只消费已在当前账号库提交的删除操作，不接受页面指定删除游标。 */
export const removeUserConversation = async (
  roomId: string,
  validateCurrent: () => void,
): Promise<void> => {
  if (!getConversationDeletion(roomId)) throw new Error('本地删除记录不存在');
  await flushConversationDeletions(validateCurrent);
  validateCurrent();
};

/** 获取点击房间的最新详情并落库，异步返回后必须重新校验页面、账号及请求次序。 */
export const refreshConversationInfo = async (
  roomId: string,
  validateCurrent: () => void,
): Promise<ConversationSummary> => {
  await flushConversationDeletions(validateCurrent);
  const api = createAuthenticatedApiClient(validateCurrent);
  const preferenceEpoch = notDisturbEpoch;
  const room = preserveNotDisturb(
    await requestContactInfo(api, roomId),
    preferenceEpoch,
  );
  validateCurrent();
  const previous = getRemoteConversation(roomId);
  setGroupRemoved(roomId, room.groupRemoved === true);
  if (room.groupRemoved) {
    // contact 不含群名或消息摘要，不能用空字段清掉已有本地资料和阅读进度。
    if (!previous) saveRemoteConversation({ ...room, name: '群聊' });
    else if (room.notDisturb !== undefined)
      setConversationNotDisturb(roomId, room.notDisturb);
    const cached = listConversations().find((item) => item.id === roomId);
    if (!cached) throw new Error('本地会话不存在');
    return { ...cached, groupRemoved: true, canRecallMembers: false };
  }
  const hydratedRoom = preserveNotDisturb(
    await hydrateConversation(api, room, validateCurrent),
    preferenceEpoch,
  );
  validateCurrent();
  if (!previous) {
    saveRemoteConversation(hydratedRoom);
    const restored = listConversations().find(
      (conversation) => conversation.id === roomId,
    );
    if (!restored) throw new Error('远端会话恢复失败，请重试');
    return {
      ...restored,
      lastReadMsgId:
        getConversationReadCursor(roomId) ?? hydratedRoom.lastReadMsgId,
      canRecallMembers: hydratedRoom.canRecallMembers === true,
      groupRemoved: false,
    };
  }
  const refreshed = updateRemoteConversation(hydratedRoom);
  return {
    ...refreshed,
    lastReadMsgId:
      getConversationReadCursor(roomId) ?? hydratedRoom.lastReadMsgId,
    canRecallMembers: hydratedRoom.canRecallMembers === true,
    groupRemoved: false,
  };
};
