import { invokeIpc } from '../../services/ipc/invoke';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  TrayConversation,
  TrayPreviewApi,
} from '../../../shared/windows/tray-preview';

/** 读取当前托盘窗口绑定账号的未读会话。 */
const read = async (): Promise<TrayConversation[]> =>
  invokeIpc('tray-preview:read');
/** 首帧完成后允许主进程显示预览。 */
const ready = async (): Promise<void> => invokeIpc('tray-preview:ready');
/** 仅请求打开预览中已有的会话。 */
const open = async (roomId: string): Promise<void> =>
  invokeIpc('tray-preview:open', roomId);
/** 暂停当前未读提醒，不修改阅读位置。 */
const ignore = async (): Promise<void> => invokeIpc('tray-preview:ignore');
/** 隐藏当前预览。 */
const hide = async (): Promise<void> => invokeIpc('tray-preview:hide');
/** 转发主进程会话快照，不暴露原始 IPC 事件。 */
const onChanged = (
  callback: (items: TrayConversation[]) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    items: TrayConversation[],
  ): void => callback(items);
  ipcRenderer.on('tray-preview:changed', listener);
  return (): void => {
    ipcRenderer.removeListener('tray-preview:changed', listener);
  };
};

const trayPreviewDesktop: TrayPreviewApi = {
  read,
  ready,
  open,
  ignore,
  hide,
  onChanged,
};
contextBridge.exposeInMainWorld('trayPreviewDesktop', trayPreviewDesktop);
