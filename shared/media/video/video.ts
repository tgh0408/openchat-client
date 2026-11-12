import { parseImageName, parseImageUrl } from '../image/image';
import type { LocalImageData } from '../image/image';
import type { ImagePreviewRequest } from '../../windows/image-preview';
import { videoExtension } from './video-formats';

export const MAX_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_VIDEO_DRAFTS = 3;
export const MAX_VIDEO_DRAFT_BYTES = MAX_VIDEO_BYTES * MAX_VIDEO_DRAFTS;
export const VIDEO_PART_SIZE = 16 * 1024 * 1024;
export const MAX_VIDEO_POSTER_BYTES = 2 * 1024 * 1024;
export const UNAVAILABLE_VIDEO_CONTENT = JSON.stringify({
  url: null,
  fileName: '视频.mp4',
  fileSize: null,
  thumbUrl: null,
  thumbSize: null,
  thumbWidth: 160,
  thumbHeight: 240,
  duration: 0,
});

export interface StoredVideoContent {
  url: string | null;
  fileName: string;
  fileSize: number | null;
  thumbUrl: string | null;
  thumbSize: number | null;
  thumbWidth: number;
  thumbHeight: number;
  duration: number;
}

export interface SelectedVideoDraft {
  id: string;
  fileName: string;
  fileSize: number;
  previewUrl: string;
  metadata?: VideoMetadata;
  needsPreparation?: boolean;
}

export interface VideoMetadata {
  duration: number;
  thumbWidth: number;
  thumbHeight: number;
  poster: Uint8Array;
}

/** 仅返回本机封面及恢复资格，不包含原生路径或上传凭据。 */
export interface LocalVideoUpload {
  poster: Uint8Array;
  canResume: boolean;
}

/** 按协议复制视频预览，避免将响应式代理或附加字段带入桌面 IPC。 */
export const copyVideoMetadata = (metadata: VideoMetadata): VideoMetadata => ({
  duration: metadata.duration,
  thumbWidth: metadata.thumbWidth,
  thumbHeight: metadata.thumbHeight,
  poster: new Uint8Array(metadata.poster),
});

export interface ComposerVideoDraft extends SelectedVideoDraft {
  metadata: VideoMetadata;
  posterUrl: string;
}

export interface PreparingVideoDraft extends SelectedVideoDraft {
  processing: 'hashing' | 'preview' | 'failed';
  processingProgress: number;
  processingError: string;
}

export type ComposerVideoItem = ComposerVideoDraft | PreparingVideoDraft;

/** 仅完整封面和元数据已就绪的草稿可以进入发送队列。 */
export const isReadyVideoDraft = (
  draft: ComposerVideoItem,
): draft is ComposerVideoDraft => 'posterUrl' in draft;

export interface VideoDraftProcessingProgress {
  roomId: string;
  draftId: string;
  phase: 'hashing' | 'preview';
  progress: number;
}

/** 只接受主进程报告的有限视频解析状态，拒绝越界进度和未知字段。 */
export const isVideoDraftProcessingProgress = (
  value: unknown,
): value is VideoDraftProcessingProgress => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !['roomId', 'draftId', 'phase', 'progress'].includes(key),
    ) ||
    typeof data.roomId !== 'string' ||
    !/^[1-9]\d{0,63}$/.test(data.roomId) ||
    typeof data.draftId !== 'string' ||
    data.draftId.length < 1 ||
    data.draftId.length > 64 ||
    !['hashing', 'preview'].includes(String(data.phase)) ||
    typeof data.progress !== 'number' ||
    !Number.isInteger(data.progress) ||
    data.progress < 0 ||
    data.progress > 100
  )
    return false;
  return true;
};

/** 上传前的真实视频元数据，不包含本地路径、临时预览或虚构的远端地址。 */
export interface TemporaryVideoContent {
  fileName: string;
  fileSize: number;
  duration: number;
  thumbWidth: number;
  thumbHeight: number;
}

