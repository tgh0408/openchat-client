/** 热群订阅完成后的补同步提示，不作为消息、已读或成员资格依据。 */
export interface RoomHistorySyncNotification {
  eventType: 'ROOM_HISTORY_SYNC_REQUIRED';
  roomId: string;
}

/** 只接受后端字符串 Long 标识，未知或损坏通知不触发历史请求。 */
export const parseRoomHistorySyncNotification = (
  data: string,
): RoomHistorySyncNotification | null => {
  try {
    const value: unknown = JSON.parse(data);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      return null;
    const event = value as Record<string, unknown>;
    if (
      event.eventType !== 'ROOM_HISTORY_SYNC_REQUIRED' ||
      typeof event.roomId !== 'string' ||
      !/^[1-9]\d{0,18}$/.test(event.roomId) ||
      BigInt(event.roomId) > 9223372036854775807n
    )
      return null;
    return { eventType: event.eventType, roomId: event.roomId };
  } catch {
    return null;
  }
};
