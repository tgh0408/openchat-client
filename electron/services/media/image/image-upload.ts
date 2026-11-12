import { parseAuthBase } from '../../../../shared/auth/auth';
import { parseApiResult } from '../../../../shared/api/api-response';
import { requestApi } from '../../../../shared/api/api-client';
import type { AuthSession } from '../../../../shared/auth/auth';
import {
  parseImageName,
  parseImageSize,
  parseImageUrl,
} from '../../../../shared/media/image/image';
import type { StoredImageContent } from '../../../../shared/media/image/image';
import { imageSize } from 'image-size';

type ImageContentType = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/bmp';

/** 通过扩展名及文件头识别允许上传的图片，不信任文件选择器过滤。 */
export const imageContentType = (
  fileName: string,
  bytes: Uint8Array,
): ImageContentType => {
  parseImageName(fileName);
  parseImageSize(bytes.byteLength);
  const png = [137, 80, 78, 71, 13, 10, 26, 10];
  if (
    /\.png$/i.test(fileName) &&
    png.every((value, index) => bytes[index] === value)
  )
    return 'image/png';
  if (
    /\.jpe?g$/i.test(fileName) &&
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255
  )
    return 'image/jpeg';
  if (
    /\.gif$/i.test(fileName) &&
    bytes[0] === 71 &&
    bytes[1] === 73 &&
    bytes[2] === 70 &&
    bytes[3] === 56 &&
    (bytes[4] === 55 || bytes[4] === 57) &&
    bytes[5] === 97
  )
    return 'image/gif';
  if (/\.bmp$/i.test(fileName) && bytes[0] === 66 && bytes[1] === 77)
    return 'image/bmp';
  throw new Error('请选择有效的 JPG/JPEG、PNG、GIF 或 BMP 图片');
};

/** 用图片头解析器检查尺寸，不重编码图片，保留动画和透明信息。 */
export const validateImageForUpload = (
  fileName: string,
  bytes: Uint8Array,
): ImageContentType => {
  const contentType = imageContentType(fileName, bytes);
  let dimensions: ReturnType<typeof imageSize>;
  try {
    // 解析器按底层 ArrayBuffer 读取，隔离 Buffer 切片外的数据，防止截断文件误通过。
    const input =
      bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
        ? bytes
        : new Uint8Array(bytes);
    dimensions = imageSize(input);
  } catch {
    throw new Error('图片头损坏或无法读取图片尺寸');
  }
  if (
    !Number.isSafeInteger(dimensions.width) ||
    !Number.isSafeInteger(dimensions.height) ||
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width * dimensions.height > 40_000_000
  )
    throw new Error('图片尺寸无效或像素超过 4000 万');
  return contentType;
};

/** 区分 OSS 配置项提示传输协议错误，不回传包含签名或凭据的原始 URL。 */
const validateOssTransport = (
  url: URL,
  setting: 'oss.upload-endpoint' | 'oss.public-endpoint',
): void => {
  try {
    parseAuthBase(url.origin);
  } catch {
    const purpose = setting === 'oss.upload-endpoint' ? '上传' : '下载';
    const fallback =
      setting === 'oss.upload-endpoint' ? '（未配置时使用 oss.endpoint）' : '';
    throw new Error(
      `OSS ${purpose}地址必须使用 HTTPS（仅回环地址允许 HTTP），请检查 ${setting}${fallback}`,
    );
  }
};

/** 校验预签名结果；只允许 HTTPS 或回环 HTTP，禁止凭据和重定向。 */
export const parseImageUpload = (
  value: unknown,
): { uploadUrl: string; downloadUrl: string } => {
  const root = parseApiResult(value, '图片上传');
  if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data))
    throw new Error('图片上传服务返回的数据无效');
  const data = root.data as Record<string, unknown>;
  if (
    typeof data.uploadUrl !== 'string' ||
    data.uploadUrl.length > 8192 ||
    /[\u0000-\u0020]/.test(data.uploadUrl)
  )
    throw new Error('图片上传地址无效');
  let upload: URL;
  try {
    upload = new URL(data.uploadUrl);
  } catch {
    // URL 解析器异常可能含完整签名，不能把原异常传给页面或日志。
    throw new Error(
      'OSS 上传地址不是完整 URL，请检查 oss.upload-endpoint 或 oss.endpoint',
    );
  }
  if (upload.username || upload.password || upload.hash)
    throw new Error(
      'OSS 上传地址不能包含用户凭据或片段，请检查 oss.upload-endpoint 或 oss.endpoint',
    );
  validateOssTransport(upload, 'oss.upload-endpoint');
  if (!upload.search)
    throw new Error('OSS 上传地址缺少预签名参数，请检查后端上传签名接口');
  let downloadUrl: string;
  try {
    downloadUrl = parseImageUrl(data.downloadUrl);
  } catch {
    throw new Error('OSS 下载地址无效，请检查 oss.public-endpoint');
  }
  validateOssTransport(new URL(downloadUrl), 'oss.public-endpoint');
  return { uploadUrl: upload.href, downloadUrl };
};

/** 主进程申请上传签名并 PUT 图片；JWT 只发送给业务接口，不发送到 OSS。 */
export const uploadImageBytes = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  fileName: string,
  bytes: Uint8Array,
  validateCurrent: () => void,
  requestRemote: typeof fetch = fetch,
  cancellation?: AbortSignal,
  placeholder?: { roomId: string; clientMsgId: string },
): Promise<StoredImageContent> => {
  validateCurrent();
  const contentType = validateImageForUpload(fileName, bytes);
  const urls = await requestApi(
    { base, session, clientId, validateCurrent, requestRemote },
    {
      path: '/capi/oss/upload/url',
      method: 'POST',
      body: { scene: 4, fileName, ...placeholder },
      signal: cancellation,
      serviceName: '图片上传',
      networkError: '无法连接图片上传服务，请重试',
      httpError: '获取图片上传地址失败',
      parse: parseImageUpload,
    },
  );
  validateCurrent();
  let uploaded: Response;
  try {
    uploaded = await requestRemote(urls.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      body: new Uint8Array(bytes),
      signal: AbortSignal.any([
        AbortSignal.timeout(300000),
        ...(cancellation ? [cancellation] : []),
      ]),
      credentials: 'omit',
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    throw new Error('图片上传失败或超时，请重新选择图片');
  }
  validateCurrent();
  // OSS 的 403 是签名或存储权限问题，不是业务账号 JWT 失效。
  if (!uploaded.ok)
    throw new Error(`图片上传失败（${uploaded.status}），请重试`);
  await uploaded.body?.cancel();
  validateCurrent();
  return { url: urls.downloadUrl, fileName, fileSize: bytes.byteLength };
};
