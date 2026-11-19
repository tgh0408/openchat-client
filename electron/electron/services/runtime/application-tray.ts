import { Menu, Tray } from 'electron';
import { getApplicationIcon } from './application-icon';

interface ApplicationTrayOptions {
  open: () => void;
  quit: () => void;
  menuVisibilityChanged: (visible: boolean) => void;
}

/** 创建固定应用图标的托盘，窗口与退出操作交由主进程生命周期处理。 */
export const createApplicationTray = (
  options: ApplicationTrayOptions,
): Tray => {
  const icon = getApplicationIcon();
  if (icon.isEmpty()) throw new Error('无法读取 OpenChat 托盘图标');
  const tray = new Tray(icon);
  tray.setToolTip('OpenChat');
  const menu = Menu.buildFromTemplate([
    { label: '打开 OpenChat', click: options.open },
    { type: 'separator' },
    { label: '退出 OpenChat', click: options.quit },
  ]);
  menu.on('menu-will-show', () => options.menuVisibilityChanged(true));
  menu.on('menu-will-close', () => options.menuVisibilityChanged(false));
  if (process.platform === 'win32') {
    // 显式弹出菜单，确保 Windows 原生菜单完整触发显示与关闭生命周期。
    tray.on('right-click', () => {
      options.menuVisibilityChanged(true);
      try {
        menu.popup({
          callback: (): void => options.menuVisibilityChanged(false),
        });
      } catch (error) {
        options.menuVisibilityChanged(false);
        throw error;
      }
    });
  } else tray.setContextMenu(menu);
  tray.on('click', options.open);
  tray.on('double-click', options.open);
  return tray;
};
