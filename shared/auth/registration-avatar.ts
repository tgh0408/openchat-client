export const MAX_REGISTRATION_AVATAR_BYTES = 10 * 1024 * 1024;
export const MAX_REGISTRATION_AVATAR_PIXELS = 4_000_000 * 10;

/** 校验注册头像的有界字节与格式头，实际图片解码由选择端和服务端完成。 */
export const parseRegistrationAvatar = (value: unknown): Uint8Array => {
  if (
    !(value instanceof Uint8Array) ||
    value.byteLength === 0 ||
    value.byteLength > MAX_REGISTRATION_AVATAR_BYTES
  )
    throw new Error('头像大小须为 1 字节至 10 MiB');
  registrationAvatarMime(value);
  let dimensions: ReturnType<typeof imageSize>;
  try {
    dimensions = imageSize(value);
  } catch {
    throw new Error('头像图片无法读取，请重新选择 JPG 或 PNG');
  }
  if (
    dimensions.width < 1 ||
    dimensions.height < 1 ||
    dimensions.width * dimensions.height > MAX_REGISTRATION_AVATAR_PIXELS
  )
    throw new Error('头像不能超过 4000 万像素');
  return value.slice();
};

/** 根据真实文件头确定表单和预览类型，不信任文件名或页面 MIME。 */
export const registrationAvatarMime = (
  bytes: Uint8Array,
): 'image/jpeg' | 'image/png' => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => bytes[index] === byte,
    )
  )
    return 'image/png';
  throw new Error('头像仅支持 JPG 或 PNG 图片');
};
import { imageSize } from 'image-size';
