import { parseImageName, parseImageUrl, MAX_IMAGE_BYTES } from '../image/image';
import {
  MAX_VIDEO_BYTES,
  videoInteger,
  isVideoDraftProcessingProgress,
} from '../video/video';
import { VIDEO_EXTENSIONS } from '../video/video-formats';
import type { ImagePreviewRequest } from '../../windows/image-preview';
import type { Message } from '../../storage/database';
import type { VideoUploadProgress } from '../video/video';
import type { MediaDraftSelection } from '../media-drafts';

export const MAX_FILE_BYTES = 6 * 1024 ** 3;
export const MAX_FILE_DRAFTS = 3;
export const UNAVAILABLE_FILE_CONTENT = JSON.stringify({
  url: null,
  fileName: '文件不可用',
  fileSize: null,
});

export interface FileMetadata {
  fileName: string;
  fileSize: number;
}
export interface SelectedFileDraft extends FileMetadata {
  id: string;
  needsPreparation?: boolean;
}
export interface ComposerFileDraft extends SelectedFileDraft {
  processing: 'ready' | 'hashing' | 'failed';
  processingProgress: number;
  processingError: string;
}
export interface FileDraftProcessingProgress {
  roomId: string;
  draftId: string;
  phase: 'hashing';
  progress: number;
}
export interface FileContent extends FileMetadata {
  url: string;
}
export type FileAvailability = 'local' | 'remote' | 'expired' | 'unknown';

export interface FileMessageApi {
  fileStatus: (request: ImagePreviewRequest) => Promise<FileAvailability>;
  downloadFile: (request: ImagePreviewRequest) => Promise<void>;
  showFileInFolder: (request: ImagePreviewRequest) => Promise<void>;
  saveFileAs: (request: ImagePreviewRequest) => Promise<boolean>;
}
export interface FileSendApi extends FileMessageApi {
  chooseAttachments: (roomId: string) => Promise<MediaDraftSelection>;
  prepareFileDraft: (roomId: string, id: string) => Promise<void>;
  onFileDraftProcessingProgress: (
    callback: (progress: FileDraftProcessingProgress) => void,
  ) => () => void;
  releaseFileDraft: (roomId: string, id: string) => Promise<void>;
  restoreFileDraft: (
    request: ImagePreviewRequest,
  ) => Promise<SelectedFileDraft>;
  sendFileDraft: (
    roomId: string,
    clientMsgId: string,
    draftId?: string,
  ) => Promise<void>;
  cancelFileUpload: (roomId: string, clientMsgId: string) => Promise<Message>;
  onFileUploadProgress: (
    callback: (progress: VideoUploadProgress) => void,
  ) => () => void;
}

/** 文件准备仅接受摘要读取阶段，沿用媒体进度的标识及百分比校验。 */
export const isFileDraftProcessingProgress = (
  value: unknown,
): value is FileDraftProcessingProgress =>
  isVideoDraftProcessingProgress(value) && value.phase === 'hashing';

/** 按大小优先分流，不把超过媒体上限的文件交给图片或视频解码器。 */
export const attachmentKind = (
  name: string,
  size: number,
): 'image' | 'video' | 'file' => {
  videoInteger(size, MAX_FILE_BYTES);
  const extension = name.split('.').pop()?.toLowerCase() ?? '';
  if (['jpg', 'jpeg', 'png', 'gif', 'bmp'].includes(extension))
    return size <= MAX_IMAGE_BYTES ? 'image' : 'file';
  if (VIDEO_EXTENSIONS.includes(extension))
    return size <= MAX_VIDEO_BYTES ? 'video' : 'file';
  return 'file';
};

/** 文件大小使用安全整数，名称不参与服务器路径拼接。 */
export const validateFileMetadata = (value: unknown): FileMetadata => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('文件信息无效');
  const data = value as Record<string, unknown>;
  return {
    fileName: parseImageName(data.fileName),
    fileSize: videoInteger(data.fileSize, MAX_FILE_BYTES),
  };
};

/** 完成消息只保存公开资源地址，不保存本机路径或分片签名。 */
export const validateFileContent = (value: unknown): FileContent => {
  const metadata = validateFileMetadata(value);
  if (
    Object.keys(value as Record<string, unknown>).some(
      (key) => !['url', 'fileName', 'fileSize'].includes(key),
    )
  )
    throw new Error('文件正文包含未知字段');
  return {
    ...metadata,
    url: parseImageUrl((value as Record<string, unknown>).url),
  };
};

/** 畸形文件元数据保留消息确认关系，界面展示不可用状态。 */
export const parseFileContent = (value: string): FileContent | null => {
  try {
    return validateFileContent(JSON.parse(value));
  } catch {
    return null;
  }
};

/** 历史和 SSE 使用同一文件正文编码。 */
export const encodeReceivedFile = (body: Record<string, unknown>): string => {
  const extra = body.extra as Record<string, unknown> | null;
  try {
    return JSON.stringify(
      validateFileContent({
        url: body.content,
        fileName: extra?.fileName,
        fileSize: extra?.size,
      }),
    );
  } catch {
    return UNAVAILABLE_FILE_CONTENT;
  }
};
