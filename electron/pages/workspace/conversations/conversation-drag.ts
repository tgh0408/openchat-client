import { BrowserWindow, ipcMain, screen } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { parseConversationDrag } from '../../../../shared/chat/conversations/conversation-drag';
import { requireAuthenticatedSession } from '../../../services/auth/auth';
import { requireRemoteConversation } from '../../../services/database/database';
import { getApplicationIcon } from '../../../services/runtime/application-icon';

interface Drag {
  id: string;
  roomId: string;
  window?: BrowserWindow;
  timer?: ReturnType<typeof setInterval>;
  timeout?: ReturnType<typeof setTimeout>;
}
let current: Drag | undefined;

/** 松手、取消、注销及会话删除时清理透明预览与跟随计时器。 */
export const closeConversationDrag = (roomId?: string): void => {
  if (!current || (roomId && current.roomId !== roomId)) return;
  const previous = current;
  current = undefined;
  clearInterval(previous.timer);
  clearTimeout(previous.timeout);
  if (previous.window && !previous.window.isDestroyed())
    previous.window.destroy();
};

/** 截取当前会话行作为只显示位图的穿透窗口，避免进入系统原生拖放。 */
export const registerConversationDrag = (
  validateMain: (event: IpcMainInvokeEvent) => void,
): void => {
  ipcMain.handle(
    'conversation:drag-preview',
    async (event, value: unknown): Promise<void> => {
      validateMain(event);
      const request = parseConversationDrag(value);
      const session = requireAuthenticatedSession();
      requireRemoteConversation(request.roomId);
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) throw new Error('主窗口已关闭');
      closeConversationDrag();
      const drag: Drag = { id: request.id, roomId: request.roomId };
      current = drag;
      drag.timeout = setTimeout(() => {
        if (current === drag) closeConversationDrag();
      }, 120000);
      const zoom = event.sender.getZoomFactor();
      const bounds = parent.getContentBounds();
      const rect = {
        x: Math.round(request.x * zoom),
        y: Math.round(request.y * zoom),
        width: Math.round(request.width * zoom),
        height: Math.round(request.height * zoom),
      };
      if (
        rect.x + rect.width > bounds.width ||
        rect.y + rect.height > bounds.height
      ) {
        closeConversationDrag();
        throw new Error('会话行超出窗口');
      }
      /** 每个异步阶段仍绑定原页面和授权，取消后不创建迟到预览。 */
      const valid = (): boolean => {
        if (current !== drag) return false;
        validateMain(event);
        if (requireAuthenticatedSession() !== session)
          throw new Error('账号已变化');
        return true;
      };
      try {
        const image = await event.sender.capturePage(rect);
        if (!valid()) return;
        const preview = new BrowserWindow({
          width: rect.width,
          height: rect.height,
          frame: false,
          transparent: true,
          show: false,
          focusable: false,
          skipTaskbar: true,
          icon: getApplicationIcon(),
          resizable: false,
          hasShadow: false,
          alwaysOnTop: true,
          webPreferences: {
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            javascript: false,
          },
        });
        drag.window = preview;
        preview.setIgnoreMouseEvents(true);
        preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        preview.webContents.on('will-navigate', (navigation) =>
          navigation.preventDefault(),
        );
        // 页面只包含主进程生成的 PNG，不执行脚本、不载入远端资源或 preload。
        const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><style>html,body{margin:0;background:transparent;overflow:hidden}img{display:block;width:100vw;height:100vh;border-radius:8px}</style><img src="${image.toDataURL()}">`;
        await preview.loadURL(
          `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
        );
        if (!valid()) return;
        /** 原生屏幕坐标跟随，跨屏时不使用页面推算的缩放比例。 */
        const follow = (): void => {
          try {
            if (!valid()) return;
            const cursor = screen.getCursorScreenPoint();
            preview.setPosition(
              Math.round(cursor.x - request.offsetX * zoom),
              Math.round(cursor.y - request.offsetY * zoom),
              false,
            );
          } catch {
            closeConversationDrag();
          }
        };
        follow();
        if (current !== drag) return;
        preview.showInactive();
        drag.timer = setInterval(follow, 16);
      } catch (error) {
        if (current === drag) closeConversationDrag();
        throw error;
      }
    },
  );
  ipcMain.handle(
    'conversation:drag-preview-close',
    (event, id: unknown): void => {
      validateMain(event);
      if (current?.id === id) closeConversationDrag();
    },
  );
};
