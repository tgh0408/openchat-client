import {
  BrowserWindow,
  desktopCapturer,
  ipcMain,
  nativeImage,
  screen,
} from 'electron';
import type { Display, IpcMainInvokeEvent, Point } from 'electron';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { getApplicationIcon } from '../../services/runtime/application-icon';
import type { LocalImageData } from '../../../shared/media/image/image';
import { MAX_IMAGE_BYTES } from '../../../shared/media/image/image';
import { screenshotCrop } from '../../../shared/media/screenshot/screenshot';
import type {
  ScreenshotRegion,
  ScrollScreenshotProgress,
} from '../../../shared/media/screenshot/screenshot';
import { createScrollCapture } from './screenshot-scroll';
import type { ScrollCapture } from './screenshot-scroll';
import {
  createScrollScreenshotMask,
  isScrollScreenshotMaskPoint,
  routeScrollScreenshotPointer,
} from './screenshot-mask';
import { createScreenshotCaptureExclusionFactory } from './screenshot-capture-exclusion';
import type { ScreenshotCaptureExclusion } from './screenshot-capture-exclusion';
import { readScreenshotWindows } from './screenshot-window-snap';
import { projectScreenshotWindows } from '../../../shared/media/screenshot/screenshot-window-snap';

interface ScreenshotEntry {
  window: BrowserWindow;
  url: string;
  displayId: number;
  boot: Promise<void>;
  booted: boolean;
  mounted: () => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ScreenshotFrame {
  entry: ScreenshotEntry;
  png: Uint8Array | undefined;
  windows: ScreenshotRegion[];
  decoded: boolean;
  ready: Promise<void>;
  resolveReady: () => void;
  scrollOverlay: boolean;
  captureExclusion?: ScreenshotCaptureExclusion;
  stopPointerRouting?: () => void;
}

interface ScreenshotOperation {
  id: string;
  roomId: string;
  frames: Map<number, ScreenshotFrame>;
  validate: () => void;
  finish: (bytes: Uint8Array | null, error?: Error) => void;
  scroll?: {
    phase: 'starting' | 'capturing';
    region: ScreenshotRegion;
    capture?: ScrollCapture;
  };
}

export interface ScreenshotTiming {
  prewarmed: boolean;
  hideWindow: boolean;
  displayCount: number;
  captureMs: number;
  encodeMs: number;
  windowWaitMs: number;
  transferDecodeMs: number;
  readyMs: number;
}

interface ScreenshotDependencies {
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  reportTiming?: (timing: ScreenshotTiming) => void;
}

/** 复用空截图窗口；图像只属于当前任务，退出授权时销毁整个窗口池。 */
export const createScreenshotController = (
  dependencies: ScreenshotDependencies,
): {
  warmup: () => void;
  capture: (
    roomId: string,
    validate: () => void,
    hideWindow?: boolean,
    sourceWindow?: BrowserWindow,
  ) => Promise<Uint8Array | null>;
  cancel: (roomId?: string) => void;
} => {
  let active: ScreenshotOperation | undefined;
  const pool = new Map<number, ScreenshotEntry>();
  let displaySignature = '';
  let watchingDisplays = false;
  let warmupTimer: ReturnType<typeof setTimeout> | undefined;

  /** 销毁空窗口或失效窗口，先移出池再关闭，防止 closed 事件递归清理。 */
  const destroyPool = (): void => {
    const entries = [...pool.values()];
    pool.clear();
    displaySignature = '';
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.mounted();
      if (!entry.window.isDestroyed()) entry.window.destroy();
    }
    if (watchingDisplays) {
      screen.removeListener('display-added', displayChanged);
      screen.removeListener('display-removed', displayChanged);
      screen.removeListener('display-metrics-changed', displayChanged);
      watchingDisplays = false;
    }
  };

  /** 撤销授权或显示器变化时连空壳一起销毁；删除会话只取消对应任务。 */
  const cancel = (roomId?: string): void => {
    if (roomId !== undefined) {
      if (active?.roomId === roomId) active.finish(null);
      return;
    }
    clearTimeout(warmupTimer);
    warmupTimer = undefined;
    active?.finish(null);
    destroyPool();
  };

