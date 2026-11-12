import type { ResourceSseMessage } from '../windows/desktop';
import { parseApiResult } from '../api/api-response';

/** 与后端 RtcMediaMode 的枚举序号一致。 */
export enum RtcMediaMode {
  AUDIO = 0,
  VIDEO = 1,
}

/** 对应后端 RtcParticipantState 的显式 value，不使用枚举序号。 */
export enum RtcParticipantState {
  INVITED = 1,
  ACCEPTED = 2,
  REJECTED = 3,
  EXPIRED = 4,
  LEFT = 5,
}

export const RTC_INVITATION_TIMEOUT_MS = 60_000;

/** 对应后端尚未定义显式 value 的 RtcCallState 序号。 */
export enum RtcCallState {
  RINGING = 0,
  ACCEPTED = 1,
  CONNECTED = 2,
  REJECTED = 3,
  CANCELED = 4,
  ENDED = 5,
  EXPIRED = 6,
}

export interface RtcCallPeer {
  name: string;
  avatar: string | null;
}

export interface RtcCallParticipant {
  uid: string;
  state?: RtcParticipantState;
  /** 群成员独立版本，单聊不使用。 */
  version?: number;
}

export interface RtcCallView {
  deviceOwnership?: RtcDeviceOwnership;
  callId: string;
  roomId: string;
  callerUid: string;
  calleeUid: string | null;
  mediaMode: RtcMediaMode;
  state: RtcCallState;
  version: number;
  expiresAt: string | null;
  endReason: string | null;
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string | null;
  connectedAt?: string | null;
  endedAt?: string | null;
  durationSeconds?: number | null;
  endedByUid?: string | null;
  summaryMessageId?: string | null;
  participants: RtcCallParticipant[];
}

/** 当前请求设备相对于本人成员席位的归属，缺失字段不授予媒体权限。 */
export enum RtcDeviceOwnership {
  UNASSIGNED = 'UNASSIGNED',
  CURRENT_DEVICE = 'CURRENT_DEVICE',
  OTHER_DEVICE = 'OTHER_DEVICE',
  UNKNOWN = 'UNKNOWN',
}

/** 只有尚未分配的邀请或本设备拥有的通话可以保留本地窗口。 */
export const canUseRtcDevice = (call: RtcCallView): boolean =>
  call.deviceOwnership === RtcDeviceOwnership.CURRENT_DEVICE ||
  call.deviceOwnership === RtcDeviceOwnership.UNASSIGNED;

/** 校验服务端设备归属，旧快照按未知设备处理。 */
const readDeviceOwnership = (value: unknown): RtcDeviceOwnership => {
  switch (value) {
    case RtcDeviceOwnership.UNASSIGNED:
    case RtcDeviceOwnership.CURRENT_DEVICE:
    case RtcDeviceOwnership.OTHER_DEVICE:
    case RtcDeviceOwnership.UNKNOWN:
      return value;
    case undefined:
    case null:
      return RtcDeviceOwnership.UNKNOWN;
    default:
      throw new Error('通话设备归属无效');
  }
};

export interface RtcOngoingCall {
  call: RtcCallView;
  peerName: string;
}

/** 解析呼出前的活动记录，包含响铃及群通话，拒绝非本人或重复记录。 */
export const parseRtcActiveCallsResponse = (
  value: unknown,
  userId: string,
): RtcCallView[] => {
  const root = parseApiResult(value, '当前通话');
  if (!Array.isArray(root.data)) throw new Error('当前通话响应无效');
  const ids = new Set<string>();
  return root.data.map((item: unknown): RtcCallView => {
    const call = readCall(item);
    if (
      ![
        RtcCallState.RINGING,
        RtcCallState.ACCEPTED,
        RtcCallState.CONNECTED,
      ].includes(call.state) ||
      !call.participants.some(
        (member) =>
          member.uid === userId &&
          (member.state === RtcParticipantState.INVITED ||
            member.state === RtcParticipantState.ACCEPTED),
      ) ||
      ids.has(call.callId)
    )
      throw new Error('当前通话响应无效');
    ids.add(call.callId);
    return call;
  });
};

