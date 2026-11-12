import type { UpdateReleaseInfo } from '../update/update';

/** 前端日志过滤等级，级别越低表示输出越少。 */
export type LogLevel = 'error' | 'warn' | 'info';

/** 校验设置窗口提交的日志等级。 */
export const parseLogLevel = (value: unknown): LogLevel => {
  switch (value) {
    case 'error':
    case 'warn':
    case 'info':
      return value;
    default:
      throw new Error('无效的日志等级');
  }
};

/** 设置窗口显示的当前账号公开资料，不包含 JWT 或其他会话凭据。 */
export interface SettingsAccount {
  id: string;
  account: string;
  nickname: string;
  avatar?: string;
}

/** 设置窗口仅提供关闭当前窗口的受控桥接。 */
export interface SettingsWindowApi {
  getAccount: () => Promise<SettingsAccount>;
  close: () => Promise<void>;
  logout: () => Promise<void>;
  getLogLevel: () => Promise<LogLevel>;
  setLogLevel: (level: LogLevel) => Promise<void>;
  checkForUpdate: () => Promise<UpdateReleaseInfo | null>;
  openUpdate: (release: UpdateReleaseInfo) => Promise<void>;
}
