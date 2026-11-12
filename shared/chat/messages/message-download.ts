import { parseApiResult } from '../../api/api-response';

export interface MessageDownloadAuthorization {
  msgId: string;
  downloadUrl: string;
  thumbDownloadUrl: string | null;
  expiresIn: number;
}

export type AuthorizeMessageDownload = (
  messageId: string,
  roomId: string,
  validate: () => void,
) => Promise<MessageDownloadAuthorization>;

/** 校验服务端返回的预签名下载地址，允许查询参数但拒绝凭据和片段。 */
export const parseSignedDownloadUrl = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 8192 ||
    /[\u0000-\u0020]/.test(value)
  )
    throw new Error('资源下载地址无效');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('资源下载地址无效');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash ||
    !url.search
  )
    throw new Error('资源下载地址无效');
  return url.href;
};

/** 解析消息下载授权响应，并确认响应属于本次请求的消息。 */
export const parseMessageDownloadResponse = (
  value: unknown,
  expectedMessageId: string,
): MessageDownloadAuthorization => {
  const result = parseApiResult(value, '资源下载授权');
  if (
    !result.data ||
    typeof result.data !== 'object' ||
    Array.isArray(result.data)
  )
    throw new Error('资源下载授权服务返回的数据无效');
  const data = result.data as Record<string, unknown>;
  const msgId = typeof data.msgId === 'string' ? data.msgId : '';
  const downloadUrl = parseSignedDownloadUrl(data.downloadUrl);
  const thumbDownloadUrl =
    data.thumbDownloadUrl === null
      ? null
      : parseSignedDownloadUrl(data.thumbDownloadUrl);
  const expiresIn = data.expiresIn;
  if (
    !/^[1-9]\d{0,63}$/.test(msgId) ||
    msgId !== expectedMessageId ||
    typeof expiresIn !== 'number' ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 1 ||
    expiresIn > 86400
  )
    throw new Error('资源下载授权服务返回的数据无效');
  return { msgId, downloadUrl, thumbDownloadUrl, expiresIn };
};
