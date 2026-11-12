import type { AuthSession } from '../auth/auth';
import { CLIENT_ID_HEADER } from '../auth/client-identity';
import { createDeviceRequestHeaders } from '../auth/device-identity';

/** 只允许 HTTPS 或回环 HTTP 认证服务，不接受带凭据和查询参数的地址。 */
export const parseAuthBase = (value: string | undefined): string => {
  if (!value?.trim()) throw new Error('尚未配置登录服务，请联系管理员');
  const url = new URL(value.trim());
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('登录服务地址配置无效');
  return url.href.replace(/\/$/, '');
};

/** 可选平台值只用于核对调用方，所有请求均携带初始化时固定的平台头。 */
export interface AuthRequestHeaderOptions {
  clientId?: string;
  contentType?: string;
}

/** 创建后端认证请求头，统一设备绑定、Bearer、clientId 和内容类型。 */
export const createAuthRequestHeaders = (
  session: AuthSession,
  options: AuthRequestHeaderOptions = {},
): Record<string, string> => {
  const headers = createDeviceRequestHeaders();
  if (
    options.clientId !== undefined &&
    options.clientId !== headers[CLIENT_ID_HEADER]
  )
    throw new Error('请求平台标识与当前客户端不一致');
  return {
    ...headers,
    Authorization: `Bearer ${session.accessToken}`,
    ...(options.contentType !== undefined
      ? { 'Content-Type': options.contentType }
      : {}),
  };
};
