import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseAuthBase } from '../../../../shared/auth/auth';
import { parseImageUrl } from '../../../../shared/media/image/image';
import type { LocalImageData } from '../../../../shared/media/image/image';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_POSTER_BYTES,
  parseVideoContent,
} from '../../../../shared/media/video/video';
import type { ImageFileAccess } from '../image/image-files';
import {
  getVideoFilePath,
  getVideoMessage,
  setVideoFilePath,
} from '../../database/database';
import { validateImageForUpload } from '../image/image-upload';
import { openVideoFile } from './video-stream';
import {
  checkVideoHeader,
  videoExtension,
  VIDEO_FORMATS,
} from '../../../../shared/media/video/video-formats';
import type { VideoExtension } from '../../../../shared/media/video/video-formats';
import type { VideoProcessor } from './video-processor';
import type { AuthorizeMessageDownload } from '../../../../shared/chat/messages/message-download';

interface VideoResource {
  url: string;
  size: number;
  poster: boolean;
  extension: VideoExtension;
}

export interface VideoFileStore {
  original: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<string | null>;
  reveal: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<string>;
  status: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<boolean>;
  poster: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<LocalImageData>;
  download: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<void>;
  local: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<string>;
  save: (
    url: string,
    size: number,
    source: ReadableStream<Uint8Array>,
    validate: () => void,
    poster?: boolean,
  ) => Promise<void>;
  cancel: () => void;
}

/** 拒绝应用目录下的符号链接，缓存路径只能由资源摘要生成。 */
const safeDirectory = async (directory: string): Promise<void> => {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    path.resolve(await realpath(directory)).toLowerCase() !==
      path.resolve(directory).toLowerCase()
  )
    throw new Error('视频目录不能是链接或外部目录');
};