/** 对应后端 RtcEventType 的字符串协议值，不使用枚举序号。 */
export enum RtcEventType {
  RTC_CALL_ANSWERED_ELSEWHERE = 'RTC_CALL_ANSWERED_ELSEWHERE',
  /** 创建呼叫，通知被邀请者。 */
  RTC_CALL_CREATED = 'RTC_CALL_CREATED',
  /** 首位被叫接听，呼叫进入已接听状态。 */
  RTC_CALL_ACCEPTED = 'RTC_CALL_ACCEPTED',
  /** 全部被叫拒绝，呼叫结束。 */
  RTC_CALL_REJECTED = 'RTC_CALL_REJECTED',
  /** 主叫取消尚未接听的呼叫。 */
  RTC_CALL_CANCELED = 'RTC_CALL_CANCELED',
  /** 已接听的呼叫被挂断。 */
  RTC_CALL_ENDED = 'RTC_CALL_ENDED',
  /** 无人接听且邀请到期，呼叫结束。 */
  RTC_CALL_EXPIRED = 'RTC_CALL_EXPIRED',
  /** 呼叫已被接听后，另一位参与者接受邀请。 */
  RTC_CALL_PARTICIPANT_ACCEPTED = 'RTC_CALL_PARTICIPANT_ACCEPTED',
  /** 部分参与者拒绝邀请，其他参与者的呼叫继续。 */
  RTC_CALL_PARTICIPANT_REJECTED = 'RTC_CALL_PARTICIPANT_REJECTED',
  /** 群聊成员离开，不结束其他成员的通话。 */
  RTC_CALL_PARTICIPANT_LEFT = 'RTC_CALL_PARTICIPANT_LEFT',
  /** 呼叫已被接听，剩余未响应的邀请到期。 */
  RTC_CALL_PARTICIPANTS_EXPIRED = 'RTC_CALL_PARTICIPANTS_EXPIRED',
  /** 媒体协商快照更新，signalSeq 为独立的媒体版本，不携带 SDP。 */
  RTC_MEDIA_UPDATED = 'RTC_MEDIA_UPDATED',
  /** 摄像头实际开关变化，版本独立于呼叫和 SDP。 */
  RTC_CAMERA_UPDATED = 'RTC_CAMERA_UPDATED',
}

export interface RtcEvent {
  eventId: string;
  /** 经协议入口校验的 RTC 事件类型。 */
  eventType: RtcEventType;
  callId: string;
  roomId: string;
  fromUid: string | null;
  toUid: string;
  callVersion: number;
  signalSeq: string | null;
  sentAt: number;
  payload: Record<string, unknown> | null;
}

export interface RtcJoinCredential {
  serverUrl: string;
  roomName: string;
  token: string;
  expiresAt: string;
  videoAllowed: boolean;
}

const readLong = (value: unknown): string | null => {
  switch (typeof value) {
    case 'string':
      return /^[1-9]\d{0,63}$/.test(value) ? value : null;
    case 'number':
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    default:
      return null;
  }
};

/** 读取协议中的安全整数，兼容后端为避免 JavaScript 精度丢失而序列化的字符串。 */
const readSafeInteger = (value: unknown, minimum: number): number | null => {
  switch (typeof value) {
    case 'number':
      return Number.isSafeInteger(value) && value >= minimum ? value : null;
    case 'string': {
      if (!/^(0|[1-9]\d*)$/.test(value)) return null;
      const parsed = Number(value);
      return Number.isSafeInteger(parsed) && parsed >= minimum ? parsed : null;
    }
    default:
      return null;
  }
};

const readRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readOptionalTimestamp = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
    throw new Error('RTC 呼叫时间字段无效');
  return value;
};

/** 协议入口将数字或旧名称归一化为通话枚举，业务层不再使用字符串状态。 */
export const readRtcCallState = (value: unknown): RtcCallState | null => {
  switch (value) {
    case RtcCallState.RINGING:
    case 'RINGING':
      return RtcCallState.RINGING;
    case RtcCallState.ACCEPTED:
    case 'ACCEPTED':
      return RtcCallState.ACCEPTED;
    case RtcCallState.CONNECTED:
    case 'CONNECTED':
      return RtcCallState.CONNECTED;
    case RtcCallState.REJECTED:
    case 'REJECTED':
      return RtcCallState.REJECTED;
    case RtcCallState.CANCELED:
    case 'CANCELED':
      return RtcCallState.CANCELED;
    case RtcCallState.ENDED:
    case 'ENDED':
      return RtcCallState.ENDED;
    case RtcCallState.EXPIRED:
    case 'EXPIRED':
      return RtcCallState.EXPIRED;
    default:
      return null;
  }
};

