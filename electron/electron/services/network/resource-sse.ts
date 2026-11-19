import { getAuthApiBase } from '../../../shared/runtime/server-settings';
import { parseAuthBase, SessionExpiredError } from '../../../shared/auth/auth';
import { readApiResponse } from '../../../shared/api/api-response';
import { createAuthRequestHeaders } from '../../../shared/api/api-request';
import { readSessionInvalidation } from '../../../shared/auth/session-invalidation';
import { getClientId } from '../auth/client-identity';
import { formatLogPayload, serializeLogPayload } from '../logging/log-sanitize';
import { log } from '../logging/logger';
import type {
  AuthSession,
  SessionInvalidationReason,
} from '../../../shared/auth/auth';
import type {
  ResourceSseConnectionType,
  ResourceSseMessage,
  ResourceSseStatus,
} from '../../../shared/windows/desktop';

const maximumRetryDelay = 30_000;
const stableConnectionWindow = 10_000;
const gracefulCloseTimeout = 1_500;

interface ResourceSseState {
  readonly session: AuthSession;
  readonly controller: AbortController;
  lastEventId: string | null;
  serverRetryDelay: number | null;
  stopped: boolean;
}

interface SseReadResult {
  lastEventId: string | null;
  retryDelay: number | null;
}

let activeState: ResourceSseState | undefined;
let gracefulClosePromise: Promise<void> | undefined;

/** 判断异常是否由主动停止 SSE 连接造成。 */
const isAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === 'AbortError';

/** 等待退避时间；主动停止时立即结束等待。 */
const waitForRetry = async (
  delay: number,
  signal: AbortSignal,
): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const complete = (): void => {
      signal.removeEventListener('abort', abort);
      resolve();
    };
    const abort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      reject(new DOMException('Canceled', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    timer = setTimeout(complete, delay);
    signal.addEventListener('abort', abort, { once: true });
  });
};

/** 从缓冲区读取一行，兼容 LF、CRLF 以及跨数据块的换行符。 */
const takeSseLine = (
  buffer: { value: string },
  flush: boolean,
): string | null => {
  let index = -1;
  let length = 1;
  for (let offset = 0; offset < buffer.value.length; offset++) {
    const character = buffer.value[offset];
    if (character === '\n') {
      index = offset;
      break;
    }
    if (character === '\r') {
      if (offset + 1 >= buffer.value.length && !flush) return null;
      index = offset;
      length =
        buffer.value[offset + 1] === '\n' && offset + 1 < buffer.value.length
          ? 2
          : 1;
      break;
    }
  }
  if (index < 0) return null;
  const line = buffer.value.slice(0, index);
  buffer.value = buffer.value.slice(index + length);
  return line;
};

