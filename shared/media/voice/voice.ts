import { parseImageUrl } from '../image/image';

export const MAX_VOICE_SECONDS = 120;
export const MAX_VOICE_BYTES = 44 + 32000 * MAX_VOICE_SECONDS;

export interface VoiceContent {
  url: string;
  fileName: string;
  fileSize: number;
  second: number;
}

/** 校验语音公开元数据，时长与固定 PCM 字节数一致。 */
export const validateVoice = (value: unknown): VoiceContent => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('语音信息无效');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !['url', 'fileName', 'fileSize', 'second'].includes(key),
    )
  )
    throw new Error('语音信息包含未知字段');
  const size =
    typeof data.fileSize === 'string' && /^\d{1,7}$/.test(data.fileSize)
      ? Number(data.fileSize)
      : data.fileSize;
  if (
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 32044 ||
    size > MAX_VOICE_BYTES ||
    (size - 44) % 2 !== 0 ||
    typeof data.second !== 'number' ||
    data.second !== Math.ceil((size - 44) / 32000) ||
    typeof data.fileName !== 'string' ||
    !/^[^/\\\u0000-\u001f\u007f]{1,251}\.wav$/.test(data.fileName)
  )
    throw new Error(`语音必须为 1 至 ${MAX_VOICE_SECONDS} 秒 WAV 录音`);
  return {
    url: parseImageUrl(data.url),
    fileName: data.fileName,
    fileSize: size,
    second: data.second,
  };
};

/** 解码本地语音记录，损坏内容不进入播放器。 */
export const parseVoice = (content: string): VoiceContent | null => {
  try {
    return validateVoice(JSON.parse(content));
  } catch {
    return null;
  }
};

/** SSE 和历史统一转换，畸形元数据保留消息确认关系但不加载。 */
export const encodeReceivedVoice = (body: Record<string, unknown>): string => {
  const extra = body.extra as Record<string, unknown> | null;
  try {
    return JSON.stringify(
      validateVoice({
        url: body.content,
        fileName: extra?.fileName,
        fileSize: extra?.size,
        second: extra?.second,
      }),
    );
  } catch {
    return '{}';
  }
};

/** 使用已上传对象重试消息，不重新录音或生成上传占位。 */
export const voiceMessageBody = (content: string): Record<string, unknown> => {
  const voice = parseVoice(content);
  if (!voice) throw new Error('语音消息无效');
  return {
    content: voice.url,
    uploadAddress: voice.url,
    fileName: voice.fileName,
    fileSize: String(voice.fileSize),
    second: voice.second,
  };
};

/** 校验固定 WAV 文件头、长度与时长，不信任页面提交的媒体类型。 */
export const validateVoiceBytes = (value: unknown): Uint8Array => {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength < 32044 ||
    value.byteLength > MAX_VOICE_BYTES ||
    (value.byteLength - 44) % 2 !== 0
  )
    throw new Error(`语音必须为 1 至 ${MAX_VOICE_SECONDS} 秒`);
  const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
  const text = new TextDecoder('ascii');
  if (
    text.decode(value.subarray(0, 4)) !== 'RIFF' ||
    text.decode(value.subarray(8, 16)) !== 'WAVEfmt ' ||
    text.decode(value.subarray(36, 40)) !== 'data' ||
    view.getUint32(4, true) !== value.byteLength - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== 16000 ||
    view.getUint32(28, true) !== 32000 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== value.byteLength - 44
  )
    throw new Error('语音文件格式无效');
  return value;
};

/** 将浏览器重采样后的单声道 PCM 编码为固定头 WAV。 */
export const encodeVoiceWave = (samples: Float32Array): Uint8Array => {
  const count = Math.min(samples.length, 16000 * MAX_VOICE_SECONDS);
  const bytes = new Uint8Array(44 + count * 2);
  const view = new DataView(bytes.buffer);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RIFF'), 0);
  bytes.set(encoder.encode('WAVEfmt '), 8);
  bytes.set(encoder.encode('data'), 36);
  view.setUint32(4, bytes.length - 8, true);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  view.setUint32(40, count * 2, true);
  for (let index = 0; index < count; index++) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0));
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 32768 : sample * 32767,
      true,
    );
  }
  return validateVoiceBytes(bytes);
};