/** 协议入口将媒体序号或旧名称归一化为媒体枚举，未知模式仍拒绝。 */
export const readRtcMediaMode = (value: unknown): RtcMediaMode | null => {
  switch (value) {
    case RtcMediaMode.AUDIO:
    case 'AUDIO':
      return RtcMediaMode.AUDIO;
    case RtcMediaMode.VIDEO:
    case 'VIDEO':
      return RtcMediaMode.VIDEO;
    default:
      return null;
  }
};

/** 按后端显式 value 或名称读取成员状态，缺省仅用于旧服务端快照。 */
const readParticipantState = (
  value: unknown,
): RtcParticipantState | undefined => {
  if (value === undefined) return undefined;
  switch (value) {
    case RtcParticipantState.INVITED:
    case 'INVITED':
      return RtcParticipantState.INVITED;
    case RtcParticipantState.ACCEPTED:
    case 'ACCEPTED':
      return RtcParticipantState.ACCEPTED;
    case RtcParticipantState.REJECTED:
    case 'REJECTED':
      return RtcParticipantState.REJECTED;
    case RtcParticipantState.EXPIRED:
    case 'EXPIRED':
      return RtcParticipantState.EXPIRED;
    case RtcParticipantState.LEFT:
    case 'LEFT':
      return RtcParticipantState.LEFT;
    default:
      throw new Error('RTC 成员响应状态无效');
  }
};

const readCall = (value: unknown): RtcCallView => {
  const data = readRecord(value);
  const callId = data?.callId;
  const roomId = readLong(data?.roomId);
  const callerUid = readLong(data?.callerUid);
  const calleeUid = readLong(data?.calleeUid);
  const mediaMode = readRtcMediaMode(data?.mediaMode);
  const state = readRtcCallState(data?.state);
  const version = readSafeInteger(data?.version, 1);
  const durationSeconds =
    data?.durationSeconds == null
      ? null
      : readSafeInteger(data.durationSeconds, 0);
  const endedByUid =
    data?.endedByUid == null ? null : readLong(data.endedByUid);
  const summaryMessageId =
    data?.summaryMessageId == null ? null : readLong(data.summaryMessageId);
  const participantsValue = data?.participants;
  const group = data?.calleeUid === null;
  const participants: RtcCallParticipant[] = Array.isArray(participantsValue)
    ? participantsValue.map((item): RtcCallParticipant => {
        const participant = readRecord(item);
        const uid = readLong(participant?.uid);
        const memberVersion = readSafeInteger(participant?.version, 1);
        const memberState = readParticipantState(participant?.state);
        if (
          !uid ||
          (group && (memberVersion === null || memberState === undefined))
        )
          throw new Error('RTC 参与者响应无效');
        return { uid, state: memberState, version: memberVersion ?? undefined };
      })
    : [];
  if (
    !data ||
    typeof callId !== 'string' ||
    !callId.trim() ||
    !roomId ||
    !callerUid ||
    (!group && (!calleeUid || calleeUid === callerUid)) ||
    mediaMode === null ||
    state === null ||
    version === null ||
    (data.expiresAt !== null && typeof data.expiresAt !== 'string') ||
    (data.endReason !== null && typeof data.endReason !== 'string') ||
    typeof data.createdAt !== 'string' ||
    typeof data.updatedAt !== 'string' ||
    (data?.durationSeconds != null && durationSeconds === null) ||
    (data?.endedByUid != null && !endedByUid) ||
    (data?.summaryMessageId != null && !summaryMessageId) ||
    participants.length < (group ? 1 : 2) ||
    new Set(participants.map((member) => member.uid)).size !==
      participants.length ||
    !participants.some((member) => member.uid === callerUid) ||
    (!group &&
      (participants.length !== 2 ||
        !participants.some((member) => member.uid === calleeUid)))
  )
    throw new Error('RTC 呼叫响应无效');
  return {
    callId,
    deviceOwnership: readDeviceOwnership(data.deviceOwnership),
    roomId,
    callerUid,
    calleeUid,
    mediaMode,
    state,
    version,
    expiresAt: readOptionalTimestamp(data.expiresAt),
    endReason: typeof data.endReason === 'string' ? data.endReason : null,
    createdAt: data.createdAt,
    updatedAt: data.updatedAt,
    acceptedAt: readOptionalTimestamp(data.acceptedAt),
    connectedAt: readOptionalTimestamp(data.connectedAt),
    endedAt: readOptionalTimestamp(data.endedAt),
    durationSeconds,
    endedByUid,
    summaryMessageId,
    participants,
  };
};