/** 读取并解析一条 SSE 流，不把业务 data 猜测成固定消息结构。 */
const consumeSseStream = async (
  response: Response,
  state: ResourceSseState,
  onMessage: (message: ResourceSseMessage) => void,
): Promise<SseReadResult> => {
  if (!response.body) throw new Error('SSE 响应没有可读取的数据流');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const buffer = { value: '' };
  let eventName = '';
  let eventId = '';
  let dataLines: string[] = [];
  let lastEventId = state.lastEventId;
  let retryDelay: number | null = state.serverRetryDelay;

  /** 分发当前空行前积累的 SSE 事件。 */
  const dispatch = (): void => {
    if (!isActive(state)) return;
    if (!dataLines.length) {
      eventName = '';
      eventId = '';
      return;
    }
    if (eventId) lastEventId = eventId;
    const event = {
      event: eventName || 'message',
      id: eventId || null,
      data: dataLines.join('\n'),
      receivedAt: new Date().toISOString(),
    };
    log.info(
      'sse.event',
      formatLogPayload({
        event: event.event,
        eventId: event.id,
        data: serializeLogPayload(event.data),
      }),
    );
    onMessage(event);
    eventName = '';
    eventId = '';
    dataLines = [];
  };

  /** 解析 SSE 字段，忽略协议注释和未知字段。 */
  const processLine = (line: string): void => {
    if (!line) {
      dispatch();
      return;
    }
    if (line.startsWith(':')) return;
    const separator = line.indexOf(':');
    const field = separator < 0 ? line : line.slice(0, separator);
    const rawValue = separator < 0 ? '' : line.slice(separator + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;
    if (field === 'event') eventName = value;
    else if (field === 'data') dataLines.push(value);
    else if (field === 'id' && !value.includes('\u0000')) eventId = value;
    else if (field === 'retry' && /^\d+$/.test(value))
      retryDelay = Math.min(Number(value), maximumRetryDelay);
  };

  try {
    while (!state.controller.signal.aborted) {
      const result = await reader.read();
      if (result.done) break;
      buffer.value += decoder.decode(result.value, { stream: true });
      let line: string | null;
      while ((line = takeSseLine(buffer, false)) !== null) processLine(line);
    }
  } finally {
    reader.releaseLock();
  }
  buffer.value += decoder.decode();
  let line: string | null;
  while ((line = takeSseLine(buffer, true)) !== null) processLine(line);
  dispatch();
  return { lastEventId, retryDelay };
};

/** 计算带上限和轻微抖动的重连等待时间，避免服务恢复时集中请求。 */
const getRetryDelay = (
  attempt: number,
  serverRetryDelay: number | null,
): number => {
  const base = Math.max(serverRetryDelay ?? 1000, 1000);
  const exponential = Math.min(
    maximumRetryDelay,
    base * 2 ** Math.min(attempt, 5),
  );
  return Math.min(
    maximumRetryDelay,
    exponential + Math.floor(Math.random() * 250),
  );
};

/** 判断连接状态对象仍是当前 SSE，避免旧连接覆盖新账号状态。 */
const isActive = (state: ResourceSseState): boolean =>
  activeState === state && !state.stopped && !state.controller.signal.aborted;

/** 持续读取 SSE，网络错误、EOF 和服务端关闭后按退避策略重连。 */
const runResourceSse = async (
  state: ResourceSseState,
  onMessage: (message: ResourceSseMessage) => void,
  onStatus: (status: ResourceSseStatus) => void,
  onUnauthorized: (
    reason?: SessionInvalidationReason | SessionExpiredError,
  ) => void,
): Promise<void> => {
  let attempt = 0;
  let firstConnection = true;
  while (isActive(state)) {
    const connectionType: ResourceSseConnectionType = firstConnection
      ? 'LOGIN'
      : 'RECONNECT';
    onStatus(firstConnection ? 'connecting' : 'reconnecting');
    firstConnection = false;
    const connectedAt = Date.now();
    let status: number | null = null;
    try {
      log.info(
        'sse.request',
        formatLogPayload({
          connectionType,
          lastEventId: state.lastEventId,
        }),
      );
      const headers: Record<string, string> = {
        ...createAuthRequestHeaders(state.session, {
          clientId: getClientId(),
        }),
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      };
      if (state.lastEventId) headers['Last-Event-ID'] = state.lastEventId;
      const url = new URL(`${parseAuthBase(getAuthApiBase())}/capi/resource/sse`);
      url.searchParams.set('connectionType', connectionType);
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: state.controller.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      status = response.status;
      if (!response.ok) {
        try {
          await readApiResponse(response, 'SSE');
        } catch (error) {
          if (!(error instanceof SessionExpiredError)) throw error;
          if (isActive(state)) {
            log.error(
              'sse.unauthorized',
              formatLogPayload({ status, connectionType }),
            );
            state.stopped = true;
            state.controller.abort();
            onUnauthorized(error);
          }
          return;
        }
      }
      if (!isActive(state)) return;
      if (
        response.headers
          .get('content-type')
          ?.split(';')[0]
          ?.trim()
          .toLowerCase() !== 'text/event-stream'
      )
        log.warn('sse.content-type', formatLogPayload({ status }));
      onStatus('connected');
      const result = await consumeSseStream(response, state, (message) => {
        const reason = readSessionInvalidation(message, state.session.user.id);
        if (reason) {
          // 先终止循环再清理授权，即使清理失败也不能再次抢占 SSE。
          state.stopped = true;
          state.controller.abort();
          onUnauthorized(reason);
          return;
        }
        onMessage(message);
      });
      state.lastEventId = result.lastEventId;
      state.serverRetryDelay = result.retryDelay;
      if (isActive(state))
        log.warn(
          'sse.eof',
          formatLogPayload({
            connectionType,
            durationMs: Date.now() - connectedAt,
          }),
        );
      attempt =
        Date.now() - connectedAt >= stableConnectionWindow ? 0 : attempt + 1;
    } catch (error) {
      if (!isActive(state) || isAbortError(error)) return;
      attempt++;
      log.error(
        'sse.failure',
        formatLogPayload(
          {
            status,
            connectionType,
            attempt,
            durationMs: Date.now() - connectedAt,
          },
          error,
        ),
      );
    }
    if (!isActive(state)) return;
    onStatus('reconnecting');
    await waitForRetry(
      getRetryDelay(attempt, state.serverRetryDelay),
      state.controller.signal,
    ).catch(() => undefined);
  }
};

/** 启动当前账号的 SSE；同一时间只允许存在一个连接及其重连循环。 */
export const startResourceSse = (
  session: AuthSession,
  onMessage: (message: ResourceSseMessage) => void,
  onStatus: (status: ResourceSseStatus) => void,
  onUnauthorized: (
    reason?: SessionInvalidationReason | SessionExpiredError,
  ) => void,
): void => {
  stopResourceSse('replace-connection');
  const state: ResourceSseState = {
    session,
    controller: new AbortController(),
    lastEventId: null,
    serverRetryDelay: null,
    stopped: false,
  };
  activeState = state;
  void runResourceSse(state, onMessage, onStatus, onUnauthorized).catch(
    (error: unknown): void => {
      if (!isActive(state) || isAbortError(error)) return;
      log.error('sse.loop', formatLogPayload(undefined, error));
      stopResourceSse('loop-failure');
      onStatus('stopped');
    },
  );
};

/** 在退出应用前通知服务端关闭 SSE，再用本地中止作为兜底。 */
export const closeResourceSse = (
  reason: string = 'application-exit',
): Promise<void> => {
  if (gracefulClosePromise) return gracefulClosePromise;
  const state = activeState;
  activeState = undefined;
  if (!state) return Promise.resolve();
  state.stopped = true;
  gracefulClosePromise = (async (): Promise<void> => {
    log.info('sse.close.start', formatLogPayload({ reason }));
    const closeController = new AbortController();
    const timeout = setTimeout(
      () => closeController.abort(),
      gracefulCloseTimeout,
    );
    let acknowledged = false;
    try {
      const url = new URL(
        `${parseAuthBase(getAuthApiBase())}/capi/resource/sse/close`,
      );
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          ...createAuthRequestHeaders(state.session, {
            clientId: getClientId(),
          }),
          Accept: 'application/json',
        },
        signal: closeController.signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
      });
      acknowledged = response.ok;
      const closePayload = formatLogPayload({
        reason,
        status: response.status,
        acknowledged,
      });
      if (response.ok) log.info('sse.close.response', closePayload);
      else log.warn('sse.close.response', closePayload);
    } catch (error) {
      const payload = formatLogPayload(
        { reason, timeoutMs: gracefulCloseTimeout },
        error,
      );
      if (closeController.signal.aborted)
        log.warn('sse.close.timeout', payload);
      else log.info('sse.close.failure', payload);
    } finally {
      clearTimeout(timeout);
      state.controller.abort();
      log.info(
        'sse.close.complete',
        formatLogPayload({ reason, acknowledged, fallbackAbort: true }),
      );
      gracefulClosePromise = undefined;
    }
  })();
  return gracefulClosePromise;
};

/** 主动停止 SSE 及其重连计时，不影响加密登录会话。 */
export const stopResourceSse = (reason: string = 'local-stop'): void => {
  const state = activeState;
  activeState = undefined;
  if (!state) return;
  state.stopped = true;
  state.controller.abort();
  log.info('sse.stop', formatLogPayload({ reason }));
};
