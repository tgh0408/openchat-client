import { SessionExpiredError } from './api-error';
import type { AuthSession } from '../auth/auth';
import { createAuthRequestHeaders, parseAuthBase } from './api-request';
import { createDeviceRequestHeaders } from '../auth/device-identity';
import { parseApiResult, readApiResponse } from './api-response';

/** 请求本身超时，与业务拒绝、HTTP 错误及未知网络异常分开。 */
export class ApiRequestTimeoutError extends Error {}

/** 只识别明确的超时信号，不根据展示文案推测失败原因。 */
const isRequestTimeout = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false;
  if (error.name === 'TimeoutError') return true;
  const code = 'code' in error ? error.code : undefined;
  switch (code) {
    case 'ETIMEDOUT':
    case 'UND_ERR_CONNECT_TIMEOUT':
    case 'UND_ERR_HEADERS_TIMEOUT':
    case 'UND_ERR_BODY_TIMEOUT':
      return true;
    default: {
      const cause = 'cause' in error ? error.cause : undefined;
      return cause instanceof Error && cause !== error
        ? isRequestTimeout(cause)
        : false;
    }
  }
};

/** 普通业务接口参数；表单由 fetch 设置 boundary，不手写 Content-Type。 */
export interface ApiRequestOptions {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown> | FormData;
  serviceName: string;
  networkError?: string;
  httpError?: string | ((status: number) => string);
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 请求环境由可信调用方提供，不向页面开放令牌或通用请求能力。 */
export interface ApiRequestContext {
  base: string | undefined;
  session?: AuthSession;
  clientId?: string;
  requestRemote?: typeof fetch;
  validateCurrent?: () => void;
  onResponseStart?: (response: Response) => void;
  onResponseComplete?: (response: Response) => void;
  onResponseError?: (response: Response, error: unknown) => void;
}

/** 普通后端 JSON 请求的唯一传输入口；不自动重试，不处理 SSE 或 OSS 字节流。 */
export const requestApi = async <T>(
  context: ApiRequestContext,
  options: ApiRequestOptions & { parse: (value: unknown) => T },
): Promise<T> => {
  const { session, validateCurrent } = context;
  validateCurrent?.();
  options.signal?.throwIfAborted();
  const base = parseAuthBase(context.base);
  if (
    !options.path.startsWith('/capi/') ||
    /[\\#\u0000-\u0020]/.test(options.path)
  )
    throw new Error('业务接口路径无效');
  const url = new URL(`${base}${options.path}`);
  const baseUrl = new URL(base);
  // 拒绝外站及路径穿越，防止业务凭据被带到非业务接口。
  if (
    url.origin !== baseUrl.origin ||
    !url.pathname.startsWith(`${baseUrl.pathname.replace(/\/$/, '')}/capi/`)
  )
    throw new Error('业务接口路径无效');
  const form = options.body instanceof FormData;
  const contentType =
    options.body !== undefined && !form ? 'application/json' : undefined;
  const headers = session
    ? createAuthRequestHeaders(session, {
        clientId: context.clientId,
        contentType,
      })
    : {
        ...createDeviceRequestHeaders(),
        ...(contentType ? { 'Content-Type': contentType } : {}),
      };
  let body: BodyInit | undefined;
  if (options.body instanceof FormData) body = options.body;
  else if (options.body !== undefined) body = JSON.stringify(options.body);
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 10000);
  const signal = AbortSignal.any([
    timeout,
    ...(options.signal ? [options.signal] : []),
  ]);
  let response: Response | undefined;
  try {
    try {
      response = await (context.requestRemote ?? fetch)(url.href, {
        method: options.method,
        headers,
        body,
        signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
    } catch (error) {
      validateCurrent?.();
      options.signal?.throwIfAborted();
      if (timeout.aborted || isRequestTimeout(error))
        throw new ApiRequestTimeoutError(
          options.networkError ?? `${options.serviceName}请求超时，请稍后重试`,
        );
      throw new Error(
        options.networkError ??
          `无法连接${options.serviceName}服务或请求超时，请稍后重试`,
      );
    }
    validateCurrent?.();
    context.onResponseStart?.(response);
    const httpError =
      typeof options.httpError === 'function'
        ? options.httpError(response.status)
        : options.httpError;
    const result = await readApiResponse(
      response,
      options.serviceName,
      httpError,
      session !== undefined,
    );
    validateCurrent?.();
    signal.throwIfAborted();
    const parsed = options.parse(parseApiResult(result, options.serviceName));
    validateCurrent?.();
    context.onResponseComplete?.(response);
    return parsed;
  } catch (error) {
    // 旧账号和主动取消优先，不向新页面交付旧请求的授权错误。
    try {
      validateCurrent?.();
      options.signal?.throwIfAborted();
      if (timeout.aborted)
        error = new ApiRequestTimeoutError(
          options.networkError ?? `${options.serviceName}请求超时，请稍后重试`,
        );
    } catch (currentError) {
      error = currentError;
    }
    if (response) context.onResponseError?.(response, error);
    throw error;
  }
};

/** 注入运行环境的可信会话来源，不在共享层依赖 Electron 或页面状态。 */
export interface ApiClientSource extends Omit<
  ApiRequestContext,
  'session' | 'validateCurrent'
> {
  clientId: string;
  getSession: () => AuthSession | null;
}

/** 一次操作绑定的请求入口；分页及重试必须复用该对象。 */
export interface ApiClient {
  readonly userId: string;
  validateCurrent: () => void;
  request: <T>(
    options: ApiRequestOptions & { parse: (value: unknown) => T },
  ) => Promise<T>;
}

/** 配置会话来源；每次调用返回的工厂才捕获会话，不在每页请求时更换令牌。 */
export const createApiClientFactory = (
  source: ApiClientSource,
): ((validateOperation?: () => void) => ApiClient) => {
  const { base, clientId, getSession } = source;
  /** 在操作开始时绑定授权，并保留页面、窗口及请求次序的额外校验。 */
  return (validateOperation?: () => void): ApiClient => {
    const session = getSession();
    if (!session) throw new SessionExpiredError('请先登录');
    const snapshot = { ...session, user: { ...session.user } };
    let invalidated = false;
    /** 会话一旦变化永久废弃该操作，旧响应也不能触发新账号的失效处理。 */
    const validateCurrent = (): void => {
      if (invalidated) throw new Error('请求所属页面或账号已失效，请重试');
      try {
        if (
          getSession() !== session ||
          session.accessToken !== snapshot.accessToken ||
          session.user.id !== snapshot.user.id ||
          session.expiresAt !== snapshot.expiresAt
        )
          throw new Error('账号已切换，请重试');
        if (
          !snapshot.accessToken.trim() ||
          (snapshot.expiresAt !== null &&
            snapshot.expiresAt * 1000 <= Date.now())
        )
          throw new SessionExpiredError('登录状态已失效，请重新登录');
        validateOperation?.();
      } catch (error) {
        invalidated = true;
        throw error;
      }
    };
    validateCurrent();
    parseAuthBase(base);

    /** 绑定原授权并委托公共传输层，分页不会重新捕获其他账号令牌。 */
    const request = async <T>(
      options: ApiRequestOptions & { parse: (value: unknown) => T },
    ): Promise<T> =>
      requestApi(
        { ...source, base, clientId, session: snapshot, validateCurrent },
        options,
      );
    return {
      userId: snapshot.user.id,
      validateCurrent,
      request,
    };
  };
};
