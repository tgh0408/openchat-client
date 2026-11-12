import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { imageSize } from 'image-size';
import {
  parseAuthBase,
  SessionExpiredError,
} from '../../../../shared/auth/auth';
import type { AuthSession } from '../../../../shared/auth/auth';
import { requestApi } from '../../../../shared/api/api-client';
import { parseApiResult } from '../../../../shared/api/api-response';
import {
  parseImageName,
  parseImageUrl,
} from '../../../../shared/media/image/image';
import type { StoredImageContent } from '../../../../shared/media/image/image';
import {
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DRAFT_BYTES,
  MAX_VIDEO_DRAFTS,
  MAX_VIDEO_POSTER_BYTES,
  VIDEO_PART_SIZE,
  videoInteger,
  validateVideo,
} from '../../../../shared/media/video/video';
import type {
  MultipartUploadInit,
  SelectedVideoDraft,
  StoredVideoContent,
  VideoMetadata,
  VideoUploadProgress,
  VideoDraftProcessingProgress,
  LocalVideoUpload,
} from '../../../../shared/media/video/video';
import {
  getVideoUploadMessage,
  getVideoUploadSource,
  saveVideoUploadSource,
  markVideoUploadCancelled,
} from '../../database/database';
import { parseUploadPlaceholder } from '../../../../shared/chat/messages/upload-placeholder';
import {
  parseImageUpload,
  uploadImageBytes,
  validateImageForUpload,
} from '../image/image-upload';
import { openVideoFile, videoFileResponse } from './video-stream';
import type { VideoFileStore } from './video-files';
import type { VideoProcessor } from './video-processor';
import {
  checkVideoHeader,
  videoExtension,
  VIDEO_FORMATS,
} from '../../../../shared/media/video/video-formats';

interface PrivateDraft {
  roomId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  digest: string;
  partDigests: string[];
  validate: () => void;
  controller: AbortController;
  processing?: Promise<VideoMetadata>;
  needsPreparation?: boolean;
  poster?: StoredImageContent;
  multipart?: MultipartUploadInit;
  uploaded?: StoredVideoContent;
  clientMsgId?: string;
}

export interface VideoDraftStore {
  reveal: (
    roomId: string,
    messageId: string,
    validate: () => void,
  ) => Promise<string>;
  persist: (
    roomId: string,
    id: string,
    clientMsgId: string,
    metadata: unknown,
  ) => void;
  readSaved: (
    roomId: string,
    messageId: string,
    validate: () => void,
  ) => Promise<LocalVideoUpload | null>;
  restore: (
    roomId: string,
    messageId: string,
    validate: () => void,
  ) => Promise<SelectedVideoDraft>;
  stage: (
    roomId: string,
    filePath: string,
    validate: () => void,
  ) => Promise<SelectedVideoDraft>;
  stageDeferred: (
    roomId: string,
    filePath: string,
    validate: () => void,
  ) => Promise<SelectedVideoDraft>;
  prepare: (
    roomId: string,
    id: string,
    validate: () => void,
    progress: (value: VideoDraftProcessingProgress) => void,
  ) => Promise<VideoMetadata>;
  response: (id: string, request: Request) => Promise<Response>;
  upload: (
    roomId: string,
    id: string,
    metadata: unknown,
    session: AuthSession,
    validate: () => void,
    progress?: (value: VideoUploadProgress) => void,
  ) => Promise<StoredVideoContent>;
  release: (roomId: string, id: string) => void;
  stop: (roomId: string, id: string) => void;
  recall: (roomId: string, clientMsgId: string) => void;
  clear: (roomId?: string) => void;
}

