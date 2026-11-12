import { invokeIpc } from '../../services/ipc/invoke';
import { contextBridge } from 'electron';
import type { UpdateReleaseInfo } from '../../../shared/update/update';
import type {
  LogLevel,
  SettingsAccount,
  SettingsWindowApi,
} from '../../../shared/windows/settings-window';

/** 读取当前已验证账号的公开资料，不返回访问令牌。 */
const getAccount = async (): Promise<SettingsAccount> => {
  return invokeIpc('settings:context');
};

/** 关闭当前设置窗口，不向页面暴露通用 IPC。 */
const close = async (): Promise<void> => {
  await invokeIpc('settings:close');
};

/** 请求主进程清理当前登录会话。 */
const logout = async (): Promise<void> => {
  await invokeIpc('settings:logout');
};

/** 读取当前主进程日志等级。 */
const getLogLevel = async (): Promise<LogLevel> => {
  return invokeIpc('settings:get-log-level');
};

/** 请求主进程更新日志等级并持久化。 */
const setLogLevel = async (level: LogLevel): Promise<void> => {
  await invokeIpc('settings:set-log-level', level);
};

/** 请求当前客户端是否存在更高版本。 */
const checkForUpdate = async (): Promise<UpdateReleaseInfo | null> => {
  return invokeIpc('settings:check-update');
};

/** 请求主进程打开绑定版本的独立更新窗口。 */
const openUpdate = async (release: UpdateReleaseInfo): Promise<void> => {
  await invokeIpc('settings:open-update', release);
};

const settingsDesktop: SettingsWindowApi = {
  getAccount,
  close,
  logout,
  getLogLevel,
  setLogLevel,
  checkForUpdate,
  openUpdate,
};

contextBridge.exposeInMainWorld('settingsDesktop', settingsDesktop);
