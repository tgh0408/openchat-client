import { requestApi } from '../api/api-client';
import { parseApiResult } from '../api/api-response';
import type { AuthSession } from '../auth/auth';
import { parseRtcServerUrl } from '../runtime/server-settings';
import { SessionExpiredError } from '../api/api-error';

/** 媒体配置可选；失败清空地址但不阻止登录，明确失效和主动取消仍交由认证流程处理。 */
export const requestRtcServerUrl = async (
  base: string | undefined,
  session: AuthSession,
  signal?: AbortSignal,
): Promise<string> => {
  try {
    return await requestApi(
      { base, session },
      {
        path: '/capi/rtc/config',
        method: 'GET',
        signal,
        timeoutMs: 3000,
        serviceName: 'LiveKit 配置',
        parse: (value: unknown): string => {
          const { data } = parseApiResult(value, 'LiveKit 配置');
          if (!data || typeof data !== 'object' || !('serverUrl' in data))
            throw new Error('LiveKit 配置响应无效');
          if (data.serverUrl === '') return '';
          return parseRtcServerUrl(data.serverUrl);
        },
      },
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof SessionExpiredError) throw error;
    return '';
  }
};
