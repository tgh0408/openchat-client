import {
  readRtcCallState,
  readRtcMediaMode,
  RtcCallState,
  type RtcMediaMode,
} from '../../rtc/rtc';

/** RTC 通话摘要允许展示的终态。 */
export type RtcCallTerminalState =
  | RtcCallState.REJECTED
  | RtcCallState.CANCELED
  | RtcCallState.ENDED
  | RtcCallState.EXPIRED;

/** 已落库的 RTC 通话摘要快照。 */
export interface RtcCallMessage {
  callId: string;
  mediaMode: RtcMediaMode;
  state: RtcCallTerminalState;
  endReason: string | null;
  endedByUid: string | null;
  acceptedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
}

/** 从后端 Long 字段读取无精度损失的正整数。 */
const readPositiveLong = (value: unknown): string | null => {
  switch (typeof value) {
    case 'string':
      return /^[1-9]\d{0,63}$/.test(value) ? value : null;
    case 'number':
      return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
    default:
      return null;
  }
};

/** 读取并规范化后端日期字段。 */
const readTimestamp = (value: unknown): string | null => {
  if (value == null) return null;
  let date: Date;
  switch (typeof value) {
    case 'number':
      date = new Date(value);
      break;
    case 'string':
      date = new Date(value);
      break;
    default:
      return null;
  }
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

/** 读取非负通话秒数，兼容 Java Long 字符串序列化。 */
const readDurationSeconds = (value: unknown): number | null => {
  if (typeof value === 'string' && /^[0-9]\d{0,8}$/.test(value))
    return Number(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0)
    return value;
  return null;
};

/** 读取可选结束原因。 */
const readEndReason = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'string' && value.length <= 128 && !value.includes('\0'))
    return value;
  throw new Error('RTC 通话结束原因无效');
};

/** 摘要只接受终态枚举，不将未结束呼叫展示为通话记录。 */
const readTerminalState = (value: unknown): RtcCallTerminalState | null => {
  const state = readRtcCallState(value);
  switch (state) {
    case RtcCallState.REJECTED:
    case RtcCallState.CANCELED:
    case RtcCallState.ENDED:
    case RtcCallState.EXPIRED:
      return state;
    default:
      return null;
  }
};

/** 严格解析 RTC 消息 JSON，协议名称和数字统一转为枚举。 */
export const parseRtcCallMessage = (content: string): RtcCallMessage => {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    throw new Error('RTC 通话消息内容无效');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('RTC 通话消息内容无效');
  const data = value as Record<string, unknown>;
  const callId =
    typeof data.callId === 'string' &&
    data.callId.length > 0 &&
    data.callId.length <= 128 &&
    !data.callId.includes('\0')
      ? data.callId
      : null;
  const mediaMode = readRtcMediaMode(data.mediaMode);
  const state = readTerminalState(data.state);
  const durationSeconds = readDurationSeconds(data.durationSeconds);
  const endedByUid =
    data.endedByUid == null ? null : readPositiveLong(data.endedByUid);
  const acceptedAt = readTimestamp(data.acceptedAt);
  const endedAt = readTimestamp(data.endedAt);
  const endReason = readEndReason(data.endReason);
  if (
    !callId ||
    mediaMode === null ||
    state === null ||
    durationSeconds === null
  )
    throw new Error('RTC 通话消息内容无效');
  if (data.endedByUid != null && !endedByUid)
    throw new Error('RTC 通话结束用户无效');
  return {
    callId,
    mediaMode,
    state,
    endReason,
    endedByUid,
    acceptedAt,
    endedAt,
    durationSeconds,
  };
};

/** 从资源消息 body.extra 转换为本地 SQLite 使用的 JSON 快照。 */
export const encodeReceivedRtcCall = (
  body: Record<string, unknown>,
): string => {
  const extra = body.extra;
  if (!extra || typeof extra !== 'object' || Array.isArray(extra))
    throw new Error('RTC 通话消息缺少摘要');
  return JSON.stringify(parseRtcCallMessage(JSON.stringify(extra)));
};

/** 将秒数显示为固定两位的分钟和秒。 */
export const formatRtcCallDuration = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
};
