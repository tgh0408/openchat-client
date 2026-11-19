import { parseAuthBase } from '../api/api-request';

export interface ServerSettings {
  authApiBase: string;
  rtcServerUrl: string;
}

/** 环境变量仅作为尚未保存配置时的默认值。 */
export const getDefaultServerSettings = (): ServerSettings => ({
  authApiBase: import.meta.env.VITE_AUTH_API_BASE?.trim() ?? '',
  rtcServerUrl: '',
});

let settings: ServerSettings = getDefaultServerSettings();

/** 读取当前进程的服务地址快照，未保存时使用环境默认值。 */
export const getServerSettings = (): ServerSettings => ({ ...settings });

/** 在设置库加载或保存成功后同步当前进程的服务地址。 */
export const applyServerSettings = (value: ServerSettings): void => {
  settings = { ...value };
};

/** 每次业务操作读取当前服务器地址，不在模块加载时固定配置。 */
export const getAuthApiBase = (): string => settings.authApiBase;

/** 校验服务地址；登录前允许媒体地址为空，登录时由后端刷新。 */
export const parseServerSettings = (value: unknown): ServerSettings => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('authApiBase' in value) ||
    typeof value.authApiBase !== 'string' ||
    !('rtcServerUrl' in value) ||
    typeof value.rtcServerUrl !== 'string' ||
    value.authApiBase.length > 2048 ||
    value.rtcServerUrl.length > 2048
  )
    throw new Error('服务地址格式无效');
  let authApiBase: string;
  try {
    authApiBase = parseAuthBase(value.authApiBase);
  } catch {
    throw new Error('服务器地址须为 HTTPS，本机可使用 HTTP');
  }
  return {
    authApiBase,
    rtcServerUrl: value.rtcServerUrl
      ? parseRtcServerUrl(value.rtcServerUrl)
      : '',
  };
};

/** 校验后端下发的媒体地址，不允许凭据、查询参数或片段。 */
export const parseRtcServerUrl = (value: unknown): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048)
    throw new Error('LiveKit 服务地址无效');
  let rtc: URL;
  try {
    rtc = new URL(value.trim());
  } catch {
    throw new Error('请输入有效的 LiveKit 服务器地址');
  }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(rtc.hostname);
  if (
    (rtc.protocol !== 'wss:' && !(rtc.protocol === 'ws:' && local)) ||
    rtc.username ||
    rtc.password ||
    rtc.search ||
    rtc.hash
  )
    throw new Error('LiveKit 地址须为 WSS，本机可使用 WS');
  return rtc.href.replace(/\/$/, '');
};
