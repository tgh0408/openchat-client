import { parseApiResult } from '../api/api-response';

/** 可安全交给设置页展示的版本元数据，不包含下载地址。 */
export interface UpdateReleaseInfo {
  releaseId: number;
  version: string;
  clientName: string;
  fileSize: number;
  updateInfo: string[];
}

/** 主进程内部使用的后端发布记录，包含受控下载地址。 */
export interface ClientUpdateInfo extends UpdateReleaseInfo {
  sha256: string;
  downloadUrl: string;
}

/** 更新下载进度，页面只接收统计数据，不接收文件路径。 */
export interface UpdateDownloadProgress {
  loaded: number;
  total: number;
  percent: number;
  status: 'downloading' | 'completed' | 'failed' | 'cancelled';
}

/** Windows OpenChat进程状态，unknown 表示系统无法可靠完成检查。 */
export type OpenChatStatus = 'running' | 'stopped' | 'unknown';

/** 比较三段式客户端版本号，忽略版本号前后的空白和 v 前缀。 */
export const compareClientVersions = (left: string, right: string): number => {
  const parse = (value: string): number[] =>
    value
      .trim()
      .replace(/^v/i, '')
      .split('.')
      .map((part) => Number.parseInt(part, 10));
  const leftParts = parse(left);
  const rightParts = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};

/** 读取后端可能按字符串序列化的非负安全整数。 */
const parseSafeInteger = (value: unknown): number => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  if (typeof value !== 'string' || !/^\d+$/.test(value.trim())) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
};

/** 校验版本接口的统一响应，空 data 表示服务端暂无已发布版本。 */
export const parseClientUpdateResponse = (
  value: unknown,
): ClientUpdateInfo | null => {
  const result = parseApiResult(value, '版本更新');
  const raw = result.data;
  if (raw === null) return null;
  if (!raw || typeof raw !== 'object')
    throw new Error('版本更新服务返回的数据无效');
  const data = raw as Record<string, unknown>;
  const releaseId = parseSafeInteger(data.releaseId);
  const version = typeof data.version === 'string' ? data.version.trim() : '';
  const clientName =
    typeof data.clientName === 'string' ? data.clientName.trim() : '';
  const fileSize = parseSafeInteger(data.fileSize);
  const sha256 = typeof data.sha256 === 'string' ? data.sha256.trim() : '';
  const downloadUrl =
    typeof data.downloadUrl === 'string' ? data.downloadUrl.trim() : '';
  const updateInfo = Array.isArray(data.updateInfo)
    ? data.updateInfo.filter(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      )
    : [];
  if (
    releaseId <= 0 ||
    !/^\d+\.\d+\.\d+$/.test(version) ||
    !clientName ||
    fileSize <= 0 ||
    !/^[a-f\d]{64}$/i.test(sha256) ||
    !/^https?:\/\//i.test(downloadUrl)
  )
    throw new Error('版本更新服务返回的数据无效');
  return {
    releaseId,
    version,
    clientName,
    fileSize,
    sha256: sha256.toLowerCase(),
    downloadUrl,
    updateInfo,
  };
};

/** 移除下载地址和校验摘要后再交给设置页。 */
export const toUpdateReleaseInfo = (
  value: ClientUpdateInfo,
): UpdateReleaseInfo => ({
  releaseId: value.releaseId,
  version: value.version,
  clientName: value.clientName,
  fileSize: value.fileSize,
  updateInfo: value.updateInfo,
});
