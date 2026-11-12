import type { ApiClient } from '../../../shared/api/api-client';
import {
  parseRtcCallResponse,
  type RtcCallView,
  type RtcMediaMode,
} from '../../../shared/rtc/rtc';

interface RtcDialRequest {
  roomId: string;
  mediaMode: RtcMediaMode;
  clientRequestId: string;
  participantUids?: string[];
  replaceCallIds: string[];
}

interface RtcDialOptions {
  api: ApiClient;
  request: RtcDialRequest;
  validate: () => void;
  windowCallIds: string[];
  closeWindows: (callIds: string[]) => void;
}

/** 校验渲染层明确确认的旧通话范围，不接受无界或重复的标识。 */
export const parseRtcReplaceCallIds = (value: unknown): string[] => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new Error('待结束通话列表无效');
  const ids = value.map((item: unknown): string => {
    if (typeof item !== 'string' || !item.trim() || item.length > 128)
      throw new Error('待结束通话标识无效');
    return item.trim();
  });
  if (new Set(ids).size !== ids.length) throw new Error('待结束通话列表重复');
  return ids;
};

/** 提交已确认的呼出，服务端原子替换成功后才释放旧窗口。 */
export const dialRtcCall = async (
  options: RtcDialOptions,
): Promise<RtcCallView> => {
  options.validate();
  const call = await options.api.request({
    path: '/capi/rtc/calls',
    method: 'POST',
    body: { ...options.request },
    serviceName: 'RTC 呼叫',
    parse: parseRtcCallResponse,
  });
  options.validate();
  // 服务端确认新建成功后回收旧窗口，不等待可能丢失的终态 SSE。
  options.closeWindows(
    [
      ...new Set([...options.windowCallIds, ...options.request.replaceCallIds]),
    ].filter((callId) => callId !== call.callId),
  );
  return call;
};
