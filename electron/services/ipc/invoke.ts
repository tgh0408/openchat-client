import { ipcRenderer } from 'electron';
import { getRequestErrorMessage } from '../../../shared/api/api-error';

/** 只供受控 preload 使用，页面仍只获得各窗口白名单中的业务方法。 */
export const invokeIpc = async <T>(
  channel: string,
  ...args: unknown[]
): Promise<T> => {
  try {
    return (await ipcRenderer.invoke(channel, ...args)) as T;
  } catch (cause) {
    const error = new Error(getRequestErrorMessage(cause, '操作失败，请重试'));
    error.name = 'IpcRequestError';
    throw error;
  }
};