  /** 屏幕几何变化使预热窗口失效，下一次按新几何重新创建。 */
  const displayChanged = (): void => cancel();

  /** 页面加载失败或崩溃只影响仍在池中的窗口，不处理旧窗口迟到事件。 */
  const windowFailed = (entry: ScreenshotEntry): void => {
    if (pool.get(entry.displayId) !== entry) return;
    active?.finish(null, new Error('截图窗口加载失败，请重试'));
    destroyPool();
  };

  /** Windows 使用固定尺寸的透明覆盖窗口，避免原生全屏或缩放破坏滚动选区的透明合成。 */
  const createEntry = (display: Display): ScreenshotEntry => {
    const transparent = process.platform === 'win32';
    const window = new BrowserWindow({
      ...display.bounds,
      frame: false,
      show: false,
      transparent,
      thickFrame: false,
      resizable: !transparent,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: !transparent,
      fullscreen: !transparent,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: transparent ? '#00000000' : '#151515',
      title: '截图',
      icon: getApplicationIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'screenshot-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        zoomFactor: 1,
        backgroundThrottling: false,
      },
    });
    const url = new URL(dependencies.getRendererUrl());
    url.hash = 'screenshot';
    let mounted: () => void = (): void => {};
    const mountedPromise = new Promise<void>((resolve) => {
      mounted = resolve;
    });
    const entry: ScreenshotEntry = {
      window,
      url: url.href,
      displayId: display.id,
      boot: Promise.resolve(),
      booted: false,
      mounted,
      timer: setTimeout(() => windowFailed(entry), 15_000),
    };
    pool.set(display.id, entry);
    window.setAlwaysOnTop(true, 'screen-saver');
    if (transparent) window.setBounds(display.bounds);
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on(
      'did-start-navigation',
      (_event, _url, inPlace, mainFrame) => {
        if (mainFrame && !inPlace && entry.booted) windowFailed(entry);
      },
    );
    window.webContents.on('render-process-gone', () => windowFailed(entry));
    window.on('closed', () => windowFailed(entry));
    entry.boot = window
      .loadURL(entry.url)
      .then(() => mountedPromise)
      .then((): void => {
        clearTimeout(entry.timer);
        entry.booted = true;
      });
    void entry.boot.catch(() => windowFailed(entry));
    return entry;
  };

  /** 复用同一组显示器的空窗口，不在预热时获取任何屏幕快照。 */
  const ensurePool = (displays: Display[]): ScreenshotEntry[] => {
    const signature = JSON.stringify(
      displays.map(({ id, bounds, scaleFactor }) => ({
        id,
        bounds,
        scaleFactor,
      })),
    );
    if (displaySignature !== signature) {
      destroyPool();
      displaySignature = signature;
    }
    if (!watchingDisplays) {
      screen.on('display-added', displayChanged);
      screen.on('display-removed', displayChanged);
      screen.on('display-metrics-changed', displayChanged);
      watchingDisplays = true;
    }
    return displays.map(
      (display) => pool.get(display.id) ?? createEntry(display),
    );
  };

  /** 登录完成后让出当前事件循环再预热，退出或重载可取消尚未执行的预热。 */
  const warmup = (): void => {
    clearTimeout(warmupTimer);
    warmupTimer = setTimeout((): void => {
      warmupTimer = undefined;
      if (active) return;
      try {
        ensurePool(screen.getAllDisplays());
      } catch {
        destroyPool();
      }
    }, 0);
  };

  /** 空窗口只允许握手；来源必须仍是池中窗口的可信主框架。 */
  const validateWindow = (event: IpcMainInvokeEvent): ScreenshotEntry => {
    const entry = [...pool.values()].find(
      (item) => item.window.webContents === event.sender,
    );
    if (
      !entry ||
      entry.window.isDestroyed() ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== entry.url
    )
      throw new Error('无效的截图窗口调用');
    return entry;
  };

  /** 每次读取及写入绑定任务编号，拒绝同一复用窗口的旧任务迟到请求。 */
  const validateSender = (
    event: IpcMainInvokeEvent,
    requestId: unknown,
  ): { operation: ScreenshotOperation; frame: ScreenshotFrame } => {
    const entry = validateWindow(event);
    const operation = active;
    const frame = operation?.frames.get(event.sender.id);
    if (
      !operation ||
      operation.id !== requestId ||
      !frame ||
      frame.entry !== entry
    )
      throw new Error('截图任务已失效');
    try {
      operation.validate();
    } catch (error) {
      cancel();
      throw error;
    }
    return { operation, frame };
  };

  /** 恢复窗口输入及捕获权限，失败时保留标记让任务清理继续回收窗口。 */
  const restoreScrollOverlay = (
    frame: ScreenshotFrame,
    requestId: string,
  ): void => {
    frame.stopPointerRouting?.();
    frame.stopPointerRouting = undefined;
    if (!frame.scrollOverlay) return;
    const window = frame.entry.window;
    if (!window.isDestroyed()) {
      window.setShape([]);
      window.setIgnoreMouseEvents(false);
      window.setFocusable(true);
      frame.captureExclusion?.restore();
      window.webContents.send('screenshot:scroll-overlay', {
        requestId,
        active: false,
        region: null,
      });
    }
    frame.scrollOverlay = false;
    frame.captureExclusion = undefined;
  };

  ipcMain.handle('screenshot:connect', (event): void => {
    validateWindow(event).mounted();
  });
  ipcMain.handle(
    'screenshot:read',
    (
      event,
      requestId: unknown,
    ): LocalImageData & { windows: ScreenshotRegion[] } => {
      const { frame } = validateSender(event, requestId);
      if (!frame.png) throw new Error('截图尚未就绪');
      return {
        bytes: frame.png,
        contentType: 'image/png',
        windows: frame.windows,
      };
    },
  );
  ipcMain.handle(
    'screenshot:ready',
    (event, requestId: unknown, loaded: unknown): void => {
      const { operation, frame } = validateSender(event, requestId);
      if (loaded !== true) {
        operation.finish(null, new Error('截图画面加载失败，请重试'));
        return;
      }
      frame.decoded = true;
      frame.resolveReady();
    },
  );
  ipcMain.handle('screenshot:cancel', (event, requestId: unknown): void => {
    validateSender(event, requestId).operation.finish(null);
  });
  ipcMain.handle(
    'screenshot:confirm',
    (event, requestId: unknown, value: unknown): void => {
      const { frame, operation } = validateSender(event, requestId);
      if (!frame.png || !frame.decoded) throw new Error('截图尚未就绪');
      if (operation.scroll) throw new Error('滚动截图期间不能确认普通选区');
      // 整屏 PNG 只编码一次；用户确认后才解码为 1x 图像并裁剪，保持高 DPI 语义。
      const image = nativeImage.createFromBuffer(Buffer.from(frame.png));
      const region = screenshotCrop(value, image.getSize());
      if (region.width * region.height > 40_000_000)
        throw new Error('截图像素超过 4000 万');
      const bytes = image.crop(region).toPNG();
      if (!bytes.length || bytes.length > MAX_IMAGE_BYTES)
        throw new Error('截图超过 50 MiB，请缩小选区');
      operation.validate();
      operation.finish(new Uint8Array(bytes));
    },
  );

  ipcMain.handle(
    'screenshot:scroll-finish',
    (event, requestId: unknown): void => {
      const { frame, operation } = validateSender(event, requestId);
      const state = operation.scroll;
      if (
        !state ||
        state.phase !== 'capturing' ||
        !state.capture ||
        !frame.scrollOverlay
      )
        throw new Error('滚动截图未在采集中');
      state.capture.finish();
    },
  );

  ipcMain.handle(
    'screenshot:scroll',
    async (event, requestId: unknown, value: unknown): Promise<void> => {
      const { frame, operation } = validateSender(event, requestId);
      if (operation.scroll) throw new Error('滚动截图已开始，请先完成当前任务');
      if (!frame.png || !frame.decoded) throw new Error('截图尚未就绪');
      const imageSize = nativeImage
        .createFromBuffer(Buffer.from(frame.png))
        .getSize();
      const crop = screenshotCrop(value, imageSize);
      const display = screen
        .getAllDisplays()
        .find((item) => item.id === frame.entry.displayId);
      if (!display) throw new Error('截图显示器已断开');
      const mask = createScrollScreenshotMask(
        crop,
        imageSize,
        frame.entry.window.getBounds(),
      );
      if (!mask.shape.length)
        throw new Error('请缩小选区，留出可单击结束的遮罩区域');
      const state: NonNullable<ScreenshotOperation['scroll']> = {
        phase: 'starting',
        region: mask.region,
      };
      operation.scroll = state;
      try {
        const bindCaptureExclusion =
          await createScreenshotCaptureExclusionFactory();
        operation.validate();
        const capture = await createScrollCapture({
          display,
          crop,
          imageSize,
          /** 原生点击只接受本次截图窗口的遮罩，忽略选区、外部窗口及旧任务。 */
          isMaskPoint: (point: Point): boolean => {
            if (
              active !== operation ||
              operation.scroll !== state ||
              state.phase !== 'capturing'
            )
              return false;
            return [...operation.frames.values()].some(
              (current) =>
                current.scrollOverlay &&
                !current.entry.window.isDestroyed() &&
                isScrollScreenshotMaskPoint(
                  point,
                  current.entry.window.getBounds(),
                  current === frame ? state.region : null,
                ),
            );
          },
          /** 缩略图只发送到绑定任务的截图窗口，迟到进度不能覆盖新任务。 */
          progress: (
            progress: Omit<ScrollScreenshotProgress, 'requestId'>,
          ): void => {
            if (active !== operation || operation.scroll !== state) return;
            operation.validate();
            if (state.phase !== 'capturing') return;
            frame.entry.window.webContents.send('screenshot:scroll-progress', {
              requestId: operation.id,
              ...progress,
            });
          },
          /** Escape 取消整个截图，不返回原始截图或生成草稿。 */
          dismissed: (): void => {
            if (active === operation && operation.scroll === state)
              operation.finish(null);
          },
          /** 授权和遮罩排除状态同时有效时才允许接收屏幕像素。 */
          validate: (): void => {
            operation.validate();
            for (const current of operation.frames.values()) {
              if (!current.captureExclusion)
                throw new Error('截图遮罩尚未完成捕获排除');
              current.captureExclusion.validate();
            }
          },
          /** 正常结束直接交付草稿；异常和迟到结果不能恢复窗口或交付旧图片。 */
          complete: (png: Uint8Array | undefined, message: string): void => {
            if (active !== operation || operation.scroll !== state) return;
            try {
              operation.validate();
              if (!png) throw new Error(message || '滚动截图失败');
              operation.finish(png);
            } catch (error) {
              operation.finish(
                null,
                error instanceof Error ? error : new Error('滚动截图已失效'),
              );
            }
          },
        });
        if (active !== operation || operation.scroll !== state) {
          capture.cancel();
          throw new Error('截图任务已失效');
        }
        state.capture = capture;
        operation.validate();
        state.phase = 'capturing';
        for (const current of operation.frames.values()) {
          const window = current.entry.window;
          current.scrollOverlay = true;
          current.captureExclusion = bindCaptureExclusion(window);
          window.webContents.send('screenshot:scroll-overlay', {
            requestId: operation.id,
            active: true,
            region: current === frame ? state.region : null,
          });
          current.captureExclusion.enable();
        }
        for (const current of operation.frames.values()) {
          const window = current.entry.window;
          window.setShape(current === frame ? mask.shape : []);
          window.setIgnoreMouseEvents(true);
          window.setFocusable(false);
          window.blur();
        }
        capture.start();
        if (
          active !== operation ||
          operation.scroll !== state ||
          state.phase !== 'capturing'
        )
          return;
        for (const current of operation.frames.values()) {
          if (current !== frame)
            current.entry.window.setIgnoreMouseEvents(false);
        }
        frame.stopPointerRouting = routeScrollScreenshotPointer(
          frame.entry.window,
          {
            x: display.bounds.x + mask.region.x * display.bounds.width,
            y: display.bounds.y + mask.region.y * display.bounds.height,
            width: mask.region.width * display.bounds.width,
            height: mask.region.height * display.bounds.height,
          },
          (error: Error): void => {
            if (active === operation && operation.scroll === state)
              operation.finish(null, error);
          },
        );
      } catch (error) {
        state.capture?.cancel();
        if (active === operation && operation.scroll === state) {
          try {
            for (const current of operation.frames.values())
              restoreScrollOverlay(current, operation.id);
            operation.scroll = undefined;
            frame.entry.window.show();
            frame.entry.window.focus();
          } catch (restoreError) {
            operation.finish(
              null,
              restoreError instanceof Error
                ? restoreError
                : new Error('恢复截图遮罩失败'),
            );
          }
        }
        throw error;
      }
    },
  );

  /** 抓取当前新画面，与冷窗口加载并行；所有画面完成解码后再显示，避免黑屏假响应。 */
  const prepare = async (
    operation: ScreenshotOperation,
    hideWindow: boolean,
    started: number,
  ): Promise<void> => {
    operation.validate();
    const displays = screen.getAllDisplays();
    const dimensions = displays.map((display) => ({
      width: Math.ceil(display.size.width * display.scaleFactor),
      height: Math.ceil(display.size.height * display.scaleFactor),
    }));
    const thumbnailSize = {
      width: Math.max(...dimensions.map((size) => size.width)),
      height: Math.max(...dimensions.map((size) => size.height)),
    };
    if (
      !displays.length ||
      thumbnailSize.width * thumbnailSize.height > 40_000_000 ||
      dimensions.some((size) => size.width * size.height > 40_000_000) ||
      dimensions.reduce((sum, size) => sum + size.width * size.height, 0) >
        80_000_000
    )
      throw new Error('显示器总分辨率超过截图上限');
    const existing = new Set(pool.values());
    const entries = ensurePool(displays);
    const prewarmed = entries.every(
      (entry) => existing.has(entry) && entry.booted,
    );
    const boot = Promise.all(entries.map((entry) => entry.boot));
    // 立即挂上失败处理，避免抓屏尚未返回时冷窗口加载失败产生未处理拒绝。
    void boot.catch(() => {});
    for (const entry of entries) {
      let resolveReady: () => void = (): void => {};
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });
      operation.frames.set(entry.window.webContents.id, {
        entry,
        png: undefined,
        windows: [],
        decoded: false,
        scrollOverlay: false,
        ready,
        resolveReady,
      });
    }
    const windows = await readScreenshotWindows(
      entries.map((entry) => entry.window),
    );
    operation.validate();
    for (const frame of operation.frames.values()) {
      const display = displays.find(
        (item) => item.id === frame.entry.displayId,
      );
      if (display && windows.length)
        frame.windows = projectScreenshotWindows(
          windows,
          screen.dipToScreenRect(null, display.bounds),
        );
    }
    const captureStarted = performance.now();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize,
      fetchWindowIcons: false,
    });
    const captureMs = performance.now() - captureStarted;
    operation.validate();
    const encodeStarted = performance.now();
    for (const frame of operation.frames.values()) {
      const source = sources.find(
        (item) => item.display_id === String(frame.entry.displayId),
      );
      if (!source || source.thumbnail.isEmpty())
        throw new Error('无法读取屏幕，请检查系统录屏权限后重试');
      const size = source.thumbnail.getSize();
      if (size.width * size.height > 40_000_000)
        throw new Error('屏幕截图无效或分辨率过大');
      frame.png = new Uint8Array(source.thumbnail.toPNG());
    }
    const encodeMs = performance.now() - encodeStarted;
    const windowStarted = performance.now();
    await boot;
    const windowWaitMs = performance.now() - windowStarted;
    operation.validate();
    const transferStarted = performance.now();
    for (const frame of operation.frames.values())
      frame.entry.window.webContents.send('screenshot:request', operation.id);
    await Promise.all(
      [...operation.frames.values()].map((frame) => frame.ready),
    );
    operation.validate();
    const focusedDisplay = screen.getDisplayNearestPoint(
      screen.getCursorScreenPoint(),
    );
    const focused = (
      entries.find((entry) => entry.displayId === focusedDisplay.id) ??
      entries[0]
    )?.window;
    for (const { window } of entries) {
      if (window === focused) window.show();
      else window.showInactive();
    }
    focused?.focus();
    for (const { window } of entries) {
      window.setAlwaysOnTop(true, 'screen-saver');
      window.moveTop();
    }
    dependencies.reportTiming?.({
      prewarmed,
      hideWindow,
      displayCount: entries.length,
      captureMs,
      encodeMs,
      windowWaitMs,
      transferDecodeMs: performance.now() - transferStarted,
      readyMs: performance.now() - started,
    });
  };

  /** 当前授权页面发起单次截图；结束后只保留清空的窗口，不复用屏幕内容。 */
  const capture = async (
    roomId: string,
    validate: () => void,
    hideWindow: boolean = true,
    sourceWindow?: BrowserWindow,
  ): Promise<Uint8Array | null> => {
    validate();
    if (active) throw new Error('请先完成当前截图');
    const main = sourceWindow ?? dependencies.getMainWindow();
    if (!main || main.isDestroyed()) throw new Error('主窗口已关闭');
    clearTimeout(warmupTimer);
    const visible = main.isVisible();
    const started = performance.now();
    return new Promise<Uint8Array | null>((resolve, reject) => {
      let finished = false;
      let restoreContentProtection = false;
      const operation: ScreenshotOperation = {
        id: randomUUID(),
        roomId,
        frames: new Map(),
        /** 旧抓屏、窗口加载和图片就绪结果不能进入后续任务。 */
        validate: (): void => {
          if (active !== operation) throw new Error('截图已取消');
          validate();
        },
        /** 先撤销任务权限再清空图片，唤醒等待链并隐藏空窗口。 */
        finish: (bytes: Uint8Array | null, error?: Error): void => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          clearTimeout(loadingTimer);
          if (active === operation) active = undefined;
          operation.scroll?.capture?.cancel();
          operation.scroll = undefined;
          let discard = Boolean(error);
          for (const frame of operation.frames.values()) {
            frame.png = undefined;
            frame.windows = [];
            frame.resolveReady();
            const window = frame.entry.window;
            if (!window.isDestroyed()) {
              try {
                window.hide();
                restoreScrollOverlay(frame, operation.id);
                window.webContents.send('screenshot:request', null);
              } catch {
                discard = true;
              }
            }
          }
          operation.frames.clear();
          if (discard) destroyPool();
          let completionError = error;
          if (!main.isDestroyed()) {
            try {
              if (restoreContentProtection) main.setContentProtection(false);
            } catch (restoreError) {
              completionError ??= new Error('恢复窗口屏幕捕获状态失败', {
                cause: restoreError,
              });
            }
            try {
              if (visible) {
                if (hideWindow) main.show();
                main.focus();
              }
            } catch (restoreError) {
              completionError ??= new Error('恢复截图发起窗口失败', {
                cause: restoreError,
              });
            }
          }
          if (completionError) reject(completionError);
          else resolve(bytes);
        },
      };
      const timer = setTimeout(
        () => operation.finish(null, new Error('截图已超时，请重试')),
        360_000,
      );
      const loadingTimer = setTimeout(
        () =>
          operation.finish(null, new Error('屏幕读取超时，请检查系统录屏权限')),
        15_000,
      );
      active = operation;
      try {
        if (hideWindow) {
          if (process.platform === 'win32' && !main.isContentProtected()) {
            restoreContentProtection = true;
            main.setContentProtection(true);
          }
          main.hide();
        }
      } catch (error) {
        operation.finish(
          null,
          error instanceof Error ? error : new Error('隐藏截图发起窗口失败'),
        );
        return;
      }
      void prepare(operation, hideWindow, started)
        .then(() => {
          clearTimeout(loadingTimer);
        })
        .catch((error: unknown) =>
          operation.finish(
            null,
            error instanceof Error ? error : new Error('截图失败，请重试'),
          ),
        );
    });
  };

  return { warmup, capture, cancel };
};
