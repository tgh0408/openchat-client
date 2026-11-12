import { createHash, randomUUID } from 'node:crypto';
import { open } from 'node:fs/promises';
import path from 'node:path';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DRAFT_BYTES,
  MAX_IMAGE_DRAFTS,
} from '../../../../shared/media/image/image';
import type {
  SelectedImageDraft,
  StoredImageContent,
  LocalImageData,
} from '../../../../shared/media/image/image';
import { validateImageForUpload } from './image-upload';

interface PrivateImageDraft {
  roomId: string;
  source: { filePath: string } | { bytes: Buffer };
  fileName: string;
  fileSize: number;
  digest: string;
  uploaded?: StoredImageContent;
}

interface ImageDraftStore {
  describe: (roomId: string, id: string) => StoredImageContent;
  read: (
    roomId: string,
    id: string,
    validateCurrent: () => void,
  ) => Promise<LocalImageData>;
  stageClipboard: (
    roomId: string,
    images: unknown,
    validateCurrent: () => void,
  ) => SelectedImageDraft[];
  stage: (
    roomId: string,
    paths: unknown,
    validateCurrent: () => void,
  ) => Promise<SelectedImageDraft[]>;
  upload: (
    roomId: string,
    id: string,
    validateCurrent: () => void,
    uploadBytes: (
      fileName: string,
      bytes: Uint8Array,
    ) => Promise<StoredImageContent>,
  ) => Promise<StoredImageContent>;
  release: (roomId: string, ids: string[]) => void;
  clear: () => void;
  clearRoom: (roomId: string) => void;
}

/** 有上限地读取原生授权文件，同时检测读取期间的文件变化。 */
const readImageFile = async (filePath: string): Promise<Buffer> => {
  const file = await open(filePath, 'r').catch((): never => {
    throw new Error('无法打开所选图片，请检查文件访问权限');
  });
  try {
    const before = await file.stat();
    if (!before.isFile() || before.size < 1 || before.size > MAX_IMAGE_BYTES)
      throw new Error('请选择不超过 50 MiB 的图片文件');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat();
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error('图片文件已变化，请重新选择');
    return buffer.subarray(0, length);
  } catch (error) {
    if (error instanceof Error && 'code' in error)
      throw new Error('无法读取所选图片，请重新选择');
    throw error;
  } finally {
    await file.close().catch((): never => {
      throw new Error('读取图片时发生文件访问错误');
    });
  }
};

