import {
  parseExitGroupRoomId,
  parseRemoveGroupMembersRequest,
  type GroupDepartureAction,
  type RemoveGroupMembersRequest,
} from './group';

/** 本机退出或解散请求已被服务端确认，仅同步原账号的窗口状态。 */
export interface GroupExitedNotification {
  userId: string;
  roomId: string;
  action: GroupDepartureAction;
}

/** 校验主进程退出确认的账号与房间，不接受任意事件内容。 */
export const parseGroupExitedNotification = (
  value: unknown,
): GroupExitedNotification | null => {
  if (!value || typeof value !== 'object') return null;
  const notification = value as Record<string, unknown>;
  if (notification.action !== 'exit' && notification.action !== 'dissolve')
    return null;
  try {
    return {
      userId: parseExitGroupRoomId(notification.userId),
      roomId: parseExitGroupRoomId(notification.roomId),
      action: notification.action,
    };
  } catch {
    return null;
  }
};

/** 移出通知仅提示重读，不作为当前成员状态或授权依据。 */
export const parseGroupMembersRemovedNotification = (
  data: string,
): RemoveGroupMembersRequest | null => {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const event = value as Record<string, unknown>;
    if (event.eventType !== 'GROUP_MEMBERS_REMOVED') return null;
    return parseRemoveGroupMembersRequest({
      roomId: event.roomId,
      uids: event.removedUids,
    });
  } catch {
    return null;
  }
};