export interface VideoUploadProgress {
  roomId: string;
  draftId: string;
  uploadedBytes: number;
  totalBytes: number;
  phase: 'validating' | 'uploading' | 'finalizing';
}

/** 严格校验 type 3 视频占位所需的非敏感元数据。 */
export const validateTemporaryVideo = (
  value: unknown,
): TemporaryVideoContent => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('视频占位信息无效');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        ![
          'fileName',
          'fileSize',
          'duration',
          'thumbWidth',
          'thumbHeight',
        ].includes(key),
    )
  )
    throw new Error('视频占位包含未知字段');
  const fileName = parseImageName(data.fileName);
  videoExtension(fileName);
  return {
    fileName,
    fileSize: videoInteger(data.fileSize, MAX_VIDEO_BYTES),
    duration: videoInteger(data.duration, 86400000),
    thumbWidth: videoInteger(data.thumbWidth, 1920),
    thumbHeight: videoInteger(data.thumbHeight, 1920),
  };
};

/** 读取已落库的占位信息，旧空占位不伪造可播放视频。 */
export const parseTemporaryVideo = (
  content: string,
): TemporaryVideoContent | null => {
  try {
    return validateTemporaryVideo(JSON.parse(content));
  } catch {
    return null;
  }
};

/** 仅接受主进程报告的有界实际分片确认量。 */
export const isVideoUploadProgress = (
  value: unknown,
): value is VideoUploadProgress => {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return (
    typeof data.roomId === 'string' &&
    /^[1-9]\d{0,63}$/.test(data.roomId) &&
    typeof data.draftId === 'string' &&
    data.draftId.length <= 64 &&
    typeof data.totalBytes === 'number' &&
    Number.isSafeInteger(data.totalBytes) &&
    data.totalBytes > 0 &&
    data.totalBytes <= MAX_VIDEO_BYTES &&
    typeof data.uploadedBytes === 'number' &&
    Number.isSafeInteger(data.uploadedBytes) &&
    data.uploadedBytes >= 0 &&
    data.uploadedBytes <= data.totalBytes &&
    ['validating', 'uploading', 'finalizing'].includes(String(data.phase))
  );
};

export interface MultipartUploadInit {
  sessionKey: string;
  uploadId: string;
  downloadUrl: string;
  fileSize: number;
  partSize: number;
  completed: boolean;
  parts: Array<{ partNumber: number; etag: string; size: number }>;
}

export interface MultipartPartUpload {
  uploadUrl: string;
}

/** 消息窗口仅按标识访问视频，状态查询和封面读取不会下载视频。 */
export interface VideoMessageApi {
  showVideoInFolder: (request: ImagePreviewRequest) => Promise<void>;
  readVideoUpload: (
    request: ImagePreviewRequest,
  ) => Promise<LocalVideoUpload | null>;
  videoStatus: (request: ImagePreviewRequest) => Promise<boolean>;
  readVideoPoster: (request: ImagePreviewRequest) => Promise<LocalImageData>;
  downloadVideo: (request: ImagePreviewRequest) => Promise<void>;
  openVideo: (request: ImagePreviewRequest) => Promise<void>;
}

export interface VideoPlayerApi {
  getContext: () => Promise<VideoPlayerContext>;
  updateProgress: (progress: VideoPlaybackProgress) => Promise<void>;
  saveProgress: (progress: VideoPlaybackProgress | null) => Promise<void>;
  onClosing: (callback: () => void) => () => void;
}

export interface VideoPlayerContext {
  fileName: string;
  url: string;
  position: number;
}

/** 播放位置使用秒，标识和文件路径均由主进程窗口绑定。 */
export interface VideoPlaybackProgress {
  position: number;
  duration: number;
  ended: boolean;
}

