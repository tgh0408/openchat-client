import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { parseAuthBase } from '../../../../shared/auth/auth';
import { parseFileContent } from '../../../../shared/media/file/file-message';
import type {
  FileAvailability,
  FileContent,
} from '../../../../shared/media/file/file-message';
import type { FileUploadSource } from '../file-sources';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';
import type { AuthorizeMessageDownload } from '../../../../shared/chat/messages/message-download';
import type { ImageFileAccess } from '../image/image-files';
import {
  getFileMessage,
  getFileUploadSource,
  getAttachmentPath,
  setAttachmentPath,
} from '../../database/database';
import { openVideoFile } from '../video/video-stream';

/** 清理展示名称中的路径字符与 Windows 保留名称，仅作本机文件名。 */
const safeAttachmentName = (fileName: string): string => {
  const name = fileName
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .slice(0, 180)
    .replace(/[. ]+$/g, '');
  return !name || /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)
    ? `attachment-${name || 'file'}`
    : name;
};

/** 普通文件仅显式下载到账号目录，不自动打开或执行任何附件。 */
export const createAttachmentFileStore = (
  root: string,
  capture: () => ImageFileAccess,
  authorizeDownload?: AuthorizeMessageDownload,
): {
  status: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<FileAvailability>;
  reveal: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<string>;
  local: (
    request: ImagePreviewRequest,
    validate: () => void,
  ) => Promise<string | null>;
  saveAs: (
    request: ImagePreviewRequest,
    validate: () => void,
    choosePath: (fileName: string) => Promise<string | null>,
  ) => Promise<boolean>;
  cancel: () => void;
  saveUploaded: (
    content: FileContent,
    source: FileUploadSource,
    validate: () => void,
  ) => Promise<void>;
} => {
  let generation = 0;
  let controller = new AbortController();
  const transfers = new Map<string, Promise<string>>();
  /** 每层目录拒绝链接和重解析映射。 */
  const directory = async (target: string): Promise<void> => {
    const info = await lstat(target);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(target)).toLowerCase() !==
        path.resolve(target).toLowerCase()
    )
      throw new Error('文件缓存目录不能是链接');
  };
  /** 绑定消息、账号及页面，路径由主进程生成。 */
  const context = (
    request: ImagePreviewRequest,
    validate: () => void,
  ): {
    access: ImageFileAccess;
    key: string;
    messageId: string;
    roomId: string;
    size: number;
    url: string;
    name: string;
    current: () => void;
  } => {
    validate();
    const access = capture();
    const content = getFileMessage(
      request.conversationId,
      request.messageId,
    ).content;
    const file = parseFileContent(content);
    if (
      !file ||
      !/^[1-9]\d{0,63}$/.test(access.owner) ||
      !/^[a-f0-9]{16}$/.test(access.serverHash)
    )
      throw new Error('文件消息不可用');
    const version = generation;
    /** 删除消息或切换账号后立即停止读取和写入。 */
    const current = (): void => {
      validate();
      access.validateRead();
      if (
        version !== generation ||
        getFileMessage(request.conversationId, request.messageId).content !==
          content
      )
        throw new Error('文件消息已变化');
    };
    return {
      access,
      current,
      messageId: request.messageId,
      roomId: request.conversationId,
      key: createHash('sha256').update(file.url).digest('hex'),
      size: file.fileSize,
      url: file.url,
      name: file.fileName,
    };
  };
  /** 本地状态查询不会触发下载，缺失之外的磁盘错误正常上报。 */
  const cached = async (
    item: Pick<
      ReturnType<typeof context>,
      'current' | 'access' | 'key' | 'size'
    >,
  ): Promise<string | null> => {
    item.current();
    const relative = getAttachmentPath(item.key);
    if (!relative) return null;
    const parts = relative.split('/');
    if (
      parts.length !== 6 ||
      parts[0] !== 'file' ||
      parts[1] !== item.access.serverHash ||
      parts[2] !== item.access.owner ||
      !/^\d{4}-\d{2}-\d{2}$/.test(parts[3]!) ||
      parts[4] !== item.key ||
      !parts[5] ||
      /[\\/:*?"<>|\u0000-\u001f]/.test(parts[5]) ||
      parts[5] === '..'
    )
      throw new Error('文件缓存路径无效');
    const absolute = path.join(root, relative);
    try {
      let dir = root;
      for (const part of parts.slice(0, -1)) {
        dir = path.join(dir, part);
        await directory(dir);
      }
      const file = await openVideoFile(absolute);
      try {
        const info = await file.stat();
        item.current();
        return info.size === item.size ? absolute : null;
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return null;
      throw error;
    }
  };
  /** 本机上传完成后按原摘要流式复制到账号文件目录，不从服务器重复下载。 */
  const saveUploaded = async (
    content: FileContent,
    source: FileUploadSource,
    validate: () => void,
  ): Promise<void> => {
    const file = parseFileContent(JSON.stringify(content));
    if (
      !file ||
      file.fileSize !== source.fileSize ||
      file.fileName !== source.fileName ||
      !/^[a-f0-9]{64}$/.test(source.digest)
    )
      throw new Error('本机文件与发送元数据不匹配');
    const access = capture();
    const version = generation;
    /** 复制和索引提交都绑定原账号、原消息及取消代次。 */
    const current = (): void => {
      validate();
      access.validateWrite();
      if (generation !== version) throw new Error('本机文件同步已取消');
    };
    current();
    if (
      !/^[1-9]\d{0,63}$/.test(access.owner) ||
      !/^[a-f0-9]{16}$/.test(access.serverHash)
    )
      throw new Error('文件账号无效');
    const key = createHash('sha256').update(file.url).digest('hex');
    if (await cached({ current, access, key, size: file.fileSize })) return;
    current();
    const input = await openVideoFile(source.filePath);
    let temporary: string | undefined;
    try {
      const initial = await input.stat({ bigint: true });
      if (initial.size !== BigInt(file.fileSize))
        throw new Error('原文件已变化');
      const date = new Date();
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const parts = ['file', access.serverHash, access.owner, day, key];
      let dir = root;
      for (const part of parts) {
        current();
        dir = path.join(dir, part);
        await mkdir(dir, { recursive: true });
        await directory(dir);
      }
      current();
      const staging = path.join(dir, `${randomUUID()}.part`);
      const output = await open(staging, 'wx');
      temporary = staging;
      try {
        const hash = createHash('sha256');
        const buffer = Buffer.alloc(1024 * 1024);
        let offset = 0;
        while (offset < file.fileSize) {
          current();
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, file.fileSize - offset),
            offset,
          );
          current();
          if (!bytesRead) throw new Error('原文件读取不完整');
          hash.update(buffer.subarray(0, bytesRead));
          await output.writeFile(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        const latest = await input.stat({ bigint: true });
        current();
        if (
          hash.digest('hex') !== source.digest ||
          latest.size !== initial.size ||
          latest.mtimeNs !== initial.mtimeNs ||
          latest.ctimeNs !== initial.ctimeNs
        )
          throw new Error('原文件已变化，无法保存发送副本');
        await output.sync();
      } finally {
        await output.close();
      }
      current();
      const relative = [...parts, safeAttachmentName(file.fileName)].join('/');
      await rename(staging, path.join(root, relative));
      temporary = undefined;
      current();
      setAttachmentPath(key, relative);
    } finally {
      await input.close();
      if (temporary) await unlink(temporary).catch(() => {});
    }
  };
  /** 流式下载且按实际字节限额，完成才原子发布索引。 */
  const download = async (
    item: ReturnType<typeof context>,
  ): Promise<string> => {
    item.current();
    item.access.validateWrite();
    const authorization = authorizeDownload
      ? await authorizeDownload(item.messageId, item.roomId, item.current)
      : null;
    item.current();
    item.access.validateWrite();
    const downloadUrl = authorization?.downloadUrl ?? item.url;
    parseAuthBase(new URL(downloadUrl).origin);
    const response = await fetch(downloadUrl, {
      credentials: 'omit',
      redirect: 'error',
      signal: AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(3600000),
      ]),
    });
    let temporary: string | undefined;
    const reader = response.body?.getReader();
    try {
      item.current();
      item.access.validateWrite();
      if (response.status === 404 || response.status === 410)
        throw new Error('文件已过期');
      if (!response.ok || !reader) throw new Error('文件下载失败');
      const length = response.headers.get('content-length');
      if (length && Number(length) !== item.size)
        throw new Error('文件下载长度不匹配');
      const date = new Date();
      const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      const safeName = safeAttachmentName(item.name);
      const parts = [
        'file',
        item.access.serverHash,
        item.access.owner,
        day,
        item.key,
      ];
      let dir = root;
      for (const part of parts) {
        item.current();
        item.access.validateWrite();
        dir = path.join(dir, part);
        await mkdir(dir, { recursive: true });
        await directory(dir);
      }
      temporary = path.join(dir, `${randomUUID()}.part`);
      const handle = await open(temporary, 'wx');
      let received = 0;
      try {
        while (true) {
          item.current();
          item.access.validateWrite();
          const result = await reader.read();
          item.current();
          item.access.validateWrite();
          if (result.done) break;
          received += result.value.byteLength;
          if (received > item.size) throw new Error('文件超过声明大小');
          await handle.writeFile(result.value);
        }
        if (received !== item.size) throw new Error('文件下载不完整');
        await handle.sync();
      } finally {
        await handle.close();
      }
      item.current();
      item.access.validateWrite();
      const relative = [...parts, safeName].join('/');
      const absolute = path.join(root, relative);
      await rename(temporary, absolute);
      temporary = undefined;
      item.current();
      item.access.validateWrite();
      setAttachmentPath(item.key, relative);
      return absolute;
    } finally {
      await reader?.cancel().catch(() => {});
      if (temporary) await unlink(temporary).catch(() => {});
    }
  };
  /** 同账号同资源合并显式下载，最多两个并行下载。 */
  const reveal = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<string> => {
    const item = context(request, validate);
    const saved = await cached(item);
    if (saved) return saved;
    item.access.validateWrite();
    const key = `${item.access.serverHash}:${item.access.owner}:${item.key}`;
    let task = transfers.get(key);
    if (!task) {
      if (transfers.size >= 2) throw new Error('请等待其他文件下载完成');
      task = download(item);
      transfers.set(key, task);
    }
    try {
      const result = await task;
      item.current();
      return result;
    } finally {
      if (transfers.get(key) === task) transfers.delete(key);
    }
  };
  /** 优先补存当前设备的发送来源，远端附件仅查询响应头，不获取正文。 */
  const status = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<FileAvailability> => {
    const item = context(request, validate);
    if (await cached(item)) return 'local';
    item.current();
    const message = getFileMessage(request.conversationId, request.messageId);
    const source =
      message.senderId === item.access.owner && message.clientMsgId
        ? getFileUploadSource(request.conversationId, message.clientMsgId)
        : null;
    if (source && !source.cancelRequested) {
      try {
        await saveUploaded(
          { url: item.url, fileName: item.name, fileSize: item.size },
          source,
          item.current,
        );
        item.current();
        if (await cached(item)) return 'local';
      } catch (error) {
        item.current();
        if (!(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        ))
          throw error;
        // 原文件已移除时仍可通过显式下载取得服务器副本。
      }
    }
    parseAuthBase(new URL(item.url).origin);
    let response: Response;
    try {
      response = await fetch(item.url, {
        method: 'HEAD',
        credentials: 'omit',
        redirect: 'error',
        cache: 'no-store',
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(10000),
        ]),
      });
    } catch {
      item.current();
      return 'unknown';
    }
    item.current();
    if (response.status === 404 || response.status === 410) return 'expired';
    return response.ok ? 'remote' : 'unknown';
  };

  /** 拖拽预热仅返回已校验的本地文件，缓存缺失时不下载。 */
  const local = async (
    request: ImagePreviewRequest,
    validate: () => void,
  ): Promise<string | null> => cached(context(request, validate));

  /** 原生选择器返回目标后分块另存为；撤销授权时不发布半成品或覆盖旧文件。 */
  const saveAs = async (
    request: ImagePreviewRequest,
    validate: () => void,
    choosePath: (fileName: string) => Promise<string | null>,
  ): Promise<boolean> => {
    const item = context(request, validate);
    /** 每次磁盘操作前后复核原消息及其写入授权。 */
    const current = (): void => {
      item.current();
      item.access.validateWrite();
    };
    current();
    const selected = await choosePath(safeAttachmentName(item.name));
    current();
    if (!selected) return false;
    if (!path.isAbsolute(selected)) throw new Error('保存路径无效');
    const destination = path.resolve(selected);
    const parent = path.dirname(destination);
    await directory(parent);
    current();
    // 记录选择结束时的目标状态，耗时下载后不能覆盖期间被其他程序改写的文件。
    const previous = await lstat(destination, { bigint: true }).catch(
      (error: unknown) => {
        if (
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return null;
        throw error;
      },
    );
    if (previous && (!previous.isFile() || previous.isSymbolicLink()))
      throw new Error('保存目标不能是目录或链接');
    current();
    const source = await cached(item);
    if (!source) throw new Error('本地文件不存在，请先点击下载按钮');
    current();
    if (
      process.platform === 'win32'
        ? source.toLowerCase() === destination.toLowerCase()
        : source === destination
    )
      return true;
    const input = await openVideoFile(source);
    let temporary: string | undefined;
    try {
      const initial = await input.stat({ bigint: true });
      if (initial.size !== BigInt(item.size)) throw new Error('文件大小已变化');
      current();
      await directory(parent);
      current();
      const staging = path.join(parent, `.openchat-${randomUUID()}.part`);
      const output = await open(staging, 'wx');
      temporary = staging;
      try {
        const buffer = Buffer.alloc(1024 * 1024);
        let offset = 0;
        while (offset < item.size) {
          current();
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, item.size - offset),
            offset,
          );
          current();
          if (!bytesRead) throw new Error('文件读取不完整');
          await output.writeFile(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
        await output.sync();
      } finally {
        await output.close();
      }
      current();
      const latest = await input.stat({ bigint: true });
      if (
        latest.size !== initial.size ||
        latest.mtimeNs !== initial.mtimeNs ||
        latest.ctimeNs !== initial.ctimeNs
      )
        throw new Error('保存过程中源文件已变化');
      await directory(parent);
      const target = await lstat(destination, { bigint: true }).catch(
        (error: unknown) => {
          if (
            error instanceof Error &&
            'code' in error &&
            error.code === 'ENOENT'
          )
            return null;
          throw error;
        },
      );
      if (
        previous?.ino !== target?.ino ||
        previous?.dev !== target?.dev ||
        previous?.size !== target?.size ||
        previous?.mtimeNs !== target?.mtimeNs ||
        previous?.ctimeNs !== target?.ctimeNs
      )
        throw new Error('保存目标已变化，请重新选择');
      current();
      await rename(staging, destination);
      temporary = undefined;
      current();
      return true;
    } finally {
      await input.close();
      if (temporary) await unlink(temporary).catch(() => {});
    }
  };
  /** 撤销旧账号下载，临时文件由各任务负责清理。 */
  const cancel = (): void => {
    generation++;
    controller.abort();
    controller = new AbortController();
  };
  return { status, reveal, local, saveAs, saveUploaded, cancel };
};
