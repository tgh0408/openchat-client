import { requestFriendDetail } from '../../../shared/contacts/friend';
import { SessionExpiredError } from '../../../shared/auth/auth';
import { createAuthenticatedApiClient } from '../network/api-client';
import { getContact, saveContact } from '../database/database';

const avatarRequests = new WeakMap<
  ReturnType<typeof createAuthenticatedApiClient>,
  Map<string, Promise<string | null>>
>();

/** 复用当前账号联系人缓存补齐列表头像，异步完成后复核原页面授权。 */
export const hydrateAvatarByUid = async (
  api: ReturnType<typeof createAuthenticatedApiClient>,
  uid: string,
  validateCurrent: () => void,
  roomId: string | null,
): Promise<string | null> => {
  const cached = getContact(uid);
  if (cached?.avatar) return cached.avatar;
  if (!roomId) return null;
  let requests = avatarRequests.get(api);
  if (!requests) {
    requests = new Map();
    avatarRequests.set(api, requests);
  }
  const key = JSON.stringify([uid, roomId ?? null]);
  const running = requests.get(key);
  if (running) return running;
  const request = (async (): Promise<string | null> => {
    try {
      const detail = await requestFriendDetail(api, uid, roomId);
      validateCurrent();
      const timestamp = new Date().toISOString();
      saveContact({
        id: uid,
        nickname: detail.name || `用户 ${uid}`,
        avatar: detail.avatar,
        signature: detail.personalitySignature,
        updatedAt: timestamp,
        remark: detail.remark,
        nameUpdatedAt: timestamp,
      });
      return detail.avatar;
    } catch (cause) {
      if (cause instanceof SessionExpiredError) throw cause;
      return null;
    }
  })();
  requests.set(key, request);
  try {
    return await request;
  } finally {
    if (requests.get(key) === request) requests.delete(key);
  }
};
