import { BrowserWindow, ipcMain, screen } from 'electron';
import type {
  IpcMainInvokeEvent,
  NativeImage,
  Rectangle,
  WebContents,
} from 'electron';
import path from 'node:path';
import log from 'electron-log/main';
import { matchesCurrentDevice } from '../../../shared/auth/device-identity';
import {
  requireAuthenticatedSession,
  getActiveSession,
} from '../../services/auth/auth';
import { getStorageOwner } from '../../services/database/database';
import { parseText } from '../../services/database/database-validation';
import {
  parseRtcEvent,
  isRtcIncomingCallCreatedEvent,
  type RtcCallPeer,
  type RtcCallView,
  RtcMediaMode,
  RtcCallState,
  RtcEventType,
  RtcParticipantState,
  canUseRtcDevice,
} from '../../../shared/rtc/rtc';
import { RtcAuditEvent } from '../../../shared/rtc/rtc-audit';
import type { ResourceSseMessage } from '../../../shared/windows/desktop';
import type { AuthSession } from '../../../shared/auth/auth';
import { sendWindowNotification } from '../../services/ipc/window-notifications';
import {
  createRtcMicrophoneWindowController,
  type RtcMicrophoneOwner,
} from './device-menu/rtc-microphone-window';

interface RtcCallWindowEntry {
  window: BrowserWindow;
  callId: string;
  mediaMode: RtcMediaMode;
  version: number;
  terminal: boolean;
  compact: boolean;
  session: AuthSession;
  url: string;
  allowClose: boolean;
  closeTimer?: ReturnType<typeof setTimeout>;
}

interface RtcCallWindowDependencies {
  getMainWindow: () => BrowserWindow | undefined;
  getRendererUrl: () => string;
  getDefaultIcon: () => NativeImage;
  validateMainSender: (event: IpcMainInvokeEvent) => void;
  readCall: (callId: string, validate: () => void) => Promise<RtcCallView>;
  reconnectCall: (callId: string, validate: () => void) => Promise<RtcCallView>;
  isGroupCall?: (call: RtcCallView) => boolean;
  readPeer: (
    call: RtcCallView,
    session: AuthSession,
    validate: () => void,
  ) => Promise<RtcCallPeer>;
  readParticipant?: (
    call: RtcCallView,
    uid: string,
    validate: () => void,
  ) => Promise<RtcCallPeer>;
}

const windows = new Map<number, RtcCallWindowEntry>();
const CALL_ASPECT_RATIO = 9 / 16;
let windowGeneration = 0;
let opening:
  | {
      callId: string;
      session: AuthSession;
      promise: Promise<void>;
    }
  | undefined;
let dependencies: RtcCallWindowDependencies | undefined;
let deviceMenus:
  ReturnType<typeof createRtcMicrophoneWindowController> | undefined;

/** 群聊类型以当前账号已同步的会话为准，兼容只邀请一名成员。 */
const isGroupCall = (call: RtcCallView): boolean =>
  call.calleeUid === null || (dependencies?.isGroupCall?.(call) ?? false);

/** 群通话使用横向六宫格窗口，不应用单聊的竖屏比例锁。 */
const fitGroupBounds = (bounds: Rectangle, area: Rectangle): Rectangle => {
  const width = Math.max(1, Math.min(bounds.width, area.width));
  const height = Math.max(1, Math.min(bounds.height, area.height));
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  };
};

/** 小菜单绑定当前音视频通话页面，重载、退出和结束后撤销其权限。 */
const microphoneOwner = (entry: RtcCallWindowEntry): RtcMicrophoneOwner => {
  const contents = entry.window.webContents;
  const frame = contents.mainFrame;
  return {
    window: entry.window,
    allowCamera: entry.mediaMode === RtcMediaMode.VIDEO,
    validate: (): void => {
      if (
        entry.window.isDestroyed() ||
        windows.get(contents.id) !== entry ||
        contents.mainFrame !== frame ||
        contents.getURL() !== entry.url ||
        frame.url !== entry.url ||
        (entry.mediaMode !== RtcMediaMode.VIDEO &&
          entry.mediaMode !== RtcMediaMode.AUDIO) ||
        entry.terminal ||
        entry.allowClose ||
        entry.closeTimer ||
        getActiveSession() !== entry.session ||
        getStorageOwner() !== entry.session.user.id
      )
        throw new Error('设备菜单所属通话已失效');
      requireAuthenticatedSession();
    },
  };
};

