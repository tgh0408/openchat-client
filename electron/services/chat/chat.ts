import { getAuthApiBase } from '../../../shared/runtime/server-settings';
import { createHash } from 'node:crypto';
import type { ApiClient } from '../../../shared/api/api-client';
import type { ImageFileStore } from '../media/image/image-files';
import {
  requestMessagePage,
  requestSendMessage,
} from '../../../shared/chat/chat';
import type { SendMessageRequest } from '../../../shared/chat/chat';
import { requestUserInfo } from '../../../shared/auth/auth';
import type { AuthSession } from '../../../shared/auth/auth';
import {
  canAddImageEmoji,
  requestAddImageEmoji,
  requestEmojiList,
  requestDeleteEmoji,
  requestMoveEmojiToFront,
  parseEmojiId,
  isMessageEmojiCached,
} from '../../../shared/chat/emoji';
import type { UserEmoji } from '../../../shared/chat/emoji';
import type { ImagePreviewRequest } from '../../../shared/windows/image-preview';
import type { Contact, Message } from '../../../shared/storage/database';
import { isContactNameFresh } from '../../../shared/contacts/contact-name';
import { getClientId } from '../auth/client-identity';
import { createAuthenticatedApiClient } from '../network/api-client';
import { requireAuthenticatedSession } from '../auth/auth';
import { requestTemporaryState } from '../../../shared/chat/messages/temporary-message';
import { requestMessageState } from '../../../shared/chat/messages/message-state';
import {
  getContact,
  saveContact,
  requireRemoteConversation,
  saveEmojis,
  deleteCachedEmoji,
  listCachedEmojis,
  listTemporaryMessageIds,
  saveRemoteMessages,
  getHistoryMessage,
  listMessageStateIds,
} from '../database/database';
import { createMessageHistorySynchronizer } from './message-history';
import type { MessageHistorySynchronizer } from './message-history';
import { sendOutgoingMessage } from './message-send';
import { flushConversationDeletions } from './conversation-sync';


const contactRequests = new WeakMap<
  AuthSession,
  Map<string, Promise<Contact>>
>();

const sendingRequests = new WeakMap<AuthSession, Map<string, Promise<void>>>();

const addingImageEmojis = new WeakMap<AuthSession, Set<string>>();

const changingEmojis = new WeakSet<AuthSession>();

let emojiCacheRevision = 0;

/** 为收藏及状态读取绑定原消息，拒绝删除、撤回或旧账号的迟到结果。 */
const createImageEmojiOperation = (
  request: ImagePreviewRequest,
  validateCurrent: () => void,
): { api: ApiClient; message: Message } => {
  validateCurrent();
  const message = getHistoryMessage(request.conversationId, request.messageId);
  /** 请求前后复核原消息，删除、撤回或账号变化后不交付旧结果。 */
  const validateImage = (): void => {
    validateCurrent();
    requireRemoteConversation(request.conversationId);
    const current = getHistoryMessage(
      request.conversationId,
      request.messageId,
    );
    if (!canAddImageEmoji(current) || current.content !== message.content)
      throw new Error('图片消息已变化或尚未发送成功');
  };
  return { api: createAuthenticatedApiClient(validateImage), message };
};

/** 仅查当前账号缓存；表情比较 ID，普通图片比较本地原始字节摘要。 */
export const isUserImageEmojiCollected = async (
  request: ImagePreviewRequest,
  readImage: ImageFileStore['read'],
  validateCurrent: () => void,
): Promise<boolean> => {
  const { api, message } = createImageEmojiOperation(request, validateCurrent);
  if (message.messageType === 'emoji') {
    return isMessageEmojiCached(message, listCachedEmojis());
  }
  const image = await readImage(request, api.validateCurrent);
  api.validateCurrent();
  const sha256 = createHash('sha256').update(image.bytes).digest('hex');
  return isMessageEmojiCached(message, listCachedEmojis(), sha256);
};