/** 校验播放器报告的有限时长和位置，拒绝附加消息、路径或账号字段。 */
export const parseVideoPlaybackProgress = (
  value: unknown,
): VideoPlaybackProgress => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('视频播放进度无效');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) => !['position', 'duration', 'ended'].includes(key),
    ) ||
    typeof data.position !== 'number' ||
    !Number.isFinite(data.position) ||
    typeof data.duration !== 'number' ||
    !Number.isFinite(data.duration) ||
    data.duration <= 0 ||
    data.duration > 86400 ||
    data.position < 0 ||
    data.position > data.duration ||
    typeof data.ended !== 'boolean'
  )
    throw new Error('视频播放进度无效');
  return {
    position: data.position,
    duration: data.duration,
    ended: data.ended,
  };
};

/** 旧位置超出实际媒体时长时从头播放，不跳到结尾覆盖历史进度。 */
export const resumeVideoPosition = (
  position: number,
  duration: number,
): number =>
  Number.isFinite(position) &&
  Number.isFinite(duration) &&
  position >= 0 &&
  position < duration
    ? position
    : 0;

/** 严格解析媒体计量值，Long 字符串仅在安全整数范围内转换。 */
export const videoInteger = (value: unknown, maximum: number): number => {
  const parsed =
    typeof value === 'string' && /^[1-9]\d{0,9}$/.test(value)
      ? Number(value)
      : value;
  if (
    typeof parsed !== 'number' ||
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > maximum
  )
    throw new Error('视频大小、时长或尺寸无效');
  return parsed;
};

/** 校验待发送的完整视频元数据，不接受本地路径或临时签名。 */
export const validateVideo = (value: unknown): StoredVideoContent => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('视频信息无效');
  const data = value as Record<string, unknown>;
  if (
    Object.keys(data).some(
      (key) =>
        ![
          'url',
          'fileName',
          'fileSize',
          'thumbUrl',
          'thumbSize',
          'thumbWidth',
          'thumbHeight',
          'duration',
        ].includes(key),
    )
  )
    throw new Error('视频包含未知字段');
  const fileName = parseImageName(data.fileName);
  videoExtension(fileName);
  return {
    url: parseImageUrl(data.url),
    fileName,
    fileSize: videoInteger(data.fileSize, MAX_VIDEO_BYTES),
    thumbUrl: parseImageUrl(data.thumbUrl),
    thumbSize: videoInteger(data.thumbSize, MAX_VIDEO_POSTER_BYTES),
    thumbWidth: videoInteger(data.thumbWidth, 1920),
    thumbHeight: videoInteger(data.thumbHeight, 1920),
    duration: videoInteger(data.duration, 86400000),
  };
};

/** 接收无效媒体时保留确认关系，用不可用占位避免阻断整页同步。 */
export const encodeReceivedVideo = (body: Record<string, unknown>): string => {
  try {
    const extra = body.extra as Record<string, unknown> | null;
    return JSON.stringify(
      validateVideo({
        url: body.content,
        fileName: extra?.fileName,
        fileSize: extra?.size,
        thumbUrl: extra?.thumbUrl,
        thumbSize: extra?.thumbSize,
        thumbWidth: extra?.thumbWidth,
        thumbHeight: extra?.thumbHeight,
        duration: extra?.duration,
      }),
    );
  } catch {
    return UNAVAILABLE_VIDEO_CONTENT;
  }
};

/** 读取本地视频正文；缺少必要元数据的旧记录只显示不可用状态。 */
export const parseVideoContent = (
  content: string,
): StoredVideoContent | null => {
  try {
    return validateVideo(JSON.parse(content));
  } catch {
    return null;
  }
};

/** 重试复用公开视频及封面地址，不重复上传文件。 */
export const videoMessageBody = (content: string): Record<string, unknown> => {
  const video = validateVideo(JSON.parse(content));
  return {
    content: video.url,
    uploadAddress: video.url,
    fileName: video.fileName,
    fileSize: String(video.fileSize),
    thumbUrl: video.thumbUrl,
    thumbSize: String(video.thumbSize),
    thumbWidth: video.thumbWidth,
    thumbHeight: video.thumbHeight,
    duration: String(video.duration),
  };
};
