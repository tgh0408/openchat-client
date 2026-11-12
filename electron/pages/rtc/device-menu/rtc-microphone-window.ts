import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent, NativeImage, Rectangle } from 'electron';
import path from 'node:path';
import {
  createRtcMicrophoneState,
  parseRtcMicrophoneAnchor,
  parseRtcMicrophoneCommand,
  parseRtcMicrophoneState,
  parseRtcDeviceMenuBinding,
  positionRtcMicrophoneMenu,
  readRtcDeviceLabel,
  type RtcAudioMenuKind,
  type RtcMicrophoneSnapshot,
  type RtcMicrophoneState,
} from '../../../../shared/rtc/rtc-microphone';
import { sendWindowNotification } from '../../../services/ipc/window-notifications';

export interface RtcMicrophoneOwner {
  window: BrowserWindow;
  allowCamera: boolean;
  validate: () => void;
}

interface MenuEntry {
  owner: RtcMicrophoneOwner;
  popup?: BrowserWindow;
  url: string;
  snapshot: RtcMicrophoneSnapshot;
  states: Record<RtcAudioMenuKind, RtcMicrophoneState>;
  terminal: boolean;
  anchor?: Rectangle;
  height: number;
  ready: boolean;
  painted: boolean;
  warmAttempted: boolean;
  requested: boolean;
  focusRequested: boolean;
  keyboardActive: boolean;
  dragging: boolean;
  hideTimer?: ReturnType<typeof setTimeout>;
  blurTimer?: ReturnType<typeof setTimeout>;
  preloadTimer?: ReturnType<typeof setTimeout>;
  disposeListeners: () => void;
}

