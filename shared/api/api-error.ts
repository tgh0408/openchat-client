/** 仅明确的授权失效使用此错误，网络故障不能据此清除 JWT。 */
export class SessionExpiredError extends Error {}

/** 保留失败类型供认证恢复判断，不通过错误文案推测是否应清除令牌。 */
export class ApiResponseError extends Error {
  kind: 'http' | 'business' | 'invalid' = 'invalid';
  status?: number;
  code?: number;
  errCode?: number;
}

/** 创建不携带响应正文或凭据的结构化请求异常。 */
export const createApiResponseError = (
  message: string,
  kind: ApiResponseError['kind'],
  status?: number,
  code?: number,
  errCode?: number,
): ApiResponseError =>
  Object.assign(new ApiResponseError(message), { kind, status, code, errCode });

/** 提取跨窗口错误文本，只移除 Electron 的调用包装，不改写业务内容。 */
export const getRequestErrorMessage = (
  cause: unknown,
  fallback: string,
): string => {
  if (!cause || typeof cause !== 'object' || !('message' in cause))
    return fallback;
  if (typeof cause.message !== 'string') return fallback;
  const message = cause.message.replace(
    /^Error invoking remote method '[^']+': (?:Error: )?/,
    '',
  );
  return message.trim() ? message : fallback;
};
/** 读取后端错误原文，缺失或空白时才使用本地提示。 */
export const getApiErrorMessage = (
  value: unknown,
  fallback: string,
): string => {
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'errMsg' in value &&
    typeof value.errMsg === 'string' &&
    value.errMsg.trim()
  )
    return value.errMsg;
  return fallback;
};
