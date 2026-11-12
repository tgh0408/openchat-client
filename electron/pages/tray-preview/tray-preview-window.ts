import { BrowserWindow, ipcMain, nativeImage, screen } from 'electron';
import type { IpcMainInvokeEvent, Rectangle, Tray } from 'electron';
import path from 'node:path';
import type { AuthSession } from '../../../shared/auth/auth';
import type { TrayConversation } from '../../../shared/windows/tray-preview';
import type { GroupDirectoryItem } from '../../../shared/contacts/group';
import { requireAuthenticatedSession } from '../../services/auth/auth';
import {
  getRemoteConversation,
  listUnreadConversations,
} from '../../services/database/database';
import { getApplicationIcon } from '../../services/runtime/application-icon';
import { sendWindowNotification } from '../../services/ipc/window-notifications';

interface TrayPreviewOptions {
  tray: Tray;
  getSession: () => AuthSession | null;
  getRendererUrl: () => string;
  openConversation: (id: string) => void;
}

interface PreviewEntry {
  window: BrowserWindow;
  session: AuthSession;
  url: string;
  nativeReady: boolean;
  rendererReady: boolean;
}

/** 托盘悬浮预览与闪烁共用已授权的本地未读数，不创建新的 SSE。 */
export const createTrayPreview = (
  options: TrayPreviewOptions,
): {
  refresh: () => void;
  unread: (roomId: string, count: number, newMessage?: boolean) => void;
  setGroups: (session: AuthSession, groups: GroupDirectoryItem[]) => void;
  warmup: () => void;
  hide: () => void;
  setMenuVisible: (visible: boolean) => void;
  reset: () => void;
  destroy: () => void;
} => {
  const { tray } = options;
  const icon = getApplicationIcon();
  // 保留透明图像尺寸，闪烁时不移除系统托盘的鼠标命中区域。
  const blank = nativeImage.createFromBitmap(Buffer.alloc(16 * 16 * 4), {
    width: 16,
    height: 16,
  });
  const groups = new Map<string, NonNullable<TrayConversation['group']>>();
  let ignored = false;
  let items: TrayConversation[] = [];
  let owner: AuthSession | null = null;
  let entry: PreviewEntry | undefined;
  let flashTimer: ReturnType<typeof setInterval> | undefined;
  let pointerTimer: ReturnType<typeof setInterval> | undefined;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let hoverTimer: ReturnType<typeof setTimeout> | undefined;
  let readyTimer: ReturnType<typeof setTimeout> | undefined;
  let wanted = false;
  let menuVisible = false;
  let transparent = false;
  let outsideSince = 0;

  /** 收起浮层并停止鼠标检测，保留未读与忽略状态。 */
  const hide = (): void => {
    wanted = false;
    clearTimeout(hoverTimer);
    clearInterval(pointerTimer);
    pointerTimer = undefined;
    if (entry && !entry.window.isDestroyed()) entry.window.hide();
  };

  /** 菜单显示期间取消悬浮与迟到就绪，关闭后等待下一次悬浮再展示。 */
  const setMenuVisible = (visible: boolean): void => {
    menuVisible = visible;
    hide();
  };

  /** 停止闪烁并恢复原始 ICO。 */
  const stopFlash = (): void => {
    clearInterval(flashTimer);
    flashTimer = undefined;
    transparent = false;
    if (!tray.isDestroyed()) tray.setImage(icon);
  };

  /** 注销或页面失效时销毁内容浮层，清除旧账号内存和全部定时任务。 */
  const reset = (): void => {
    hide();
    stopFlash();
    clearTimeout(refreshTimer);
    clearTimeout(readyTimer);
    refreshTimer = undefined;
    const previous = entry;
    entry = undefined;
    if (previous && !previous.window.isDestroyed()) previous.window.destroy();
    items = [];
    ignored = false;
    groups.clear();
    owner = null;
    if (!tray.isDestroyed()) tray.setToolTip('OpenChat');
  };

  /** 每次访问重新核对当前授权对象，拒绝同账号重新授权后的旧窗口。 */
  const validateSession = (): AuthSession => {
    const session = requireAuthenticatedSession();
    if (!owner || session !== owner || options.getSession() !== owner)
      throw new Error('托盘会话已失效');
    return session;
  };

  /** 暂不处理后保持静默，只有新消息落库入口可以恢复提醒。 */
  const updateFlash = (): void => {
    if (ignored || !items.length) {
      stopFlash();
      return;
    }
    if (flashTimer) return;
    flashTimer = setInterval((): void => {
      try {
        validateSession();
      } catch {
        reset();
        return;
      }
      if (tray.isDestroyed()) {
        reset();
        return;
      }
      transparent = !transparent;
      tray.setImage(transparent ? blank : icon);
    }, 500);
  };

  /** 将浮层放到托盘附近并限制在对应显示器工作区，兼容不同任务栏位置。 */
  const position = (window: BrowserWindow): void => {
    const anchor = tray.getBounds();
    const area = screen.getDisplayMatching(anchor).workArea;
    const width = Math.min(264, area.width);
    // 列表上下留白 10px、底栏 44px、外边框 2px，避免少算边框产生滚动条。
    const height = Math.min(56 + Math.min(items.length, 4) * 58, area.height);
    const x = Math.max(
      area.x,
      Math.min(anchor.x + anchor.width - width, area.x + area.width - width),
    );
    const above = anchor.y - height - 4;
    const y = Math.max(
      area.y,
      Math.min(
        above >= area.y ? above : anchor.y + anchor.height + 4,
        area.y + area.height - height,
      ),
    );
    window.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
  };

  /** 仅在原生窗口与页面首帧均完成后显示，不抢占主窗口焦点。 */
  const showReady = (): void => {
    if (
      !entry ||
      !wanted ||
      menuVisible ||
      !items.length ||
      !entry.nativeReady ||
      !entry.rendererReady
    )
      return;
    try {
      validateSession();
    } catch {
      reset();
      return;
    }
    clearTimeout(readyTimer);
    position(entry.window);
    entry.window.setAlwaysOnTop(true);
    entry.window.moveTop();
    entry.window.showInactive();
  };

  /** 一次读取所有分页，避免只提醒最近五十条会话中的未读。 */
  const refreshNow = (): void => {
    const session = options.getSession();
    if (!session) {
      // 群资料可能在工作台首帧前返回；保留头像快照，待授权窗口完成交接后再合并未读会话。
      hide();
      stopFlash();
      items = [];
      try {
        if (owner !== requireAuthenticatedSession()) reset();
      } catch {
        reset();
      }
      return;
    }
    if (owner !== session) {
      reset();
      owner = session;
    }
    try {
      validateSession();
      const next: TrayConversation[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = listUnreadConversations(200, offset);
        next.push(
          ...page.map((item): TrayConversation => ({
            ...item,
            group: item.type === 1 ? groups.get(item.id) : undefined,
          })),
        );
        if (page.length < 200) break;
      }
      items = next;
      updateFlash();
      // 有自定义预览时关闭系统提示，避免两个浮层重叠。
      tray.setToolTip(items.length ? '' : 'OpenChat');
      if (!items.length) hide();
      if (entry) {
        sendWindowNotification(entry.window, 'tray-preview:changed', items);
        if (entry.window.isVisible()) position(entry.window);
      }
    } catch {
      reset();
    }
  };

  /** 合并同一轮消息、未读确认和列表同步事件，事务提交后读取真实计数。 */
  const refresh = (): void => {
    if (refreshTimer) return;
    refreshTimer = setTimeout((): void => {
      refreshTimer = undefined;
      refreshNow();
    }, 80);
  };

  /** 登录完成后预热隐藏的预览窗口，避免首次悬浮时等待页面加载。 */
  const warmup = (): void => {
    if (menuVisible || tray.isDestroyed() || entry) return;
    const session = options.getSession();
    if (!session) return;
    try {
      refreshNow();
      if (!owner || owner !== session || tray.isDestroyed()) return;
      createPreviewWindow();
    } catch {
      reset();
    }
  };

  /** 只有实际新增未读消息才解除静默，普通同步、重复消息和已读校正均不解除。 */
  const unread = (
    roomId: string,
    count: number,
    newMessage: boolean = false,
  ): void => {
    if (
      newMessage &&
      count > 0 &&
      getRemoteConversation(roomId)?.notDisturb !== 1
    )
      ignored = false;
    refresh();
  };

  /** 复用会话列表的真实群头像结果，仅保留当前授权内的拼图字段。 */
  const setGroups = (
    session: AuthSession,
    result: GroupDirectoryItem[],
  ): void => {
    if (requireAuthenticatedSession() !== session) return;
    if (owner !== session) {
      reset();
      owner = session;
    }
    groups.clear();
    for (const group of result)
      groups.set(group.roomId, {
        memberCount: group.memberCount,
        avatarList: [...group.avatarList],
      });
    if (options.getSession() === session) refresh();
  };

  /** 判断鼠标是否位于托盘或浮层内，保留少量边缘容差。 */
  const containsPointer = (bounds: Rectangle): boolean => {
    const point = screen.getCursorScreenPoint();
    return (
      point.x >= bounds.x - 6 &&
      point.x <= bounds.x + bounds.width + 6 &&
      point.y >= bounds.y - 6 &&
      point.y <= bounds.y + bounds.height + 6
    );
  };

  /** 鼠标离开托盘和预览后延迟收起，允许跨越两者之间的间隙。 */
  const trackPointer = (): void => {
    clearInterval(pointerTimer);
    outsideSince = 0;
    pointerTimer = setInterval((): void => {
      try {
        validateSession();
      } catch {
        reset();
        return;
      }
      if (tray.isDestroyed()) {
        reset();
        return;
      }
      const inside =
        containsPointer(tray.getBounds()) ||
        (!!entry?.window.isVisible() &&
          containsPointer(entry.window.getBounds()));
      if (inside) outsideSince = 0;
      else if (!outsideSince) outsideSince = Date.now();
      else if (Date.now() - outsideSince >= 450) hide();
    }, 100);
  };

  /** 按需创建专属沙箱窗口，登录预热后复用当前授权内的浮层。 */
  const show = (): void => {
    if (menuVisible) return;
    refreshNow();
    if (!owner || !items.length || tray.isDestroyed()) return;
    wanted = true;
    trackPointer();
    if (entry) {
      showReady();
      return;
    }
    createPreviewWindow();
    showReady();
  };

  /** 创建托盘预览的隐藏窗口，等待原生窗口和页面首帧完成后再按需显示。 */
  const createPreviewWindow = (): void => {
    if (entry || !owner || tray.isDestroyed()) return;
    const url = new URL(options.getRendererUrl());
    url.hash = 'tray-preview';
    const window = new BrowserWindow({
      width: 264,
      height: 56 + Math.min(items.length, 4) * 58,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      show: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      title: 'OpenChat 未读消息',
      icon,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'tray-preview-preload.cjs'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    });
    const current: PreviewEntry = {
      window,
      session: owner,
      url: url.href,
      nativeReady: false,
      rendererReady: false,
    };
    entry = current;
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on(
      'did-start-navigation',
      (_event, target, inPlace, mainFrame) => {
        if (
          mainFrame &&
          !inPlace &&
          (current.rendererReady || target !== current.url)
        )
          window.destroy();
      },
    );
    window.webContents.on('render-process-gone', () => window.destroy());
    window.webContents.on('preload-error', () => window.destroy());
    window.once('ready-to-show', () => {
      if (entry === current) {
        current.nativeReady = true;
        showReady();
      }
    });
    window.on('blur', hide);
    window.on('closed', () => {
      if (entry === current) {
        hide();
        clearTimeout(readyTimer);
        entry = undefined;
      }
    });
    readyTimer = setTimeout((): void => {
      if (entry === current && (!current.rendererReady || !current.nativeReady))
        window.destroy();
    }, 15000);
    void window.loadURL(current.url).catch(() => {
      if (!window.isDestroyed()) window.destroy();
    });
  };

  /** 短暂停留后打开，避免快速划过托盘时弹出。 */
  const hover = (): void => {
    clearTimeout(hoverTimer);
    if (menuVisible) return;
    hoverTimer = setTimeout((): void => {
      if (tray.isDestroyed() || !containsPointer(tray.getBounds())) return;
      try {
        show();
      } catch {
        hide();
      }
    }, 180);
  };

  /** 子窗口只能访问自身主框架和原授权，不能读取任意账号或调用主页面接口。 */
  const validate = (event: IpcMainInvokeEvent): PreviewEntry => {
    const current = entry;
    if (
      !current ||
      current.window.isDestroyed() ||
      event.sender !== current.window.webContents ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== current.url ||
      validateSession() !== current.session
    )
      throw new Error('无效的托盘预览请求');
    return current;
  };

  ipcMain.handle('tray-preview:read', (event): TrayConversation[] => {
    validate(event);
    return items;
  });
  ipcMain.handle('tray-preview:ready', (event): void => {
    validate(event).rendererReady = true;
    showReady();
  });
  ipcMain.handle('tray-preview:open', (event, id: unknown): void => {
    const current = validate(event);
    if (!current.window.isVisible()) throw new Error('托盘预览已关闭');
    refreshNow();
    validate(event);
    if (typeof id !== 'string' || !items.some((item) => item.id === id))
      throw new Error('未读会话已变化');
    options.openConversation(id);
    hide();
  });
  ipcMain.handle('tray-preview:ignore', (event): void => {
    if (!validate(event).window.isVisible()) throw new Error('托盘预览已关闭');
    ignored = true;
    updateFlash();
    hide();
  });
  ipcMain.handle('tray-preview:hide', (event): void => {
    validate(event);
    hide();
  });
  tray.on('mouse-enter', hover);
  tray.on('click', hide);
  tray.on('double-click', hide);
  tray.on('right-click', hide);

  /** 应用退出时移除托盘监听及专属 IPC，不留下闪烁或隐藏窗口。 */
  const destroy = (): void => {
    reset();
    tray.removeListener('mouse-enter', hover);
    tray.removeListener('click', hide);
    tray.removeListener('double-click', hide);
    tray.removeListener('right-click', hide);
    for (const name of ['read', 'ready', 'open', 'ignore', 'hide'])
      ipcMain.removeHandler(`tray-preview:${name}`);
  };
  return {
    refresh,
    unread,
    setGroups,
    warmup,
    hide,
    setMenuVisible,
    reset,
    destroy,
  };
};
