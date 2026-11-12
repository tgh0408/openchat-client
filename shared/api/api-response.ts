import {
  createApiResponseError,
  getApiErrorMessage,
  SessionExpiredError,
} from './api-error';

/** 检查 HTTP 授权状态，不读取正文，兼容 JSON、空响应和流式响应。 */
export const assertApiSession = (
  response: Response,
  result?: unknown,
): void => {
  if (response.status === 401 || response.status === 403)
    throw new SessionExpiredError(
      getApiErrorMessage(result, '登录已过期，请重新登录'),
    );
};

/** 读取认证接口 JSON，业务字段由各接口的解析方法继续校验。 */
export const readApiResponse = async (
  response: Response,
  serviceName: string,
  httpError: string = `${serviceName}请求失败`,
  authenticated: boolean = true,
): Promise<unknown> => {
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    if (authenticated) assertApiSession(response);
    if (!response.ok)
      throw createApiResponseError(
        `${httpError}（${response.status}）`,
        'http',
        response.status,
      );
    throw createApiResponseError(`${serviceName}服务返回的数据无效`, 'invalid');
  }
  if (authenticated) assertApiSession(response, result);
  if (!response.ok)
    throw createApiResponseError(
      getApiErrorMessage(result, `${httpError}（${response.status}）`),
      'http',
      response.status,
    );
  return result;
};

/** 校验统一业务成功标志，具体 data 字段仍需由业务模块校验。 */
export const parseApiResult = (
  result: unknown,
  serviceName: string,
): Record<string, unknown> => {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw createApiResponseError(`${serviceName}服务返回的数据无效`, 'invalid');

  const data = result as Record<string, unknown>;
  if (
    typeof data.success !== 'boolean' ||
    typeof data.code !== 'number' ||
    !Number.isFinite(data.code)
  )
    throw createApiResponseError(
      getApiErrorMessage(data, `${serviceName}服务返回的数据无效`),
      'invalid',
    );
  if (data.success !== true || data.code !== 200)
    throw createApiResponseError(
      getApiErrorMessage(data, `${serviceName}失败，请重试`),
      'business',
      undefined,
      data.code,
      typeof data.errCode === 'number' ? data.errCode : undefined,
    );
  return data;
};

/** 解析后端统一响应，集中处理授权失效、HTTP 错误和业务失败。 */
export const parseApiResponse = async (
  response: Response,
  serviceName: string,
): Promise<Record<string, unknown>> =>
  parseApiResult(await readApiResponse(response, serviceName), serviceName);
