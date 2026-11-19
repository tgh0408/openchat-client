import {
  formatLogPayload,
  markLoggedError,
  safeFailureLogUrl,
  safeLogUrl,
  serializeLogPayload,
} from './log-sanitize';

/** 请求日志入口：直接复用 electron-log 的 info/error 方法。 */
export interface RequestLogSink {
  info: (message: string, payload: string) => void;
  error: (message: string, payload: string) => void;
}

interface PendingResponse {
  finish: (error?: unknown) => void;
  defer: boolean;
  reading: boolean;
}

// 状态直接绑定原始 Response，避免启动入口与业务入口的 WeakMap 上下文不一致。
const pendingResponseKey = Symbol.for('openchat.pending-http-response');
type ResponseWithPending = Response & {
  [key: symbol]: PendingResponse | undefined;
};

/** 读取同一响应对象上的待完成请求状态，兼容独立 bundle。 */
const getPendingResponse = (response: Response): PendingResponse | undefined =>
  (response as ResponseWithPending)[pendingResponseKey];

/** 业务层读取并校验正文期间，延迟生成最终请求记录。 */
export const deferLoggedResponse = (response: Response): void => {
  const pending = getPendingResponse(response);
  if (pending) pending.defer = true;
};

/** 将业务解析异常合并进同一次请求的最终记录。 */
export const completeLoggedResponse = (
  response: Response,
  _level?: 'error',
  error?: unknown,
): void => {
  getPendingResponse(response)?.finish(error);
};

/** 用户主动取消不作为网络故障，超时仍必须记录。 */
export const isIntentionalAbort = (
  signal: AbortSignal | null | undefined,
): boolean =>
  signal?.aborted === true &&
  signal.reason instanceof Error &&
  signal.reason.name === 'AbortError';

/** 状态码只接受有界数字或标识，不记录任意服务端字符串和正文。 */
const safeCode = (value: unknown): string | number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^[\w.-]{1,64}$/.test(value)) return value;
  return null;
};

/** 将请求体转换为可审计文本；表单、文件和流只记录类型及大小。 */
const serializeRequestBody = (value: unknown): string => {
  if (value === undefined || value === null) return '[none]';
  if (typeof value === 'string') {
    try {
      return serializeLogPayload(JSON.parse(value));
    } catch {
      return serializeLogPayload(value);
    }
  }
  if (value instanceof URLSearchParams)
    return serializeLogPayload(Object.fromEntries(value.entries()));
  if (typeof FormData !== 'undefined' && value instanceof FormData)
    return '[multipart/form-data]';
  if (typeof Blob !== 'undefined' && value instanceof Blob)
    return `[blob type=${value.type || 'application/octet-stream'} size=${value.size}]`;
  if (value instanceof ArrayBuffer) return `[binary ${value.byteLength} bytes]`;
  if (ArrayBuffer.isView(value)) return `[binary ${value.byteLength} bytes]`;
  return '[stream body]';
};

