import {
  ClientPlatform,
  PLATFORM_CLIENT_IDS,
} from '../../../shared/auth/client-identity';

/** 按桌面平台配置读取固定 clientId，不作为设备唯一标识。 */
export const getClientId = (): string => PLATFORM_CLIENT_IDS[CLIENT_PLATFORM];



/** 桌面平台唯一配置，设备初始化与请求头共用；修改后须完整重启并重新登录。 */
export const CLIENT_PLATFORM: ClientPlatform = ClientPlatform.PC;