/** 主进程持有视频原生路径，页面仅获得临时随机句柄和受控预览地址。 */
export const createVideoDraftStore = (
  base: string | undefined,
  clientId: string,
  files: VideoFileStore,
  requestRemote: typeof fetch = fetch,
  processor?: VideoProcessor,
): VideoDraftStore => {
  const drafts = new Map<string, PrivateDraft>();
  let generation = 0;
  let uploading = false;

  /** 逐块核对文件内容，不在内存保留整个视频。 */
  const digestFile = async (
    filePath: string,
    validate: () => void,
    onProgress?: (progress: number) => void,
  ): Promise<{ digest: string; size: number; partDigests: string[] }> => {
    const file = await openVideoFile(filePath);
    try {
      const before = await file.stat();
      if (before.size > MAX_VIDEO_BYTES) throw new Error('视频不能超过 2 GiB');
      videoInteger(before.size, MAX_VIDEO_BYTES);
      const hash = createHash('sha256');
      let partHash = createHash('sha256');
      const partDigests: string[] = [];
      const buffer = Buffer.alloc(65536);
      let position = 0;
      while (true) {
        const { bytesRead } = await file.read(
          buffer,
          0,
          Math.min(
            buffer.length,
            VIDEO_PART_SIZE - (position % VIDEO_PART_SIZE),
          ),
          position,
        );
        validate();
        if (!bytesRead) break;
        if (position === 0)
          checkVideoHeader(
            buffer.subarray(0, bytesRead),
            videoExtension(path.basename(filePath)),
          );
        position += bytesRead;
        if (before.size > 0)
          onProgress?.(
            Math.min(100, Math.floor((position * 100) / before.size)),
          );
        if (position > MAX_VIDEO_BYTES) throw new Error('视频超过 2 GiB');
        hash.update(buffer.subarray(0, bytesRead));
        partHash.update(buffer.subarray(0, bytesRead));
        if (position % VIDEO_PART_SIZE === 0) {
          partDigests.push(partHash.digest('hex'));
          partHash = createHash('sha256');
        }
      }
      const after = await file.stat();
      if (
        position !== before.size ||
        after.size !== before.size ||
        after.mtimeMs !== before.mtimeMs
      )
        throw new Error('视频已变化，请重新选择');
      if (position % VIDEO_PART_SIZE !== 0)
        partDigests.push(partHash.digest('hex'));
      return { digest: hash.digest('hex'), size: position, partDigests };
    } finally {
      await file.close();
    }
  };
  /** 输入框登记草稿后才开始解析；同一原生句柄合并重复请求。 */
  const prepare = async (
    roomId: string,
    id: string,
    validate: () => void,
    progress: (value: VideoDraftProcessingProgress) => void,
  ): Promise<VideoMetadata> => {
    const draft = drafts.get(id);
    if (!draft || draft.roomId !== roomId) throw new Error('视频草稿已失效');
    /** 移除、切换账号或页面重载后停止读取，不再回传旧进度。 */
    const current = (): void => {
      validate();
      draft.validate();
      if (drafts.get(id) !== draft) throw new Error('视频草稿已失效');
    };
    current();
    if (!draft.needsPreparation && !draft.processing)
      throw new Error('该视频草稿无需重新解析');
    if (!draft.processing) {
      /** 哈希按实际读取字节计量，封面提取不伪造百分比。 */
      const process = async (): Promise<VideoMetadata> => {
        if (!processor) throw new Error('视频解码工具尚未初始化');
        let lastProgress = -1;
        const info = await digestFile(draft.filePath, current, (value) => {
          if (value === lastProgress) return;
          lastProgress = value;
          progress({ roomId, draftId: id, phase: 'hashing', progress: value });
        });
        current();
        if (info.size !== draft.fileSize)
          throw new Error('视频已变化，请重新选择');
        progress({ roomId, draftId: id, phase: 'preview', progress: 0 });
        const metadata = await processor.preview(draft.filePath, current);
        current();
        draft.digest = info.digest;
        draft.partDigests = info.partDigests;
        draft.needsPreparation = false;
        return metadata;
      };
      draft.processing = process();
    }
    const metadata = await draft.processing;
    current();
    return metadata;
  };
  /** 选中只创建草稿，限三个视频且总大小不超过 6 GiB。 */
  const stage = async (
    roomId: string,
    filePath: string,
    validate: () => void,
  ): Promise<SelectedVideoDraft> => {
    const version = generation;
    validate();
    const fileName = parseImageName(path.basename(filePath));
    videoExtension(fileName);
    /** 预览解码期间也检查草稿代次，退出或清理后终止子进程。 */
    const current = (): void => {
      validate();
      if (version !== generation) throw new Error('视频选择已失效');
    };
    const info = await digestFile(filePath, current);
    current();
    const total = [...drafts.values()].reduce(
      (sum, draft) => sum + draft.fileSize,
      0,
    );
    if (
      drafts.size >= MAX_VIDEO_DRAFTS ||
      total + info.size > MAX_VIDEO_DRAFT_BYTES
    )
      throw new Error('最多保留三个视频草稿，总大小不能超过 6 GiB');
    const metadata = await processor?.preview(filePath, current);
    current();
    const id = randomUUID();
    drafts.set(id, {
      roomId,
      filePath,
      fileName,
      fileSize: info.size,
      digest: info.digest,
      partDigests: info.partDigests,
      validate,
      controller: new AbortController(),
    });
    return {
      id,
      fileName,
      fileSize: info.size,
      previewUrl: `openchat-video://draft/${id}`,
      ...(metadata ? { metadata } : {}),
    };
  };
  /** 仅检查文件属性并预留配额，耗时解析由输入框拿到句柄后启动。 */
  const stageDeferred = async (
    roomId: string,
    filePath: string,
    validate: () => void,
  ): Promise<SelectedVideoDraft> => {
    const version = generation;
    validate();
    const fileName = parseImageName(path.basename(filePath));
    videoExtension(fileName);
    const file = await openVideoFile(filePath);
    let fileSize: number;
    try {
      const info = await file.stat();
      videoInteger(info.size, MAX_VIDEO_BYTES);
      fileSize = info.size;
    } finally {
      await file.close();
    }
    validate();
    if (version !== generation) throw new Error('视频选择已失效');
    const total = [...drafts.values()].reduce(
      (sum, draft) => sum + draft.fileSize,
      0,
    );
    if (
      drafts.size >= MAX_VIDEO_DRAFTS ||
      total + fileSize > MAX_VIDEO_DRAFT_BYTES
    )
      throw new Error('最多保留三个视频草稿，总大小不能超过 6 GiB');
    const id = randomUUID();
    const draft: PrivateDraft = {
      roomId,
      filePath,
      fileName,
      fileSize,
      digest: '',
      partDigests: [],
      validate,
      controller: new AbortController(),
      needsPreparation: true,
    };
    drafts.set(id, draft);
    return {
      id,
      fileName,
      fileSize,
      previewUrl: `openchat-video://draft/${id}`,
      needsPreparation: true,
    };
  };
  /** 解析业务接口返回的统一 JSON，签名地址只留在主进程。 */
  const parseMultipartData = (
    value: unknown,
    message: string,
  ): Record<string, unknown> => {
    const root = parseApiResult(value, '视频上传');
    if (!root.data || typeof root.data !== 'object' || Array.isArray(root.data))
      throw new Error(message);
    return root.data as Record<string, unknown>;
  };
  /** 请求视频 Multipart 控制接口，不把业务令牌发送给对象存储。 */
  const requestMultipart = async (
    pathName: string,
    body: Record<string, unknown>,
    session: AuthSession,
    validate: () => void,
    draft: PrivateDraft,
  ): Promise<Record<string, unknown>> => {
    validate();
    draft.controller.signal.throwIfAborted();
    return requestApi(
      { base, session, clientId, requestRemote, validateCurrent: validate },
      {
        path: pathName,
        method: 'POST',
        body,
        signal: draft.controller.signal,
        timeoutMs: 60000,
        serviceName: '视频上传',
        networkError: '无法连接视频上传服务，请重试',
        parse: (value: unknown): Record<string, unknown> =>
          parseMultipartData(value, '视频上传服务返回无效数据'),
      },
    );
  };
  /** 校验真实分片状态与固定协议上限，不靠类型断言信任后端响应。 */
  const parseMultipart = (
    data: Record<string, unknown>,
    draft: PrivateDraft,
  ): MultipartUploadInit => {
    if (
      typeof data.sessionKey !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.sessionKey) ||
      typeof data.uploadId !== 'string' ||
      !data.uploadId.length ||
      data.uploadId.length > 512 ||
      /[\u0000-\u0020]/.test(data.uploadId) ||
      videoInteger(data.fileSize, MAX_VIDEO_BYTES) !== draft.fileSize ||
      data.partSize !== VIDEO_PART_SIZE ||
      typeof data.completed !== 'boolean' ||
      !Array.isArray(data.parts) ||
      data.parts.length > 128
    )
      throw new Error('视频上传会话响应无效');
    const downloadUrl = parseImageUrl(data.downloadUrl);
    parseAuthBase(new URL(downloadUrl).origin);
    const numbers = new Set<number>();
    const parts = data.parts.map((value: unknown) => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new Error('视频分片响应无效');
      const part = value as Record<string, unknown>;
      const partNumber = videoInteger(
        part.partNumber,
        Math.ceil(draft.fileSize / VIDEO_PART_SIZE),
      );
      const size = videoInteger(part.size, VIDEO_PART_SIZE);
      if (
        numbers.has(partNumber) ||
        typeof part.etag !== 'string' ||
        !part.etag.length ||
        part.etag.length > 256 ||
        size !==
          Math.min(
            VIDEO_PART_SIZE,
            draft.fileSize - (partNumber - 1) * VIDEO_PART_SIZE,
          )
      )
        throw new Error('视频分片大小或编号无效');
      numbers.add(partNumber);
      return { partNumber, etag: part.etag, size };
    });
    return {
      sessionKey: data.sessionKey,
      uploadId: data.uploadId,
      downloadUrl,
      fileSize: draft.fileSize,
      partSize: VIDEO_PART_SIZE,
      completed: data.completed,
      parts,
    };
  };
  /** 每次发送从服务端恢复分片；断网或应用重启后重新选择同一文件可继续。 */
  const uploadMultipart = async (
    draft: PrivateDraft,
    session: AuthSession,
    validate: () => void,
    progress: (bytes: number, phase: VideoUploadProgress['phase']) => void,
  ): Promise<string> => {
    const multipart = parseMultipart(
      await requestMultipart(
        '/capi/oss/multipart/initiate',
        {
          roomId: draft.roomId,
          clientMsgId: draft.clientMsgId,
          fileName: draft.fileName,
          fileSize: String(draft.fileSize),
          sha256: draft.digest,
        },
        session,
        validate,
        draft,
      ),
      draft,
    );
    draft.multipart = multipart;
    let uploadedBytes = multipart.completed
      ? draft.fileSize
      : multipart.parts.reduce((sum, part) => sum + part.size, 0);
    progress(uploadedBytes, 'uploading');
    if (multipart.completed) return multipart.downloadUrl;
    const finished = new Set(multipart.parts.map((part) => part.partNumber));
    const partCount = Math.ceil(draft.fileSize / VIDEO_PART_SIZE);
    const file = await openVideoFile(draft.filePath);
    try {
      const hash = createHash('sha256');
      for (let partNumber = 1; partNumber <= partCount; partNumber++) {
        validate();
        const position = (partNumber - 1) * VIDEO_PART_SIZE;
        const length = Math.min(VIDEO_PART_SIZE, draft.fileSize - position);
        const buffer = Buffer.alloc(length);
        let read = 0;
        while (read < length) {
          const result = await file.read(
            buffer,
            read,
            length - read,
            position + read,
          );
          validate();
          if (!result.bytesRead) throw new Error('视频文件读取不完整，请重试');
          read += result.bytesRead;
        }
        hash.update(buffer);
        if (
          createHash('sha256').update(buffer).digest('hex') !==
          draft.partDigests[partNumber - 1]
        )
          throw new Error('视频内容已变化，请移除草稿并重新选择');
        if (finished.has(partNumber)) continue;
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt++) {
          validate();
          draft.controller.signal.throwIfAborted();
          try {
            const part = await requestMultipart(
              '/capi/oss/multipart/part-url',
              {
                sessionKey: multipart.sessionKey,
                uploadId: multipart.uploadId,
                partNumber,
              },
              session,
              validate,
              draft,
            );
            const urls = parseImageUpload({
              success: true,
              code: 200,
              data: {
                uploadUrl: part.uploadUrl,
                downloadUrl: multipart.downloadUrl,
              },
            });
            const signed = new URL(urls.uploadUrl);
            if (
              signed.searchParams.get('uploadId') !== multipart.uploadId ||
              signed.searchParams.get('partNumber') !== String(partNumber)
            )
              throw new Error('视频分片签名不匹配');
            validate();
            const uploaded = await requestRemote(urls.uploadUrl, {
              method: 'PUT',
              headers: {
                'Content-Type': VIDEO_FORMATS[videoExtension(draft.fileName)],
                'Content-Length': String(length),
                'Content-MD5': createHash('md5')
                  .update(buffer)
                  .digest('base64'),
              },
              body: buffer,
              credentials: 'omit',
              redirect: 'error',
              cache: 'no-store',
              signal: AbortSignal.any([
                draft.controller.signal,
                AbortSignal.timeout(600000),
              ]),
            });
            validate();
            await uploaded.body?.cancel();
            if (!uploaded.ok)
              throw new Error(`视频分片上传失败（${uploaded.status}）`);
            const etag = uploaded.headers.get('etag')?.replace(/^"|"$/g, '');
            if (!etag) throw new Error('对象存储未返回分片 ETag');
            uploadedBytes += length;
            progress(uploadedBytes, 'uploading');
            lastError = undefined;
            break;
          } catch (error) {
            lastError = error;
            validate();
            draft.controller.signal.throwIfAborted();
            if (error instanceof SessionExpiredError) throw error;
            if (attempt < 2)
              await new Promise((resolve) =>
                setTimeout(resolve, 1000 * 2 ** attempt),
              );
          }
        }
        if (lastError)
          throw new Error('视频分片上传失败，已上传分片保留，请点击发送续传');
      }
      if (
        (await file.stat()).size !== draft.fileSize ||
        hash.digest('hex') !== draft.digest
      ) {
        await requestMultipart(
          '/capi/oss/multipart/abort',
          {
            sessionKey: multipart.sessionKey,
            uploadId: multipart.uploadId,
          },
          session,
          validate,
          draft,
        ).catch(() => {});
        throw new Error('视频内容已变化，请移除草稿并重新选择');
      }
    } finally {
      await file.close();
    }
    progress(uploadedBytes, 'finalizing');
    const complete = parseMultipart(
      await requestMultipart(
        '/capi/oss/multipart/complete',
        {
          sessionKey: multipart.sessionKey,
          uploadId: multipart.uploadId,
        },
        session,
        validate,
        draft,
      ),
      draft,
    );
    validate();
    if (
      !complete.completed ||
      complete.sessionKey !== multipart.sessionKey ||
      complete.uploadId !== multipart.uploadId ||
      complete.downloadUrl !== multipart.downloadUrl
    )
      throw new Error('视频合并尚未确认，请点击发送重试');
    return multipart.downloadUrl;
  };
  /** 协议只接受仍属于当前页面的原生选中草稿，不解析页面提供的文件路径。 */
  const response = async (id: string, request: Request): Promise<Response> => {
    const draft = drafts.get(id);
    if (!draft) return new Response(null, { status: 404 });
    /** 释放草稿立即撤销正在读取的媒体流。 */
    const validate = (): void => {
      draft.validate();
      if (drafts.get(id) !== draft) throw new Error('视频草稿已释放');
    };
    return videoFileResponse(
      draft.filePath,
      request.headers.get('range'),
      validate,
      request.method === 'HEAD',
    );
  };
  /** 校验封面字节与真实尺寸，视频的时长由解码预览提供且有上限。 */
  const metadataOf = (value: unknown): VideoMetadata => {
    if (!value || typeof value !== 'object') throw new Error('视频预览无效');
    const data = value as Record<string, unknown>;
    if (!(data.poster instanceof Uint8Array)) throw new Error('视频封面无效');
    videoInteger(data.poster.byteLength, MAX_VIDEO_POSTER_BYTES);
    validateImageForUpload('poster.jpg', data.poster);
    const dimensions = imageSize(new Uint8Array(data.poster));
    const width = videoInteger(data.thumbWidth, 1920);
    const height = videoInteger(data.thumbHeight, 1920);
    if (dimensions.width !== width || dimensions.height !== height)
      throw new Error('视频封面尺寸不一致');
    return {
      poster: data.poster,
      thumbWidth: width,
      thumbHeight: height,
      duration: videoInteger(data.duration, 86400000),
    };
  };
  /** 首次提交占位前保存本机来源；页面只传随机草稿句柄，不能传文件路径。 */
  const persist = (
    roomId: string,
    id: string,
    clientMsgId: string,
    value: unknown,
  ): void => {
    const draft = drafts.get(id);
    if (!draft || draft.roomId !== roomId) throw new Error('视频草稿已失效');
    if (draft.needsPreparation || !draft.digest)
      throw new Error('视频仍在解析，请稍后重试');
    draft.validate();
    const metadata = metadataOf(value);
    const message = getVideoUploadMessage(roomId, clientMsgId);
    const placeholder = message && parseUploadPlaceholder(message.content);
    if (
      !placeholder ||
      placeholder.targetType !== 5 ||
      placeholder.fileName !== draft.fileName ||
      placeholder.fileSize !== draft.fileSize ||
      placeholder.duration !== metadata.duration ||
      placeholder.thumbWidth !== metadata.thumbWidth ||
      placeholder.thumbHeight !== metadata.thumbHeight
    )
      throw new Error('视频来源与占位不匹配');
    saveVideoUploadSource(roomId, clientMsgId, {
      filePath: draft.filePath,
      fileName: draft.fileName,
      fileSize: draft.fileSize,
      digest: draft.digest,
      partDigests: JSON.stringify(draft.partDigests),
      ...metadata,
      cancelRequested: 0,
    });
    if (draft.clientMsgId !== clientMsgId) {
      draft.poster = undefined;
      draft.multipart = undefined;
      draft.uploaded = undefined;
    }
    draft.clientMsgId = clientMsgId;
  };
  /** 仅检查原文件是否仍可读取，不在展示卡片时计算整个视频摘要。 */
  const sourceAvailable = async (
    filePath: string,
    fileSize: number,
    validate: () => void,
  ): Promise<boolean> => {
    try {
      const file = await openVideoFile(filePath);
      try {
        const info = await file.stat();
        validate();
        return info.size === fileSize;
      } finally {
        await file.close();
      }
    } catch {
      validate();
      return false;
    }
  };
  /** 只读查询按消息归属加载一张封面，无本机记录时留空且不可恢复上传。 */
  const readSaved = async (
    roomId: string,
    messageId: string,
    validate: () => void,
  ): Promise<LocalVideoUpload | null> => {
    validate();
    const message = getVideoUploadMessage(roomId, messageId);
    if (!message?.clientMsgId || message.messageType === 'video') return null;
    const source = getVideoUploadSource(roomId, message.clientMsgId);
    if (!source) return null;
    const canResume =
      (message.messageType === 'upload-cancelled' || !source.cancelRequested) &&
      (await sourceAvailable(source.filePath, source.fileSize, validate));
    validate();
    return { poster: new Uint8Array(source.poster), canResume };
  };
  /** 定位本人本机占位的原文件，仅检查来源和存在性，不恢复上传或修改取消状态。 */
  const reveal = async (
    roomId: string,
    messageId: string,
    validate: () => void,
  ): Promise<string> => {
    validate();
    const message = getVideoUploadMessage(roomId, messageId);
    const source = message?.clientMsgId
      ? getVideoUploadSource(roomId, message.clientMsgId)
      : null;
    if (
      !message ||
      !source ||
      !['temporary', 'upload-cancelled'].includes(message.messageType) ||
      parseUploadPlaceholder(message.content)?.targetType !== 5
    )
      throw new Error('本机没有该视频的原文件记录');
    if (!(await sourceAvailable(source.filePath, source.fileSize, validate)))
      throw new Error('原视频已移动、删除或大小发生变化，无法定位');
    validate();
    const latest = getVideoUploadMessage(roomId, messageId);
    if (!latest || latest.clientMsgId !== message.clientMsgId)
      throw new Error('视频消息已变化，无法定位');
    return source.filePath;
  };
  /** 从首次发送记录重建临时句柄，不接受重新选择的文件，不自动开始上传。 */
  const restore = async (
    roomId: string,
    messageId: string,
    validate: () => void,
  ): Promise<SelectedVideoDraft> => {
    validate();
    const version = generation;
    const message = getVideoUploadMessage(roomId, messageId);
    const source = message?.clientMsgId
      ? getVideoUploadSource(roomId, message.clientMsgId)
      : null;
    if (!source || !message || message.messageType === 'video')
      throw new Error('仅首次发送的设备可以恢复上传');
    if (source.cancelRequested && message.messageType !== 'upload-cancelled')
      throw new Error('取消尚未确认，请先重试取消发送');
    /** 恢复过程不能跨账号、页面或草稿代次。 */
    const current = (): void => {
      validate();
      if (generation !== version) throw new Error('视频恢复已失效');
      const latest = getVideoUploadMessage(roomId, messageId);
      if (
        !latest ||
        latest.clientMsgId !== message.clientMsgId ||
        latest.messageType !== message.messageType
      )
        throw new Error('视频消息状态已变化，请刷新后重试');
    };
    if (!(await sourceAvailable(source.filePath, source.fileSize, current)))
      throw new Error('原视频已移动、删除或大小发生变化，无法恢复上传');
    current();
    const total = [...drafts.values()].reduce(
      (sum, draft) => sum + draft.fileSize,
      0,
    );
    if (
      drafts.size >= MAX_VIDEO_DRAFTS ||
      total + source.fileSize > MAX_VIDEO_DRAFT_BYTES
    )
      throw new Error('最多保留三个视频草稿，总大小不能超过 6 GiB');
    const metadata = metadataOf(source);
    const partDigests: unknown = JSON.parse(source.partDigests);
    if (
      !path.isAbsolute(source.filePath) ||
      !/^[a-f0-9]{64}$/.test(source.digest) ||
      !Array.isArray(partDigests) ||
      partDigests.length !== Math.ceil(source.fileSize / VIDEO_PART_SIZE) ||
      !partDigests.every(
        (value: unknown) =>
          typeof value === 'string' && /^[a-f0-9]{64}$/.test(value),
      )
    )
      throw new Error('本地视频来源记录无效');
    const id = randomUUID();
    drafts.set(id, {
      roomId,
      filePath: source.filePath,
      fileName: source.fileName,
      fileSize: source.fileSize,
      digest: source.digest,
      partDigests: partDigests as string[],
      clientMsgId: message.clientMsgId!,
      validate,
      controller: new AbortController(),
    });
    return {
      id,
      fileName: source.fileName,
      fileSize: source.fileSize,
      previewUrl: `openchat-video://draft/${id}`,
      metadata,
    };
  };
  /** 上传流结束前再次核对摘要，防止预览后文件被替换。 */
  const checkedSource = async (
    draft: PrivateDraft,
    validate: () => void,
  ): Promise<ReadableStream<Uint8Array>> => {
    const response = await videoFileResponse(draft.filePath, null, validate);
    const reader = response.body!.getReader();
    const hash = createHash('sha256');
    let length = 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller): Promise<void> => {
        try {
          validate();
          const result = await reader.read();
          validate();
          if (result.done) {
            if (
              length !== draft.fileSize ||
              hash.digest('hex') !== draft.digest
            )
              throw new Error('视频内容已变化，请重新选择');
            reader.releaseLock();
            controller.close();
          } else {
            length += result.value.length;
            hash.update(result.value);
            controller.enqueue(result.value);
          }
        } catch (error) {
          await reader.cancel().catch(() => {});
          controller.error(error);
        }
      },
      cancel: async (): Promise<void> => {
        await reader.cancel();
      },
    });
  };
  /** 先上传封面再分片直传视频，业务 JWT 绝不发送给 MinIO。 */
  const upload = async (
    roomId: string,
    id: string,
    value: unknown,
    session: AuthSession,
    validateCurrent: () => void,
    onProgress?: (value: VideoUploadProgress) => void,
  ): Promise<StoredVideoContent> => {
    const draft = drafts.get(id);
    if (!draft || draft.roomId !== roomId) throw new Error('视频草稿已失效');
    if (draft.needsPreparation || !draft.digest)
      throw new Error('视频仍在解析，请稍后重试');
    const clientMsgId = draft.clientMsgId;
    if (!clientMsgId) throw new Error('上传必须先绑定占位消息');
    const source = getVideoUploadSource(roomId, clientMsgId);
    if (!source || source.cancelRequested)
      throw new Error('本机上传来源已失效或已请求取消');
    if (uploading) throw new Error('请等待当前视频上传完成');
    draft.controller = new AbortController();
    const controller = draft.controller;
    /** 上传、缓存和返回各阶段限定最初的账号与会话。 */
    const validate = (): void => {
      validateCurrent();
      draft.validate();
      controller.signal.throwIfAborted();
      if (drafts.get(id) !== draft) throw new Error('视频草稿已失效');
      const message = getVideoUploadMessage(roomId, clientMsgId);
      if (!message || message.messageType === 'upload-cancelled')
        throw new Error('视频消息已撤回、取消或移除');
    };
    validate();
    /** 仅统计服务端已确认分片，重试不累加重复传输字节。 */
    const progress = (
      uploadedBytes: number,
      phase: VideoUploadProgress['phase'],
    ): void => {
      validate();
      onProgress?.({
        roomId,
        draftId: id,
        uploadedBytes,
        totalBytes: draft.fileSize,
        phase,
      });
    };
    const metadata = metadataOf(value);
    uploading = true;
    try {
      progress(0, 'validating');
      const current = await digestFile(draft.filePath, validate);
      if (current.digest !== draft.digest)
        throw new Error('原视频已变化，不能继续此占位，请作为新消息发送');
      if (draft.uploaded) {
        progress(draft.fileSize, 'finalizing');
        return draft.uploaded;
      }
      const poster =
        draft.poster ??
        (await uploadImageBytes(
          base,
          session,
          clientId,
          'poster.jpg',
          metadata.poster,
          validate,
          requestRemote,
          draft.controller.signal,
          { roomId, clientMsgId },
        ));
      draft.poster = poster;
      const videoUrl = await uploadMultipart(
        draft,
        session,
        validate,
        progress,
      );
      progress(draft.fileSize, 'finalizing');
      const video = validateVideo({
        url: videoUrl,
        fileName: draft.fileName,
        fileSize: draft.fileSize,
        thumbUrl: poster.url,
        thumbSize: metadata.poster.byteLength,
        thumbWidth: metadata.thumbWidth,
        thumbHeight: metadata.thumbHeight,
        duration: metadata.duration,
      });
      await files.save(
        video.url!,
        draft.fileSize,
        await checkedSource(draft, validate),
        validate,
      );
      await files.save(
        video.thumbUrl!,
        metadata.poster.byteLength,
        new Response(new Uint8Array(metadata.poster)).body!,
        validate,
        true,
      );
      validate();
      draft.uploaded = video;
      return video;
    } finally {
      uploading = false;
    }
  };
  /** 中止传输并保留原生句柄与摘要，重新发送时重新校验文件。 */
  const stop = (roomId: string, id: string): void => {
    const draft = drafts.get(id);
    if (draft?.roomId === roomId) {
      draft.controller.abort();
      if (draft.clientMsgId)
        markVideoUploadCancelled(roomId, draft.clientMsgId);
    }
  };
  /** 删除指定会话的草稿不删除原始视频。 */
  const release = (roomId: string, id: string): void => {
    const draft = drafts.get(id);
    if (draft?.roomId === roomId) {
      draft.controller.abort();
      drafts.delete(id);
    }
  };
  /** 服务端撤回只释放匹配消息的任务，不能保留重新发送入口或影响其他上传。 */
  const recall = (roomId: string, clientMsgId: string): void => {
    for (const [id, draft] of drafts)
      if (draft.roomId === roomId && draft.clientMsgId === clientMsgId)
        release(roomId, id);
  };
  /** 撤销全部草稿或已删除会话的草稿。 */
  const clear = (roomId?: string): void => {
    generation++;
    for (const [id, draft] of drafts)
      if (!roomId || draft.roomId === roomId) release(draft.roomId, id);
  };
  return {
    stage,
    stageDeferred,
    prepare,
    response,
    upload,
    stop,
    recall,
    release,
    clear,
    persist,
    readSaved,
    restore,
    reveal,
  };
};
