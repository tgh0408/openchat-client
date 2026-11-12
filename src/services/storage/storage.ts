import type { LocalSettings } from '../../../shared/storage/database';

/** 直接读取当前 SQLite 设置，浏览器预览使用内存默认值。 */
export const readLocalSettings = async (): Promise<LocalSettings> => {
  return window.desktop
    ? window.desktop.getLocalSettings()
    : { rememberAccount: true, debugMode: false };
};
