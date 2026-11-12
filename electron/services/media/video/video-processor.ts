import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import ffmpeg from 'ffmpeg-static';
import ffprobe from '@ffprobe-installer/ffprobe';
import { imageSize } from 'image-size';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_POSTER_BYTES,
  videoInteger,
} from '../../../../shared/media/video/video';
import type { VideoMetadata } from '../../../../shared/media/video/video';
import {
  checkVideoHeader,
  videoExtension,
} from '../../../../shared/media/video/video-formats';
import { openVideoFile } from './video-stream';

export interface VideoProcessor {
  preview: (filePath: string, validate: () => void) => Promise<VideoMetadata>;
  playback: (
    filePath: string,
    validateRead: () => void,
    validateWrite: () => void,
  ) => Promise<string>;
  cancel: () => void;
}

interface Probe {
  duration: number;
  video: number;
  audio: number | null;
  copyVideo: boolean;
  copyAudio: boolean;
}

const inputOptions = [
  '-protocol_whitelist',
  'file,pipe',
  '-format_whitelist',
  'mov,matroska,webm,avi,asf,flv,mpeg,mpegvideo',
];

/** 只使用随应用分发的解码器；原视频不转码上传，兼容副本只用于本地播放。 */
export const createVideoProcessor = (): VideoProcessor => {
  const children = new Set<ChildProcess>();
  let generation = 0;
  let queue: Promise<void> = Promise.resolve();

  /** 排队期间不读取文件，限制同时运行的解码任务及内存占用。 */
  const exclusive = async <T>(
    validate: () => void,
    action: (current: () => void) => Promise<T>,
  ): Promise<T> => {
    const version = generation;
    /** 退出、账号切换或草稿撤销后，排队和正在执行的任务均失效。 */
    const current = (): void => {
      if (version !== generation) throw new Error('视频处理已取消');
      validate();
    };
    const previous = queue;
    let release = (): void => {};
    queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      current();
      return await action(current);
    } finally {
      release();
    }
  };

  /** 参数数组启动隐藏子进程，不经过 shell；禁止网络协议、限制输出并持续检查授权。 */
  const run = (
    executable: string | null,
    args: string[],
    validate: () => void,
    maximum: number,
    timeout: number,
  ): Promise<Buffer> =>
    new Promise((resolve, reject) => {
      if (!executable) {
        reject(new Error('本机缺少视频解码工具，请重新安装应用依赖'));
        return;
      }
      try {
        validate();
      } catch (error) {
        reject(error);
        return;
      }
      // spawn 需要真实文件路径，不能执行 ASAR 虚拟目录中的程序。
      const executablePath = executable.replace(
        /([\\/])app\.asar([\\/])/i,
        '$1app.asar.unpacked$2',
      );
      const child = spawn(executablePath, args, {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      children.add(child);
      const chunks: Buffer[] = [];
      let length = 0;
      let failure: unknown;
      /** 只记录第一个错误，等待子进程退出再释放文件和排队锁。 */
      const stop = (error: unknown): void => {
        failure ??= error;
        child.kill();
      };
      const timer = setTimeout(
        () => stop(new Error('视频处理超时，请尝试较短的视频')),
        timeout,
      );
      const watcher = setInterval(() => {
        try {
          validate();
        } catch (error) {
          stop(error);
        }
      }, 200);
      child.stdout.on('data', (bytes: Buffer) => {
        length += bytes.length;
        if (length > maximum) stop(new Error('视频预览信息超过大小限制'));
        else chunks.push(bytes);
      });
      child.on('error', (cause: NodeJS.ErrnoException) => {
        failure ??= Object.assign(
          new Error('无法启动视频解码工具，请检查应用依赖', { cause }),
          { code: cause.code },
        );
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        clearInterval(watcher);
        children.delete(child);
        try {
          validate();
          if (failure) throw failure;
          if (code !== 0)
            throw new Error('视频解码失败，文件可能损坏、加密或编码不受支持');
          resolve(Buffer.concat(chunks));
        } catch (error) {
          reject(error);
        }
      });
    });

  /** 使用结构化探测结果校验真实视频轨、时长和像素规模，不信任扩展名或 stderr 文本。 */
  const probe = async (
    filePath: string,
    validate: () => void,
  ): Promise<Probe> => {
    const file = await openVideoFile(filePath);
    try {
      const info = await file.stat();
      videoInteger(info.size, MAX_VIDEO_BYTES);
      const header = Buffer.alloc(32);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      checkVideoHeader(
        header.subarray(0, bytesRead),
        videoExtension(path.basename(filePath)),
      );
    } finally {
      await file.close();
    }
    const output = await run(
      ffprobe.path,
      [
        '-v',
        'error',
        ...inputOptions,
        '-show_entries',
        'format=format_name,duration:stream=index,codec_type,codec_name,pix_fmt,width,height,duration:stream_disposition=attached_pic',
        '-of',
        'json',
        filePath,
      ],
      validate,
      1024 * 1024,
      60000,
    );
    const data: unknown = JSON.parse(output.toString('utf8'));
    if (!data || typeof data !== 'object') throw new Error('视频信息无效');
    const root = data as Record<string, unknown>;
    if (!Array.isArray(root.streams)) throw new Error('视频没有可解码的轨道');
    const streams = root.streams.filter(
      (value: unknown): value is Record<string, unknown> =>
        !!value && typeof value === 'object',
    );
    const video = streams.find(
      (stream) =>
        stream.codec_type === 'video' &&
        (stream.disposition as Record<string, unknown> | undefined)
          ?.attached_pic !== 1,
    );
    const audio = streams.find((stream) => stream.codec_type === 'audio');
    if (!video || !Number.isInteger(video.index) || Number(video.index) < 0)
      throw new Error('文件没有可播放的视频轨');
    const width = videoInteger(video.width, 8192);
    const height = videoInteger(video.height, 8192);
    if (width * height > 40000000) throw new Error('视频画面超过 4000 万像素');
    const format = root.format as Record<string, unknown> | undefined;
    const duration = videoInteger(
      Math.round(Number(format?.duration ?? video.duration) * 1000),
      86400000,
    );
    return {
      duration,
      video: Number(video.index),
      audio:
        audio && Number.isInteger(audio.index) && Number(audio.index) >= 0
          ? Number(audio.index)
          : null,
      copyVideo: video.codec_name === 'h264' && video.pix_fmt === 'yuv420p',
      copyAudio: !audio || audio.codec_name === 'aac',
    };
  };

  /** 从原格式抽取一张 JPEG 封面，不通过渲染进程解码整个视频。 */
  const preview = async (
    filePath: string,
    validate: () => void,
  ): Promise<VideoMetadata> =>
    exclusive(validate, async (current) => {
      const info = await probe(filePath, current);
      const poster = await run(
        ffmpeg,
        [
          '-v',
          'error',
          '-nostdin',
          '-threads',
          '2',
          ...inputOptions,
          '-i',
          filePath,
          '-map',
          `0:${info.video}`,
          '-frames:v',
          '1',
          '-vf',
          'scale=640:640:force_original_aspect_ratio=decrease',
          '-threads',
          '2',
          '-c:v',
          'mjpeg',
          '-q:v',
          '3',
          '-f',
          'image2pipe',
          'pipe:1',
        ],
        current,
        MAX_VIDEO_POSTER_BYTES,
        60000,
      );
      const dimensions = imageSize(poster);
      return {
        duration: info.duration,
        thumbWidth: dimensions.width,
        thumbHeight: dimensions.height,
        poster: new Uint8Array(poster),
      };
    });

  /** 优先复用兼容副本；只有有效写入授权才可在原缓存旁生成 MP4，绝不覆盖原文件。 */
  const playback = async (
    filePath: string,
    validateRead: () => void,
    validateWrite: () => void,
  ): Promise<string> =>
    exclusive(validateRead, async (current) => {
      const target = `${filePath}.play.mp4`;
      try {
        const file = await openVideoFile(target);
        try {
          videoInteger((await file.stat()).size, MAX_VIDEO_BYTES);
          const header = Buffer.alloc(12);
          await file.read(header, 0, header.length, 0);
          checkVideoHeader(header, 'mp4');
          current();
          return target;
        } finally {
          await file.close();
        }
      } catch (error) {
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
      }
      const info = await probe(filePath, current);
      if (
        videoExtension(path.basename(filePath)) === 'mp4' &&
        info.copyVideo &&
        info.copyAudio
      )
        return filePath;
      /** 生成副本的每个阶段仍绑定原账号与有效令牌。 */
      const writable = (): void => {
        current();
        validateWrite();
      };
      writable();
      const temporary = `${filePath}.${randomUUID()}.part.mp4`;
      try {
        await run(
          ffmpeg,
          [
            '-v',
            'error',
            '-nostdin',
            '-n',
            '-threads',
            '2',
            ...inputOptions,
            '-i',
            filePath,
            '-map',
            `0:${info.video}`,
            ...(info.audio === null ? ['-an'] : ['-map', `0:${info.audio}`]),
            '-sn',
            '-dn',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            ...(info.copyVideo
              ? ['-c:v', 'copy']
              : [
                  '-c:v',
                  'libx264',
                  '-preset',
                  'veryfast',
                  '-crf',
                  '23',
                  '-pix_fmt',
                  'yuv420p',
                  '-vf',
                  'scale=trunc(iw/2)*2:trunc(ih/2)*2',
                ]),
            ...(info.audio === null
              ? []
              : info.copyAudio
                ? ['-c:a', 'copy']
                : ['-c:a', 'aac', '-b:a', '160k']),
            '-threads',
            '2',
            '-movflags',
            '+faststart',
            '-fs',
            String(MAX_VIDEO_BYTES + 1),
            '-f',
            'mp4',
            temporary,
          ],
          writable,
          1024,
          2 * 60 * 60 * 1000,
        );
        const result = await probe(temporary, writable);
        if (
          !result.copyVideo ||
          !result.copyAudio ||
          Math.abs(result.duration - info.duration) > 1000
        )
          throw new Error('视频兼容副本不完整或超过 2 GiB，未修改原文件');
        writable();
        await rename(temporary, target);
        writable();
        return target;
      } finally {
        await unlink(temporary).catch((error: unknown): void => {
          if (!(
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          ))
            throw error;
        });
      }
    });

  /** 应用退出时立即终止本进程启动的解码器，不遗留后台转码任务。 */
  const cancel = (): void => {
    generation++;
    for (const child of children) child.kill();
  };
  return { preview, playback, cancel };
};
