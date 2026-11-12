import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { MAX_IMAGE_DRAFTS } from '../../../shared/media/image/image';
import { MAX_VIDEO_DRAFTS } from '../../../shared/media/video/video';
import {
  attachmentKind,
  MAX_FILE_DRAFTS,
} from '../../../shared/media/file/file-message';
import type { FileDraftStore } from './file/file-drafts';
import type { MediaDraftSelection } from '../../../shared/media/media-drafts';
import type { createImageDraftStore } from './image/image-drafts';
import type { VideoDraftStore } from './video/video-drafts';

interface MediaDraftStores {
  images: Pick<ReturnType<typeof createImageDraftStore>, 'stage' | 'release'>;
  videos: Pick<VideoDraftStore, 'stage' | 'stageDeferred' | 'release'>;
  files: Pick<FileDraftStore, 'stage' | 'stageDeferred' | 'release'>;
}

/** 有界扫描原生拖入的目录并分流媒体；任一文件失败只回滚本批草稿，不上传。 */
export const stageDroppedMedia = async (
  roomId: string,
  paths: unknown,
  validate: () => void,
  stores: MediaDraftStores,
  options: {
    deferVideoProcessing?: boolean;
    deferFileProcessing?: boolean;
  } = {},
): Promise<MediaDraftSelection> => {
  validate();
  if (
    !Array.isArray(paths) ||
    !paths.length ||
    paths.length > MAX_IMAGE_DRAFTS + MAX_VIDEO_DRAFTS + MAX_FILE_DRAFTS ||
    paths.some(
      (value: unknown) =>
        typeof value !== 'string' ||
        value.length > 32768 ||
        !path.isAbsolute(value),
    )
  )
    throw new Error('无效的拖入文件，单次最多 10 张图片和 3 个视频');
  const imagePaths: string[] = [];
  const videoPaths: string[] = [];
  const filePaths: string[] = [];
  const visited = new Set<string>();
  let count = 0;
  /** 每个节点重查授权与真实路径，禁止沿链接跳出拖入目录；扫描最多 500 项、16 层。 */
  const collect = async (filePath: string, depth: number): Promise<void> => {
    validate();
    if (++count > 500 || depth > 16)
      throw new Error('文件夹超过 500 项或 16 层，请选择具体媒体文件');
    const info = await lstat(filePath).catch((): never => {
      throw new Error('无法读取拖入的文件，请重新选择');
    });
    const resolved = path.resolve(filePath);
    const canonical = await realpath(filePath);
    const identity =
      process.platform === 'win32' ? canonical.toLowerCase() : canonical;
    const expected =
      process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    validate();
    if (info.isSymbolicLink() || identity !== expected) {
      if (depth > 0) return;
      throw new Error('不支持拖入链接或外部映射');
    }
    if (visited.has(identity)) return;
    visited.add(identity);
    if (info.isDirectory()) {
      const directory = await opendir(filePath);
      for await (const entry of directory) {
        validate();
        await collect(path.join(filePath, entry.name), depth + 1);
      }
      return;
    }
    if (!info.isFile()) throw new Error('请拖入普通图片或视频文件，不支持链接');
    switch (attachmentKind(path.basename(filePath), info.size)) {
      case 'image':
        imagePaths.push(filePath);
        break;
      case 'video':
        videoPaths.push(filePath);
        break;
      case 'file':
        filePaths.push(filePath);
        break;
    }
    if (
      imagePaths.length > MAX_IMAGE_DRAFTS ||
      videoPaths.length > MAX_VIDEO_DRAFTS ||
      filePaths.length > MAX_FILE_DRAFTS
    )
      throw new Error('单次最多拖入 10 张图片、3 个视频和 3 个文件');
  };
  for (const filePath of paths as string[]) await collect(filePath, 0);
  if (!imagePaths.length && !videoPaths.length && !filePaths.length)
    throw new Error('拖入的文件夹中没有普通文件');
  const result: MediaDraftSelection = { images: [], videos: [], files: [] };
  try {
    if (imagePaths.length)
      result.images = await stores.images.stage(roomId, imagePaths, validate);
    for (const filePath of videoPaths) {
      validate();
      const video = options.deferVideoProcessing
        ? await stores.videos.stageDeferred(roomId, filePath, validate)
        : await stores.videos.stage(roomId, filePath, validate);
      result.videos.push(video);
    }
    for (const filePath of filePaths) {
      validate();
      const file = options.deferFileProcessing
        ? await stores.files.stageDeferred(roomId, filePath, validate)
        : await stores.files.stage(roomId, filePath, validate);
      result.files.push(file);
    }
    validate();
    return result;
  } catch (error) {
    stores.images.release(
      roomId,
      result.images.map((image) => image.id),
    );
    for (const video of result.videos) stores.videos.release(roomId, video.id);
    for (const file of result.files) stores.files.release(roomId, file.id);
    throw error;
  }
};
