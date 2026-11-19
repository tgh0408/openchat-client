import { requestApi } from '../../../../shared/api/api-client';
import { parseAuthBase } from '../../../../shared/api/api-request';
import type { AuthSession } from '../../../../shared/auth/auth';
import { parseImageUpload } from '../image/image-upload';
import {
  MAX_VOICE_BYTES,
  parseVoice,
  validateVoiceBytes,
} from '../../../../shared/media/voice/voice';
import type { VoiceContent } from '../../../../shared/media/voice/voice';
import type { Message } from '../../../../shared/storage/database';
import type { AuthorizeMessageDownload } from '../../../../shared/chat/messages/message-download';

/** 直传录音字节，上传成功之前不创建任何消息记录。 */
export const uploadVoice = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  value: unknown,
  validate: () => void,
  signal: AbortSignal,
  request: typeof fetch = fetch,
): Promise<VoiceContent> => {
  validate();
  const bytes = validateVoiceBytes(value);
  const fileName = `${crypto.randomUUID()}.wav`;
  const urls = await requestApi(
    {
      base,
      session,
      clientId,
      validateCurrent: validate,
      requestRemote: request,
    },
    {
      path: '/capi/oss/upload/url',
      method: 'POST',
      body: { scene: 8, fileName },
      signal,
      serviceName: '语音上传',
      networkError: '无法连接语音上传服务，请重试',
      httpError: '获取语音上传地址失败',
      parse: parseImageUpload,
    },
  );
  validate();
  let uploaded: Response;
  try {
    uploaded = await request(urls.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/wav' },
      body: new Uint8Array(bytes),
      signal: AbortSignal.any([signal, AbortSignal.timeout(60000)]),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
  } catch {
    throw new Error('语音上传失败或已取消');
  }
  validate();
  if (!uploaded.ok) throw new Error('语音上传失败，请重试');
  await uploaded.body?.cancel();
  validate();
  return {
    url: urls.downloadUrl,
    fileName,
    fileSize: bytes.length,
    second: Math.ceil((bytes.length - 44) / 32000),
  };
};

/** 只读取已授权消息绑定的语音，限制流大小并在返回前复核账号及撤回状态。 */
export const readVoice = async (
  message: Message,
  validate: () => void,
  signal: AbortSignal,
  request: typeof fetch = fetch,
  authorizeDownload?: AuthorizeMessageDownload,
): Promise<Uint8Array> => {
  validate();
  const voice = parseVoice(message.content);
  if (message.deletedAt || message.messageType !== 'audio' || !voice)
    throw new Error('语音不存在或已撤回');
  const authorization = authorizeDownload
    ? await authorizeDownload(message.id, message.conversationId, validate)
    : null;
  const downloadUrl = authorization?.downloadUrl ?? voice.url;
  parseAuthBase(new URL(downloadUrl).origin);
  const response = await request(downloadUrl, {
    signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
    credentials: 'omit',
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok || !response.body) throw new Error('语音加载失败，请重试');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      validate();
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > MAX_VOICE_BYTES || size > voice.fileSize)
        throw new Error('语音大小无效');
      chunks.push(chunk.value);
    }
  } finally {
    await reader.cancel();
  }
  validate();
  if (size !== voice.fileSize) throw new Error('语音文件不完整');
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return validateVoiceBytes(bytes);
};
