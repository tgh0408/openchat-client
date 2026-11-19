import { invokeIpc } from '../../services/ipc/invoke';
import { contextBridge } from 'electron';
import type { UpdateConfirmApi } from '../../../shared/windows/update-confirm';

/** 读取主进程绑定的待更新版本号。 */
const getVersion = async (): Promise<string> =>
  invokeIpc('update-confirm:context');

/** 提交确认或取消，只作用于当前升级确认窗口。 */
const respond = async (confirmed: boolean): Promise<void> => {
  await invokeIpc('update-confirm:respond', confirmed);
};

const updateConfirmDesktop: UpdateConfirmApi = { getVersion, respond };
contextBridge.exposeInMainWorld('updateConfirmDesktop', updateConfirmDesktop);
