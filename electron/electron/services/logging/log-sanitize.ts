/** 调用点提交的结构化日志字段，具体值由本模块负责脱敏。 */
export type LogFields = Record<string, string | number | boolean | null>;

const sensitivePayloadKey =
  /(?:password|passwd|token|authorization|cookie|secret|client[_-]?secret|access[_-]?key|secret[_-]?key|signature|device[_-]?id|sdp|icecandidate)/i;

/** 跨 bundle 共享的异常标记槽。 */
const loggedErrorsKey = Symbol.for('openchat.logged-errors');
const registry = globalThis as typeof globalThis & {
  [loggedErrorsKey]?: WeakSet<object>;
};
// 独立打包的启动入口与业务入口共享异常标记，避免同一异常记录两次。
const loggedErrors = (registry[loggedErrorsKey] ??= new WeakSet<object>());

/** 规范化日志载荷中的普通字符串，不把业务正文字段误判为凭据。 */
const normalizePayloadString = (value: string): string =>
  value
    .replace(/[\r\n]+/g, ' | ')
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeLogUrl(url))
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .slice(0, 65536);

/** 地址只保留接口路径；对象存储路径、查询参数及 URL 凭据不进入日志。 */
export const safeLogUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '[local-resource]';
    const pathname = url.pathname.startsWith('/capi/')
      ? url.pathname
      : '/[resource]';
    return `${url.origin}${pathname}`;
  } catch {
    return '[invalid-url]';
  }
};

/** 失败请求保留完整路径，但每个查询值固定替换为占位符。 */
export const safeFailureLogUrl = (value: string): string => {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '[local-resource]';
    const query = [...url.searchParams.keys()]
      .map((key) => `${encodeURIComponent(key)}=[redacted]`)
      .join('&');
    return `${url.origin}${url.pathname}${query ? `?${query}` : ''}`;
  } catch {
    return '[invalid-url]';
  }
};

/** 截断并脱敏异常文本，不记录令牌、密码、签名链接或正文类字段。 */
export const redactLogText = (value: string): string => {
  if (/\bSyntaxError\b/.test(value)) return '[数据解析失败，已省略原始内容]';
  return value
    .replace(/[\r\n]+/g, ' | ')
    .slice(0, 16384)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => safeLogUrl(url))
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[jwt]')
    .replace(
      /(["']?(?:password|passwd|token|access[_-]?token|refresh[_-]?token|authorization|cookie|secret|client[_-]?secret|access[_-]?key|secret[_-]?key|signature|(?:x-)?device[_-]?id|content|body|data)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;]+)/gi,
      '$1[redacted]',
    )
    .slice(0, 4096);
};

/**
 * 识别已序列化的嵌套正文。
 * 请求体与响应正文在上游先经过一次序列化，若按普通字符串写入外层 JSON
 * 会被再次转义成 `"{\"code\":\"id\"}"`，无法直接解析；此处还原成结构化值。
 * 截断过的正文不再能解析，保持字符串原样。
 */
const inlineJsonString = (value: string): unknown => {
  const trimmed = value.trim();
  const head = trimmed[0];
  if (head !== '{' && head !== '[') return undefined;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return parsed !== null && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
};

/** 递归脱敏请求/响应载荷，保留业务字段以便排查协议问题。 */
const sanitizePayload = (
  value: unknown,
  key: string | undefined,
  seen: WeakSet<object>,
  depth: number,
): unknown => {
  if (key && sensitivePayloadKey.test(key)) return '[redacted]';
  if (value === null || typeof value === 'boolean' || typeof value === 'number')
    return value;
  if (typeof value === 'string') {
    const inlined = depth < 8 ? inlineJsonString(value) : undefined;
    if (inlined !== undefined)
      return sanitizePayload(inlined, undefined, seen, depth + 1);
    return normalizePayloadString(value);
  }
  if (depth >= 8) return '[max-depth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value))
    return value
      .slice(0, 200)
      .map((item) => sanitizePayload(item, undefined, seen, depth + 1));
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(value).slice(0, 200))
    result[childKey] = sanitizePayload(childValue, childKey, seen, depth + 1);
  return result;
};

/** 序列化请求/响应载荷，保证外层 JSON 仍是一行且正文有上限。 */
export const serializeLogPayload = (
  value: unknown,
  maxLength: number = 65536,
): string => {
  if (value === undefined) return '[unavailable]';
  let serialized: string;
  try {
    if (typeof value === 'string') {
      try {
        serialized = JSON.stringify(
          sanitizePayload(JSON.parse(value), undefined, new WeakSet(), 0),
        );
      } catch {
        serialized = normalizePayloadString(value);
      }
    } else {
      serialized = JSON.stringify(
        sanitizePayload(value, undefined, new WeakSet(), 0),
      );
    }
  } catch {
    serialized = '[unserializable]';
  }
  return serialized.length > maxLength
    ? `${serialized.slice(0, maxLength)}...[truncated]`
    : serialized;
};

/** 只提取异常诊断字段，禁止序列化未知对象以免带入会话或消息内容。 */
export const describeLogError = (error: unknown, depth = 0): unknown => {
  if (!(error instanceof Error))
    return typeof error === 'string' ? redactLogText(error) : undefined;
  const syntaxError = error.name === 'SyntaxError';
  const code = 'code' in error ? error.code : undefined;
  const cause = 'cause' in error ? error.cause : undefined;
  return {
    name: redactLogText(error.name),
    message: syntaxError ? '数据解析失败' : redactLogText(error.message),
    code:
      typeof code === 'string' || typeof code === 'number'
        ? redactLogText(String(code))
        : undefined,
    // SyntaxError 首行可能包含服务端原始正文，只保留调用位置。
    stack: redactLogText(
      (error.stack ?? '')
        .split('\n')
        .filter((line) => /^\s+at /.test(line))
        .slice(0, 12)
        .join('\n'),
    ),
    cause:
      depth < 2 && cause !== error
        ? describeLogError(cause, depth + 1)
        : undefined,
  };
};

/**
 * 把结构化字段与异常诊断合并为单行载荷。
 * electron-log 默认会把对象参数折行，统一在此序列化可保持一条记录一行。
 */
export const formatLogPayload = (
  fields?: LogFields,
  error?: unknown,
): string => {
  const payload: Record<string, unknown> = { ...(fields ?? {}) };
  const described = describeLogError(error);
  if (described !== undefined) payload.error = described;
  return serializeLogPayload(payload);
};

/** 写盘前统一脱敏单个参数，供 electron-log 的 hook 兜底调用。 */
export const redactLogArgument = (value: unknown): unknown => {
  if (typeof value === 'string') return normalizePayloadString(value);
  if (value instanceof Error) return describeLogError(value);
  if (value === null || typeof value !== 'object') return value;
  return sanitizePayload(value, undefined, new WeakSet(), 0);
};

/** 标记已并入请求记录的异常，防止 IPC 再次单独输出。 */
export const markLoggedError = (error: unknown): void => {
  if (error && typeof error === 'object') loggedErrors.add(error);
};

/** 判断异常是否已被请求记录覆盖。 */
export const isLoggedError = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && loggedErrors.has(error));
