import type { ScrollPreviewLayout } from './screenshot-preview';

/** 选区使用屏幕内归一化坐标，不接受页面提交图片、路径或屏幕标识。 */
export interface ScreenshotRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotSnapshot {
  url: string;
  windows: ScreenshotRegion[];
}

export interface ScrollScreenshotProgress {
  requestId: string;
  width: number;
  height: number;
  frameTop: number;
  frameHeight: number;
  previewOffset: number;
  layout: ScrollPreviewLayout;
  warning: boolean;
  message: string;
  preview: string;
}

export interface ScrollScreenshotOverlay {
  requestId: string;
  active: boolean;
  region: ScreenshotRegion | null;
}

export interface ScreenshotApi {
  connect: () => Promise<void>;
  onRequest: (callback: (requestId: string | null) => void) => () => void;
  read: (requestId: string) => Promise<ScreenshotSnapshot>;
  ready: (requestId: string, loaded: boolean) => Promise<void>;
  confirm: (requestId: string, region: ScreenshotRegion) => Promise<void>;
  cancel: (requestId: string) => Promise<void>;
  startScroll: (requestId: string, region: ScreenshotRegion) => Promise<void>;
  finishScroll: (requestId: string) => Promise<void>;
  onScrollOverlay: (
    callback: (overlay: ScrollScreenshotOverlay) => void,
  ) => () => void;
  onScrollProgress: (
    callback: (progress: ScrollScreenshotProgress) => void,
  ) => () => void;
}

/** 消除归一化往返产生的整数像素误差，保留真实的亚像素边界。 */
const alignScreenshotPixel = (value: number): number => {
  const nearest = Math.round(value);
  return Math.abs(value - nearest) <=
    Number.EPSILON * Math.max(1, Math.abs(value)) * 4
    ? nearest
    : value;
};

/** 将界面选区映射到原始截图像素，拒绝空选区、越界和非有限数值。 */
export const screenshotCrop = (
  value: unknown,
  size: { width: number; height: number },
): ScreenshotRegion => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('截图选区无效');
  const region = value as Record<string, unknown>;
  for (const key of ['x', 'y', 'width', 'height']) {
    const number = region[key];
    if (typeof number !== 'number' || !Number.isFinite(number))
      throw new Error('截图选区无效');
  }
  const { x, y, width, height } = region as unknown as ScreenshotRegion;
  if (
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 1 + Number.EPSILON ||
    y + height > 1 + Number.EPSILON ||
    !Number.isSafeInteger(size.width) ||
    !Number.isSafeInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  )
    throw new Error('截图选区无效');
  const left = Math.floor(alignScreenshotPixel(x * size.width));
  const top = Math.floor(alignScreenshotPixel(y * size.height));
  const right = Math.min(
    size.width,
    Math.ceil(alignScreenshotPixel((x + width) * size.width)),
  );
  const bottom = Math.min(
    size.height,
    Math.ceil(alignScreenshotPixel((y + height) * size.height)),
  );
  if (right - left < 2 || bottom - top < 2) throw new Error('截图选区太小');
  return { x: left, y: top, width: right - left, height: bottom - top };
};
