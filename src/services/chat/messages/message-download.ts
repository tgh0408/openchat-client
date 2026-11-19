import { getAuthApiBase } from '../../../../shared/runtime/server-settings';
import { createApiClientFactory } from '../../../../shared/api/api-client';
import { PLATFORM_CLIENT_IDS } from '../../../../shared/auth/client-identity';
import {
  parseMessageDownloadResponse,
  type MessageDownloadAuthorization,
} from '../../../../shared/chat/messages/message-download';
import { getCurrentBrowserSession } from '../../auth/auth';

const createBrowserApiClient = createApiClientFactory({
  base: getAuthApiBase,
  clientId: PLATFORM_CLIENT_IDS.WEB,
  getSession: getCurrentBrowserSession,
});

/** 浏览器预览按消息 ID申请短期 OSS 下载签名，不把业务 JWT发送给 OSS。 */
export const requestBrowserMessageDownload = async (
  messageId: string,
  roomId: string,
): Promise<MessageDownloadAuthorization> => {
  const api = createBrowserApiClient();
  return api.request({
    path: '/capi/chat/msg/download/url',
    method: 'POST',
    body: { msgId: messageId, roomId },
    serviceName: '资源下载授权',
    parse: (value: unknown): MessageDownloadAuthorization =>
      parseMessageDownloadResponse(value, messageId),
  });
};
