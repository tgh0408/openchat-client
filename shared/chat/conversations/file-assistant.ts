import type { ApiClient } from '../../api/api-client';
import { parseApiResult } from '../../api/api-response';

/** 读取当前账号已有文件助手的真实房间号，不创建房间或接受页面指定归属。 */
export const requestFileAssistantRoomId = async (
  api: ApiClient,
): Promise<string> =>
  api.request({
    path: '/capi/chat/contact/fileAssistant',
    method: 'GET',
    serviceName: '文件助手',
    parse: (value: unknown): string => {
      const { data } = parseApiResult(value, '文件助手');
      if (
        typeof data !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(data) ||
        BigInt(data) > 9223372036854775807n
      )
        throw new Error('文件助手房间号无效');
      return data;
    },
  });
