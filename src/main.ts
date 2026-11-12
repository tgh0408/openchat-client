import { createApp } from 'vue';
import type { Component } from 'vue';
import { publicAssetUrl } from './services/runtime/public-assets';
import './style.css';

const consoleSensitiveKeys = new Set([
  'access_token',
  'authorization',
  'password',
  'secret',
  'token',
]);

/** 将 renderer 控制台对象转换为可读且不包含凭据的单行文本。 */
const formatConsoleValue = (
  value: unknown,
  seen: WeakSet<object>,
  key = '',
): string => {
  if (consoleSensitiveKeys.has(key)) return '[redacted]';
  if (typeof value === 'string')
    return value
      .replace(/(access_token=)[^&\s]+/gi, '$1[redacted]')
      .replace(/[\r\n]+/g, ' ');
  if (typeof value === 'number' || typeof value === 'boolean')
    return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value))
    return `[${value.map((item) => formatConsoleValue(item, seen)).join(', ')}]`;
  const entries = Object.entries(value).map(
    ([entryKey, entryValue]) =>
      `${entryKey}: ${formatConsoleValue(entryValue, seen, entryKey)}`,
  );
  return `{${entries.join(', ')}}`;
};

/** 将 renderer 控制台参数序列化为不会产生嵌套转义的文本。 */
const serializeConsoleArgument = (value: unknown): unknown => {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === 'object' && value !== null)
    return formatConsoleValue(value, new WeakSet<object>());
  if (typeof value === 'string')
    return value.replace(/(access_token=)[^&\s]+/gi, '$1[redacted]');
  return value;
};

/** 保留 renderer 控制台输出，同时避免 Electron 日志把对象显示为 [object Object]。 */
const installConsoleFormatting = (): void => {
  for (const method of ['info', 'warn', 'error'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]): void => {
      original(...args.map(serializeConsoleArgument));
    };
  }
};

/** 只加载当前窗口入口，登录首屏不下载聊天、历史或播放器组件。 */
const selectEntry = async (): Promise<Component> => {
  switch (window.location.hash) {
    case '#context-menu':
      return (await import('./pages/context-menu/ContextMenuWindow.vue'))
        .default;
    case '#tray-preview':
      return (await import('./pages/tray-preview/TrayPreviewWindow.vue'))
        .default;
    case '#workspace':
      if (window.desktop)
        return (await import('./pages/workspace/WorkspaceWindow.vue')).default;
      return (await import('./App.vue')).default;
    case '#conversation':
      return (await import('./pages/conversation/ConversationWindow.vue'))
        .default;
    case '#history':
      return (await import('./pages/history/HistoryWindow.vue')).default;
    case '#settings':
      return (await import('./pages/settings/SettingsWindow.vue')).default;
    case '#image-preview':
      return (await import('./pages/image-preview/ImagePreviewWindow.vue'))
        .default;
    case '#video-player':
      return (await import('./pages/video-player/VideoPlayerWindow.vue'))
        .default;
    case '#rtc-call':
      return (await import('./pages/rtc/RtcCallWindow.vue')).default;
    case '#rtc-device-menu':
      return (
        await import('./pages/rtc/device-menu/RtcMicrophoneMenuWindow.vue')
      ).default;
    case '#screenshot':
      return (await import('./pages/screenshot/ScreenshotWindow.vue')).default;
    case '#avatar-crop':
      return (await import('./pages/avatar-crop/AvatarCropWindow.vue')).default;
    case '#add-friend':
      return (await import('./pages/contacts/add-friend/AddFriendWindow.vue'))
        .default;
    case '#friend-profile':
      return (await import('./pages/contacts/profile/FriendProfileWindow.vue'))
        .default;
    case '#friend-remark':
      return (await import('./pages/contacts/remark/FriendRemarkWindow.vue'))
        .default;
    case '#friend-application':
    case '#friend-verification':
      return (
        await import('./pages/contacts/application/FriendApplicationWindow.vue')
      ).default;
    case '#update':
      return (await import('./pages/update/UpdateWindow.vue')).default;
    case '#update-confirm':
      return (await import('./pages/update/UpdateConfirmWindow.vue')).default;
    default:
      if (window.desktop)
        return (await import('./pages/login/LoginWindow.vue')).default;
      return (await import('./App.vue')).default;
  }
};

/** 入口分块加载失败时保留重新加载和关闭入口，不留下无法操作的空白页。 */
const showEntryError = (): void => {
  const root = document.getElementById('app');
  if (!root) return;
  const panel = document.createElement('section');
  panel.className = 'panel';
  const message = document.createElement('p');
  message.textContent = '页面加载失败，请重试。';
  const retry = document.createElement('button');
  retry.textContent = '重新加载';
  retry.addEventListener('click', () => window.location.reload());
  panel.append(message, retry);
  const desktop = window.desktop;
  if (desktop) {
    if (window.location.hash === '#workspace') {
      void desktop.returnToLogin().catch(() => {});
    }
    const close = document.createElement('button');
    close.textContent = '关闭';
    close.addEventListener('click', () => void desktop.close());
    panel.append(close);
    requestAnimationFrame(() => {
      if (window.location.hash !== '#workspace')
        void desktop.startupRendered().catch(() => {});
    });
  }
  root.replaceChildren(panel);
};

/** 选定入口后挂载，子窗口不运行主页面的登录恢复逻辑。 */
const mountEntry = async (): Promise<void> => {
  createApp(await selectEntry()).mount('#app');
};

document.documentElement.classList.toggle(
  'native-window',
  Boolean(
    window.desktop ||
    window.contextMenuDesktop ||
    window.trayPreviewDesktop ||
    window.screenshotDesktop ||
    window.rtcCallDesktop ||
    window.rtcMicrophoneDesktop ||
    window.historyDesktop ||
    window.settingsDesktop ||
    window.updateDesktop ||
    window.updateConfirmDesktop,
  ),
);
const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
if (favicon) favicon.href = publicAssetUrl('ico/openchat.ico');
installConsoleFormatting();
void mountEntry().catch(showEntryError);
