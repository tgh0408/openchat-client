import {
  listRemoteFriends,
  requestFriendDetail,
} from '../../../../../shared/contacts/friend';
import type {
  Friend,
  FriendDetail,
} from '../../../../../shared/contacts/friend';
import { createAuthenticatedApiClient } from '../../../../services/network/api-client';
import { hydrateAvatarByUid } from '../../../../services/chat/contact-avatar';

/** 使用好友详情补齐本地没有缓存的头像，并把结果写入当前账号联系人缓存。 */
const hydrateFriendAvatar = async (
  api: ReturnType<typeof createAuthenticatedApiClient>,
  friend: Friend,
  validateCurrent: () => void,
): Promise<Friend> => {
  return {
    ...friend,
    avatar: await hydrateAvatarByUid(
      api,
      friend.uid,
      validateCurrent,
      friend.roomId,
    ),
  };
};

/** 拉取好友联系人列表，结果仅返回当前已验证账号的页面内存。 */
export const listUserFriends = async (
  validateCurrent: () => void,
): Promise<Friend[]> => {
  const api = createAuthenticatedApiClient(validateCurrent);
  const friends = await listRemoteFriends(api);
  validateCurrent();
  const result = await Promise.all(
    friends.map((friend) => hydrateFriendAvatar(api, friend, validateCurrent)),
  );
  validateCurrent();
  return result;
};

/** 好友详情不落库，返回前复核账号及页面，防止迟到请求泄漏私有资料。 */
export const fetchFriendDetail = async (
  uid: string,
  validateCurrent: () => void,
  roomId: string,
): Promise<FriendDetail> => {
  const api = createAuthenticatedApiClient(validateCurrent);
  const detail = await requestFriendDetail(api, uid, roomId);
  validateCurrent();
  return detail;
};
