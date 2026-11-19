import { contextBridge, ipcRenderer } from 'electron';
import type {
  ContextMenuHostApi,
  ContextMenuResult,
} from '../../../shared/windows/context-menu';
import { invokeIpc } from './invoke';

/** 向菜单来源页开放展示与结果订阅，不增加任何业务或数据库权限。 */
export const exposeContextMenuHost = (): void => {
  const api: ContextMenuHostApi = {
    show: (request) => invokeIpc('context-menu:show', request),
    update: (request) => invokeIpc('context-menu:update', request),
    hide: (requestId) => invokeIpc('context-menu:hide', requestId),
    onResult: (listener) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        result: ContextMenuResult,
      ): void => listener(result);
      ipcRenderer.on('context-menu:result', handler);
      return () => ipcRenderer.removeListener('context-menu:result', handler);
    },
  };
  contextBridge.exposeInMainWorld('contextMenuHost', api);
};
