import type { BrowserWindow } from 'electron';
import type { ScreenshotWindowBounds } from '../../../shared/media/screenshot/screenshot-window-snap';

type WindowReader = (excluded: Set<bigint>) => ScreenshotWindowBounds[];
let reader: WindowReader | undefined;

/** 延迟绑定窗口查询接口，只读取边界和层级，不读取标题或操作目标窗口。 */
const createWindowReader = async (): Promise<WindowReader> => {
  const { default: koffi } = await import('koffi');
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  const getTopWindow: (handle: null) => bigint | null = user32.func(
    'void * __stdcall GetTopWindow(void *window)',
  );
  const getWindow: (handle: bigint, command: number) => bigint | null =
    user32.func(
      'void * __stdcall GetWindow(void *window, unsigned int command)',
    );
  const isVisible: (handle: bigint) => number = user32.func(
    'int __stdcall IsWindowVisible(void *window)',
  );
  const isMinimized: (handle: bigint) => number = user32.func(
    'int __stdcall IsIconic(void *window)',
  );
  const getClassName: (
    handle: bigint,
    name: Buffer,
    maximum: number,
  ) => number = user32.func(
    'int __stdcall GetClassNameW(void *window, void *name, int maximum)',
  );
  const getAttribute: (
    handle: bigint,
    attribute: number,
    value: Buffer,
    size: number,
  ) => number = dwmapi.func(
    'long __stdcall DwmGetWindowAttribute(void *window, unsigned long attribute, void *value, unsigned long size)',
  );
  const desktopClasses = new Set([
    'Progman',
    'WorkerW',
    'Shell_TrayWnd',
    'Shell_SecondaryTrayWnd',
  ]);

  /** 从顶层向后遍历可见窗口，过滤遮罩、最小化、隐藏桌面及系统外壳。 */
  return (excluded: Set<bigint>): ScreenshotWindowBounds[] => {
    const windows: ScreenshotWindowBounds[] = [];
    const visited = new Set<bigint>();
    const className = Buffer.alloc(512);
    const cloaked = Buffer.alloc(4);
    const bounds = Buffer.alloc(16);
    let handle = getTopWindow(null);
    while (handle && visited.size < 4096 && !visited.has(handle)) {
      const current = handle;
      visited.add(current);
      handle = getWindow(current, 2);
      if (excluded.has(current) || !isVisible(current) || isMinimized(current))
        continue;
      const length = getClassName(current, className, 256);
      if (
        length <= 0 ||
        desktopClasses.has(className.toString('utf16le', 0, length * 2)) ||
        getAttribute(current, 14, cloaked, cloaked.length) !== 0 ||
        cloaked.readUInt32LE() !== 0 ||
        getAttribute(current, 9, bounds, bounds.length) !== 0
      )
        continue;
      const left = bounds.readInt32LE(0);
      const top = bounds.readInt32LE(4);
      const width = bounds.readInt32LE(8) - left;
      const height = bounds.readInt32LE(12) - top;
      if (width < 2 || height < 2) continue;
      windows.push({ x: left, y: top, width, height });
    }
    return windows;
  };
};

/** 仅为当前截图采集 Windows 候选窗口，识别不可用时保留普通手动框选。 */
export const readScreenshotWindows = async (
  excludedWindows: BrowserWindow[],
): Promise<ScreenshotWindowBounds[]> => {
  if (process.platform !== 'win32') return [];
  try {
    reader ??= await createWindowReader();
    const excluded = new Set<bigint>();
    for (const window of excludedWindows) {
      if (window.isDestroyed()) continue;
      const handle = window.getNativeWindowHandle();
      if (handle.length === 8) excluded.add(handle.readBigUInt64LE());
      else if (handle.length === 4) excluded.add(BigInt(handle.readUInt32LE()));
    }
    return reader(excluded);
  } catch {
    return [];
  }
};
