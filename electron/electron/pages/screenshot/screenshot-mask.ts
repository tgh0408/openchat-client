import { screen } from 'electron';
import type { BrowserWindow, Point, Rectangle, Size } from 'electron';
import type { ScreenshotRegion } from '../../../shared/media/screenshot/screenshot';

/** 按任务窗口的全局 DIP 边界判断遮罩点击，选区留孔及截图窗口之外均不属于遮罩。 */
export const isScrollScreenshotMaskPoint = (
  point: Point,
  window: Rectangle,
  selection: ScreenshotRegion | null,
): boolean => {
  if (
    point.x < window.x ||
    point.y < window.y ||
    point.x >= window.x + window.width ||
    point.y >= window.y + window.height
  )
    return false;
  if (!selection) return true;
  const normalizedX = (point.x - window.x) / window.width;
  const normalizedY = (point.y - window.y) / window.height;
  return (
    normalizedX < selection.x ||
    normalizedY < selection.y ||
    normalizedX >= selection.x + selection.width ||
    normalizedY >= selection.y + selection.height
  );
};

/** 将选区向外扩展到 DIP 网格，透明覆盖窗口仅在选区之外绘制遮罩和边框。 */
export const createScrollScreenshotMask = (
  crop: Rectangle,
  image: Size,
  window: Size,
): { region: ScreenshotRegion; shape: Rectangle[] } => {
  const left = Math.max(
    0,
    Math.floor((crop.x / image.width) * window.width) - 1,
  );
  const top = Math.max(
    0,
    Math.floor((crop.y / image.height) * window.height) - 1,
  );
  const right = Math.min(
    window.width,
    Math.ceil(((crop.x + crop.width) / image.width) * window.width) + 1,
  );
  const bottom = Math.min(
    window.height,
    Math.ceil(((crop.y + crop.height) / image.height) * window.height) + 1,
  );
  return {
    shape: [
      { x: 0, y: 0, width: window.width, height: top },
      { x: 0, y: bottom, width: window.width, height: window.height - bottom },
      { x: 0, y: top, width: left, height: bottom - top },
      { x: right, y: top, width: window.width - right, height: bottom - top },
    ].filter((rectangle) => rectangle.width > 0 && rectangle.height > 0),
    region: {
      x: left / window.width,
      y: top / window.height,
      width: (right - left) / window.width,
      height: (bottom - top) / window.height,
    },
  };
};

/** 随指针位置显式切换选区穿透；遮罩仍保留原生孔，选区外恢复接收结束点击。 */
export const routeScrollScreenshotPointer = (
  window: BrowserWindow,
  selection: Rectangle,
  onError: (error: Error) => void,
): (() => void) => {
  let stopped = false;
  let ignoring: boolean | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;

  /** 结束、取消或窗口复用前停止路由，旧任务不得再次修改窗口输入状态。 */
  const stop = (): void => {
    stopped = true;
    clearInterval(timer);
  };

  /** 只在指针跨越选区边界时修改穿透标志，不模拟点击或滚轮，也不抢占焦点。 */
  const update = (): void => {
    if (stopped) return;
    try {
      if (window.isDestroyed()) throw new Error('截图窗口已关闭');
      const cursor = screen.getCursorScreenPoint();
      const inside =
        cursor.x >= selection.x &&
        cursor.y >= selection.y &&
        cursor.x < selection.x + selection.width &&
        cursor.y < selection.y + selection.height;
      if (inside === ignoring) return;
      // 位置由定时器读取，不向遮罩转发高频鼠标移动事件。
      window.setIgnoreMouseEvents(inside);
      ignoring = inside;
    } catch (error) {
      stop();
      onError(
        error instanceof Error ? error : new Error('更新截图穿透状态失败'),
      );
    }
  };

  update();
  if (!stopped) timer = setInterval(update, 16);
  return stop;
};
