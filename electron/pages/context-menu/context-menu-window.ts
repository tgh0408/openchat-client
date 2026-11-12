import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage } from 'electron';
import path from 'node:path';
import {
  parseContextMenuBinding,
  parseContextMenuId,
  parseContextMenuNumber,
  parseContextMenuRequest,
  positionContextMenu,
  type ContextMenuRequest,
  type ContextMenuSnapshot,
} from '../../../shared/windows/context-menu';
import { sendWindowNotification } from '../../services/ipc/window-notifications';

export interface ContextMenuOwner {
  window: BrowserWindow;
  validate: () => void;
  onDismiss?: () => void;
}

interface ActiveMenu {
  owner: ContextMenuOwner;
  request: ContextMenuRequest;
  snapshot: ContextMenuSnapshot;
  dispose: () => void;
  timer?: ReturnType<typeof setTimeout>;
}

/** 全应用只预热一个沙箱菜单页，业务回调和身份始终保留在来源窗口。 */
export const createContextMenuController = (dependencies: {
  getRendererUrl: () => string;
  getDefaultIcon: () => NativeImage;
  resolveOwner: (event: IpcMainInvokeEvent) => ContextMenuOwner;
}): {
  warmup: () => void;
  clear: () => void;
  destroy: () => void;
  isOpenFor: (window: BrowserWindow) => boolean;
} => {
  let popup: BrowserWindow | undefined;
  let ready = false;
  let painted = false;
  let generation = 0;
  let active: ActiveMenu | undefined;
  let blurTimer: ReturnType<typeof setTimeout> | undefined;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  const url = new URL(dependencies.getRendererUrl());
  url.hash = 'context-menu';

  /** 结束一次显示并释放上下文，但正常关闭不销毁页面或原生窗口。 */
  const finish = (
    restoreFocus = false,
    itemId?: string,
    error?: string,
  ): void => {
    const entry = active;
    active = undefined;
    clearTimeout(blurTimer);
    if (entry) {
      clearTimeout(entry.timer);
      entry.dispose();
    }
    if (popup && !popup.isDestroyed()) {
      popup.hide();
      sendWindowNotification(popup, 'context-menu:snapshot', null);
    }
    if (!entry) return;
    try {
      entry.owner.validate();
      if (restoreFocus && !entry.owner.window.isDestroyed())
        entry.owner.window.focus();
      sendWindowNotification(entry.owner.window, 'context-menu:result', {
        requestId: entry.request.requestId,
        itemId,
        error,
      });
      if (!restoreFocus) entry.owner.onDismiss?.();
    } catch {
      // 原页面或账号失效后，旧操作不得交给新页面。
    }
  };

  /** 页面加载失败或应用退出时才回收常驻窗口。 */
  const destroy = (): void => {
    finish();
    clearTimeout(loadTimer);
    const previous = popup;
    popup = undefined;
    ready = false;
    painted = false;
    if (previous && !previous.isDestroyed()) previous.destroy();
  };

  /** 来源与菜单的焦点交接完成后再收起，点击菜单不触发来源页的失焦清理。 */
  const scheduleBlur = (): void => {
    const entry = active;
    if (!entry) return;
    clearTimeout(blurTimer);
    blurTimer = setTimeout((): void => {
      if (active !== entry) return;
      if (BrowserWindow.getFocusedWindow() !== popup) finish();
    }, 80);
  };

  /** 源坐标以页面 CSS 像素传入，按实际 zoom 转成屏幕 DIP。 */
  const geometry = (
    entry: ActiveMenu,
  ): {
    anchor: { x: number; y: number };
    area: Electron.Rectangle;
    zoom: number;
  } => {
    entry.owner.validate();
    const bounds = entry.owner.window.getContentBounds();
    const zoom = entry.owner.window.webContents.getZoomFactor();
    const x = Math.max(0, Math.min(bounds.width, entry.request.x * zoom));
    const y = Math.max(0, Math.min(bounds.height, entry.request.y * zoom));
    const point = { x: Math.round(bounds.x + x), y: Math.round(bounds.y + y) };
    const area = screen.getDisplayNearestPoint(point).workArea;
    return {
      anchor: { x: point.x - 16 * zoom, y: point.y - 16 * zoom },
      area,
      zoom,
    };
  };

  /** 在隐藏窗口中更新内容，收到当前版本的布局回报后才显示。 */
  const publish = (): void => {
    const entry = active;
    if (!entry || !popup || popup.isDestroyed() || !ready || !painted) return;
    try {
      const { area, zoom } = geometry(entry);
      popup.webContents.setZoomFactor(zoom);
      const maxWidth = Math.max(
        80,
        Math.min(entry.request.maxWidth, area.width / zoom - 32),
      );
      entry.snapshot = {
        ...entry.request,
        generation: entry.snapshot.generation,
        minWidth: Math.min(entry.request.minWidth, maxWidth),
        maxWidth,
        maxHeight: Math.max(40, area.height / zoom - 32),
      };
      sendWindowNotification(popup, 'context-menu:snapshot', entry.snapshot);
    } catch {
      finish();
    }
  };

  /** 启动后提前加载页面和菜单库，后续点击不会创建窗口或再次 loadURL。 */
  const warmup = (): void => {
    if (popup && !popup.isDestroyed()) return;
    const window = new BrowserWindow({
      width: 640,
      height: 800,
      useContentSize: true,
      frame: false,
      thickFrame: false,
      transparent: true,
      backgroundColor: '#00000000',
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      show: false,
      autoHideMenuBar: true,
      title: '菜单',
      icon: dependencies.getDefaultIcon(),
      // 只维护逻辑来源绑定，不设置原生父级，避免来源强制销毁时连带销毁常驻菜单。
      webPreferences: {
        preload: path.join(__dirname, 'context-menu-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    popup = window;
    /** 加载失败明确通知来源，下一次预热允许重建故障窗口。 */
    const failed = (): void => {
      if (popup !== window) return;
      finish(true, undefined, '菜单加载失败，请重试');
      destroy();
    };
    loadTimer = setTimeout(failed, 15000);
    window.once('ready-to-show', () => {
      if (popup !== window) return;
      painted = true;
      if (ready) clearTimeout(loadTimer);
      publish();
    });
    window.on('blur', scheduleBlur);
    window.on('closed', failed);
    window.webContents.on('render-process-gone', failed);
    window.webContents.on('did-fail-load', failed);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        finish(true);
      }
    });
    void window.loadURL(url.href).catch(failed);
  };

  /** 子窗口仅可操作自身主框架，不能借通用 IPC 取得来源页能力。 */
  const validatePopup = (event: IpcMainInvokeEvent): void => {
    if (
      !popup ||
      popup.isDestroyed() ||
      event.sender !== popup.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== url.href
    )
      throw new Error('菜单窗口来源无效');
  };

  /** 已取消或已替换的显示回报直接丢弃，不误关闭后来打开的菜单。 */
  const current = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): ActiveMenu | undefined => {
    validatePopup(event);
    const binding = parseContextMenuBinding(value);
    if (
      !active ||
      binding.generation !== active.snapshot.generation ||
      binding.revision !== active.request.revision
    )
      return undefined;
    try {
      active.owner.validate();
    } catch (error: unknown) {
      finish();
      throw error;
    }
    return active;
  };

  ipcMain.handle('context-menu:show', (event, value: unknown): void => {
    const owner = dependencies.resolveOwner(event);
    const request = parseContextMenuRequest(value);
    owner.validate();
    if (
      !owner.window.isVisible() ||
      owner.window.isMinimized() ||
      !owner.window.isFocused()
    )
      throw new Error('菜单来源窗口不在前台');
    finish();
    warmup();
    const contents = owner.window.webContents;
    /** 来源移动、隐藏或关闭后撤销显示，同时保留预热页面。 */
    const dismiss = (): void => {
      if (active === entry) finish();
    };
    /** 页面重载使原闭包失效，不能向新页面投递旧菜单结果。 */
    const navigate = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (event.isMainFrame && !event.isSameDocument) dismiss();
    };
    const entry: ActiveMenu = {
      owner,
      request,
      snapshot: { ...request, generation: ++generation, maxHeight: 800 },
      dispose: (): void => {
        owner.window.removeListener('move', dismiss);
        owner.window.removeListener('resize', dismiss);
        owner.window.removeListener('hide', dismiss);
        owner.window.removeListener('minimize', dismiss);
        owner.window.removeListener('close', dismiss);
        owner.window.removeListener('closed', dismiss);
        owner.window.removeListener('blur', scheduleBlur);
        contents.removeListener('did-start-navigation', navigate);
        contents.removeListener('render-process-gone', dismiss);
      },
    };
    active = entry;
    owner.window.on('move', dismiss);
    owner.window.on('resize', dismiss);
    owner.window.on('hide', dismiss);
    owner.window.on('minimize', dismiss);
    owner.window.on('close', dismiss);
    owner.window.on('closed', dismiss);
    owner.window.on('blur', scheduleBlur);
    contents.on('did-start-navigation', navigate);
    contents.on('render-process-gone', dismiss);
    entry.timer = setTimeout((): void => {
      if (active === entry) finish(true, undefined, '菜单显示超时，请重试');
    }, 15000);
    publish();
  });
  ipcMain.handle('context-menu:update', (event, value: unknown): void => {
    const owner = dependencies.resolveOwner(event);
    const request = parseContextMenuRequest(value);
    if (
      !active ||
      active.owner.window !== owner.window ||
      active.request.requestId !== request.requestId ||
      request.revision <= active.request.revision
    )
      return;
    active.owner.validate();
    active.request = request;
    publish();
  });
  ipcMain.handle('context-menu:hide', (event, value: unknown): void => {
    const owner = dependencies.resolveOwner(event);
    const id = parseContextMenuId(value);
    if (
      active?.owner.window === owner.window &&
      active.request.requestId === id
    )
      finish(
        Boolean(
          popup?.isFocused() &&
          owner.window.isVisible() &&
          !owner.window.isMinimized(),
        ),
      );
  });
  ipcMain.handle('context-menu:ready', (event): ContextMenuSnapshot | null => {
    validatePopup(event);
    ready = true;
    if (painted) clearTimeout(loadTimer);
    publish();
    return active?.snapshot ?? null;
  });
  ipcMain.handle(
    'context-menu:layout',
    (event, binding: unknown, value: unknown): void => {
      const entry = current(event, binding);
      if (!entry || !popup || !ready || !painted) return;
      if (!value || typeof value !== 'object') throw new Error('菜单尺寸无效');
      const size = value as Record<string, unknown>;
      const width = parseContextMenuNumber(size.width, 1, 1000);
      const height = parseContextMenuNumber(size.height, 1, 10000);
      const { anchor, area, zoom } = geometry(entry);
      if (
        !entry.owner.window.isVisible() ||
        entry.owner.window.isMinimized() ||
        (!entry.owner.window.isFocused() && !popup.isFocused())
      ) {
        finish();
        return;
      }
      const bounds = positionContextMenu(anchor, area, {
        width: (width + 32) * zoom,
        height: (height + 32) * zoom,
      });
      const previous = popup.getBounds();
      if (
        Object.keys(bounds).some(
          (key) =>
            bounds[key as keyof typeof bounds] !==
            previous[key as keyof typeof bounds],
        )
      )
        popup.setBounds(bounds, false);
      if (!popup.isVisible()) {
        popup.setAlwaysOnTop(entry.owner.window.isAlwaysOnTop());
        popup.show();
        popup.focus();
      }
      clearTimeout(entry.timer);
    },
  );
  ipcMain.handle(
    'context-menu:select',
    (event, binding: unknown, value: unknown): void => {
      const entry = current(event, binding);
      if (!entry || !popup?.isVisible()) return;
      const id = parseContextMenuId(value);
      const item = entry.request.items.find((candidate) => candidate.id === id);
      if (!item || item.disabled || item.hidden || item.divided === 'self')
        throw new Error('菜单操作不可用');
      finish(true, id);
    },
  );
  ipcMain.handle('context-menu:dismiss', (event, binding: unknown): void => {
    if (current(event, binding)) finish(true);
  });
  screen.on('display-metrics-changed', () => finish());
  screen.on('display-removed', () => finish());
  return {
    warmup,
    clear: () => finish(),
    destroy,
    isOpenFor: (window) => active?.owner.window === window,
  };
};
