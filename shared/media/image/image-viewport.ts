export interface ImageViewportSize {
  width: number;
  height: number;
}

export interface ImagePan {
  x: number;
  y: number;
}

/** 旋转后使用包围盒计算缩放和拖动边界，原图像素不变。 */
export const rotatedImageSize = (
  size: ImageViewportSize,
  rotation: number,
): ImageViewportSize =>
  Math.abs(rotation % 180) === 90
    ? { width: size.height, height: size.width }
    : size;

/** 按旋转后宽高的限制边等比适配可用区域，小图放大、大图缩小。 */
export const fitImageScale = (
  size: ImageViewportSize,
  viewport: ImageViewportSize,
  rotation: number,
): number => {
  const rotated = rotatedImageSize(size, rotation);
  if (
    rotated.width <= 0 ||
    rotated.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  )
    return 1;
  return Math.min(
    viewport.width / rotated.width,
    viewport.height / rotated.height,
  );
};

/** 约束平移范围，缩小的维度始终居中，不允许把整张图片拖出可视区。 */
export const clampImagePan = (
  pan: ImagePan,
  size: ImageViewportSize,
  viewport: ImageViewportSize,
  scale: number,
  rotation: number,
): ImagePan => {
  const rotated = rotatedImageSize(size, rotation);
  const limitX = Math.max(0, (rotated.width * scale - viewport.width) / 2);
  const limitY = Math.max(0, (rotated.height * scale - viewport.height) / 2);
  return {
    x: limitX === 0 ? 0 : Math.max(-limitX, Math.min(limitX, pan.x)),
    y: limitY === 0 ? 0 : Math.max(-limitY, Math.min(limitY, pan.y)),
  };
};

/** 缩放时保持鼠标对应的图像位置稳定，再由调用方应用容器边界。 */
export const zoomImagePan = (
  pan: ImagePan,
  anchor: ImagePan,
  previous: number,
  next: number,
): ImagePan => ({
  x: anchor.x - ((anchor.x - pan.x) * next) / previous,
  y: anchor.y - ((anchor.y - pan.y) * next) / previous,
});
