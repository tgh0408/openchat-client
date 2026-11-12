import { contextBridge, ipcRenderer } from 'electron';
import type {
  ContextMenuSnapshot,
  ContextMenuWindowApi,
} from '../../../shared/windows/context-menu';
import { invokeIpc } from '../../services/ipc/invoke';

const api: ContextMenuWindowApi = {
  ready: () => invokeIpc('context-menu:ready'),
  layout: (binding, size) => invokeIpc('context-menu:layout', binding, size),
  select: (binding, itemId) =>
    invokeIpc('context-menu:select', binding, itemId),
  dismiss: (binding) => invokeIpc('context-menu:dismiss', binding),
  onSnapshot: (listener) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      value: ContextMenuSnapshot | null,
    ): void => listener(value);
    ipcRenderer.on('context-menu:snapshot', handler);
    return () => ipcRenderer.removeListener('context-menu:snapshot', handler);
  },
};

contextBridge.exposeInMainWorld('contextMenuDesktop', api);
