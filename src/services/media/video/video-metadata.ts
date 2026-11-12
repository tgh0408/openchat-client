import {
  MAX_VIDEO_POSTER_BYTES,
  videoInteger,
} from '../../../../shared/media/video/video';
import type { VideoMetadata } from '../../../../shared/media/video/video';

/** 通过本地受控流解码一帧，生成等比例 JPEG 封面，不读取远端视频。 */
export const readVideoMetadata = async (
  url: string,
): Promise<VideoMetadata> => {
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('读取视频预览超时')),
        30000,
      );
      video.onloadeddata = (): void => {
        clearTimeout(timer);
        resolve();
      };
      video.onerror = (): void => {
        clearTimeout(timer);
        reject(new Error('无法解码视频，请使用 H.264 编码的 MP4 文件'));
      };
      video.src = url;
      video.load();
    });
    const duration = videoInteger(Math.round(video.duration * 1000), 86400000);
    if (!video.videoWidth || !video.videoHeight)
      throw new Error('视频画面尺寸无效');
    const scale = Math.min(
      1,
      640 / Math.max(video.videoWidth, video.videoHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法生成视频封面');
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error('无法生成视频封面')),
        'image/jpeg',
        0.85,
      );
    });
    videoInteger(blob.size, MAX_VIDEO_POSTER_BYTES);
    return {
      duration,
      thumbWidth: canvas.width,
      thumbHeight: canvas.height,
      poster: new Uint8Array(await blob.arrayBuffer()),
    };
  } finally {
    video.onloadeddata = null;
    video.onerror = null;
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
};
