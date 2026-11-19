import { open, lstat, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { MAX_VIDEO_BYTES } from '../../../../shared/media/video/video';
import {
  checkVideoHeader,
  videoExtension,
  VIDEO_FORMATS,
} from '../../../../shared/media/video/video-formats';

/** 只打开真实普通文件，避免选中后被替换为链接或目录。 */
export const openVideoFile = async (filePath: string): Promise<FileHandle> => {
  const info = await lstat(filePath, { bigint: true });
  if (
    !info.isFile() ||
    info.isSymbolicLink() ||
    path.resolve(await realpath(filePath)).toLowerCase() !==
      path.resolve(filePath).toLowerCase()
  )
    throw new Error('视频文件不能是链接或外部映射');
  const file = await open(filePath, 'r');
  try {
    const opened = await file.stat({ bigint: true });
    if (
      opened.ino !== info.ino ||
      (process.platform !== 'win32' && opened.dev !== info.dev)
    )
      throw new Error('视频文件已被替换');
    return file;
  } catch (error) {
    await file.close();
    throw error;
  }
};

/** 校验 MP4 容器头，不把扩展名当作文件格式或编码兼容性的保证。 */
export const checkMp4Header = (bytes: Uint8Array): void => {
  checkVideoHeader(bytes, 'mp4');
};

/** 解析单段 Range；拒绝非法和越界请求，支持拖动进度条和尾部元数据读取。 */
export const videoRange = (
  value: string | null,
  size: number,
): { start: number; end: number } | null => {
  if (!value) return { start: 0, end: size - 1 };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return null;
  const suffix = match[1] === '';
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last)) return null;
  const start = suffix ? Math.max(0, size - last) : first;
  const end = suffix || !match[2] ? size - 1 : Math.min(last, size - 1);
  if (start < 0 || start >= size || end < start) return null;
  return { start, end };
};

/** 通过受控协议分段读取文件；每个数据块重新检查窗口和账号授权。 */
export const videoFileResponse = async (
  filePath: string,
  range: string | null,
  validate: () => void,
  head = false,
): Promise<Response> => {
  validate();
  const file = await openVideoFile(filePath);
  let handedOff = false;
  try {
    const info = await file.stat();
    if (info.size < 12 || info.size > MAX_VIDEO_BYTES)
      throw new Error('视频大小无效或超过 2 GiB');
    const extension = videoExtension(path.basename(filePath));
    const header = Buffer.alloc(32);
    const { bytesRead } = await file.read(header, 0, header.length, 0);
    checkVideoHeader(header.subarray(0, bytesRead), extension);
    validate();
    const bounds = videoRange(range, info.size);
    if (!bounds)
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${info.size}` },
      });
    const headers: Record<string, string> = {
      'Content-Type': VIDEO_FORMATS[extension],
      'Content-Length': String(bounds.end - bounds.start + 1),
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    };
    if (range)
      headers['Content-Range'] =
        `bytes ${bounds.start}-${bounds.end}/${info.size}`;
    if (head) return new Response(null, { status: range ? 206 : 200, headers });
    let position = bounds.start;
    let closed = false;
    /** 取消和读完均只关闭一次句柄。 */
    const close = async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await file.close();
    };
    const stream = new ReadableStream<Uint8Array>({
      pull: async (controller): Promise<void> => {
        try {
          validate();
          const buffer = Buffer.alloc(
            Math.min(65536, bounds.end - position + 1),
          );
          const { bytesRead } = await file.read(
            buffer,
            0,
            buffer.length,
            position,
          );
          validate();
          if (!bytesRead) throw new Error('视频文件已截断');
          position += bytesRead;
          controller.enqueue(new Uint8Array(buffer.subarray(0, bytesRead)));
          if (position > bounds.end) {
            await close();
            controller.close();
          }
        } catch (error) {
          await close();
          controller.error(error);
        }
      },
      cancel: close,
    });
    handedOff = true;
    return new Response(stream, { status: range ? 206 : 200, headers });
  } finally {
    if (!handedOff) await file.close();
  }
};