/** 只将不存在视为缓存未命中，其他磁盘错误不触发覆盖。 */
const missing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** 视频仅显式下载，封面独立缓存；消息协议与磁盘路径分离。 */
export const createVideoFileStore = (
  applicationRoot: string,
  captureAccess: () => ImageFileAccess,
  requestRemote: typeof fetch = fetch,
  processor?: VideoProcessor,
  authorizeDownload?: AuthorizeMessageDownload,
): VideoFileStore => {
  const root = path.resolve(applicationRoot, 'file');
  let epoch = 0;
  let abort = new AbortController();
  const transfers = new Map<string, Promise<void>>();
  let active = 0;
  const waiting: (() => void)[] = [];

  /** 限制媒体传输并发，排队期间不保存视频字节。 */
  const acquire = async (): Promise<void> => {
    if (active < 2) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  };
  /** 唤醒下一个传输。 */
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };
  /** 捕获页面、账号及取消代次，过期后本地读取仍由新请求取得。 */
  const capture = (): ImageFileAccess => {
    const access = captureAccess();
    const version = epoch;
    if (
      !/^[1-9]\d{0,63}$/.test(access.owner) ||
      !/^[a-f0-9]{16}$/.test(access.serverHash)
    )
      throw new Error('视频账号无效');
    return {
      ...access,
      validateRead: (): void => {
        if (version !== epoch) throw new Error('视频请求已取消');
        access.validateRead();
      },
      validateWrite: (): void => {
        if (version !== epoch) throw new Error('视频请求已取消');
        access.validateWrite();
      },
    };
  };
  /** 只从已绑定消息取得资源地址，页面不能指定下载 URL。 */
  const resource = (
    request: ImagePreviewRequest,
    poster: boolean,
  ): VideoResource => {
    const video = parseVideoContent(
      getVideoMessage(request.conversationId, request.messageId).content,
    );
    if (!video) throw new Error('视频信息不完整，无法加载');
    return {
      url: parseImageUrl(poster ? video.thumbUrl : video.url),
      size: (poster ? video.thumbSize : video.fileSize)!,
      poster,
      extension: videoExtension(video.fileName),
    };
  };
  /** URL 摘要仅作为本地索引，不重复保存公开地址。 */
  const keyOf = (item: VideoResource): string =>
    createHash('sha256').update(item.url).digest('hex');
  /** 复用记录日期，跨天不重新推导旧路径。 */
  const location = (
    access: ImageFileAccess,
    item: VideoResource,
    saved?: string,
  ): string => {
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const name = `${keyOf(item)}${item.poster ? '.jpg' : `.${item.extension}`}`;
    const relative =
      saved ?? `file/${access.serverHash}/${access.owner}/${day}/${name}`;
    const parts = relative.split('/');
    if (
      parts.length !== 5 ||
      parts[0] !== 'file' ||
      parts[1] !== access.serverHash ||
      parts[2] !== access.owner ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parts[3]!) ||
      parts[4] !== name
    )
      throw new Error('视频缓存路径无效');
    return relative;
  };
  /** 本地存在性查询不下载，不修改数据库。 */
  const cached = async (
    access: ImageFileAccess,
    item: VideoResource,
    validate: () => void,
  ): Promise<string | null> => {
    access.validateRead();
    const saved = getVideoFilePath(keyOf(item));
    if (!saved) return null;
    const absolute = path.resolve(
      applicationRoot,
      location(access, item, saved),
    );
    try {
      await safeDirectory(root);
      await safeDirectory(path.join(root, access.serverHash));
      await safeDirectory(path.join(root, access.serverHash, access.owner));
      await safeDirectory(path.dirname(absolute));
      const file = await openVideoFile(absolute);
      try {
        const info = await file.stat();
        const header = Buffer.alloc(32);
        const { bytesRead } = await file.read(header, 0, header.length, 0);
        validate();
        access.validateRead();
        if (info.size !== item.size) return null;
        if (item.poster) {
          if (header[0] !== 255 || header[1] !== 216 || header[2] !== 255)
            return null;
        } else {
          try {
            checkVideoHeader(header.subarray(0, bytesRead), item.extension);
          } catch {
            return null;
          }
        }
        return absolute;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  };
  /** 流式写临时文件，核验实际长度与格式后原子提交，绝不缓存半文件。 */
  const write = async (
    access: ImageFileAccess,
    item: VideoResource,
    source: ReadableStream<Uint8Array>,
    validate: () => void,
  ): Promise<void> => {
    const reader = source.getReader();
    let temporary: string | undefined;
    try {
      validate();
      access.validateWrite();
      const relative = location(access, item);
      const absolute = path.resolve(applicationRoot, relative);
      await safeDirectory(root);
      const serverDirectory = path.join(root, access.serverHash);
      await mkdir(serverDirectory, { recursive: true });
      await safeDirectory(serverDirectory);
      const ownerDirectory = path.join(serverDirectory, access.owner);
      await mkdir(ownerDirectory, { recursive: true });
      await safeDirectory(ownerDirectory);
      await mkdir(path.dirname(absolute), { recursive: true });
      await safeDirectory(path.dirname(absolute));
      validate();
      access.validateWrite();
      temporary = path.join(path.dirname(absolute), `${randomUUID()}.part`);
      const file = await open(temporary, 'wx');
      let length = 0;
      try {
        while (true) {
          validate();
          access.validateWrite();
          const result = await reader.read();
          validate();
          access.validateWrite();
          if (result.done) break;
          length += result.value.length;
          if (
            length > item.size ||
            length > (item.poster ? MAX_VIDEO_POSTER_BYTES : MAX_VIDEO_BYTES)
          )
            throw new Error('视频或封面超过大小限制');
          await file.writeFile(result.value);
        }
        if (length !== item.size)
          throw new Error('视频或封面下载不完整，请重试');
        await file.sync();
      } finally {
        await file.close();
      }
      const verify = await open(temporary, 'r');
      try {
        if (item.poster) {
          const bytes = await verify.readFile();
          if (validateImageForUpload('poster.jpg', bytes) !== 'image/jpeg')
            throw new Error('封面格式无效');
        } else {
          const header = Buffer.alloc(32);
          const { bytesRead } = await verify.read(header, 0, header.length, 0);
          checkVideoHeader(header.subarray(0, bytesRead), item.extension);
        }
      } finally {
        await verify.close();
      }
      await safeDirectory(ownerDirectory);
      await safeDirectory(path.dirname(absolute));
      validate();
      access.validateWrite();
      await rename(temporary, absolute);
      validate();
      access.validateWrite();
      setVideoFilePath(keyOf(item), relative);
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
      if (temporary)
        await unlink(temporary).catch((error: unknown): void => {
          if (!missing(error)) throw error;
        });
    }
  };
  /** 有效授权下显式下载指定媒体；封面与视频分别合并并发请求。 */
  const ensure = async (
    request: ImagePreviewRequest,
    poster: boolean,
    validate: () => void,
  ): Promise<string> => {
    const access = capture();
    const item = resource(request, poster);
    /** 删除、账号变更及资源改变后拒绝迟到结果。 */
    const current = (): void => {
      access.validateRead();
      validate();
      const currentItem = resource(request, poster);
      if (currentItem.url !== item.url || currentItem.size !== item.size)
        throw new Error('视频消息已变化');
    };
    const local = await cached(access, item, current);
    current();
    if (local) return local;
    access.validateWrite();
    const key = `${epoch}:${access.serverHash}:${access.owner}:${keyOf(item)}`;
    let transfer = transfers.get(key);
    if (!transfer) {
      const signal = abort.signal;
      /** 下载前及每个块都核对授权，不向 OSS 发送业务凭据。 */
      const run = async (): Promise<void> => {
        await acquire();
        try {
          current();
          access.validateWrite();
          const authorization = authorizeDownload
            ? await authorizeDownload(
                request.messageId,
                request.conversationId,
                current,
              )
            : null;
          const downloadUrl = authorization
            ? item.poster
              ? authorization.thumbDownloadUrl
              : authorization.downloadUrl
            : item.url;
          if (!downloadUrl) throw new Error('视频封面下载地址缺失');
          parseAuthBase(new URL(downloadUrl).origin);
          const response = await requestRemote(downloadUrl, {
            credentials: 'omit',
            redirect: 'error',
            cache: 'no-store',
            signal: AbortSignal.any([signal, AbortSignal.timeout(600000)]),
          });
          if (
            !response.ok ||
            !response.body ||
            response.headers
              .get('content-type')
              ?.split(';')[0]
              ?.trim()
              .toLowerCase() !==
              (poster ? 'image/jpeg' : VIDEO_FORMATS[item.extension]) ||
            Number(response.headers.get('content-length')) > item.size
          ) {
            await response.body?.cancel();
            throw new Error('视频或封面下载失败');
          }
          await write(access, item, response.body, current);
        } finally {
          release();
        }
      };
      transfer = run().finally(() => {
        transfers.delete(key);
      });
      transfers.set(key, transfer);
    }
    await transfer;
    current();
    const result = await cached(access, item, current);
    if (!result) throw new Error('本地视频文件不可用');
    return result;
  };
  /** 首次点击只下载，不触发播放器窗口。 */
  const download = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<void> => {
    await ensure(request, false, validate);
  };
  /** 显式定位原格式缓存；缺失时要求有效授权下载，不创建播放副本。 */
  const reveal = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<string> => ensure(request, false, validate);
  /** 播放只能读取已落盘文件，绝不隐式访问远端。 */
  const local = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<string> => {
    const access = capture();
    const item = resource(request, false);
    const result = await cached(access, item, validate);
    validate();
    access.validateRead();
    if (resource(request, false).url !== item.url)
      throw new Error('视频消息已变化');
    if (!result) throw new Error('视频尚未下载，请先下载');
    if (!processor) return result;
    /** 转码仅写入当前账号的缓存目录，授权失效时只能复用已有播放副本。 */
    const current = (): void => {
      validate();
      access.validateRead();
      const latest = resource(request, false);
      if (latest.url !== item.url || latest.size !== item.size)
        throw new Error('视频消息已变化');
    };
    return processor.playback(result, current, () => {
      current();
      access.validateWrite();
    });
  };
  /** 只定位原格式缓存，拖拽预热不下载或生成播放转码副本。 */
  const original = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<string | null> => {
    const access = capture();
    const item = resource(request, false);
    const result = await cached(access, item, validate);
    validate();
    access.validateRead();
    if (resource(request, false).url !== item.url)
      throw new Error('视频消息已变化');
    return result;
  };
  /** 状态查询只检查本地，不以收到 SSE 等同于文件可用。 */
  const status = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<boolean> => (await original(request, validate)) !== null;
  /** 仅封面可按需加载，返回有上限的 JPEG 字节供页面创建 Blob。 */
  const poster = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<LocalImageData> => {
    const access = capture();
    const item = resource(request, true);
    const filePath = await ensure(request, true, validate);
    const file = await openVideoFile(filePath);
    try {
      const info = await file.stat();
      if (info.size > MAX_VIDEO_POSTER_BYTES) throw new Error('视频封面过大');
      const bytes = Buffer.alloc(info.size);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      validate();
      access.validateRead();
      if (resource(request, true).url !== item.url)
        throw new Error('视频消息已变化');
      if (bytesRead !== bytes.length) throw new Error('封面不完整');
      validateImageForUpload('poster.jpg', bytes);
      return { bytes: new Uint8Array(bytes), contentType: 'image/jpeg' };
    } finally {
      await file.close();
    }
  };
  /** 上传端保存原始文件副本，之后播放不再重新下载。 */
  const save = async (
    url: string,
    size: number,
    source: ReadableStream<Uint8Array>,
    validate: () => void,
    poster = false,
  ): Promise<void> => {
    try {
      await write(
        capture(),
        {
          url: parseImageUrl(url),
          size,
          poster,
          extension: poster
            ? 'mp4'
            : videoExtension(new URL(url).pathname.split('/').at(-1)!),
        },
        source,
        validate,
      );
    } finally {
      if (!source.locked) await source.cancel().catch(() => {});
    }
  };
  /** 取消待下载任务，不删除已提交的用户文件。 */
  const cancel = (): void => {
    epoch++;
    abort.abort();
    abort = new AbortController();
  };
  return { status, poster, download, local, original, reveal, save, cancel };
};
