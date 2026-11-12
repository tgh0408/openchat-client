import {
  listRemoteGroupMembers,
  listRemoteGroups,
} from '../../../../../shared/contacts/group';
import type {
  GroupDirectoryItem,
  GroupMemberItem,
} from '../../../../../shared/contacts/group';
import { createAuthenticatedApiClient } from '../../../../services/network/api-client';
import { hydrateAvatarByUid } from '../../../../services/chat/contact-avatar';
import { getContact } from '../../../../services/database/database';
import { formatGroupDisplayName } from '../../../../../shared/contacts/group-name';

/** 拉取当前账号加入的群聊列表，结果只返回当前已验证账号的页面内存。 */
export const listUserGroups = async (
  validateCurrent: () => void,
): Promise<GroupDirectoryItem[]> => {
  const api = createAuthenticatedApiClient(validateCurrent);
  const groups = await listRemoteGroups(api);
  validateCurrent();
  return Promise.all(
    groups.map(async (group) => {
      const avatarList = await Promise.all(
        group.avatarUidList.map((uid) =>
          hydrateAvatarByUid(api, uid, validateCurrent, group.roomId),
        ),
      );
      validateCurrent();
      return {
        ...group,
        avatarList,
        displayName: formatGroupDisplayName(
          group.name,
          group.avatarUidList.map((uid) => getContact(uid)?.nickname),
        ),
      };
    }),
  );
};

/** 拉取指定群的成员列表，结果只返回当前已验证账号的页面内存。 */
export const listUserGroupMembers = async (
  roomId: string,
  validateCurrent: () => void,
): Promise<GroupMemberItem[]> => {
  const api = createAuthenticatedApiClient(validateCurrent);
  const members = await listRemoteGroupMembers(api, roomId);
  validateCurrent();
  return Promise.all(
    members.map(async (member) => ({
      ...member,
      avatar: await hydrateAvatarByUid(
        api,
        member.uid,
        validateCurrent,
        roomId,
      ),
    })),
  );
};