/** 主进程持有原生路径或剪贴板快照；页面只通过随机标识操作当前会话草稿。 */
export const createImageDraftStore = (
  checkDecode: (bytes: Buffer, contentType: string) => void,
  onRelease?: (roomId: string, id: string) => void,
): ImageDraftStore => {
  const drafts = new Map<string, PrivateImageDraft>();
  let generation = 0;

  /** 失效或页面切换后清空路径，不保留本地文件读取权。 */
  const clear = (): void => {
    generation++;
    for (const [id, draft] of drafts) onRelease?.(draft.roomId, id);
    drafts.clear();
  };

  /** 只删除绑定到指定会话的草稿，不能用标识跨会话操作。 */
  const release = (roomId: string, ids: string[]): void => {
    for (const id of ids) {
      if (drafts.get(id)?.roomId === roomId) {
        drafts.delete(id);
        onRelease?.(roomId, id);
      }
    }
  };

  /** 删除会话时释放其全部临时选图记录。 */
  const clearRoom = (roomId: string): void => {
    release(roomId, [...drafts.keys()]);
  };

  /** 提交前统一核对磁盘和剪贴板草稿容量，防止异步选图期间超额。 */
  const checkCapacity = (count: number, bytes: number): void => {
    if (drafts.size + count > MAX_IMAGE_DRAFTS)
      throw new Error(`图片草稿最多保留 ${MAX_IMAGE_DRAFTS} 张`);
    const total = [...drafts.values()].reduce(
      (sum, draft) => sum + draft.fileSize,
      bytes,
    );
    if (total > MAX_IMAGE_DRAFT_BYTES)
      throw new Error('图片草稿总大小不能超过 200 MiB');
  };

  /** 校验真实粘贴事件的图片快照；整批通过后才保留，不创建临时磁盘文件。 */
  const stageClipboard = (
    roomId: string,
    images: unknown,
    validateCurrent: () => void,
  ): SelectedImageDraft[] => {
    validateCurrent();
    if (!Array.isArray(images) || !images.length)
      throw new Error('剪贴板中没有可用图片');
    checkCapacity(images.length, 0);
    const pending: [string, PrivateImageDraft][] = [];
    const previews: SelectedImageDraft[] = [];
    let total = 0;
    for (const value of images as unknown[]) {
      if (!value || typeof value !== 'object')
        throw new Error('剪贴板图片无效');
      const image = value as Record<string, unknown>;
      if (
        !(image.bytes instanceof Uint8Array) ||
        !image.bytes.byteLength ||
        image.bytes.byteLength > MAX_IMAGE_BYTES
      )
        throw new Error('请选择不超过 50 MiB 的图片');
      total += image.bytes.byteLength;
      checkCapacity(images.length, total);
      let extension: string;
      switch (image.contentType) {
        case 'image/png':
          extension = 'png';
          break;
        case 'image/jpeg':
          extension = 'jpg';
          break;
        case 'image/gif':
          extension = 'gif';
          break;
        case 'image/bmp':
          extension = 'bmp';
          break;
        default:
          throw new Error('请选择有效的 JPG/JPEG、PNG、GIF 或 BMP 图片');
      }
      const id = randomUUID();
      const fileName = `clipboard-${id}.${extension}`;
      const bytes = Buffer.from(image.bytes);
      const contentType = validateImageForUpload(fileName, bytes);
      checkDecode(bytes, contentType);
      pending.push([
        id,
        {
          roomId,
          source: { bytes },
          fileName,
          fileSize: bytes.byteLength,
          digest: createHash('sha256').update(bytes).digest('hex'),
        },
      ]);
      previews.push({
        id,
        fileName,
        fileSize: bytes.byteLength,
        contentType,
        previewBytes: new Uint8Array(bytes),
      });
    }
    validateCurrent();
    for (const [id, draft] of pending) drafts.set(id, draft);
    return previews;
  };

  /** 批量校验全部文件后一次性提交，选图不触发上传或消息落库。 */
  const stage = async (
    roomId: string,
    paths: unknown,
    validateCurrent: () => void,
  ): Promise<SelectedImageDraft[]> => {
    if (
      !Array.isArray(paths) ||
      !paths.length ||
      paths.length + drafts.size > MAX_IMAGE_DRAFTS
    )
      throw new Error(`图片草稿最多保留 ${MAX_IMAGE_DRAFTS} 张`);
    if (
      paths.some(
        (item: unknown) =>
          typeof item !== 'string' ||
          item.length > 32768 ||
          !path.isAbsolute(item),
      )
    )
      throw new Error('无效的原生文件选择');
    const version = generation;
    const pending: [string, PrivateImageDraft][] = [];
    const previews: SelectedImageDraft[] = [];
    let total = [...drafts.values()].reduce(
      (sum, draft) => sum + draft.fileSize,
      0,
    );
    for (const filePath of paths as string[]) {
      validateCurrent();
      const bytes = await readImageFile(filePath);
      validateCurrent();
      if (version !== generation) throw new Error('图片草稿已失效，请重新选择');
      total += bytes.byteLength;
      if (total > MAX_IMAGE_DRAFT_BYTES)
        throw new Error('图片草稿总大小不能超过 200 MiB');
      const fileName = path.basename(filePath);
      const contentType = validateImageForUpload(fileName, bytes);
      checkDecode(bytes, contentType);
      const id = randomUUID();
      pending.push([
        id,
        {
          roomId,
          source: { filePath },
          fileName,
          fileSize: bytes.byteLength,
          digest: createHash('sha256').update(bytes).digest('hex'),
        },
      ]);
      previews.push({
        id,
        fileName,
        fileSize: bytes.byteLength,
        contentType,
        previewBytes: new Uint8Array(bytes),
      });
    }
    validateCurrent();
    if (version !== generation) throw new Error('图片草稿已失效，请重新选择');
    checkCapacity(
      pending.length,
      pending.reduce((sum, [, draft]) => sum + draft.fileSize, 0),
    );
    for (const [id, draft] of pending) drafts.set(id, draft);
    return previews;
  };

  /** 发送时读取文件或粘贴快照并比对内容；已上传草稿重试只复用公开元数据。 */
  const upload = async (
    roomId: string,
    id: string,
    validateCurrent: () => void,
    uploadBytes: (
      fileName: string,
      bytes: Uint8Array,
    ) => Promise<StoredImageContent>,
  ): Promise<StoredImageContent> => {
    validateCurrent();
    const draft = drafts.get(id);
    if (!draft || draft.roomId !== roomId)
      throw new Error('图片草稿已失效，请重新选择');
    if (draft.uploaded) return draft.uploaded;
    const bytes =
      'filePath' in draft.source
        ? await readImageFile(draft.source.filePath)
        : draft.source.bytes;
    validateCurrent();
    if (drafts.get(id) !== draft) throw new Error('图片草稿已失效，请重新选择');
    if (createHash('sha256').update(bytes).digest('hex') !== draft.digest)
      throw new Error('图片文件已变化，请移除后重新选择');
    const uploaded = await uploadBytes(draft.fileName, bytes);
    validateCurrent();
    if (drafts.get(id) !== draft) throw new Error('图片草稿已失效，请重新选择');
    draft.uploaded = uploaded;
    return uploaded;
  };

  /** 只返回当前会话已登记草稿的公开元数据，不公开路径。 */
  const describe = (roomId: string, id: string): StoredImageContent => {
    const draft = drafts.get(id);
    if (!draft || draft.roomId !== roomId)
      throw new Error('图片草稿已失效，请重新选择');
    return { url: null, fileName: draft.fileName, fileSize: draft.fileSize };
  };

  /** 预览读取原始有界字节，并核对授权、草稿身份及原文件摘要。 */
  const read = async (
    roomId: string,
    id: string,
    validateCurrent: () => void,
  ): Promise<LocalImageData> => {
    validateCurrent();
    const draft = drafts.get(id);
    if (!draft || draft.roomId !== roomId)
      throw new Error('图片草稿已失效，请重新选择');
    const bytes =
      'filePath' in draft.source
        ? await readImageFile(draft.source.filePath)
        : draft.source.bytes;
    validateCurrent();
    if (drafts.get(id) !== draft) throw new Error('图片草稿已失效，请重新选择');
    if (createHash('sha256').update(bytes).digest('hex') !== draft.digest)
      throw new Error('图片文件已变化，请移除后重新选择');
    return {
      bytes: new Uint8Array(bytes),
      contentType: validateImageForUpload(draft.fileName, bytes),
    };
  };

  return {
    stage,
    stageClipboard,
    upload,
    release,
    clear,
    clearRoom,
    describe,
    read,
  };
};
