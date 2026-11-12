import { createHash, randomUUID } from 'node:crypto';
import { validateReplyTarget } from '../../chat/message-reply';
import path from 'node:path';
import {
  parseAuthBase,
  SessionExpiredError,
} from '../../../../shared/auth/auth';
import type { AuthSession } from '../../../../shared/auth/auth';
import { requestApi } from '../../../../shared/api/api-client';
import { parseApiResult } from '../../../../shared/api/api-response';
import {
  MAX_FILE_BYTES,
  MAX_FILE_DRAFTS,
  validateFileMetadata,
  parseFileContent,
} from '../../../../shared/media/file/file-message';
import type {
  SelectedFileDraft,
  FileContent,
  FileMetadata,
  FileDraftProcessingProgress,
} from '../../../../shared/media/file/file-message';
import {
  VIDEO_PART_SIZE,
  videoInteger,
} from '../../../../shared/media/video/video';
import type { VideoUploadProgress } from '../../../../shared/media/video/video';
import { openVideoFile } from '../video/video-stream';
import { parseImageUpload } from '../image/image-upload';
import { parseImageUrl } from '../../../../shared/media/image/image';
import { parseUploadPlaceholder } from '../../../../shared/chat/messages/upload-placeholder';
import {
  getVideoUploadMessage,
  getFileUploadSource,
  saveFileUploadSource,
  markFileUploadCancelled,
  saveRemoteMessages,
} from '../../database/database';
import {
  requestCreateFileTemporary,
  requestCompleteFileTemporary,
  requestCancelTemporary,
} from '../../../../shared/chat/messages/temporary-message';
import type { FileUploadSource } from '../file-sources';
import type { Message } from '../../../../shared/storage/database';
import type { createAttachmentFileStore } from './attachment-files';

interface Draft extends FileUploadSource {
  roomId: string;
  validate: () => void;
  needsPreparation?: boolean;
  processing?: Promise<void>;
}
export interface FileDraftStore {
  stage: (
    roomId: string,
    filePath: string,
    validate: () => void,
  ) => Promise<SelectedFileDraft>;
  stageDeferred: FileDraftStore['stage'];
  prepare: (
    roomId: string,
    id: string,
    validate: () => void,
    progress: (value: FileDraftProcessingProgress) => void,
  ) => Promise<void>;
  release: (roomId: string, id: string) => void;
  restore: (
    roomId: string,
    messageId: string,
    validate: () => void,
  ) => Promise<SelectedFileDraft>;
  send: (
    roomId: string,
    clientMsgId: string,
    draftId: string | undefined,
    session: AuthSession,
    validate: () => void,
    progress: (value: VideoUploadProgress) => void,
  ) => Promise<void>;
  cancel: (
    roomId: string,
    clientMsgId: string,
    session: AuthSession,
    validate: () => void,
  ) => Promise<Message>;
  clear: (roomId?: string) => void;
  recall: (roomId: string, clientMsgId: string) => void;
}

/** 流式计算原文件及固定分片摘要，不将 6 GiB 文件读入内存。 */
const inspect = async (
  filePath: string,
  validate: () => void,
  progress?: (percent: number) => void,
): Promise<FileUploadSource> => {
  const file = await openVideoFile(filePath);
  try {
    const before = await file.stat();
    const metadata = validateFileMetadata({
      fileName: path.basename(filePath),
      fileSize: before.size,
    });
    const hash = createHash('sha256');
    let part = createHash('sha256');
    const partDigests: string[] = [];
    const buffer = Buffer.alloc(65536);
    let position = 0;
    let reported = 0;
    validate();
    progress?.(0);
    while (position < before.size) {
      validate();
      const { bytesRead } = await file.read(
        buffer,
        0,
        Math.min(
          buffer.length,
          before.size - position,
          VIDEO_PART_SIZE - (position % VIDEO_PART_SIZE),
        ),
        position,
      );
      validate();
      if (!bytesRead) throw new Error('原文件读取不完整');
      hash.update(buffer.subarray(0, bytesRead));
      part.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
      const percent = Math.floor((position / before.size) * 100);
      if (percent !== reported) {
        reported = percent;
        progress?.(percent);
      }
      if (position % VIDEO_PART_SIZE === 0 || position === before.size) {
        partDigests.push(part.digest('hex'));
        part = createHash('sha256');
      }
    }
    const after = await file.stat();
    validate();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
      throw new Error('原文件已变化');
    return {
      ...metadata,
      filePath,
      digest: hash.digest('hex'),
      partDigests,
      cancelRequested: false,
    };
  } finally {
    await file.close();
  }
};

