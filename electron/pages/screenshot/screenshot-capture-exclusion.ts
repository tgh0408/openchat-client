import type { BrowserWindow } from 'electron';
import { release } from 'node:os';

export interface ScreenshotCaptureExclusion {
  enable: () => void;
  validate: () => void;
  restore: () => void;
}

/** 只在支持完整捕获排除的 Windows 上创建原生校验器，旧系统不能以黑块方式降级。 */
export const createScreenshotCaptureExclusionFactory = async (): Promise<
  (window: BrowserWindow) => ScreenshotCaptureExclusion
> => {
  const [major = 0, , build = 0] = release().split('.').map(Number);
  if (
    process.platform !== 'win32' ||
    !(major > 10 || (major === 10 && build >= 19041))
  )
    throw new Error('保留遮罩的滚动截图需要 Windows 10 2004 或更新系统');
  const { default: koffi } = await import('koffi');
  const user32 = koffi.load('user32.dll');
  const getDisplayAffinity: (handle: bigint, value: Buffer) => number =
    user32.func(
      'int __stdcall GetWindowDisplayAffinity(void *window, void *affinity)',
    );

  /** 读取本进程窗口的真实显示亲和性，不把 Electron 内存标记当作设置成功的证明。 */
  const readAffinity = (window: BrowserWindow): number => {
    if (window.isDestroyed()) throw new Error('截图遮罩窗口已关闭');
    const handle = window.getNativeWindowHandle();
    if (handle.length !== 4 && handle.length !== 8)
      throw new Error('无法读取截图遮罩窗口句柄');
    const address =
      handle.length === 8
        ? handle.readBigUInt64LE()
        : BigInt(handle.readUInt32LE());
    const value = Buffer.alloc(4);
    if (!getDisplayAffinity(address, value))
      throw new Error('无法验证截图遮罩的屏幕捕获排除状态');
    return value.readUInt32LE();
  };

  return (window: BrowserWindow): ScreenshotCaptureExclusion => {
    const originalProtected = window.isContentProtected();
    const originalAffinity = readAffinity(window);
    let changed = false;

    /** 每次抓屏前后均要求完整排除，拒绝仅隐藏内容的 WDA_MONITOR 黑块模式。 */
    const validate = (): void => {
      if (!changed || readAffinity(window) !== 0x11)
        throw new Error('系统未能将截图遮罩从采集中排除，已停止滚动截图');
    };

    /** 保持窗口可见，仅将当前应用的遮罩窗口从系统屏幕捕获中排除。 */
    const enable = (): void => {
      changed = true;
      window.setContentProtection(true);
      validate();
    };

    /** 恢复原捕获权限并复核原生值，失败由调用方销毁不可复用的遮罩窗口。 */
    const restore = (): void => {
      if (!changed) return;
      if (!window.isDestroyed()) {
        window.setContentProtection(originalProtected);
        if (readAffinity(window) !== originalAffinity)
          throw new Error('恢复截图遮罩的屏幕捕获状态失败');
      }
      changed = false;
    };

    return { enable, validate, restore };
  };
};