/** 截止时间以服务端为准，旧响应缺省时最多等待创建时间起一分钟。 */
export const readRtcInvitationDeadline = (call: RtcCallView): number => {
  const created = Date.parse(call.createdAt);
  const expires = call.expiresAt === null ? NaN : Date.parse(call.expiresAt);
  if (Number.isFinite(expires)) return expires;
  return Number.isFinite(created) ? created + RTC_INVITATION_TIMEOUT_MS : 0;
};

/** 仅等待中的邀请需要到期确认，不给已接通的媒体会话设置时长上限。 */
export const hasRtcPendingInvitations = (call: RtcCallView): boolean => {
  switch (call.state) {
    case RtcCallState.RINGING:
      return true;
    case RtcCallState.ACCEPTED:
    case RtcCallState.CONNECTED:
      return call.participants.some(
        (participant) => participant.state === RtcParticipantState.INVITED,
      );
    default:
      return false;
  }
};

/** 群通话没有唯一被叫，包含只有一人或两人的群通话。 */
export const isRtcGroupCall = (call: RtcCallView | null): boolean =>
  call !== null && call.calleeUid === null;

/** 群操作提交本人版本，整通版本只用于快照排序；首次主动加入以 1 为初始版本。 */
export const rtcActionVersion = (call: RtcCallView, uid: string): number => {
  if (!isRtcGroupCall(call)) return call.version;
  const member = call.participants.find((item) => item.uid === uid);
  if (!member) return 1;
  if (member.version === undefined) throw new Error('群通话成员版本缺失');
  return member.version;
};

/** 解析 RTC 呼叫接口的统一响应。 */
export const parseRtcCallResponse = (value: unknown): RtcCallView => {
  const root = parseApiResult(value, 'RTC 呼叫');
  return readCall(root.data);
};

/** 群房间查询允许明确的空结果，不要求本人已经在通话名单中。 */
export const parseRtcGroupActiveResponse = (
  value: unknown,
  roomId: string,
): RtcCallView | null => {
  const root = parseApiResult(value, '群当前通话');
  if (root.data === null) return null;
  const call = readCall(root.data);
  if (
    call.roomId !== roomId ||
    !isRtcGroupCall(call) ||
    ![
      RtcCallState.RINGING,
      RtcCallState.ACCEPTED,
      RtcCallState.CONNECTED,
    ].includes(call.state)
  )
    throw new Error('群当前通话响应无效');
  return call;
};

/** 解析服务端按真实单聊类型筛选的恢复列表，并校验当前账号已接听。 */
export const parseRtcOngoingCallsResponse = (
  value: unknown,
  userId: string,
): RtcOngoingCall[] => {
  const root = parseApiResult(value, '未结束通话');
  if (!Array.isArray(root.data)) throw new Error('未结束通话响应无效');
  const ids = new Set<string>();
  return root.data.map((item: unknown): RtcOngoingCall => {
    const data = readRecord(item);
    const call = readCall(data?.call);
    if (
      typeof data?.peerName !== 'string' ||
      isRtcGroupCall(call) ||
      !data.peerName.trim() ||
      (call.state !== RtcCallState.ACCEPTED &&
        call.state !== RtcCallState.CONNECTED) ||
      call.participants.length !== 2 ||
      call.callerUid === call.calleeUid ||
      ![call.callerUid, call.calleeUid].includes(userId) ||
      new Set(call.participants.map((participant) => participant.uid)).size !==
        2 ||
      !call.participants.every((participant) =>
        [call.callerUid, call.calleeUid].includes(participant.uid),
      ) ||
      !call.participants.some(
        (participant) =>
          participant.uid === userId &&
          participant.state === RtcParticipantState.ACCEPTED,
      ) ||
      ids.has(call.callId)
    )
      throw new Error('未结束通话响应无效');
    ids.add(call.callId);
    return { call, peerName: data.peerName };
  });
};

