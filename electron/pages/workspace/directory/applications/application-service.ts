import { getAuthApiBase } from '../../../../../shared/runtime/server-settings';
import {
  requestUserInfo,
  SessionExpiredError,
} from '../../../../../shared/auth/auth';
import type { FriendApplicationPage } from '../../../../../shared/contacts/friend-notification';
import { requireAuthenticatedSession } from '../../../../services/auth/auth';
import {
  getContact,
  saveContact,
} from '../../../../services/database/database';


/** 按对方 UID 补齐收发申请头像，不让单条资料失败阻断整页。*/
export const hydrateFriendApplicationPage = async (
  page: FriendApplicationPage,
  validateCurrent: () => void,
): Promise<FriendApplicationPage> => {
  const session = requireAuthenticatedSession();
  return {
    ...page,
    list: await Promise.all(
      page.list.map(async (item) => {
        const cached = getContact(item.peerUid);
        if (cached) return { ...item, avatar: cached.avatar };
        try {
          const profile = await requestUserInfo(
            getAuthApiBase(),
            session,
            item.peerUid,
          );
          validateCurrent();
          const timestamp = new Date().toISOString();
          saveContact({
            id: item.peerUid,
            nickname: profile.name || item.name,
            avatar: profile.avatar,
            signature: profile.signature,
            updatedAt: timestamp,
            remark: profile.remark,
            nameUpdatedAt: timestamp,
          });
          return { ...item, avatar: profile.avatar };
        } catch (cause) {
          if (cause instanceof SessionExpiredError) throw cause;
          return item;
        }
      }),
    ),
  };
};
