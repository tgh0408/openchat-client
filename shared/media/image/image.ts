/** 普通图片的上传上限，与服务端 type 4 校验保持一致。 */
export const MAX_IMAGE_BYTES = 50 * 1024 * 1024;

export const MAX_IMAGE_DRAFTS = 10;
export const MAX_IMAGE_DRAFT_BYTES = 200 * 1024 * 1024;

/** 原生选图后的临时预览；只在当前页面内存中使用，不包含本地路径。 */
export interface SelectedImageDraft {
  id: string;
  fileName: string;
  fileSize: number;
  contentType: string;
  previewBytes: Uint8Array;
}

/** 输入区只保留受控草稿标识和可撤销的本地预览地址。 */
export interface ComposerImageDraft {
  id: string;
  fileName: string;
  fileSize: number;
  previewUrl: string;
}

/** 消息正文及发送协议只含公开元数据；落盘路径由主进程维护在 messages 独立列中。 */
export interface StoredImageContent {
  url: string | null;
  fileName: string;
  fileSize: number | null;
}

/** 主进程受控读取的图片内容；页面只创建临时 Blob，不取得磁盘访问权。 */
export interface LocalImageData {
  bytes: Uint8Array;
  contentType: string;
}

/** 校验图片公开地址，拒绝凭据、临时签名和非 HTTP(S) 协议。 */
export const parseImageUrl = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    /[\u0000-\u0020]/.test(value)
  )
    throw new Error('图片地址无效');
  const url = new URL(value);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('图片地址无效');
  return url.href;
};

/** 校验原文件名，禁止路径和控制字符混入消息元数据。 */
export const parseImageName = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 255 ||
    /[/\\\u0000-\u001f\u007f]/.test(value)
  )
    throw new Error('图片名称无效');
  return value;
};

/** 校验图片字节数，兼容后端 Long 字符串但不接受精度丢失。 */
export const parseImageSize = (value: unknown): number => {
  const size =
    typeof value === 'string' && /^[1-9]\d{0,7}$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof size !== 'number' ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > MAX_IMAGE_BYTES
  )
    throw new Error('图片大小无效或超过 50 MiB');
  return size;
};

/** 将已经上传的图片编码为可重试的本地消息正文。 */
export const encodeImageContent = (image: StoredImageContent): string =>
  JSON.stringify({
    url: parseImageUrl(image.url),
    fileName: parseImageName(image.fileName),
    fileSize: parseImageSize(image.fileSize),
  });

/** 接收历史和 SSE 图片时隔离无效元数据，保留消息及确认关系。 */
export const encodeReceivedImageContent = (
  body: Record<string, unknown>,
): string => {
  const image: StoredImageContent = {
    url: null,
    fileName: '图片',
    fileSize: null,
  };
  try {
    image.url = parseImageUrl(body.content);
  } catch {
    // 不根据认证基址推测 OSS 地址，也不加载不可信地址。
  }
  if (body.extra && typeof body.extra === 'object') {
    const extra = body.extra as Record<string, unknown>;
    try {
      image.fileName = parseImageName(extra.fileName);
    } catch {
      // 旧消息缺少文件名时仍可显示图片。
    }
    try {
      image.fileSize = parseImageSize(extra.size);
    } catch {
      // 旧消息的大小未知，不用于重新发送。
    }
  }
  return JSON.stringify(image);
};

/** 解码图片元数据，损坏或附加敏感字段的记录不可使用。 */
export const parseImageContent = (value: string): StoredImageContent | null => {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return null;
    const data = parsed as Record<string, unknown>;
    if (
      Object.keys(data).some(
        (key) => !['url', 'fileName', 'fileSize'].includes(key),
      )
    )
      return null;
    return {
      url: data.url === null ? null : parseImageUrl(data.url),
      fileName: parseImageName(data.fileName),
      fileSize: data.fileSize === null ? null : parseImageSize(data.fileSize),
    };
  } catch {
    return null;
  }
};

/** 重试只提交公开地址与文件信息，不重用已经过期的上传签名。 */
export const imageMessageBody = (content: string): Record<string, unknown> => {
  const image = parseImageContent(content);
  if (!image) throw new Error('图片消息无效，请重新选择');
  return {
    content: parseImageUrl(image.url),
    uploadAddress: parseImageUrl(image.url),
    fileName: parseImageName(image.fileName),
    fileSize: String(parseImageSize(image.fileSize)),
  };
};
