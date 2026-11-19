import { invokeIpc } from '../../services/ipc/invoke';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  UpdateDownloadProgress,
  UpdateReleaseInfo,
} from '../../../shared/update/update';
import type { UpdateWindowApi } from '../../../shared/windows/update-window';

/** 读取主进程绑定的版本信息，不通过 URL 传递发布数据。 */
const getRelease = async (): Promise<UpdateReleaseInfo> =>
  invokeIpc('update:context');

/** 关闭独立更新窗口。 */
const close = async (): Promise<void> => {
  await invokeIpc('update:close');
};

/** 请求主进程确认运行状态后下载，用户取消确认时返回 false。 */
const downloadUpdate = async (): Promise<boolean> =>
  invokeIpc('update:download');

/** 取消当前安装包下载。 */
const cancelUpdate = async (): Promise<void> => {
  await invokeIpc('update:cancel');
};

/** 订阅当前更新窗口的下载进度。 */
const onUpdateProgress = (
  callback: (progress: UpdateDownloadProgress) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    progress: UpdateDownloadProgress,
  ): void => callback(progress);
  ipcRenderer.on('update:progress', listener);
  return (): void => {
    ipcRenderer.removeListener('update:progress', listener);
  };
};

const updateDesktop: UpdateWindowApi = {
  getRelease,
  close,
  downloadUpdate,
  cancelUpdate,
  onUpdateProgress,
};

contextBridge.exposeInMainWorld('updateDesktop', updateDesktop);
