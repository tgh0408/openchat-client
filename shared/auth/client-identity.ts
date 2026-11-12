/** 客户端平台分类，枚举值保持与现有平台协议一致。 */
export enum ClientPlatform {
  PC = 'PC',
  PHONE = 'PHONE',
  WEB = 'WEB',
}

/** 读取构建环境中的平台标识，缺少配置时明确报错。 */
const readClientId = (
  platform: ClientPlatform,
  value: string | undefined,
): string => {
  const clientId = value?.trim();
  if (!clientId) throw new Error(`请配置 VITE_CLIENT_ID_${platform}`);
  return clientId;
};

/** 从环境配置读取与后端 openchat.jwt.client-id 对齐的平台标识。 */
export const PLATFORM_CLIENT_IDS = {
  [ClientPlatform.PC]: readClientId(
    ClientPlatform.PC,
    import.meta.env?.VITE_CLIENT_ID_PC,
  ),
  [ClientPlatform.PHONE]: readClientId(
    ClientPlatform.PHONE,
    import.meta.env?.VITE_CLIENT_ID_PHONE,
  ),
  [ClientPlatform.WEB]: readClientId(
    ClientPlatform.WEB,
    import.meta.env?.VITE_CLIENT_ID_WEB,
  ),
} as const satisfies Record<ClientPlatform, string>;

export const CLIENT_ID_HEADER = 'clientId';
