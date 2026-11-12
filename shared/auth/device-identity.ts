import {
  CLIENT_ID_HEADER,
  ClientPlatform,
  PLATFORM_CLIENT_IDS,
} from './client-identity';

export const DEVICE_ID_HEADER = 'X-Device-Id';

let deviceId: string | undefined;
let clientPlatform: ClientPlatform | undefined;

/** 在可信主进程比较接听通知，平台相同仍须匹配设备摘要。 */
export const matchesCurrentDevice = (terminal: string, id: string): boolean =>
  clientPlatform === terminal && deviceId === id;

/** 只接受系统标识摘要或浏览器随机值，不传输原始硬件信息。 */
export const parseDeviceId = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    value.length !== 64 ||
    !/^[a-f0-9]{64}$/.test(value)
  )
    throw new Error('设备标识无效，请重新启动客户端');
  return value;
};

/** 在请求开放前固定设备和应用平台，禁止切换账号时替换。 */
export const initializeDeviceId = (
  value: string,
  platform: ClientPlatform,
): void => {
  const parsed = parseDeviceId(value);
  if (
    deviceId !== undefined &&
    (deviceId !== parsed || clientPlatform !== platform)
  )
    throw new Error('设备标识已初始化，不能在运行期间更换');
  deviceId = parsed;
  clientPlatform = platform;
};

/** 浏览器预览仅保留页面内存标识，热更新复用已有值，不模拟硬件身份。 */
export const initializeBrowserDeviceIdentity = (): void => {
  if (deviceId === undefined)
    initializeDeviceId(
      `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, ''),
      ClientPlatform.WEB,
    );
};

/** 仅业务后端请求使用此头；未初始化时拒绝请求，不从 JWT 反推设备。 */
export const createDeviceRequestHeaders = (): Record<string, string> => {
  if (deviceId === undefined || clientPlatform === undefined)
    throw new Error('设备标识尚未就绪');
  return {
    [DEVICE_ID_HEADER]: deviceId,
    [CLIENT_ID_HEADER]: PLATFORM_CLIENT_IDS[clientPlatform],
  };
};
