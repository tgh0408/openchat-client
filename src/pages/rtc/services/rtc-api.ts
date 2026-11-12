import type { ApiClient } from '../../../../shared/api/api-client';
import {
  parseRtcMediaResponse,
  parseRtcMediaSignal,
  type RtcMediaApi,
} from '../../../../shared/rtc/rtc-media';
import {
  parseRtcCallResponse,
  parseRtcJoinCredentialResponse,
  parseRtcVideoEnabledResponse,
  type RtcCallView,
  type RtcJoinCredential,
  type RtcMediaMode,
} from '../../../../shared/rtc/rtc';

export interface RtcApi {
  media?: RtcMediaApi;
  createCall: (
    roomId: string,
    mediaMode: RtcMediaMode,
    clientRequestId: string,
    participantUids?: string[],
  ) => Promise<RtcCallView>;
  getCall: (callId: string) => Promise<RtcCallView>;
  issueToken: (callId: string) => Promise<RtcJoinCredential>;
  acceptCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rejectCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  cancelCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  expireCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  hangupCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  leaveCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  setVideoEnabled: (callId: string, enabled: boolean) => Promise<boolean>;
}

const createRequestId = (): string =>
  globalThis.crypto.randomUUID().replace(/-/g, '');

/** 创建 RTC HTTP API，统一复用当前页面的授权与 Clientid。 */
export const createRtcApi = (api: ApiClient): RtcApi => {
  const action = async (
    callId: string,
    path: 'accept' | 'reject' | 'cancel' | 'expire' | 'hangup' | 'leave',
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    api.request({
      path: `/capi/rtc/calls/${encodeURIComponent(callId)}/${path}`,
      method: 'POST',
      body: { clientRequestId, expectedVersion },
      serviceName: 'RTC 呼叫',
      parse: parseRtcCallResponse,
    });

  return {
    media: {
      get: (callId) =>
        api.request({
          path: `/capi/rtc/calls/${encodeURIComponent(callId)}/media`,
          method: 'GET',
          serviceName: 'RTC 媒体协商',
          parse: parseRtcMediaResponse,
        }),
      signal: (callId, signal) =>
        api.request({
          path: `/capi/rtc/calls/${encodeURIComponent(callId)}/media`,
          method: 'POST',
          body: { ...parseRtcMediaSignal(signal) },
          serviceName: 'RTC 媒体协商',
          parse: parseRtcMediaResponse,
        }),
    },
    createCall: (
      roomId: string,
      mediaMode: RtcMediaMode,
      clientRequestId: string,
      participantUids?: string[],
    ): Promise<RtcCallView> =>
      api.request({
        path: '/capi/rtc/calls',
        method: 'POST',
        body: { roomId, mediaMode, clientRequestId, participantUids },
        serviceName: 'RTC 呼叫',
        parse: parseRtcCallResponse,
      }),
    getCall: (callId: string): Promise<RtcCallView> =>
      api.request({
        path: `/capi/rtc/calls/${encodeURIComponent(callId)}`,
        method: 'GET',
        serviceName: 'RTC 呼叫',
        parse: parseRtcCallResponse,
      }),
    issueToken: (callId: string): Promise<RtcJoinCredential> =>
      api.request({
        path: `/capi/rtc/calls/${encodeURIComponent(callId)}/token`,
        method: 'POST',
        serviceName: 'LiveKit Token',
        parse: parseRtcJoinCredentialResponse,
      }),
    acceptCall: (
      callId,
      clientRequestId,
      expectedVersion,
    ): Promise<RtcCallView> =>
      action(callId, 'accept', clientRequestId, expectedVersion),
    rejectCall: (
      callId,
      clientRequestId,
      expectedVersion,
    ): Promise<RtcCallView> =>
      action(callId, 'reject', clientRequestId, expectedVersion),
    cancelCall: (
      callId,
      clientRequestId,
      expectedVersion,
    ): Promise<RtcCallView> =>
      action(callId, 'cancel', clientRequestId, expectedVersion),
    expireCall: (
      callId,
      clientRequestId,
      expectedVersion,
    ): Promise<RtcCallView> =>
      action(callId, 'expire', clientRequestId, expectedVersion),
    hangupCall: (
      callId,
      clientRequestId,
      expectedVersion,
    ): Promise<RtcCallView> =>
      action(callId, 'hangup', clientRequestId, expectedVersion),
    leaveCall: (
      callId,
      clientRequestId,
      expectedVersion,
    ): Promise<RtcCallView> =>
      action(callId, 'leave', clientRequestId, expectedVersion),
    setVideoEnabled: (callId, enabled): Promise<boolean> =>
      api.request({
        path: `/capi/rtc/calls/${encodeURIComponent(callId)}/video`,
        method: 'POST',
        body: { enabled },
        serviceName: '群视频席位',
        parse: parseRtcVideoEnabledResponse,
      }),
  };
};

/** 生成浏览器端的幂等请求标识。 */
export const newRtcRequestId = (): string => createRequestId();
