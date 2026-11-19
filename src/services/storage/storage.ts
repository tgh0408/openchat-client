import type { LocalSettings } from '../../../shared/storage/database';
import {
  applyServerSettings,
  getServerSettings,
  type ServerSettings,
} from '../../../shared/runtime/server-settings';

/** 同步主进程的有效地址；浏览器预览仅保留当前页面配置。 */
export const readServerSettings = async (): Promise<ServerSettings> => {
  const settings = window.desktop
    ? await window.desktop.getServerSettings()
    : getServerSettings();
  applyServerSettings(settings);
  return settings;
};

/** 直接读取当前 SQLite 设置，浏览器预览使用内存默认值。 */
export const readLocalSettings = async (): Promise<LocalSettings> => {
  return window.desktop
    ? window.desktop.getLocalSettings()
    : { rememberAccount: true, debugMode: false };
};
