import { imageSize } from 'image-size';
import { parseRegistrationAvatar } from '../../auth/registration-avatar';

// 沿用注册服务端现有像素上限，选区超限时拒绝，不通过缩放规避限制。
export const MAX_CROPPED_AVATAR_PIXELS = 4_000_000;

export interface AvatarImageSize {
  width: number;
  height: number;
}

export interface AvatarCropRegion {
  x: number;
  y: number;
  size: number;
}

export type AvatarCropCorner = 'nw' | 'ne' | 'sw' | 'se';

export interface AvatarCropApi {
  read: () => Promise<Uint8Array>;
  confirm: (bytes: Uint8Array) => Promise<void>;
  cancel: () => Promise<void>;
}

/** 选区按原图整数像素对齐，移动或尺寸调整都不能越出图片。 */
export const clampAvatarCrop = (
  region: AvatarCropRegion,
  bounds: AvatarImageSize,
): AvatarCropRegion => {
  const size = Math.max(
    1,
    Math.min(Math.round(region.size), bounds.width, bounds.height),
  );
  return {
    x: Math.max(0, Math.min(Math.round(region.x), bounds.width - size)),
    y: Math.max(0, Math.min(Math.round(region.y), bounds.height - size)),
    size,
  };
};

/** 默认选中居中方形；尺寸只影响选区范围，不重采样原图。 */
export const initialAvatarCrop = (
  bounds: AvatarImageSize,
): AvatarCropRegion => {
  const size = Math.max(
    1,
    Math.min(
      Math.floor(Math.min(bounds.width, bounds.height) * 0.8),
      Math.floor(Math.sqrt(MAX_CROPPED_AVATAR_PIXELS)),
    ),
  );
  return clampAvatarCrop(
    {
      x: (bounds.width - size) / 2,
      y: (bounds.height - size) / 2,
      size,
    },
    bounds,
  );
};

/** 移动方形选区，不改变其原始像素边长。 */
export const moveAvatarCrop = (
  region: AvatarCropRegion,
  dx: number,
  dy: number,
  bounds: AvatarImageSize,
): AvatarCropRegion =>
  clampAvatarCrop(
    {
      ...region,
      x: region.x + dx,
      y: region.y + dy,
    },
    bounds,
  );

/** 拖动任意角时固定对角，始终以同一边长计算宽高。 */
export const resizeAvatarCrop = (
  region: AvatarCropRegion,
  corner: AvatarCropCorner,
  dx: number,
  dy: number,
  bounds: AvatarImageSize,
): AvatarCropRegion => {
  let signX: number;
  let signY: number;
  switch (corner) {
    case 'nw':
      signX = -1;
      signY = -1;
      break;
    case 'ne':
      signX = 1;
      signY = -1;
      break;
    case 'sw':
      signX = -1;
      signY = 1;
      break;
    case 'se':
      signX = 1;
      signY = 1;
      break;
  }
  const anchorX = signX < 0 ? region.x + region.size : region.x;
  const anchorY = signY < 0 ? region.y + region.size : region.y;
  const delta = Math.abs(dx) >= Math.abs(dy) ? dx * signX : dy * signY;
  const maximum = Math.min(
    signX < 0 ? anchorX : bounds.width - anchorX,
    signY < 0 ? anchorY : bounds.height - anchorY,
  );
  const size = Math.max(1, Math.min(Math.round(region.size + delta), maximum));
  return {
    x: signX < 0 ? anchorX - size : anchorX,
    y: signY < 0 ? anchorY - size : anchorY,
    size,
  };
};

/** 裁剪结果为原尺寸方形 PNG，避免再次 JPEG 有损编码或强制缩放。 */
export const parseCroppedAvatar = (value: unknown): Uint8Array => {
  const bytes = parseRegistrationAvatar(value);
  const dimensions = imageSize(bytes);
  if (dimensions.type !== 'png' || dimensions.width !== dimensions.height)
    throw new Error('裁剪头像须为正方形 PNG');
  if (dimensions.width * dimensions.height > MAX_CROPPED_AVATAR_PIXELS)
    throw new Error('裁剪头像不能超过 400 万像素，请缩小选区');
  return bytes;
};