/** 从当前账号库核验图片；同一授权下跨聊天窗口拒绝重复在途收藏。 */
export const addUserImageEmoji = async (
  request: ImagePreviewRequest,
  validateCurrent: () => void,
): Promise<void> => {
  const { api, message } = createImageEmojiOperation(request, validateCurrent);
  const session = requireAuthenticatedSession();
  if (changingEmojis.has(session)) throw new Error('请等待当前表情操作完成');
  const pending = addingImageEmojis.get(session) ?? new Set<string>();
  addingImageEmojis.set(session, pending);
  const key = `${request.conversationId}:${request.messageId}`;
  if (pending.has(key)) throw new Error('正在添加此表情，请稍候');
  pending.add(key);
  try {
    const emoji = await requestAddImageEmoji(api, message);
    api.validateCurrent();
    saveEmojis([emoji]);
    emojiCacheRevision++;
  } finally {
    pending.delete(key);
  }
};

/** 服务端删除确认后移除缓存；本机跨窗口互斥，拒绝旧列表回填。 */
export const deleteUserEmoji = async (
  value: unknown,
  validateCurrent: () => void,
): Promise<void> => {
  const imgId = parseEmojiId(value);
  const api = createAuthenticatedApiClient(validateCurrent);
  const session = requireAuthenticatedSession();
  if (changingEmojis.has(session) || addingImageEmojis.get(session)?.size)
    throw new Error('请等待当前表情操作完成');
  if (!listCachedEmojis().some((emoji) => emoji.imgId === imgId))
    throw new Error('表情收藏已变化，请重新打开面板');
  changingEmojis.add(session);
  emojiCacheRevision++;
  try {
    await requestDeleteEmoji(api, imgId);
    api.validateCurrent();
    deleteCachedEmoji(imgId);
  } finally {
    emojiCacheRevision++;
    changingEmojis.delete(session);
  }
};

/** 移动与增删在本机互斥，服务端确认后一次性校准缓存，拒绝旧列表覆盖。 */
export const moveUserEmojiToFront = async (
  value: unknown,
  validateCurrent: () => void,
): Promise<UserEmoji[]> => {
  const imgId = parseEmojiId(value);
  const api = createAuthenticatedApiClient(validateCurrent);
  const session = requireAuthenticatedSession();
  if (changingEmojis.has(session) || addingImageEmojis.get(session)?.size)
    throw new Error('请等待当前表情操作完成');
  if (!listCachedEmojis().some((emoji) => emoji.imgId === imgId))
    throw new Error('表情收藏已变化，请重新打开面板');
  changingEmojis.add(session);
  emojiCacheRevision++;
  try {
    const list = await requestMoveEmojiToFront(api, imgId);
    api.validateCurrent();
    saveEmojis(list, true);
    return list;
  } finally {
    emojiCacheRevision++;
    changingEmojis.delete(session);
  }
};

/** 请求表情列表，重新校验调用来源和账号后事务写入当前内容库。 */
export const listUserEmojis = async (
  validateCurrent: () => void,
): Promise<UserEmoji[]> => {
  const api = createAuthenticatedApiClient(validateCurrent);
  const revision = emojiCacheRevision;
  const emojis = await requestEmojiList(api);
  validateCurrent();
  if (revision !== emojiCacheRevision)
    throw new Error('表情缓存已更新，请重新打开面板');
  saveEmojis(emojis, true);
  return emojis;
};