/** 文件发送保留本机来源，复用服务端分片状态和原 clientMsgId。 */
export const createFileDraftStore = (
  base: string | undefined,
  clientId: string,
  files: Pick<ReturnType<typeof createAttachmentFileStore>, 'saveUploaded'>,
): FileDraftStore => {
  const drafts = new Map<string, Draft>();
  const active = new Map<string, AbortController>();
  let generation = 0;
  let transmitting = 0;
  const waiting: (() => void)[] = [];
  /** 上传并发最多两个，等待任务也已持久化来源并创建占位。 */
  const acquire = async (): Promise<void> => {
    if (transmitting < 2) {
      transmitting++;
      return;
    }
    await new Promise<void>((resolve) => waiting.push(resolve));
  };
  /** 将传输位置移交等待任务。 */
  const releaseTransfer = (): void => {
    const next = waiting.shift();
    if (next) next();
    else transmitting--;
  };
  /** 选择只建立内存草稿，首次点击发送后才保存来源并上传。 */
  const stage = async (
    roomId: string,
    filePath: string,
    validate: () => void,
  ): Promise<SelectedFileDraft> => {
    const version = generation;
    /** 校验期间不跨页面或清理代次。 */
    const current = (): void => {
      validate();
      if (version !== generation) throw new Error('文件选择已失效');
    };
    const source = await inspect(filePath, current);
    current();
    if (
      drafts.size >= MAX_FILE_DRAFTS ||
      [...drafts.values()].reduce((n, d) => n + d.fileSize, source.fileSize) >
        MAX_FILE_BYTES
    )
      throw new Error('文件草稿最多三个，合计不超过 6 GiB');
    const id = randomUUID();
    drafts.set(id, { ...source, roomId, validate: current });
    return { id, fileName: source.fileName, fileSize: source.fileSize };
  };
  /** 仅检查文件信息并预留配额，让输入区在摘要读取前显示草稿。 */
  const stageDeferred: FileDraftStore['stageDeferred'] = async (
    roomId: string,
    filePath: string,
    validate: () => void,
  ): Promise<SelectedFileDraft> => {
    const version = generation;
    /** 选择和后续准备都绑定原页面的授权代次。 */
    const current = (): void => {
      validate();
      if (version !== generation) throw new Error('文件选择已失效');
    };
    current();
    const file = await openVideoFile(filePath);
    let metadata: FileMetadata;
    try {
      metadata = validateFileMetadata({
        fileName: path.basename(filePath),
        fileSize: (await file.stat()).size,
      });
    } finally {
      await file.close();
    }
    current();
    if (
      drafts.size >= MAX_FILE_DRAFTS ||
      [...drafts.values()].reduce((n, d) => n + d.fileSize, metadata.fileSize) >
        MAX_FILE_BYTES
    )
      throw new Error('文件草稿最多三个，合计不超过 6 GiB');
    const id = randomUUID();
    drafts.set(id, {
      ...metadata,
      filePath,
      roomId,
      validate: current,
      digest: '',
      partDigests: [],
      cancelRequested: false,
      needsPreparation: true,
    });
    return { ...metadata, id, needsPreparation: true };
  };
  /** 同一草稿只读取一次；移除、退出或授权变化后拒绝迟到结果。 */
  const prepare: FileDraftStore['prepare'] = async (
    roomId: string,
    id: string,
    validate: () => void,
    progress: (value: FileDraftProcessingProgress) => void,
  ): Promise<void> => {
    validate();
    const draft = drafts.get(id);
    if (!draft || draft.roomId !== roomId) throw new Error('文件草稿已失效');
    /** 每次读取与回调都核对原始归属及句柄。 */
    const current = (): void => {
      draft.validate();
      validate();
      if (drafts.get(id) !== draft) throw new Error('文件草稿已失效');
    };
    current();
    if (!draft.processing && draft.needsPreparation) {
      /** 摘要完整且文件大小未变化后才允许保存发送来源。 */
      const process = async (): Promise<void> => {
        const source = await inspect(draft.filePath, current, (percent) => {
          current();
          progress({
            roomId,
            draftId: id,
            phase: 'hashing',
            progress: percent,
          });
        });
        current();
        if (source.fileSize !== draft.fileSize)
          throw new Error('原文件已变化，请重新选择');
        Object.assign(draft, source, { needsPreparation: false });
      };
      draft.processing = process();
    }
    await draft.processing;
    current();
  };
  /** 只释放当前会话的随机句柄，不删除原文件。 */
  const release = (roomId: string, id: string): void => {
    if (drafts.get(id)?.roomId === roomId) drafts.delete(id);
  };
  /** 已取消文件重发仅恢复首次发送的原文件，页面不能传路径或重新绑定旧占位。 */
  const restore = async (
    roomId: string,
    messageId: string,
    validate: () => void,
  ): Promise<SelectedFileDraft> => {
    validate();
    const message = getVideoUploadMessage(roomId, messageId);
    const source = message?.clientMsgId
      ? getFileUploadSource(roomId, message.clientMsgId)
      : null;
    if (
      !source ||
      !message ||
      message.messageType !== 'upload-cancelled' ||
      parseUploadPlaceholder(message.content)?.targetType !== 6
    )
      throw new Error('仅原设备可以重新发送已取消文件');
    const draft = await stage(roomId, source.filePath, validate);
    validate();
    const restored = drafts.get(draft.id);
    if (
      !restored ||
      restored.digest !== source.digest ||
      restored.fileSize !== source.fileSize ||
      getVideoUploadMessage(roomId, messageId)?.messageType !==
        'upload-cancelled'
    ) {
      release(roomId, draft.id);
      throw new Error('原文件或消息已变化，请重新选择并发送新文件');
    }
    return draft;
  };
  /** 控制接口携带业务授权，分片 PUT 不携带业务令牌。 */
  const control = async (
    endpoint: string,
    body: Record<string, unknown>,
    session: AuthSession,
    validate: () => void,
    signal: AbortSignal,
  ): Promise<Record<string, unknown>> => {
    validate();
    return requestApi(
      { base, session, clientId, validateCurrent: validate },
      {
        path: `/capi/oss/multipart/${endpoint}`,
        method: 'POST',
        body,
        signal,
        timeoutMs: 60000,
        serviceName: '文件上传',
        parse: (result: unknown): Record<string, unknown> => {
          const value = parseApiResult(result, '文件上传');
          if (
            !value.data ||
            typeof value.data !== 'object' ||
            Array.isArray(value.data)
          )
            throw new Error('文件上传请求失败');
          return value.data as Record<string, unknown>;
        },
      },
    );
  };
  /** 发送始终使用已绑定原文件，重启后不允许重新选文件接管占位。 */
  const send: FileDraftStore['send'] = async (
    roomId: string,
    clientMsgId: string,
    draftId: string | undefined,
    session: AuthSession,
    validate: () => void,
    progress: (value: VideoUploadProgress) => void,
  ): Promise<void> => {
    validate();
    const key = `${roomId}:${clientMsgId}`;
    if (active.has(key)) throw new Error('文件正在发送');
    const controller = new AbortController();
    const version = generation;
    active.set(key, controller);
    let acquired = false;
    /** 每次异步返回重查授权、取消和消息生命周期。 */
    const current = (): void => {
      validate();
      controller.signal.throwIfAborted();
      if (generation !== version) throw new Error('文件发送已失效');
      const latest = getVideoUploadMessage(roomId, clientMsgId);
      if (!latest || latest.messageType === 'upload-cancelled')
        throw new Error('文件消息已取消或移除');
    };
    try {
      const message = getVideoUploadMessage(roomId, clientMsgId);
      const placeholder = message && parseUploadPlaceholder(message.content);
      const draft = draftId ? drafts.get(draftId) : undefined;
      if (draft && draft.roomId !== roomId)
        throw new Error('文件草稿不属于此会话');
      if (draft) {
        draft.validate();
        if (draft.needsPreparation || !draft.digest)
          throw new Error('文件仍在准备，请等待完成');
      }
      let source = getFileUploadSource(roomId, clientMsgId);
      if (!source && draft) {
        if (
          !placeholder ||
          placeholder.targetType !== 6 ||
          placeholder.fileName !== draft.fileName ||
          placeholder.fileSize !== draft.fileSize
        )
          throw new Error('文件来源与占位不匹配');
        saveFileUploadSource(roomId, clientMsgId, draft);
        source = getFileUploadSource(roomId, clientMsgId);
      }
      if (!source || source.cancelRequested)
        throw new Error('原设备来源不存在或已请求取消');
      if (active.size > MAX_FILE_DRAFTS)
        throw new Error('最多同时保留三个文件发送任务，请稍后重试');
      if (
        !path.isAbsolute(source.filePath) ||
        !/^[a-f0-9]{64}$/.test(source.digest) ||
        !Array.isArray(source.partDigests) ||
        source.partDigests.length !==
          Math.ceil(source.fileSize / VIDEO_PART_SIZE) ||
        !source.partDigests.every((part: string) => /^[a-f0-9]{64}$/.test(part))
      )
        throw new Error('本机文件来源无效');
      const remote = await requestCreateFileTemporary(
        base,
        session,
        clientId,
        roomId,
        clientMsgId,
        source,
        validateReplyTarget(roomId, message?.replyId),
      );
      current();
      if (remote.messageType === 'file') {
        const completed = parseFileContent(remote.content);
        if (!completed) throw new Error('已完成文件元数据无效');
        await files.saveUploaded(completed, source, current);
        current();
        saveRemoteMessages([remote]);
        await requestCompleteFileTemporary(
          base,
          session,
          clientId,
          roomId,
          remote.id,
          clientMsgId,
          completed,
        );
        current();
        if (draftId) release(roomId, draftId);
        return;
      }
      saveRemoteMessages([remote]);
      if (remote.messageType === 'upload-cancelled')
        throw new Error('该消息已取消');
      /** 进度只累计对象存储确认的分片。 */
      const report = (
        uploadedBytes: number,
        phase: VideoUploadProgress['phase'],
      ): void => {
        current();
        progress({
          roomId,
          draftId: clientMsgId,
          uploadedBytes,
          totalBytes: source!.fileSize,
          phase,
        });
      };
      await acquire();
      acquired = true;
      current();
      report(0, 'validating');
      const checked = await inspect(source.filePath, current);
      if (
        checked.digest !== source.digest ||
        checked.fileSize !== source.fileSize
      )
        throw new Error('原文件已变化，请作为新消息发送');
      const state = await control(
        'initiate',
        {
          roomId,
          clientMsgId,
          targetType: 6,
          fileName: source.fileName,
          fileSize: String(source.fileSize),
          sha256: source.digest,
        },
        session,
        current,
        controller.signal,
      );
      if (
        typeof state.sessionKey !== 'string' ||
        !/^[a-f0-9]{64}$/.test(state.sessionKey) ||
        typeof state.uploadId !== 'string' ||
        !state.uploadId ||
        state.uploadId.length > 512 ||
        videoInteger(state.fileSize, MAX_FILE_BYTES) !== source.fileSize ||
        state.partSize !== VIDEO_PART_SIZE ||
        typeof state.completed !== 'boolean' ||
        !Array.isArray(state.parts) ||
        state.parts.length > 384
      )
        throw new Error('文件上传会话无效');
      const identity = {
        sessionKey: state.sessionKey,
        uploadId: state.uploadId,
      };
      const finished = new Set<number>();
      let bytes = 0;
      for (const value of state.parts) {
        if (!value || typeof value !== 'object')
          throw new Error('文件分片响应无效');
        const part = value as Record<string, unknown>;
        const number = videoInteger(
          part.partNumber,
          Math.ceil(source.fileSize / VIDEO_PART_SIZE),
        );
        const size = videoInteger(part.size, VIDEO_PART_SIZE);
        if (
          finished.has(number) ||
          size !==
            Math.min(
              VIDEO_PART_SIZE,
              source.fileSize - (number - 1) * VIDEO_PART_SIZE,
            )
        )
          throw new Error('文件分片编号或大小无效');
        finished.add(number);
        bytes += size;
      }
      const content: FileContent = {
        fileName: source.fileName,
        fileSize: source.fileSize,
        url: parseImageUrl(state.downloadUrl),
      };
      parseAuthBase(new URL(content.url).origin);
      report(state.completed ? source.fileSize : bytes, 'uploading');
      if (!state.completed) {
        const file = await openVideoFile(source.filePath);
        try {
          for (let number = 1; number <= source.partDigests.length; number++) {
            current();
            const size = Math.min(
              VIDEO_PART_SIZE,
              source.fileSize - (number - 1) * VIDEO_PART_SIZE,
            );
            const buffer = Buffer.alloc(size);
            let read = 0;
            while (read < size) {
              const result = await file.read(
                buffer,
                read,
                size - read,
                (number - 1) * VIDEO_PART_SIZE + read,
              );
              current();
              if (!result.bytesRead) throw new Error('原文件读取不完整');
              read += result.bytesRead;
            }
            if (
              createHash('sha256').update(buffer).digest('hex') !==
              source.partDigests[number - 1]
            )
              throw new Error('原文件已变化，不能继续此占位');
            if (finished.has(number)) continue;
            let uploaded = false;
            for (let attempt = 0; attempt < 3 && !uploaded; attempt++) {
              current();
              try {
                const signed = await control(
                  'part-url',
                  { ...identity, partNumber: number },
                  session,
                  current,
                  controller.signal,
                );
                const urls = parseImageUpload({
                  success: true,
                  code: 200,
                  data: {
                    uploadUrl: signed.uploadUrl,
                    downloadUrl: content.url,
                  },
                });
                const url = new URL(urls.uploadUrl);
                if (
                  url.searchParams.get('uploadId') !== identity.uploadId ||
                  url.searchParams.get('partNumber') !== String(number)
                )
                  throw new Error('文件分片签名不匹配');
                const response = await fetch(urls.uploadUrl, {
                  method: 'PUT',
                  body: buffer,
                  headers: {
                    'Content-Type': 'application/octet-stream',
                    'Content-Length': String(size),
                    'Content-MD5': createHash('md5')
                      .update(buffer)
                      .digest('base64'),
                  },
                  credentials: 'omit',
                  redirect: 'error',
                  signal: AbortSignal.any([
                    controller.signal,
                    AbortSignal.timeout(600000),
                  ]),
                });
                current();
                await response.body?.cancel();
                if (!response.ok || !response.headers.get('etag'))
                  throw new Error('分片上传未确认');
                uploaded = true;
                bytes += size;
                report(bytes, 'uploading');
              } catch (error) {
                current();
                if (error instanceof SessionExpiredError || attempt === 2)
                  throw error;
                await new Promise<void>((resolve) =>
                  setTimeout(resolve, 1000 * 2 ** attempt),
                );
              }
            }
          }
        } finally {
          await file.close();
        }
        report(source.fileSize, 'finalizing');
        const complete = await control(
          'complete',
          identity,
          session,
          current,
          controller.signal,
        );
        if (
          complete.completed !== true ||
          complete.uploadId !== identity.uploadId ||
          complete.sessionKey !== identity.sessionKey ||
          complete.downloadUrl !== content.url
        )
          throw new Error('文件合并未确认，请重试续传');
      }
      current();
      report(source.fileSize, 'finalizing');
      await files.saveUploaded(content, source, current);
      current();
      await requestCompleteFileTemporary(
        base,
        session,
        clientId,
        roomId,
        remote.id,
        clientMsgId,
        content,
      );
      current();
      if (draftId) release(roomId, draftId);
    } finally {
      if (acquired) releaseTransfer();
      if (active.get(key) === controller) active.delete(key);
    }
  };
  /** 先持久化取消意图并中止传输，再向服务端请求幂等取消。 */
  const cancel: FileDraftStore['cancel'] = async (
    roomId: string,
    clientMsgId: string,
    session: AuthSession,
    validate: () => void,
  ): Promise<Message> => {
    validate();
    const source = getFileUploadSource(roomId, clientMsgId);
    if (!source) throw new Error('本机没有此文件的发送来源');
    markFileUploadCancelled(roomId, clientMsgId);
    active.get(`${roomId}:${clientMsgId}`)?.abort();
    await requestCreateFileTemporary(
      base,
      session,
      clientId,
      roomId,
      clientMsgId,
      source,
      getVideoUploadMessage(roomId, clientMsgId)?.replyId,
    );
    validate();
    const message = await requestCancelTemporary(
      base,
      session,
      clientId,
      roomId,
      clientMsgId,
    );
    validate();
    return saveRemoteMessages([message])[0]!;
  };
  /** 页面撤销使上传失效，但保留已提交来源供下次重新授权后恢复。 */
  const clear = (roomId?: string): void => {
    if (!roomId) generation++;
    for (const [key, controller] of active)
      if (!roomId || key.startsWith(`${roomId}:`)) controller.abort();
    for (const [id, draft] of drafts)
      if (!roomId || draft.roomId === roomId) drafts.delete(id);
  };
  /** 撤回只中止该条消息的传输，不发送本人取消接口，也不删除原文件。 */
  const recall = (roomId: string, clientMsgId: string): void => {
    active.get(`${roomId}:${clientMsgId}`)?.abort();
  };
  return {
    stage,
    stageDeferred,
    prepare,
    release,
    restore,
    send,
    cancel,
    clear,
    recall,
  };
};
