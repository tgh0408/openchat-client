import { createHash, randomUUID } from 'node:crypto';
import type { Stats } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseAuthBase } from '../../../../shared/auth/auth';
import {
  MAX_IMAGE_BYTES,
  parseImageUrl,
} from '../../../../shared/media/image/image';
import type {
  LocalImageData,
  StoredImageContent,
} from '../../../../shared/media/image/image';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';
import type { Message } from '../../../../shared/storage/database';
import type { AuthorizeMessageDownload } from '../../../../shared/chat/messages/message-download';
import {
  getMessageImageLocation,
  setMessageImageLocalPath,
} from '../../database/database';
import { validateImageForUpload } from './image-upload';

export interface ImageFileAccess {
  owner: string;
  writable: boolean;
  validateRead: () => void;
  validateWrite: () => void;
}

interface ImageFileDependencies {
  capture: () => ImageFileAccess;
  request?: typeof fetch;
  authorizeDownload?: AuthorizeMessageDownload;
  now?: () => Date;
}

interface ImageLocation {
  relative: string;
  absolute: string;
  directory: string;
  ownerDirectory: string;
}

export interface ImageFileStore {
  read: (
    request: ImagePreviewRequest,
    validateSource: () => void,
    localOnly?: boolean,
  ) => Promise<LocalImageData>;
  reveal: (
    request: ImagePreviewRequest,
    validateSource: () => void,
  ) => Promise<string>;
  local: (
    request: ImagePreviewRequest,
    validateSource: () => void,
  ) => Promise<string | null>;
  saveUploaded: (
    image: StoredImageContent,
    bytes: Uint8Array,
    validateSource: () => void,
  ) => Promise<void>;
  schedule: (message: Message) => void;
  cancel: () => void;
}

/** 只接受四种图片的真实文件头及尺寸，不将 HTML、SVG 或任意文件交给页面。 */
const imageData = (bytes: Uint8Array): LocalImageData => {
  const extension =
    bytes[0] === 137
      ? 'png'
      : bytes[0] === 255
        ? 'jpg'
        : bytes[0] === 71
          ? 'gif'
          : bytes[0] === 66
            ? 'bmp'
            : '';
  if (!extension) throw new Error('图片格式无效');
  return {
    bytes,
    contentType: validateImageForUpload(`image.${extension}`, bytes),
  };
};

/** 仅将文件不存在视为缓存未命中；权限、空间和其他 IO 错误必须正常报告。 */
const isMissing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

/** 拒绝目录链接及越界的真实路径，文件名不使用服务端文件名或页面输入。 */
const requireDirectory = async (directory: string): Promise<void> => {
  const info = await lstat(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    path.resolve(await realpath(directory)).toLowerCase() !==
      path.resolve(directory).toLowerCase()
  )
    throw new Error('图片存储目录不能是链接或外部目录');
};

