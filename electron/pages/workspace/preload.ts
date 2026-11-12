import { contextBridge } from 'electron';
import { exposeContextMenuHost } from '../../services/ipc/context-menu-bridge';
import { desktop } from '../../services/ipc/desktop-bridge';

contextBridge.exposeInMainWorld('desktop', desktop);
exposeContextMenuHost();