/** 语音小窗位于工作区右下角，不覆盖任务栏。 */
const getAudioCallBounds = (area: Rectangle): Rectangle => {
  const margin = 12;
  const width = Math.max(1, Math.min(320, area.width - margin * 2));
  const height = Math.max(1, Math.min(120, area.height - margin * 2));
  return {
    width,
    height,
    x: area.x + area.width - width - margin,
    y: area.y + area.height - height - margin,
  };
};

/** 将窗口按固定比例收进当前显示器工作区，兼容负坐标及任务栏。 */
const fitCallBounds = (bounds: Rectangle, area: Rectangle): Rectangle => {
  const width = Math.max(
    1,
    Math.floor(
      Math.min(bounds.width, area.width, area.height * CALL_ASPECT_RATIO),
    ),
  );
  const height = Math.round(width / CALL_ASPECT_RATIO);
  return {
    width,
    height,
    x: Math.min(Math.max(bounds.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(bounds.y, area.y), area.y + area.height - height),
  };
};

/** 服务端确认接听后原地展开小窗，保留渲染进程及其媒体连接。 */
const expandAudioCallWindow = (
  entry: RtcCallWindowEntry,
  call: RtcCallView,
): boolean => {
  if (!entry.compact) return true;
  if (
    call.callId !== entry.callId ||
    call.mediaMode !== RtcMediaMode.AUDIO ||
    call.calleeUid !== entry.session.user.id
  )
    return false;
  switch (call.state) {
    case RtcCallState.ACCEPTED:
    case RtcCallState.CONNECTED:
      break;
    default:
      return false;
  }
  const window = entry.window;
  const area = screen.getDisplayMatching(window.getBounds()).workArea;
  const fitted = fitCallBounds({ ...area, width: 360 }, area);
  const minimumWidth = Math.min(240, fitted.width);
  entry.compact = false;
  window.setResizable(true);
  window.setMaximizable(true);
  window.setSkipTaskbar(false);
  window.setAlwaysOnTop(false);
  window.setAspectRatio(CALL_ASPECT_RATIO);
  window.setMinimumSize(
    minimumWidth,
    Math.round(minimumWidth / CALL_ASPECT_RATIO),
  );
  window.setBounds({
    ...fitted,
    x: area.x + Math.round((area.width - fitted.width) / 2),
    y: area.y + Math.round((area.height - fitted.height) / 2),
  });
  window.show();
  window.focus();
  return true;
};

/** 最大化扩展黑色背景，内部通话区域继续由渲染层锁定比例。 */
const toggleCallSize = (entry: RtcCallWindowEntry): boolean => {
  if (entry.window.isMaximized()) entry.window.unmaximize();
  else entry.window.maximize();
  return entry.window.isMaximized();
};

/** 校验独立 RTC 窗口仍属于当前授权账号和当前页面。 */
const validateEntry = (event: IpcMainInvokeEvent): RtcCallWindowEntry => {
  const entry = windows.get(event.sender.id);
  if (
    !entry ||
    entry.window.isDestroyed() ||
    event.sender !== entry.window.webContents ||
    event.senderFrame !== event.sender.mainFrame ||
    event.senderFrame.url !== entry.url ||
    getActiveSession() !== entry.session ||
    getStorageOwner() !== entry.session.user.id
  )
    throw new Error('通话窗口已失效');
  requireAuthenticatedSession();
  return entry;
};

/** 校验 RTC 请求来自受控通话窗口。 */
export const validateRtcCallWindowSender = (
  event: IpcMainInvokeEvent,
): void => {
  validateEntry(event);
};

/** 判断 IPC 请求是否来自受控通话窗口。 */
export const isRtcCallWindow = (event: IpcMainInvokeEvent): boolean =>
  windows.has(event.sender.id);

/** 判断媒体权限请求是否来自已绑定的 RTC 窗口。 */
export const canRtcCallWindowRecord = (
  contents: WebContents | null,
  url: string,
  main: boolean,
): boolean => {
  if (!contents || !main) return false;
  const entry = windows.get(contents.id);
  return (
    !!entry &&
    !entry.window.isDestroyed() &&
    contents === entry.window.webContents &&
    url === entry.url &&
    getActiveSession() === entry.session &&
    getStorageOwner() === entry.session.user.id
  );
};

/** 输出设备权限仅交给当前已授权通话的主框架，不授予菜单或其他页面。 */
export const canRtcCallWindowSelectSpeaker = (
  contents: WebContents | null,
  url: string,
  main: boolean,
): boolean => {
  try {
    requireAuthenticatedSession();
    if (!contents || !canRtcCallWindowRecord(contents, url, main)) return false;
    const entry = windows.get(contents.id);
    return !!entry && !entry.terminal && !entry.allowClose && !entry.closeTimer;
  } catch {
    return false;
  }
};

/** 校验通话窗口只能操作创建时绑定的呼叫。 */
export const validateRtcCallWindowCall = (
  event: IpcMainInvokeEvent,
  callId: string,
): void => {
  const entry = validateEntry(event);
  if (entry.callId !== callId) throw new Error('通话窗口绑定已变化');
};

/** 关闭所有独立通话窗口。 */
export const closeRtcCallWindows = (): void => {
  windowGeneration += 1;
  for (const entry of windows.values()) {
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
  windows.clear();
  opening = undefined;
};

/** 记录呼出查询前属于当前账号的窗口，避免事后关闭新到达的来电。 */
export const getRtcCallWindowIds = (): string[] => {
  const session = requireAuthenticatedSession();
  const ids = [...windows.values()]
    .filter((entry) => entry.session === session)
    .map((entry) => entry.callId);
  if (opening?.session === session) ids.push(opening.callId);
  return ids;
};

/** 服务端确认替换后立即回收对应窗口和设备，迟到的旧窗口加载不再交付。 */
export const closeReplacedRtcCallWindows = (callIds: string[]): void => {
  const session = requireAuthenticatedSession();
  const ids = new Set(callIds);
  if (opening?.session === session && ids.has(opening.callId)) {
    windowGeneration++;
    opening = undefined;
  }
  for (const entry of windows.values()) {
    if (entry.session !== session || !ids.has(entry.callId)) continue;
    entry.terminal = true;
    entry.allowClose = true;
    deviceMenus?.close(entry.window);
    if (!entry.window.isDestroyed()) entry.window.destroy();
  }
};

/** SSE 重连只读复核现有窗口，漏推不能使另一设备的邀请一直保留。 */
export const reconcileRtcCallWindows = async (): Promise<void> => {
  const session = getActiveSession();
  if (!session || !dependencies) return;
  for (const entry of [...windows.values()]) {
    if (entry.session !== session || entry.window.isDestroyed()) continue;
    const validate = (): void => {
      if (getActiveSession() !== session || entry.window.isDestroyed())
        throw new Error('通话窗口已失效');
      requireAuthenticatedSession();
    };
    try {
      const call = await dependencies.readCall(entry.callId, validate);
      validate();
      if (!canUseRtcDevice(call)) {
        log.info(RtcAuditEvent.SNAPSHOT_DISMISSED_ELSEWHERE, {
          callId: call.callId,
        });
        closeReplacedRtcCallWindows([call.callId]);
      }
    } catch {
      // 短暂断网交给窗口定期查询；不从查询失败推断挂断。
    }
  }
};

/** 将资源 SSE 的 RTC 事件转发给通话窗口，并按需创建来电窗口。 */
export const notifyRtcCallWindow = (message: ResourceSseMessage): void => {
  const event = parseRtcEvent(message);
  const session = getActiveSession();
  if (!event || !session || event.toUid !== session.user.id) return;
  if (event.eventType === RtcEventType.RTC_CALL_ANSWERED_ELSEWHERE) {
    const terminal = event.payload?.acceptedTerminal;
    const device = event.payload?.acceptedDeviceId;
    if (
      event.fromUid !== session.user.id ||
      typeof terminal !== 'string' ||
      !/^[A-Z]{2,16}$/.test(terminal) ||
      typeof device !== 'string' ||
      !/^[a-f0-9]{64}$/.test(device)
    )
      return;
    if (matchesCurrentDevice(terminal, device)) return;
    log.info(RtcAuditEvent.POPUP_DISMISSED_ELSEWHERE, {
      callId: event.callId,
      eventId: event.eventId,
    });
    closeReplacedRtcCallWindows([event.callId]);
    return;
  }
  const current = [...windows.values()].find(
    (entry) => entry.callId === event.callId,
  );
  if (current) {
    if (event.callVersion > current.version) {
      current.version = event.callVersion;
      switch (event.eventType) {
        case RtcEventType.RTC_CALL_REJECTED:
        case RtcEventType.RTC_CALL_CANCELED:
        case RtcEventType.RTC_CALL_ENDED:
        case RtcEventType.RTC_CALL_EXPIRED:
          current.terminal = true;
          deviceMenus?.close(current.window);
          break;
        default:
          break;
      }
    }
    sendWindowNotification(current.window, 'rtc-call:message', message);
    return;
  }
  if (isRtcIncomingCallCreatedEvent(event, session.user.id))
    void openRtcCallWindow(event.callId).catch(() => undefined);
};

/** 创建绑定呼叫的窗口，仅尚未接听的语音被叫使用右下角紧凑布局。 */
const createRtcCallWindow = async (
  callId: string,
  resume: boolean,
): Promise<void> => {
  if (!dependencies) throw new Error('RTC 窗口服务尚未初始化');
  const session = requireAuthenticatedSession();
  const generation = windowGeneration;
  const existing = [...windows.values()].find(
    (entry) => entry.session === session && entry.callId === callId,
  );
  if (existing) {
    if (existing.window.isMinimized()) existing.window.restore();
    existing.window.show();
    existing.window.focus();
    return;
  }
  const validate = (): void => {
    if (
      windowGeneration !== generation ||
      getActiveSession() !== session ||
      getStorageOwner() !== session.user.id
    )
      throw new Error('账号或授权状态已变化');
    requireAuthenticatedSession();
  };
  let call = await dependencies.readCall(callId, validate);
  validate();
  if (
    !call.participants.some(
      (participant) => participant.uid === session.user.id,
    )
  )
    throw new Error('通话不属于当前账号');
  switch (call.state) {
    case RtcCallState.REJECTED:
    case RtcCallState.CANCELED:
    case RtcCallState.ENDED:
    case RtcCallState.EXPIRED:
      if (resume) throw new Error('通话已结束');
      return;
    default:
      break;
  }
  // 新来电可能先于旧通话终态 SSE 到达；复核旧记录后再回收窗口，不能只看本机状态。
  for (const entry of [...windows.values()]) {
    if (entry.window.isDestroyed()) continue;
    const previous = await dependencies.readCall(entry.callId, validate);
    validate();
    const active = [
      RtcCallState.RINGING,
      RtcCallState.ACCEPTED,
      RtcCallState.CONNECTED,
    ].includes(previous.state);
    const member = previous.participants.find(
      (item) => item.uid === session.user.id,
    );
    if (
      active &&
      (member?.state === undefined ||
        member.state === RtcParticipantState.ACCEPTED ||
        member.state === RtcParticipantState.INVITED)
    )
      throw new Error('已有通话窗口，请先结束当前通话');
    closeReplacedRtcCallWindows([entry.callId]);
  }
  if (resume) {
    call = await dependencies.reconnectCall(callId, validate);
    validate();
    if (
      call.state !== RtcCallState.ACCEPTED &&
      call.state !== RtcCallState.CONNECTED
    )
      throw new Error('通话已结束');
  }
  if (!canUseRtcDevice(call)) {
    log.info(RtcAuditEvent.WINDOW_DEVICE_REJECTED, {
      callId,
      ownership: call.deviceOwnership,
    });
    return;
  }
  const main = dependencies.getMainWindow();
  if (!main || main.isDestroyed()) throw new Error('主窗口已关闭');
  const area = screen.getDisplayMatching(main.getBounds()).workArea;
  const audio = call.mediaMode === RtcMediaMode.AUDIO;
  const group = isGroupCall(call);
  const incoming =
    call.callerUid !== session.user.id && call.state === RtcCallState.RINGING;
  const compact = audio && incoming && !group;
  let bounds = fitCallBounds({ ...area, width: 360 }, area);
  if (group)
    bounds = fitGroupBounds({ ...area, width: 740, height: 680 }, area);
  if (compact) bounds = getAudioCallBounds(area);
  const { width, height } = bounds;
  const minimumWidth = Math.min(group ? 420 : 240, width);
  const minimumHeight = Math.min(
    group ? 420 : Math.round(240 / CALL_ASPECT_RATIO),
    height,
  );
  let title = audio ? '语音通话' : '视频通话';
  if (group) title = '群通话';
  const window = new BrowserWindow({
    width,
    height,
    ...(compact ? { x: bounds.x, y: bounds.y } : {}),
    // 与后续 getBounds/setBounds 的比例校正使用同一尺寸口径。
    useContentSize: false,
    frame: false,
    transparent: false,
    minWidth: compact ? width : minimumWidth,
    minHeight: compact ? height : minimumHeight,
    resizable: !compact,
    maximizable: !compact,
    alwaysOnTop: compact,
    skipTaskbar: compact,
    fullscreenable: false,
    show: false,
    title,
    icon: dependencies.getDefaultIcon(),
    autoHideMenuBar: true,
    backgroundColor: audio ? '#505050' : '#000000',
    webPreferences: {
      preload: path.join(__dirname, 'rtc-call-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  if (!compact && !group) window.setAspectRatio(CALL_ASPECT_RATIO);
  const url = new URL(dependencies.getRendererUrl());
  url.hash = 'rtc-call';
  const entry: RtcCallWindowEntry = {
    window,
    callId,
    mediaMode: call.mediaMode,
    version: call.version,
    terminal: false,
    compact,
    session,
    url: url.href,
    allowClose: false,
  };
  // 原生比例锁不约束 setBounds 和系统贴靠，尺寸事件补充校正。
  let correctingBounds = false;
  /** 屏幕或窗口尺寸变化后仍保持比例，并限制在可用工作区。 */
  const constrainBounds = (): void => {
    if (
      window.isDestroyed() ||
      window.isMinimized() ||
      window.isMaximized() ||
      correctingBounds
    )
      return;
    const current = window.getBounds();
    const workArea = screen.getDisplayMatching(current).workArea;
    let fitted = fitCallBounds(current, workArea);
    if (group) fitted = fitGroupBounds(current, workArea);
    if (entry.compact) fitted = getAudioCallBounds(workArea);
    if (
      current.width === fitted.width &&
      current.height === fitted.height &&
      current.x === fitted.x &&
      current.y === fitted.y
    )
      return;
    correctingBounds = true;
    try {
      let minimumWidth = Math.min(group ? 420 : 240, fitted.width);
      if (entry.compact) minimumWidth = fitted.width;
      let minimumHeight = Math.round(minimumWidth / CALL_ASPECT_RATIO);
      if (group) minimumHeight = Math.min(420, fitted.height);
      if (entry.compact) minimumHeight = fitted.height;
      window.setMinimumSize(minimumWidth, minimumHeight);
      window.setBounds(fitted);
    } finally {
      correctingBounds = false;
    }
  };
  window.on('will-resize', (event, proposed) => {
    if (window.isMaximized()) return;
    const current = window.getBounds();
    const workArea = screen.getDisplayMatching(current).workArea;
    const growing =
      proposed.width > current.width || proposed.height > current.height;
    if (
      growing &&
      (proposed.y < workArea.y ||
        proposed.y + proposed.height > workArea.y + workArea.height ||
        proposed.x < workArea.x ||
        proposed.x + proposed.width > workArea.x + workArea.width)
    ) {
      event.preventDefault();
    }
  });
  window.on('resize', constrainBounds);
  window.on('moved', constrainBounds);
  screen.on('display-metrics-changed', constrainBounds);
  screen.on('display-removed', constrainBounds);
  windows.set(window.webContents.id, entry);
  const windowId = window.webContents.id;
  window.on('closed', () => {
    screen.removeListener('display-metrics-changed', constrainBounds);
    screen.removeListener('display-removed', constrainBounds);
    clearTimeout(entry.closeTimer);
    windows.delete(windowId);
    sendWindowNotification(
      dependencies?.getMainWindow(),
      'rtc-call:closed',
      entry.callId,
    );
  });
  window.on('close', (event) => {
    if (entry.allowClose || entry.closeTimer) return;
    event.preventDefault();
    entry.closeTimer = setTimeout(() => {
      if (!window.isDestroyed()) window.destroy();
    }, 1000);
    sendWindowNotification(window, 'rtc-call:closing', null);
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (navigation) =>
    navigation.preventDefault(),
  );
  window.webContents.on('render-process-gone', () => {
    if (!window.isDestroyed()) window.destroy();
  });
  try {
    constrainBounds();
    await window.loadURL(entry.url);
    validate();
    if (!window.isDestroyed()) {
      constrainBounds();
      if (audio && incoming) window.showInactive();
      else {
        window.show();
        window.focus();
      }
      if (!entry.terminal) {
        try {
          deviceMenus?.prepare(microphoneOwner(entry));
        } catch (error: unknown) {
          console.error('设备菜单预加载失败', error);
          sendWindowNotification(window, 'rtc-microphone:status', {
            visible: false,
            error: '设备菜单加载失败，请重新悬浮重试',
          });
        }
      }
    }
  } catch (error) {
    if (!window.isDestroyed()) window.destroy();
    throw error;
  }
};

/** 合并同一呼叫的并发打开请求，避免 SSE 和主动发起重复创建窗口。 */
export const openRtcCallWindow = (
  callId: string,
  resume = false,
): Promise<void> => {
  const session = requireAuthenticatedSession();
  if (opening?.session === session) {
    if (opening.callId === callId) return opening.promise;
    return Promise.reject(new Error('正在打开另一通电话'));
  }
  const promise = createRtcCallWindow(callId, resume).finally(() => {
    if (opening?.promise === promise) opening = undefined;
  });
  opening = { callId, session, promise };
  return promise;
};

/** 注册独立通话窗口及其受控 IPC。 */
export const registerRtcCallWindow = (
  nextDependencies: RtcCallWindowDependencies,
): void => {
  dependencies = nextDependencies;
  deviceMenus = createRtcMicrophoneWindowController({
    getRendererUrl: nextDependencies.getRendererUrl,
    getDefaultIcon: nextDependencies.getDefaultIcon,
    resolveOwner: (event): RtcMicrophoneOwner | undefined => {
      const entry = validateEntry(event);
      // 挂断通知先于页面收尾到达；来源及授权仍须校验，但不再创建菜单。
      if (entry.terminal || entry.allowClose || entry.closeTimer) return;
      return microphoneOwner(entry);
    },
  });
  ipcMain.handle('rtc-call:open', async (event, value: unknown) => {
    nextDependencies.validateMainSender(event);
    await openRtcCallWindow(parseText(value, 128));
  });
  ipcMain.handle('rtc-call:resume', async (event, value: unknown) => {
    nextDependencies.validateMainSender(event);
    await openRtcCallWindow(parseText(value, 128), true);
  });
  ipcMain.handle('rtc-call:context', async (event) => {
    const entry = validateEntry(event);
    const call = await nextDependencies.readCall(entry.callId, () =>
      validateEntry(event),
    );
    validateEntry(event);
    const peer = await nextDependencies.readPeer(call, entry.session, () =>
      validateEntry(event),
    );
    validateEntry(event);
    expandAudioCallWindow(entry, call);
    return {
      call,
      user: entry.session.user,
      peer,
      compact: entry.compact,
      group: isGroupCall(call),
    };
  });
  ipcMain.handle('rtc-call:participant', async (event, value: unknown) => {
    const entry = validateEntry(event);
    const uid = parseText(value, 64);
    const validate = (): void => {
      validateEntry(event);
      if (entry.terminal || entry.allowClose || entry.closeTimer)
        throw new Error('通话已结束');
    };
    validate();
    const call = await nextDependencies.readCall(entry.callId, validate);
    validate();
    if (!call.participants.some((participant) => participant.uid === uid))
      throw new Error('用户不属于当前通话');
    if (!nextDependencies.readParticipant)
      throw new Error('通话成员资料不可用');
    const peer = await nextDependencies.readParticipant(call, uid, validate);
    validate();
    return peer;
  });
  ipcMain.handle(
    'rtc-call:control',
    async (event, action: unknown): Promise<boolean> => {
      const entry = validateEntry(event);
      switch (action) {
        case 'expand': {
          if (!entry.compact) return true;
          const call = await nextDependencies.readCall(entry.callId, () =>
            validateEntry(event),
          );
          validateEntry(event);
          return expandAudioCallWindow(entry, call);
        }
        case 'close':
          entry.allowClose = true;
          entry.window.close();
          return false;
        case 'minimize':
          entry.window.minimize();
          return false;
        case 'maximize':
          if (entry.compact) return false;
          return toggleCallSize(entry);
        case 'pin':
          entry.window.setAlwaysOnTop(!entry.window.isAlwaysOnTop());
          return entry.window.isAlwaysOnTop();
        default:
          throw new Error('无效的通话窗口操作');
      }
    },
  );
};
