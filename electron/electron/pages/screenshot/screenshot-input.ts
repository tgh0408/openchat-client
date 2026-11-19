import type { ScrollHeading } from '../../../shared/media/screenshot/screenshot-stitch';
import { screen } from 'electron';
import type { Point, Rectangle } from 'electron';
import type {
  UiohookKeyboardEvent,
  UiohookMouseEvent,
  UiohookWheelEvent,
} from 'uiohook-napi';

interface NativeTarget {
  handle: bigint;
  bounds: string;
}

export interface ScreenshotInput {
  listen: (
    onCancel: () => void,
    onScroll: (direction: ScrollHeading | undefined) => void,
    onClick: (pressed: Point, released: Point) => void,
  ) => void;
  stop: () => void;
  target: (point: Point) => NativeTarget;
  unchanged: (target: NativeTarget, point: Point) => boolean;
}

/** 延迟加载 Windows 原生模块，仅在用户明确开启滚动截图时监听全局输入。 */
export const createScreenshotInput = async (): Promise<ScreenshotInput> => {
  if (process.platform !== 'win32')
    throw new Error('滚动截图暂仅支持 Windows 桌面');
  const [{ default: koffi }, { uIOhook, UiohookKey, WheelDirection }] =
    await Promise.all([import('koffi'), import('uiohook-napi')]);
  const user32 = koffi.load('user32.dll');
  const pointType = koffi.struct({ x: 'long', y: 'long' });
  const rectangleType = koffi.struct({
    left: 'long',
    top: 'long',
    right: 'long',
    bottom: 'long',
  });
  const windowFromPoint: (point: Point) => bigint | null = user32.func(
    '__stdcall',
    'WindowFromPoint',
    'void *',
    [pointType],
  );
  const getAncestor: (handle: bigint, flag: number) => bigint | null =
    user32.func(
      'void * __stdcall GetAncestor(void *handle, unsigned int flags)',
    );
  const getRectangle: (
    handle: bigint,
    rectangle: Record<string, number>,
  ) => number = user32.func('__stdcall', 'GetWindowRect', 'int', [
    'void *',
    koffi.out(koffi.pointer(rectangleType)),
  ]);
  let listening = false;
  let keyListener: ((event: UiohookKeyboardEvent) => void) | undefined;
  let wheelListener: ((event: UiohookWheelEvent) => void) | undefined;
  let pressListener: ((event: UiohookMouseEvent) => void) | undefined;
  let releaseListener: ((event: UiohookMouseEvent) => void) | undefined;
  let pressed: Point | undefined;

  /** 读取选区下方的顶层窗口及边界，避免切换或移动窗口后继续拼接。 */
  const target = (point: Point): NativeTarget => {
    const child = windowFromPoint(screen.dipToScreenPoint(point));
    const handle = child ? getAncestor(child, 2) : null;
    const rectangle: Record<string, number> = {};
    if (!handle || !getRectangle(handle, rectangle))
      throw new Error('无法定位选区下方的窗口');
    return { handle, bounds: JSON.stringify(rectangle) };
  };

  /** 释放本任务的监听，不保存按键内容，也不在截图结束后继续监听。 */
  const stop = (): void => {
    if (keyListener) uIOhook.removeListener('keydown', keyListener);
    if (wheelListener) uIOhook.removeListener('wheel', wheelListener);
    if (pressListener) uIOhook.removeListener('mousedown', pressListener);
    if (releaseListener) uIOhook.removeListener('mouseup', releaseListener);
    keyListener = undefined;
    wheelListener = undefined;
    pressListener = undefined;
    releaseListener = undefined;
    pressed = undefined;
    if (listening) {
      listening = false;
      uIOhook.stop();
    }
  };

  /** 监听当前任务的取消、滚动和完整左键单击，按事件坐标转换 DIP，不依赖页面获得焦点。 */
  const listen = (
    onCancel: () => void,
    onScroll: (direction: ScrollHeading | undefined) => void,
    onClick: (pressed: Point, released: Point) => void,
  ): void => {
    if (listening) throw new Error('滚动截图输入监听已启动');
    keyListener = (event: UiohookKeyboardEvent): void => {
      if (event.keycode === UiohookKey.Escape) onCancel();
      else if (
        [
          UiohookKey.ArrowUp,
          UiohookKey.ArrowDown,
          UiohookKey.PageUp,
          UiohookKey.PageDown,
          UiohookKey.Home,
          UiohookKey.End,
          UiohookKey.Space,
        ].some((key) => key === event.keycode)
      )
        onScroll(
          [UiohookKey.ArrowUp, UiohookKey.PageUp, UiohookKey.Home].some(
            (key) => key === event.keycode,
          )
            ? 'up'
            : event.keycode === UiohookKey.Space && event.shiftKey
              ? 'up'
              : 'down',
        );
    };
    wheelListener = (event: UiohookWheelEvent): void => {
      if (event.direction === WheelDirection.VERTICAL && event.rotation !== 0)
        onScroll(event.rotation > 0 ? 'down' : 'up');
    };
    pressListener = (event: UiohookMouseEvent): void => {
      if (!listening || event.button !== 1) return;
      pressed = screen.screenToDipPoint({ x: event.x, y: event.y });
    };
    releaseListener = (event: UiohookMouseEvent): void => {
      if (!listening || event.button !== 1) return;
      const origin = pressed;
      pressed = undefined;
      if (!origin) return;
      const released = screen.screenToDipPoint({ x: event.x, y: event.y });
      if (Math.hypot(released.x - origin.x, released.y - origin.y) > 8) return;
      onClick(origin, released);
    };
    uIOhook.on('keydown', keyListener);
    uIOhook.on('wheel', wheelListener);
    uIOhook.on('mousedown', pressListener);
    uIOhook.on('mouseup', releaseListener);
    try {
      listening = true;
      uIOhook.start();
    } catch (error) {
      stop();
      throw error;
    }
  };

  /** 目标窗口或位置变化后停止任务，不向另一个窗口自动发送滚轮。 */
  const unchanged = (original: NativeTarget, point: Point): boolean => {
    const current = target(point);
    return (
      current.handle === original.handle && current.bounds === original.bounds
    );
  };

  return { listen, stop, target, unchanged };
};

/** 用 Electron 的屏幕 DIP 坐标核对指针，兼容多显示器及不同缩放比例。 */
export const isScreenshotPointerInside = (region: Rectangle): boolean => {
  const cursor = screen.getCursorScreenPoint();
  return (
    cursor.x >= region.x &&
    cursor.y >= region.y &&
    cursor.x < region.x + region.width &&
    cursor.y < region.y + region.height
  );
};
