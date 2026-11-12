import { parseApiResult } from '../api/api-response';

export interface RtcMediaSignal {
  kind: 'OFFER' | 'ANSWER' | 'FALLBACK' | 'CAMERA';
  clientRequestId: string;
  offerId?: string;
  sdp?: string;
  enabled?: boolean;
  expectedCameraVersion?: number;
}

export interface RtcCameraState {
  enabled: boolean;
  version: number;
}

export interface RtcMediaView {
  callId: string;
  transport: 'P2P' | 'SFU';
  version: number;
  offerId: string | null;
  offerSdp: string | null;
  answerSdp: string | null;
  stunUrls: string[];
  cameraStates: Record<string, RtcCameraState>;
}

export interface RtcMediaApi {
  get: (callId: string) => Promise<RtcMediaView>;
  signal: (callId: string, signal: RtcMediaSignal) => Promise<RtcMediaView>;
}

/** 读取有界的媒体信令对象，不接受原型或数组作为协议数据。 */
const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('媒体协商数据无效');
  return value as Record<string, unknown>;
};

/** 校验协商标识，不使用数值转换处理通话 ID。 */
const identifier = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    throw new Error('媒体协商标识无效');
  return value;
};

/** SDP 只允许有界字符串，详细语义由原生 WebRTC 引擎校验。 */
const sdp = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 60_000 ||
    !value.startsWith('v=0\r\n') ||
    !value.includes('\r\nm=audio ') ||
    value.includes('\0')
  )
    throw new Error('媒体描述无效');
  return value;
};

/** IPC 和 HTTP 共用同一信令白名单，忽略调用方提供的身份及额外字段。 */
export const parseRtcMediaSignal = (value: unknown): RtcMediaSignal => {
  const data = record(value);
  const clientRequestId = identifier(data.clientRequestId);
  switch (data.kind) {
    case 'CAMERA': {
      const version = data.expectedCameraVersion;
      if (
        typeof data.enabled !== 'boolean' ||
        typeof version !== 'number' ||
        !Number.isSafeInteger(version) ||
        version < 0 ||
        version >= Number.MAX_SAFE_INTEGER
      )
        throw new Error('摄像头状态参数无效');
      return {
        kind: data.kind,
        clientRequestId,
        enabled: data.enabled,
        expectedCameraVersion: version,
      };
    }
    case 'FALLBACK':
      return { kind: data.kind, clientRequestId };
    case 'OFFER':
      return { kind: data.kind, clientRequestId, sdp: sdp(data.sdp) };
    case 'ANSWER':
      return {
        kind: data.kind,
        clientRequestId,
        offerId: identifier(data.offerId),
        sdp: sdp(data.sdp),
      };
    default:
      throw new Error('媒体信令类型无效');
  }
};

/** HTTP 与 SSE 共用摄像头状态校验，保留独立的成员版本。 */
export const parseRtcCameraState = (value: unknown): RtcCameraState => {
  const data = record(value);
  if (
    typeof data.enabled !== 'boolean' ||
    (typeof data.version !== 'number' &&
      !(typeof data.version === 'string' && /^[1-9]\d*$/.test(data.version)))
  )
    throw new Error('摄像头状态无效');
  const version = Number(data.version);
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('摄像头状态版本无效');
  return { enabled: data.enabled, version };
};

/** 校验当前呼叫的服务端权威快照；直连阶段不接受 TURN 中继配置。 */
export const parseRtcMediaResponse = (value: unknown): RtcMediaView => {
  const root = parseApiResult(value, '媒体协商');
  const data = record(root.data);
  const version = Number(data.version);
  if (
    !Number.isSafeInteger(version) ||
    version < 1 ||
    (data.transport !== 'P2P' && data.transport !== 'SFU') ||
    !Array.isArray(data.stunUrls) ||
    data.stunUrls.length > 4 ||
    !data.stunUrls.every(
      (url: unknown): url is string =>
        typeof url === 'string' && /^stuns?:[^\s/@?#]{1,240}$/.test(url),
    )
  )
    throw new Error('媒体协商响应无效');
  const offerId = data.offerId === null ? null : identifier(data.offerId);
  const offerSdp = data.offerSdp === null ? null : sdp(data.offerSdp);
  const answerSdp = data.answerSdp === null ? null : sdp(data.answerSdp);
  if (
    (offerId === null) !== (offerSdp === null) ||
    (answerSdp !== null && offerSdp === null) ||
    (data.transport === 'SFU' && (offerSdp !== null || answerSdp !== null))
  )
    throw new Error('媒体协商快照不一致');
  const cameraStates: Record<string, RtcCameraState> = {};
  for (const [uid, state] of Object.entries(record(data.cameraStates))) {
    if (!/^[1-9]\d{0,63}$/.test(uid)) throw new Error('摄像头成员无效');
    cameraStates[uid] = parseRtcCameraState(state);
  }
  return {
    callId: identifier(data.callId),
    transport: data.transport,
    version,
    offerId,
    offerSdp,
    answerSdp,
    stunUrls: data.stunUrls as string[],
    cameraStates,
  };
};