/** 向后端发送一条聊天消息，携带当前会话与平台 clientId。 */
export const sendChatMessage = async (
  request: SendMessageRequest,
): Promise<void> => {
  const api = createAuthenticatedApiClient();
  if (request.msgType === 2) {
    const target = getHistoryMessage(
      request.roomId,
      String(request.body.msgId),
    );
    if (
      target.deletedAt ||
      target.status !== 'sent' ||
      ![
        'text',
        'image',
        'video',
        'file',
        'emoji',
        'audio',
        'temporary',
        'upload-cancelled',
        'recalled',
      ].includes(target.messageType)
    )
      throw new Error('该消息不能撤回');
    await requestSendMessage(api, request);
    return;
  }
  const session = requireAuthenticatedSession();
  let pending = sendingRequests.get(session);
  if (!pending) {
    pending = new Map();
    sendingRequests.set(session, pending);
  }
  const key = JSON.stringify([request.roomId, request.clientMsgId]);
  const existing = pending.get(key);
  if (existing) return existing;
  const operation = sendOutgoingMessage(api, request).finally(() =>
    pending.delete(key),
  );
  pending.set(key, operation);
  await operation;
};

/** 为本次可信授权建立历史同步器，复用平台 clientId，不让页面管理远端游标。 */
export const createChatHistory = (): MessageHistorySynchronizer => {
  const session = requireAuthenticatedSession();
  const api = createAuthenticatedApiClient();
  return createMessageHistorySynchronizer(
    async (roomId, cursor) => {
      await flushConversationDeletions(api.validateCurrent);
      return requestMessagePage(api, roomId, 50, cursor);
    },
    async (roomId, validate): Promise<void> => {
      let afterId = '';
      while (true) {
        validate();
        const ids = listTemporaryMessageIds(roomId, afterId);
        if (!ids.length) break;
        const messages = await requestTemporaryState(
          getAuthApiBase(),
          session,
          getClientId(),
          roomId,
          ids,
        );
        validate();
        saveRemoteMessages(messages);
        afterId = ids[ids.length - 1]!;
      }
      afterId = '';
      while (true) {
        validate();
        const ids = listMessageStateIds(roomId, afterId);
        if (!ids.length) return;
        const messages = await requestMessageState(
          getAuthApiBase(),
          session,
          getClientId(),
          roomId,
          ids,
        );
        validate();
        saveRemoteMessages(messages);
        afterId = ids[ids.length - 1]!;
      }
    },
  );
};

/** 优先读取本地公开资料，缺失或手动刷新时按授权会话合并请求并安全回写。 */
export const fetchContactProfile = async (
  session: AuthSession,
  uid: string,
  force: boolean,
  validateCurrent: () => void,
  roomId?: string,
): Promise<Contact> => {
  validateCurrent();
  if (roomId) requireRemoteConversation(roomId);
  const cached = getContact(uid);
  if (cached && !force && isContactNameFresh(cached, roomId)) return cached;
  let requests = contactRequests.get(session);
  if (!requests) {
    requests = new Map();
    contactRequests.set(session, requests);
  }
  const key = JSON.stringify([uid, roomId ?? null]);
  const running = requests.get(key);
  if (running) {
    const contact = await running;
    validateCurrent();
    return contact;
  }
  /** 网络返回后重新确认调用来源及账号，旧请求不能写入新账号的资料表。 */
  const request = async (): Promise<Contact> => {
    const timestamp = new Date().toISOString();
    const profile = await requestUserInfo(
      getAuthApiBase(),
      session,
      uid,
      undefined,
      roomId,
    );
    validateCurrent();
    if (roomId) requireRemoteConversation(roomId);
    const contact: Contact = {
      id: uid,
      nickname: profile.name || cached?.nickname || `用户 ${uid}`,
      avatar: profile.avatar,
      signature: profile.signature,
      updatedAt: timestamp,
      remark: profile.remark,
      nameUpdatedAt: timestamp,
      ...(roomId
        ? {
            groupNicknames: { [roomId]: profile.groupNickname },
            groupNamesUpdatedAt: { [roomId]: timestamp },
          }
        : {}),
    };
    saveContact(contact);
    return getContact(uid)!;
  };
  const promise = request();
  requests.set(key, promise);
  try {
    return await promise;
  } finally {
    if (requests.get(key) === promise) requests.delete(key);
  }
};
