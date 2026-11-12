import type { ScreenshotRegion } from './screenshot';

export interface ScreenshotWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 按屏幕物理边界裁剪窗口，保留前后层级并转为当前屏幕的归一化选区。 */
export const projectScreenshotWindows = (
  windows: ScreenshotWindowBounds[],
  display: ScreenshotWindowBounds,
): ScreenshotRegion[] => {
  const regions: ScreenshotRegion[] = [];
  if (display.width <= 0 || display.height <= 0) return regions;
  for (const window of windows) {
    const left = Math.max(window.x, display.x);
    const top = Math.max(window.y, display.y);
    const right = Math.min(window.x + window.width, display.x + display.width);
    const bottom = Math.min(
      window.y + window.height,
      display.y + display.height,
    );
    if (right - left < 2 || bottom - top < 2) continue;
    regions.push({
      x: (left - display.x) / display.width,
      y: (top - display.y) / display.height,
      width: (right - left) / display.width,
      height: (bottom - top) / display.height,
    });
  }
  return regions;
};

/** 按前后层级命中鼠标所在的首个窗口，右边和下边不包含边界像素。 */
export const findScreenshotWindow = (
  windows: ScreenshotRegion[],
  point: { x: number; y: number },
): ScreenshotRegion | null =>
  windows.find(
    (window) =>
      point.x >= window.x &&
      point.y >= window.y &&
      point.x < window.x + window.width &&
      point.y < window.y + window.height,
  ) ?? null;