/** 解析 LiveKit 房间加入凭证。 */
export const parseRtcJoinCredentialResponse = (
  value: unknown,
): RtcJoinCredential => {
  const root = parseApiResult(value, 'LiveKit Token');
  const data = readRecord(root.data);
  if (
    !data ||
    typeof data.serverUrl !== 'string' ||
    !/^wss?:\/\//.test(data.serverUrl) ||
    typeof data.roomName !== 'string' ||
    !data.roomName.trim() ||
    typeof data.token !== 'string' ||
    !data.token.trim() ||
    typeof data.expiresAt !== 'string' ||
    typeof data.videoAllowed !== 'boolean'
  )
    throw new Error('LiveKit Token 响应无效');
  return {
    serverUrl: data.serverUrl,
    roomName: data.roomName,
    token: data.token,
    expiresAt: data.expiresAt,
    videoAllowed: data.videoAllowed,
  };
};

/** 解析群视频席位接口的布尔响应。 */
export const parseRtcVideoEnabledResponse = (value: unknown): boolean => {
  const root = parseApiResult(value, '群视频席位');
  if (typeof root.data !== 'boolean') throw new Error('群视频席位响应无效');
  return root.data;
};

/** 读取后端定义的 RTC 事件枚举，拒绝未知名称、序号及非法类型。 */
const readRtcEventType = (value: unknown): RtcEventType | null => {
  switch (value) {
    case RtcEventType.RTC_CALL_ANSWERED_ELSEWHERE:
    case RtcEventType.RTC_CALL_CREATED:
    case RtcEventType.RTC_CALL_ACCEPTED:
    case RtcEventType.RTC_CALL_REJECTED:
    case RtcEventType.RTC_CALL_CANCELED:
    case RtcEventType.RTC_CALL_ENDED:
    case RtcEventType.RTC_CALL_EXPIRED:
    case RtcEventType.RTC_CALL_PARTICIPANT_ACCEPTED:
    case RtcEventType.RTC_CALL_PARTICIPANT_REJECTED:
    case RtcEventType.RTC_CALL_PARTICIPANT_LEFT:
    case RtcEventType.RTC_CALL_PARTICIPANTS_EXPIRED:
    case RtcEventType.RTC_MEDIA_UPDATED:
    case RtcEventType.RTC_CAMERA_UPDATED:
      return value;
    default:
      return null;
  }
};

/** 解析 RTC SSE 事件，拒绝未知事件类型、聊天正文或未知结构。 */
export const parseRtcEvent = (raw: ResourceSseMessage): RtcEvent | null => {
  if (raw.event !== 'rtc') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw.data);
  } catch {
    return null;
  }
  const data = readRecord(value);
  const eventId = data?.eventId;
  const eventType = readRtcEventType(data?.eventType);
  const callId = data?.callId;
  const roomId = readLong(data?.roomId);
  const fromUid = data?.fromUid == null ? null : readLong(data.fromUid);
  const toUid = readLong(data?.toUid);
  const callVersion = readSafeInteger(data?.callVersion, 1);
  const sentAt = readSafeInteger(data?.sentAt, 0);
  if (
    !data ||
    typeof eventId !== 'string' ||
    !eventId.trim() ||
    eventType === null ||
    typeof callId !== 'string' ||
    !callId.trim() ||
    !roomId ||
    (data.fromUid != null && !fromUid) ||
    !toUid ||
    callVersion === null ||
    sentAt === null
  )
    return null;
  return {
    eventId,
    eventType,
    callId,
    roomId,
    fromUid,
    toUid,
    callVersion,
    signalSeq: typeof data.signalSeq === 'string' ? data.signalSeq : null,
    sentAt,
    payload: readRecord(data.payload),
  };
};

/** 只有当前账号是被叫方时，RTC 创建事件才应自动打开来电窗口。 */
export const isRtcIncomingCallCreatedEvent = (
  event: RtcEvent,
  userId: string,
): boolean =>
  event.eventType === RtcEventType.RTC_CALL_CREATED &&
  event.toUid === userId &&
  event.fromUid !== null &&
  event.fromUid !== userId;