/** 在应用目录内按账号隔离图片，缺失时有界下载，提交成功后再更新消息路径。 */
export const createImageFileStore = (
  applicationRoot: string,
  dependencies: ImageFileDependencies,
): ImageFileStore => {
  const root = path.resolve(applicationRoot, 'file');
  const requestRemote = dependencies.request ?? fetch;
  const now = dependencies.now ?? ((): Date => new Date());
  let epoch = 0;
  let controller = new AbortController();
  let active = 0;
  const waiting: (() => void)[] = [];
  const transfers = new Map<string, Promise<ImageLocation>>();
  const recentLocations = new Map<string, string>();
  const scheduled = new Set<string>();
  let activeReads = 0;
  const waitingReads: (() => void)[] = [];

  /** 同时最多下载两张，排队任务醒来后仍须重新验证账号和代次。 */
  const acquire = async (): Promise<void> => {
    if (active < 2) {
      active++;
      return;
    }
    await new Promise<void>((resolve) => {
      waiting.push(resolve);
    });
  };

  /** 释放一个下载位置，不把等待中的任务误计为空闲。 */
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active--;
  };

  /** 捕获授权及页面代次，任何异步步骤完成后都不能作用于新页面或新账号。 */
  const capture = (): ImageFileAccess => {
    const access = dependencies.capture();
    if (!/^[1-9]\d{0,63}$/.test(access.owner))
      throw new Error('无效的图片所属账号');
    const version = epoch;
    /** 读取允许本次页面只读身份，但拒绝已经撤销的页面。 */
    const validateRead = (): void => {
      if (version !== epoch) throw new Error('图片请求已失效');
      access.validateRead();
    };
    /** 下载和落盘必须仍有写入授权。 */
    const validateWrite = (): void => {
      validateRead();
      access.validateWrite();
    };
    validateRead();
    return { ...access, validateRead, validateWrite };
  };

  /** 按本机自然日归档，不使用 UTC 日期，避免午夜附近日期错位。 */
  const localDate = (date: Date): string =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

  /** 新文件使用落盘当天目录；已有路径须匹配账号、合法日期及资源摘要，不搬动原文件。 */
  const location = (
    owner: string,
    url: string,
    saved?: string,
  ): ImageLocation => {
    const suffix = path.posix.extname(new URL(url).pathname).toLowerCase();
    const extension = ['.jpg', '.jpeg', '.png', '.gif', '.bmp'].includes(suffix)
      ? suffix
      : '.img';
    const name = `${createHash('sha256').update(url).digest('hex')}${extension}`;
    const relative = saved ?? `file/${owner}/${localDate(now())}/${name}`;
    const parts = relative.split('/');
    if (
      parts[0] !== 'file' ||
      parts[1] !== owner ||
      parts.at(-1) !== name ||
      (parts.length !== 3 && parts.length !== 4)
    )
      throw new Error('图片本地路径无效');
    if (parts.length === 4) {
      const date = parts[2]!;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
        localDate(new Date(`${date}T12:00:00`)) !== date
      )
        throw new Error('图片本地路径日期无效');
    }
    const ownerDirectory = path.join(root, owner);
    const directory =
      parts.length === 4
        ? path.join(ownerDirectory, parts[2]!)
        : ownerDirectory;
    return {
      relative,
      absolute: path.join(directory, name),
      directory,
      ownerDirectory,
    };
  };

  /** 暂记近期已提交位置，让跨午夜的上传与随后消息落库仍关联同一文件。 */
  const rememberLocation = (
    owner: string,
    url: string,
    target: ImageLocation,
  ): void => {
    const key = `${owner}:${url}`;
    recentLocations.delete(key);
    recentLocations.set(key, target.relative);
    if (recentLocations.size > 1000)
      recentLocations.delete(recentLocations.keys().next().value!);
  };

  /** 限制本地读取大小并拒绝符号链接；文件头损坏视为需要重新下载。 */
  const readLocal = async (
    target: ImageLocation,
    validate: () => void,
  ): Promise<LocalImageData | null> => {
    try {
      await requireDirectory(root);
      await requireDirectory(target.ownerDirectory);
      await requireDirectory(target.directory);
      const info = await lstat(target.absolute, { bigint: true });
      validate();
      if (info.isSymbolicLink() || !info.isFile())
        throw new Error('图片文件不能是链接或目录');
      if (info.size < 1n || info.size > BigInt(MAX_IMAGE_BYTES)) return null;
      const file = await open(target.absolute, 'r');
      try {
        const opened = await file.stat({ bigint: true });
        // Windows 的路径 stat 与句柄 stat 可能返回不同设备号，文件标识仍须一致。
        if (
          opened.ino !== info.ino ||
          (process.platform !== 'win32' && opened.dev !== info.dev)
        )
          throw new Error('图片文件已被替换');
        const bytes = Buffer.alloc(Number(info.size) + 1);
        let length = 0;
        while (length < bytes.length) {
          const result = await file.read(
            bytes,
            length,
            bytes.length - length,
            length,
          );
          validate();
          if (!result.bytesRead) break;
          length += result.bytesRead;
        }
        if (length !== Number(info.size)) return null;
        try {
          return imageData(bytes.subarray(0, length));
        } catch {
          return null;
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  /** 写临时文件并原子改名，不留下半张正式图片，不改动用户选择的原文件。 */
  const writeLocal = async (
    access: ImageFileAccess,
    url: string,
    bytes: Uint8Array,
    validate: () => void,
  ): Promise<ImageLocation> => {
    imageData(bytes);
    validate();
    const target = location(access.owner, url);
    await requireDirectory(root);
    validate();
    await mkdir(target.ownerDirectory, { recursive: true });
    await requireDirectory(target.ownerDirectory);
    validate();
    await mkdir(target.directory, { recursive: true });
    await requireDirectory(target.directory);
    validate();
    const temporary = path.join(target.directory, `${randomUUID()}.part`);
    const file = await open(temporary, 'wx');
    try {
      try {
        validate();
        await file.writeFile(bytes);
        validate();
        await file.sync();
      } finally {
        await file.close();
      }
      validate();
      await requireDirectory(target.ownerDirectory);
      await requireDirectory(target.directory);
      validate();
      await rename(temporary, target.absolute);
      validate();
      rememberLocation(access.owner, url, target);
      return target;
    } finally {
      await unlink(temporary).catch((error: unknown): void => {
        if (!isMissing(error)) throw error;
      });
    }
  };

  /** 从授权 OSS 地址下载，限制实际响应大小；不发送 JWT、Cookie 或跟随重定向。 */
  const download = async (
    url: string,
    validate: () => void,
    signal: AbortSignal,
  ): Promise<Uint8Array> => {
    parseAuthBase(new URL(url).origin);
    validate();
    const response = await requestRemote(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(300000)]),
      credentials: 'omit',
      redirect: 'error',
      cache: 'no-store',
    });
    try {
      validate();
    } catch (error) {
      await response.body?.cancel();
      throw error;
    }
    const advertised = Number(response.headers.get('content-length'));
    if (!response.ok || !response.body || advertised > MAX_IMAGE_BYTES) {
      await response.body?.cancel();
      throw new Error('图片下载失败或超过 50 MiB');
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const result = await reader.read();
        validate();
        if (result.done) break;
        length += result.value.byteLength;
        if (length > MAX_IMAGE_BYTES) throw new Error('图片超过 50 MiB');
        chunks.push(result.value);
      }
    } finally {
      try {
        await reader.cancel();
      } finally {
        reader.releaseLock();
      }
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    imageData(bytes);
    return bytes;
  };

  /** 本地优先；每次更新路径前重新读取消息，拒绝删除、改址或账号切换后的迟到结果。 */
  const readImage = async (
    request: ImagePreviewRequest,
    validateSource: () => void,
    localOnly: boolean,
  ): Promise<LocalImageData> => {
    const access = capture();
    const initial = getMessageImageLocation(
      request.conversationId,
      request.messageId,
    );
    const url = parseImageUrl(initial.remoteUrl);
    const target = location(
      access.owner,
      url,
      initial.localPath ?? recentLocations.get(`${access.owner}:${url}`),
    );
    /** 只允许继续读取同一条图片所对应的资源。 */
    const validate = (): void => {
      access.validateRead();
      validateSource();
      if (
        getMessageImageLocation(request.conversationId, request.messageId)
          .remoteUrl !== url
      )
        throw new Error('图片消息已变化');
    };
    validate();
    const local = await readLocal(target, validate);
    validate();
    if (local) {
      rememberLocation(access.owner, url, target);
      if (initial.localPath !== target.relative && access.writable) {
        access.validateWrite();
        setMessageImageLocalPath(
          request.conversationId,
          request.messageId,
          url,
          target.relative,
        );
      }
      return local;
    }
    if (localOnly) throw new Error('图片尚未缓存，请等待图片加载后重试');
    access.validateWrite();
    const key = `${epoch}:${access.owner}:${url}`;
    let transfer = transfers.get(key);
    if (!transfer) {
      const signal = controller.signal;
      /** 合并同资源并发请求，后台排队不持有图片字节。 */
      const run = async (): Promise<ImageLocation> => {
        await acquire();
        try {
          validate();
          access.validateWrite();
          const cachedTarget = location(
            access.owner,
            url,
            recentLocations.get(`${access.owner}:${url}`),
          );
          const cached = await readLocal(cachedTarget, validate);
          let committed = cachedTarget;
          if (!cached) {
            /** 网络与磁盘每一步都必须持有有效写入授权和未删除消息。 */
            const validateWrite = (): void => {
              validate();
              access.validateWrite();
            };
            const authorization = dependencies.authorizeDownload
              ? await dependencies.authorizeDownload(
                  request.messageId,
                  request.conversationId,
                  validateWrite,
                )
              : null;
            const bytes = await download(
              authorization?.downloadUrl ?? url,
              validateWrite,
              signal,
            );
            committed = await writeLocal(access, url, bytes, validateWrite);
          }
          validate();
          access.validateWrite();
          return committed;
        } finally {
          release();
        }
      };
      transfer = run().finally(() => {
        transfers.delete(key);
      });
      transfers.set(key, transfer);
    }
    const committed = await transfer;
    validate();
    const result = await readLocal(committed, validate);
    validate();
    if (!result) throw new Error('图片本地文件不可用，请重试');
    access.validateWrite();
    setMessageImageLocalPath(
      request.conversationId,
      request.messageId,
      url,
      committed.relative,
    );
    return result;
  };

  /** 同时最多读取四张，限制 IPC 与历史后台预取产生的原始图片内存峰值。 */
  const read = async (
    request: ImagePreviewRequest,
    validateSource: () => void,
    localOnly: boolean = false,
  ): Promise<LocalImageData> => {
    const access = capture();
    if (activeReads < 4) activeReads++;
    else
      await new Promise<void>((resolve) => {
        waitingReads.push(resolve);
      });
    try {
      access.validateRead();
      validateSource();
      return await readImage(request, validateSource, localOnly);
    } finally {
      const next = waitingReads.shift();
      if (next) next();
      else activeReads--;
    }
  };

  /** 本地定位核对各层目录，文件已被清理时按缓存缺失处理。 */
  const inspectLocalLocation = async (
    target: ImageLocation,
  ): Promise<Stats | null> => {
    try {
      await requireDirectory(root);
      await requireDirectory(target.ownerDirectory);
      await requireDirectory(target.directory);
      return await lstat(target.absolute);
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  };

  /** 只定位已落盘图片，拖拽预热不触发网络读取。 */
  const local = async (
    request: ImagePreviewRequest,
    validateSource: () => void,
  ): Promise<string | null> => {
    const access = capture();
    validateSource();
    const locationData = getMessageImageLocation(
      request.conversationId,
      request.messageId,
    );
    const url = parseImageUrl(locationData.remoteUrl);
    const saved =
      locationData.localPath ?? recentLocations.get(`${access.owner}:${url}`);
    if (!saved) return null;
    const target = location(access.owner, url, saved);
    access.validateRead();
    validateSource();
    const info = await inspectLocalLocation(target);
    access.validateRead();
    validateSource();
    if (!info) return null;
    const actualPath = await realpath(target.absolute);
    access.validateRead();
    validateSource();
    const current = getMessageImageLocation(
      request.conversationId,
      request.messageId,
    );
    if (
      current.remoteUrl !== url ||
      current.localPath !== locationData.localPath
    )
      throw new Error('图片消息已变化');
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      path.resolve(actualPath).toLowerCase() !==
        path.resolve(target.absolute).toLowerCase()
    )
      throw new Error('图片文件不能是链接或外部文件');
    return target.absolute;
  };

  /** 确保图片已落盘后返回受校验的绝对路径，供系统定位与显式拖出。 */
  const reveal = async (
    request: ImagePreviewRequest,
    validateSource: () => void,
  ): Promise<string> => {
    await read(request, validateSource);
    const filePath = await local(request, validateSource);
    if (!filePath) throw new Error('图片文件不存在，请重试');
    return filePath;
  };

  /** 上传完成即保存原始字节，随后消息落库时关联同一份本地文件，不再下载本人图片。 */
  const saveUploaded = async (
    image: StoredImageContent,
    bytes: Uint8Array,
    validateSource: () => void,
  ): Promise<void> => {
    const access = capture();
    /** 上传来源和账号的写入权必须同时有效。 */
    const validate = (): void => {
      access.validateWrite();
      validateSource();
    };
    await writeLocal(access, parseImageUrl(image.url), bytes, validate);
  };

  /** 等事务完成后关联已有本机图片，远端图片必须由用户显式下载。 */
  const schedule = (message: Message): void => {
    const version = epoch;
    const key = `${version}:${message.conversationId}:${message.id}`;
    if (scheduled.has(key)) return;
    scheduled.add(key);
    queueMicrotask(() => {
      if (version !== epoch) {
        scheduled.delete(key);
        return;
      }
      void read(
        { conversationId: message.conversationId, messageId: message.id },
        (): void => {
          if (version !== epoch) throw new Error('图片请求已失效');
        },
        true,
      )
        .catch(() => {
          // 本地缺失不触发下载，页面展示下载入口。
        })
        .finally(() => {
          scheduled.delete(key);
        });
    });
  };

  /** 退出、重载和授权失效时取消网络工作；已提交文件保留，不清空用户图片。 */
  const cancel = (): void => {
    epoch++;
    controller.abort();
    controller = new AbortController();
    scheduled.clear();
    recentLocations.clear();
  };
  return { read, reveal, local, saveUploaded, schedule, cancel };
};
