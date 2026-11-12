import {
  type RtcCallView,
  RtcParticipantState,
} from '../../../../shared/rtc/rtc';
import type { RtcRoomParticipant } from './rtc-client';

export interface RtcGroupMember extends RtcRoomParticipant {
  waiting: boolean;
  expired: boolean;
}

/** 已入会者保持媒体房间顺序，未响应邀请追加占位，拒绝及离开不可恢复为占位。 */
export const readRtcGroupMembers = (
  call: RtcCallView,
  currentUserId: string,
  joined: RtcRoomParticipant[],
  previouslyJoined: ReadonlySet<string>,
): RtcGroupMember[] => {
  const visible = call.participants.filter(
    (participant) =>
      participant.state !== RtcParticipantState.REJECTED &&
      participant.state !== RtcParticipantState.LEFT,
  );
  const members: RtcGroupMember[] = joined
    .filter((participant) =>
      visible.some(
        (invitation) =>
          invitation.uid === participant.identity &&
          invitation.state !== RtcParticipantState.EXPIRED,
      ),
    )
    .map((participant) => ({ ...participant, waiting: false, expired: false }));
  const joinedIds = new Set(members.map((participant) => participant.identity));
  for (const invitation of visible) {
    if (joinedIds.has(invitation.uid)) continue;
    const local = invitation.uid === currentUserId;
    if (
      !local &&
      invitation.state === RtcParticipantState.ACCEPTED &&
      previouslyJoined.has(invitation.uid)
    )
      continue;
    const expired = invitation.state === RtcParticipantState.EXPIRED;
    members.push({
      identity: invitation.uid,
      name: local ? '你' : `用户 ${invitation.uid}`,
      joinedAt: Number.MAX_SAFE_INTEGER,
      speaking: false,
      cameraEnabled: false,
      waiting: !local && !expired,
      expired,
    });
  }
  return members;
};
