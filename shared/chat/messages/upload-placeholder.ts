import { parseImageName } from '../../media/image/image';
import { validateTemporaryVideo, videoInteger } from '../../media/video/video';
import { MAX_FILE_BYTES } from '../../media/file/file-message';

export interface UploadPlaceholder {
  targetType: 5 | 6;
  cancelled: boolean;
  fileName: string;
  fileSize: number;
  duration?: number;
  thumbWidth?: number;
  thumbHeight?: number;
}

/** 视频与普通大文件共用 type 3，终态仅从服务端消息读取，不作为创建参数。 */
export const validateUploadPlaceholder = (
  value: unknown,
): UploadPlaceholder => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('上传占位信息无效');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        ![
          'targetType',
          'cancelled',
          'fileName',
          'fileSize',
          'duration',
          'thumbWidth',
          'thumbHeight',
        ].includes(key),
    )
  )
    throw new Error('上传占位包含未知字段');
  const targetType = data.targetType ?? 5;
  const cancelled = data.cancelled ?? false;
  if ((targetType !== 5 && targetType !== 6) || typeof cancelled !== 'boolean')
    throw new Error('上传占位类型或状态无效');
  if (targetType === 5) {
    return {
      ...validateTemporaryVideo({
        fileName: data.fileName,
        fileSize: data.fileSize,
        duration: data.duration,
        thumbWidth: data.thumbWidth,
        thumbHeight: data.thumbHeight,
      }),
      targetType,
      cancelled,
    };
  }
  if (
    data.duration != null ||
    data.thumbWidth != null ||
    data.thumbHeight != null
  )
    throw new Error('普通文件占位不接受视频字段');
  return {
    targetType,
    cancelled,
    fileName: parseImageName(data.fileName),
    fileSize: videoInteger(data.fileSize, MAX_FILE_BYTES),
  };
};

/** 读取历史占位及取消终态；旧视频占位缺省按 type 5 解析。 */
export const parseUploadPlaceholder = (
  content: string,
): UploadPlaceholder | null => {
  try {
    return validateUploadPlaceholder(JSON.parse(content));
  } catch {
    return null;
  }
};