/** 每通电话只预热一个设备菜单窗口，媒体和通话凭据始终由原通话窗口持有。 */
export const createRtcMicrophoneWindowController = (dependencies: {
  getRendererUrl: () => string;
  getDefaultIcon: () => NativeImage;
  resolveOwner: (event: IpcMainInvokeEvent) => RtcMicrophoneOwner | undefined;
}): {
  prepare: (owner: RtcMicrophoneOwner) => void;
  close: (owner: BrowserWindow) => void;
  hide: (owner: BrowserWindow) => void;
} => {
  const entries = new Map<BrowserWindow, MenuEntry>();
  const channel = 'rtc-device-menu';
  const label = '设备';

  /** 所有延迟操作和子窗口 IPC 都复核原页面、账号和通话归属。 */
  const validate = (entry: MenuEntry): void => {
    if (entries.get(entry.owner.window) !== entry)
      throw new Error(`${label}菜单已失效`);
    entry.owner.validate();
  };

  /** 只向原通话页面报告实际显示状态或加载失败。 */
  const notifyStatus = (
    entry: MenuEntry,
    visible: boolean,
    error?: string,
  ): void => {
    try {
      validate(entry);
      sendWindowNotification(
        entry.owner.window,
        `rtc-${entry.snapshot.kind}:status`,
        {
          visible,
          error,
        },
      );
    } catch {
      // 原页面或账号失效后不向新页面发送旧菜单状态。
    }
  };

  /** 隐藏但不销毁已经加载的窗口，下次悬浮直接复用。 */
  const hide = (entry: MenuEntry): void => {
    entry.requested = false;
    entry.focusRequested = false;
    entry.keyboardActive = false;
    entry.dragging = false;
    clearTimeout(entry.hideTimer);
    entry.hideTimer = undefined;
    clearTimeout(entry.blurTimer);
    entry.blurTimer = undefined;
    if (entry.popup && !entry.popup.isDestroyed() && entry.popup.isVisible())
      entry.popup.hide();
    notifyStatus(entry, false);
  };

  /** 撤销窗口引用后再销毁，阻止迟到的加载回调重新显示它。 */
  const destroyPopup = (entry: MenuEntry): void => {
    hide(entry);
    clearTimeout(entry.preloadTimer);
    entry.preloadTimer = undefined;
    const popup = entry.popup;
    entry.popup = undefined;
    entry.ready = false;
    entry.painted = false;
    if (popup && !popup.isDestroyed()) popup.destroy();
  };

  /** 通话关闭、页面重载或授权撤销时销毁预热菜单及全部监听。 */
  const close = (owner: BrowserWindow): void => {
    const entry = entries.get(owner);
    if (!entry) return;
    destroyPopup(entry);
    entries.delete(owner);
    clearTimeout(entry.blurTimer);
    entry.disposeListeners();
  };

  /** 将按钮页面坐标换算为 DIP，拒绝把任意屏幕位置作为弹窗入口。 */
  const screenAnchor = (entry: MenuEntry): Rectangle => {
    const anchor = entry.anchor;
    if (!anchor) throw new Error(`${label}按钮位置尚未就绪`);
    const bounds = entry.owner.window.getContentBounds();
    const zoom = entry.owner.window.webContents.getZoomFactor();
    if (
      (anchor.x + anchor.width) * zoom > bounds.width + 1 ||
      (anchor.y + anchor.height) * zoom > bounds.height + 1
    )
      throw new Error(`${label}按钮已不在窗口内`);
    return {
      x: Math.round(bounds.x + anchor.x * zoom),
      y: Math.round(bounds.y + anchor.y * zoom),
      width: Math.round(anchor.width * zoom),
      height: Math.round(anchor.height * zoom),
    };
  };

  /** 隐藏阶段先完成内容尺寸调整，坐标和尺寸不变时不触发原生重排。 */
  const position = (entry: MenuEntry): void => {
    const popup = entry.popup;
    if (!popup || popup.isDestroyed()) return;
    const anchor = entry.anchor
      ? screenAnchor(entry)
      : entry.owner.window.getContentBounds();
    const area = screen.getDisplayMatching(anchor).workArea;
    const next = positionRtcMicrophoneMenu(
      anchor,
      area,
      entry.height * popup.webContents.getZoomFactor(),
    );
    const current = popup.getBounds();
    if (
      current.x !== next.x ||
      current.y !== next.y ||
      current.width !== next.width ||
      current.height !== next.height
    )
      popup.setBounds(next, false);
  };

  /** 只在置顶级别实际变化时更新，避免每次悬浮重新排列原生窗口。 */
  const syncPin = (entry: MenuEntry): void => {
    const popup = entry.popup;
    if (!popup || popup.isDestroyed()) return;
    const pinned = entry.owner.window.isAlwaysOnTop();
    if (popup.isAlwaysOnTop() !== pinned) popup.setAlwaysOnTop(pinned);
  };

  /** 页面和原生首帧均就绪后才显示，预热期间离开按钮则取消显示。 */
  const showIfReady = (entry: MenuEntry): void => {
    const popup = entry.popup;
    if (
      !popup ||
      popup.isDestroyed() ||
      !entry.requested ||
      !entry.ready ||
      !entry.painted
    )
      return;
    try {
      validate(entry);
      const owner = entry.owner.window;
      if (entry.terminal || !owner.isVisible() || owner.isMinimized()) {
        hide(entry);
        return;
      }
      position(entry);
      syncPin(entry);
      if (!popup.isVisible()) popup.showInactive();
      if (entry.focusRequested) {
        entry.focusRequested = false;
        popup.focus();
        sendWindowNotification(popup, `${channel}:focus`, {
          kind: entry.snapshot.kind,
          generation: entry.snapshot.generation,
        });
      }
      notifyStatus(entry, true);
    } catch {
      close(entry.owner.window);
    }
  };

  /** 检查鼠标仍在按钮或菜单内，避免两个渲染进程的进出事件乱序闪退。 */
  const pointerInside = (entry: MenuEntry): boolean => {
    const point = screen.getCursorScreenPoint();
    const bounds = [screenAnchor(entry)];
    if (entry.popup && !entry.popup.isDestroyed() && entry.popup.isVisible())
      bounds.push(entry.popup.getBounds());
    return bounds.some(
      (rect) =>
        point.x >= rect.x &&
        point.x < rect.x + rect.width &&
        point.y >= rect.y &&
        point.y < rect.y + rect.height,
    );
  };

  /** 为按钮与小窗口之间的鼠标移动留出时间，滑块拖动期间不隐藏。 */
  const scheduleHide = (entry: MenuEntry): void => {
    clearTimeout(entry.hideTimer);
    entry.hideTimer = setTimeout((): void => {
      entry.hideTimer = undefined;
      try {
        validate(entry);
        if (
          entry.dragging ||
          (entry.keyboardActive &&
            BrowserWindow.getFocusedWindow() === entry.popup) ||
          pointerInside(entry)
        )
          return;
        hide(entry);
      } catch {
        close(entry.owner.window);
      }
    }, 120);
  };

  /** 点击菜单引起父窗口失焦时不关闭，切到其他应用或窗口才隐藏。 */
  const scheduleBlur = (entry: MenuEntry): void => {
    if (
      entries.get(entry.owner.window) !== entry ||
      !entry.popup ||
      entry.popup.isDestroyed() ||
      !entry.popup.isVisible()
    )
      return;
    clearTimeout(entry.blurTimer);
    entry.blurTimer = setTimeout((): void => {
      entry.blurTimer = undefined;
      const focused = BrowserWindow.getFocusedWindow();
      if (focused !== entry.owner.window && focused !== entry.popup)
        hide(entry);
    }, 80);
  };

  /** 建立原通话页面绑定，状态可以先于预热窗口到达。 */
  const ensureEntry = (owner: RtcMicrophoneOwner): MenuEntry => {
    owner.validate();
    const existing = entries.get(owner.window);
    if (existing) {
      validate(existing);
      return existing;
    }
    // closed 触发后不能再读取原生窗口属性，清理监听使用存活时保存的引用。
    const ownerContents = owner.window.webContents;
    const url = new URL(dependencies.getRendererUrl());
    url.hash = channel;
    const entry: MenuEntry = {
      owner,
      url: url.href,
      snapshot: {
        revision: 0,
        kind: 'microphone',
        generation: 0,
        state: createRtcMicrophoneState(),
      },
      states: {
        microphone: createRtcMicrophoneState(),
        speaker: createRtcMicrophoneState(),
        camera: createRtcMicrophoneState(),
      },
      terminal: false,
      height: 280,
      ready: false,
      painted: false,
      warmAttempted: false,
      requested: false,
      focusRequested: false,
      keyboardActive: false,
      dragging: false,
      disposeListeners: (): void => {},
    };
    /** 父窗口位置或可见性变化时只隐藏菜单。 */
    const dismiss = (): void => hide(entry);
    /** 原页面生命周期结束时清除整个绑定。 */
    const dispose = (): void => close(owner.window);
    /** 等待原生焦点完成父子窗口交接后再判断是否收起。 */
    const blur = (): void => scheduleBlur(entry);
    /** 菜单跟随通话窗口的置顶级别。 */
    const pin = (): void => syncPin(entry);
    /** 同页锚点变化保留菜单，真正重载则撤销旧页面绑定。 */
    const navigate = (
      event: Electron.Event<Electron.WebContentsDidStartNavigationEventParams>,
    ): void => {
      if (event.isMainFrame && !event.isSameDocument) dispose();
    };
    owner.window.on('move', dismiss);
    owner.window.on('resize', dismiss);
    owner.window.on('hide', dismiss);
    owner.window.on('minimize', dismiss);
    owner.window.on('close', dismiss);
    owner.window.on('closed', dispose);
    owner.window.on('blur', blur);
    owner.window.on('always-on-top-changed', pin);
    ownerContents.on('did-start-navigation', navigate);
    ownerContents.on('render-process-gone', dispose);
    screen.on('display-metrics-changed', dismiss);
    screen.on('display-removed', dismiss);
    entry.disposeListeners = (): void => {
      owner.window.removeListener('move', dismiss);
      owner.window.removeListener('resize', dismiss);
      owner.window.removeListener('hide', dismiss);
      owner.window.removeListener('minimize', dismiss);
      owner.window.removeListener('close', dismiss);
      owner.window.removeListener('closed', dispose);
      owner.window.removeListener('blur', blur);
      owner.window.removeListener('always-on-top-changed', pin);
      ownerContents.removeListener('did-start-navigation', navigate);
      ownerContents.removeListener('render-process-gone', dispose);
      screen.removeListener('display-metrics-changed', dismiss);
      screen.removeListener('display-removed', dismiss);
    };
    entries.set(owner.window, entry);
    return entry;
  };

  /** 创建隐藏沙箱窗口并提前加载页面；没有麦克风权限，也不初始化 RTC。 */
  const warm = (entry: MenuEntry): void => {
    validate(entry);
    if (entry.popup || entry.terminal) return;
    entry.warmAttempted = true;
    const popup = new BrowserWindow({
      width: 208,
      height: 280,
      parent: entry.owner.window,
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
      alwaysOnTop: entry.owner.window.isAlwaysOnTop(),
      show: false,
      autoHideMenuBar: true,
      title: `${label}设置`,
      icon: dependencies.getDefaultIcon(),
      webPreferences: {
        preload: path.join(__dirname, 'rtc-microphone-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    entry.popup = popup;
    /** 仅处理当前加载失败，保留通话，下次悬浮可重新预热。 */
    const failed = (): void => {
      if (entry.popup !== popup) return;
      destroyPopup(entry);
      notifyStatus(entry, false, `${label}菜单加载失败，请重新悬浮重试`);
    };
    entry.preloadTimer = setTimeout(failed, 15000);
    popup.once('ready-to-show', (): void => {
      if (entry.popup !== popup) return;
      entry.painted = true;
      if (entry.ready) clearTimeout(entry.preloadTimer);
      showIfReady(entry);
    });
    popup.on('blur', (): void => scheduleBlur(entry));
    popup.on('closed', (): void => {
      if (entry.popup === popup) destroyPopup(entry);
    });
    popup.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    popup.webContents.on('will-navigate', (event) => event.preventDefault());
    popup.webContents.on('render-process-gone', failed);
    popup.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') {
        event.preventDefault();
        hide(entry);
      }
    });
    void popup.loadURL(entry.url).catch(failed);
  };

  /** 只允许绑定的菜单主框架调用小窗口接口，逐次复核原通话授权。 */
  const fromMenu = (event: IpcMainInvokeEvent): MenuEntry => {
    const entry = [...entries.values()].find(
      (item) =>
        item.popup &&
        !item.popup.isDestroyed() &&
        item.popup.webContents === event.sender,
    );
    if (
      !entry ||
      event.senderFrame !== event.sender.mainFrame ||
      event.senderFrame.url !== entry.url
    )
      throw new Error(`${label}菜单来源无效`);
    try {
      validate(entry);
      if (entry.terminal) throw new Error('通话已结束');
    } catch (error: unknown) {
      close(entry.owner.window);
      throw error;
    }
    return entry;
  };

  /** 先校验主通话页面；已结束通话的迟到请求不再创建菜单绑定。 */
  const fromOwner = (event: IpcMainInvokeEvent): MenuEntry | undefined => {
    const owner = dependencies.resolveOwner(event);
    return owner ? ensureEntry(owner) : undefined;
  };

  /** 子窗口不能利用迟到事件或伪造模式操作另一设备。 */
  const fromCurrentMenu = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): MenuEntry => {
    const entry = fromMenu(event);
    const binding = parseRtcDeviceMenuBinding(value);
    if (
      binding.kind !== entry.snapshot.kind ||
      binding.generation !== entry.snapshot.generation
    )
      throw new Error('设备菜单显示已变化');
    return entry;
  };

  /** 摄像头模式必须来自主进程绑定的视频通话，不能由页面状态开放。 */
  const requireMode = (entry: MenuEntry, kind: RtcAudioMenuKind): void => {
    if (kind === 'camera' && !entry.owner.allowCamera)
      throw new Error('语音通话不提供摄像头菜单');
  };

  /** 限制内容测量值，最终尺寸仍由屏幕工作区约束。 */
  const readHeight = (value: unknown): number => {
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 1 ||
      value > 10000
    )
      throw new Error(`${label}菜单尺寸无效`);
    return Math.ceil(value);
  };

  // 通话页面仍按设备发布独立状态；子菜单只接收当前显示类型的快照。
  for (const kind of ['microphone', 'speaker', 'camera'] as const) {
    const ownerChannel = `rtc-${kind}`;
    ipcMain.handle(`${ownerChannel}:publish`, (event, value: unknown): void => {
      const entry = fromOwner(event);
      if (!entry) return;
      requireMode(entry, kind);
      const state = parseRtcMicrophoneState(value);
      if (entry.terminal) return;
      entry.states[kind] = state;
      if (state.terminal) {
        entry.terminal = true;
        destroyPopup(entry);
        return;
      }
      if (entry.snapshot.kind === kind) {
        entry.snapshot = {
          ...entry.snapshot,
          revision: entry.snapshot.revision + 1,
          state,
        };
        sendWindowNotification(entry.popup, `${channel}:state`, entry.snapshot);
      }
      if (!entry.warmAttempted && entry.owner.window.isVisible()) warm(entry);
    });
    ipcMain.handle(
      `${ownerChannel}:show`,
      (event, value: unknown, focus: unknown): void => {
        const entry = fromOwner(event);
        if (!entry) return;
        requireMode(entry, kind);
        if (typeof focus !== 'boolean')
          throw new Error(`${label}菜单焦点参数无效`);
        if (entry.terminal) return;
        const previousAnchor = entry.anchor;
        entry.anchor = parseRtcMicrophoneAnchor(value);
        try {
          screenAnchor(entry);
        } catch (error: unknown) {
          entry.anchor = previousAnchor;
          throw error;
        }
        const changed = entry.snapshot.kind !== kind;
        if (changed) {
          hide(entry);
          entry.ready = false;
        }
        if (changed || !entry.requested) {
          entry.snapshot = {
            kind,
            generation: entry.snapshot.generation + 1,
            revision: entry.snapshot.revision + 1,
            state: entry.states[kind],
          };
          sendWindowNotification(
            entry.popup,
            `${channel}:state`,
            entry.snapshot,
          );
        }
        entry.requested = true;
        entry.focusRequested = focus;
        entry.keyboardActive = focus;
        clearTimeout(entry.hideTimer);
        entry.hideTimer = undefined;
        clearTimeout(entry.blurTimer);
        entry.blurTimer = undefined;
        warm(entry);
        showIfReady(entry);
      },
    );
    ipcMain.handle(`${ownerChannel}:leave`, (event): void => {
      const entry = fromOwner(event);
      if (!entry) return;
      requireMode(entry, kind);
      if (entry.snapshot.kind !== kind) return;
      if (!entry.popup?.isVisible()) {
        hide(entry);
        return;
      }
      scheduleHide(entry);
    });
    ipcMain.handle(`${ownerChannel}:dismiss`, (event): void => {
      const entry = fromOwner(event);
      if (!entry) return;
      requireMode(entry, kind);
      if (entry.snapshot.kind === kind) hide(entry);
    });
  }
  ipcMain.handle(
    `${channel}:read`,
    (event): RtcMicrophoneSnapshot => fromMenu(event).snapshot,
  );
  ipcMain.handle(
    `${channel}:ready`,
    (event, binding: unknown, height: unknown): void => {
      const entry = fromCurrentMenu(event, binding);
      entry.height = readHeight(height);
      entry.ready = true;
      if (entry.painted) clearTimeout(entry.preloadTimer);
      position(entry);
      showIfReady(entry);
    },
  );
  ipcMain.handle(
    `${channel}:resize`,
    (event, binding: unknown, height: unknown): void => {
      const entry = fromCurrentMenu(event, binding);
      const next = readHeight(height);
      if (entry.height === next) return;
      entry.height = next;
      position(entry);
    },
  );
  ipcMain.handle(
    `${channel}:pointer`,
    (event, binding: unknown, action: unknown): void => {
      const entry = fromCurrentMenu(event, binding);
      if (!entry.popup?.isVisible()) return;
      switch (action) {
        case 'enter':
          clearTimeout(entry.hideTimer);
          return;
        case 'leave':
          scheduleHide(entry);
          return;
        case 'drag-start':
          entry.dragging = true;
          clearTimeout(entry.hideTimer);
          return;
        case 'drag-end':
          entry.dragging = false;
          scheduleHide(entry);
          return;
        default:
          throw new Error(`${label}菜单指针状态无效`);
      }
    },
  );
  ipcMain.handle(`${channel}:hide`, (event, binding: unknown): void =>
    hide(fromCurrentMenu(event, binding)),
  );
  ipcMain.handle(
    `${channel}:command`,
    (event, binding: unknown, value: unknown): void => {
      const entry = fromCurrentMenu(event, binding);
      const kind = entry.snapshot.kind;
      const deviceLabel = readRtcDeviceLabel(kind);
      const state = entry.snapshot.state;
      if (!entry.popup?.isVisible() || !entry.ready || state.busy)
        throw new Error(`${label}菜单当前不可操作`);
      const command = parseRtcMicrophoneCommand(value);
      if (kind === 'camera' && command.type === 'volume')
        throw new Error('摄像头菜单不支持音量操作');
      if (command.type !== 'volume' && state.deviceBusy)
        throw new Error(`正在切换${deviceLabel}，请稍候`);
      if (
        command.type === 'select' &&
        !state.devices.some((device) => device.deviceId === command.deviceId)
      )
        throw new Error(`所选${deviceLabel}不可用`);
      sendWindowNotification(
        entry.owner.window,
        `rtc-${kind}:command`,
        command,
      );
    },
  );

  return {
    /** 在通话窗口显示后调用，重复调用不会新建窗口或重新加载页面。 */
    prepare: (owner: RtcMicrophoneOwner): void => warm(ensureEntry(owner)),
    close,
    /** 隐藏共用菜单并取消延迟显示，保留窗口和各设备缓存。 */
    hide: (owner: BrowserWindow): void => {
      const entry = entries.get(owner);
      if (entry) hide(entry);
    },
  };
};
