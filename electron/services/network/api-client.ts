import { createApiClientFactory } from '../../../shared/api/api-client';
import { requireAuthenticatedSession } from '../auth/auth';
import { getClientId } from '../auth/client-identity';
import {
  completeLoggedResponse,
  deferLoggedResponse,
} from '../logging/request-logging';

/** 主进程操作统一从已验证授权中绑定会话，不接受页面传入令牌。 */
export const createAuthenticatedApiClient = createApiClientFactory({
  base: import.meta.env.VITE_AUTH_API_BASE?.trim(),
  clientId: getClientId(),
  getSession: requireAuthenticatedSession,
  onResponseStart: deferLoggedResponse,
  onResponseComplete: (response) => {
    completeLoggedResponse(response);
  },
  onResponseError: (response, error) => {
    completeLoggedResponse(response, 'error', error);
  },
});