/** 观察主进程 fetch 及调用方原有 JSON 读取，不克隆响应或提前消费 SSE/附件流。 */
const readFailureResponsePreview = async (
  response: Response,
): Promise<string | undefined> => {
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ??
    '';
  const textual =
    contentType === '' ||
    contentType.startsWith('text/') ||
    contentType === 'application/json' ||
    contentType === 'application/problem+json' ||
    contentType === 'application/xml';
  if (!textual) return '[binary response omitted]';
  let clone: Response;
  try {
    clone = response.clone();
  } catch {
    return undefined;
  }
  if (!clone.body) return '';
  const reader = clone.body.getReader();
  const chunks: Uint8Array[] = [];
  const limit = 65536;
  let length = 0;
  let truncated = false;
  try {
    while (length < limit) {
      const result = await reader.read();
      if (result.done) break;
      const remaining = limit - length;
      if (result.value.byteLength > remaining) {
        chunks.push(result.value.subarray(0, remaining));
        length += remaining;
        truncated = true;
        break;
      }
      chunks.push(result.value);
      length += result.value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(bytes);
  return truncated ? `${text}...[truncated]` : text;
};

export const createLoggedFetch = (
  fetcher: typeof fetch,
  report: RequestLogSink,
): typeof fetch => {
  let sequence = 0;
  return async (input, init): Promise<Response> => {
    const request = input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input);
    const signal = init?.signal ?? request?.signal;
    const started = Date.now();
    const context = {
      requestId: `${process.pid}-${++sequence}`,
      method: init?.method ?? request?.method ?? 'GET',
      endpoint: safeLogUrl(url),
      requestBody: serializeRequestBody(init?.body),
    };
    let response: Response;
    try {
      response = await fetcher(input, init);
    } catch (error) {
      if (!isIntentionalAbort(signal)) {
        markLoggedError(error);
        report.error(
          'http.request',
          formatLogPayload(
            {
              ...context,
              failureEndpoint: safeFailureLogUrl(url),
              durationMs: Date.now() - started,
            },
            error,
          ),
        );
      }
      throw error;
    }
    let finished = false;
    let responseBody: string | undefined;
    let businessFailure = false;
    let code: string | number | null = null;
    let errCode: string | number | null = null;
    let failurePreviewDone = response.ok;
    let finishRequested = false;
    let requestedError: unknown;
    const pending: PendingResponse = {
      defer: false,
      reading: false,
      finish: (error?: unknown): void => {
        if (finished) return;
        if (!failurePreviewDone) {
          finishRequested = true;
          if (error !== undefined) requestedError = error;
          return;
        }
        finished = true;
        delete (response as ResponseWithPending)[pendingResponseKey];
        const finalError = error ?? requestedError;
        if (finalError !== undefined) markLoggedError(finalError);
        const failed =
          !response.ok || businessFailure || finalError !== undefined;
        const payload = formatLogPayload(
          {
            ...context,
            status: response.status,
            contentType: response.headers.get('content-type') ?? '',
            durationMs: Date.now() - started,
            ...(failed
              ? {
                  failureEndpoint: safeFailureLogUrl(url),
                  responseBody: responseBody ?? '[not-read]',
                }
              : {}),
            ...(businessFailure ? { code, errCode } : {}),
          },
          finalError,
        );
        if (failed) report.error('http.request', payload);
        else report.info('http.request', payload);
      },
    };
    (response as ResponseWithPending)[pendingResponseKey] = pending;
    // 未读取正文的流式和附件响应只记录元信息，不主动克隆或消费响应。
    if (!response.ok) {
      void readFailureResponsePreview(response)
        .then((preview) => {
          if (preview !== undefined)
            responseBody = serializeLogPayload(preview);
        })
        .catch(() => undefined)
        .finally(() => {
          failurePreviewDone = true;
          if (finishRequested || (!pending.defer && !pending.reading))
            pending.finish(requestedError);
        });
    } else {
      setTimeout(() => {
        if (!pending.defer && !pending.reading) pending.finish();
      }, 0);
    }

    const readJson = response.json.bind(response);
    /** 沿用原响应读取次数和异常，只记录失败分类及业务码。 */
    response.json = async (): Promise<unknown> => {
      pending.reading = true;
      let value: unknown;
      try {
        value = await readJson();
      } catch (error) {
        if (!isIntentionalAbort(signal) && !pending.defer)
          pending.finish(error);
        throw error;
      }
      responseBody = serializeLogPayload(value);
      if (value !== null && typeof value === 'object') {
        const result = value as Record<string, unknown>;
        if (
          'success' in result &&
          (result.success !== true || result.code !== 200)
        ) {
          businessFailure = true;
          code = safeCode(result.code);
          errCode = safeCode(result.errCode);
        }
      }
      if (!pending.defer) pending.finish();
      return value;
    };
    const readText = response.text.bind(response);
    response.text = async (): Promise<string> => {
      pending.reading = true;
      let value: string;
      try {
        value = await readText();
      } catch (error) {
        if (!isIntentionalAbort(signal) && !pending.defer)
          pending.finish(error);
        throw error;
      }
      responseBody = serializeLogPayload(value);
      if (!pending.defer) pending.finish();
      return value;
    };
    const readArrayBuffer = response.arrayBuffer.bind(response);
    response.arrayBuffer = async (): Promise<ArrayBuffer> => {
      pending.reading = true;
      try {
        const value = await readArrayBuffer();
        responseBody = `[binary ${value.byteLength} bytes]`;
        if (!pending.defer) pending.finish();
        return value;
      } catch (error) {
        if (!isIntentionalAbort(signal) && !pending.defer)
          pending.finish(error);
        throw error;
      }
    };
    return response;
  };
};
