import type { Message } from '../../../../shared/storage/database';
import { parseUploadPlaceholder } from '../../../../shared/chat/messages/upload-placeholder';
import {
  copyVideoMetadata,
  parseVideoContent,
  validateTemporaryVideo,
} from '../../../../shared/media/video/video';
import { getRequestErrorMessage } from '../../../../shared/api/api-error';
import type {
  ComposerVideoDraft,
  StoredVideoContent,
  TemporaryVideoContent,
  VideoMetadata,
  VideoUploadProgress,
} from '../../../../shared/media/video/video';

export interface VideoSendView {
  phase:
    | 'queued'
    | 'validating'
    | 'uploading'
    | 'finalizing'
    | 'confirming'
    | 'canceling'
    | 'cancel-failed'
    | 'cancelled'
    | 'failed';
  uploadedBytes: number;
  totalBytes: number;
  posterUrl: string;
  error: string;
}

interface VideoTask extends VideoSendView {
  message: Message;
  draft: ComposerVideoDraft;
  uploaded?: StoredVideoContent;
  attempt: number;
  timer?: ReturnType<typeof setTimeout>;
  cancelRequested: boolean;
  ownsDraft: boolean;
  resending: boolean;
}

interface OutboxDependencies {
  active: () => boolean;
  save: (message: Message) => Promise<void>;
  persist: (
    roomId: string,
    id: string,
    clientMsgId: string,
    metadata: VideoMetadata,
  ) => Promise<void>;
  show: (message: Message) => void;
  changed: () => void;
  create: (
    roomId: string,
    clientMsgId: string,
    content: TemporaryVideoContent,
  ) => Promise<Message>;
  upload: (
    roomId: string,
    id: string,
    metadata: VideoMetadata,
  ) => Promise<StoredVideoContent>;
  complete: (
    roomId: string,
    msgId: string,
    clientMsgId: string,
    content: StoredVideoContent,
  ) => Promise<void>;
  release: (
    roomId: string,
    draft: ComposerVideoDraft,
    keepNative?: boolean,
  ) => void;
  stop: (roomId: string, id: string) => Promise<void>;
  cancel: (roomId: string, clientMsgId: string) => Promise<Message>;
  confirmationTimeout?: number;
}

export interface VideoOutbox {
  enqueue: (message: Message, draft: ComposerVideoDraft) => Promise<void>;
  progress: (value: VideoUploadProgress) => void;
  acknowledge: (message: Message) => void;
  retry: (clientMsgId: string) => boolean;
  cancel: (message: Message) => Promise<void>;
  resend: (message: Message) => Promise<boolean>;
  clear: (roomId?: string) => void;
  snapshot: () => Record<string, VideoSendView>;
}

/** 占位立即提交，视频串行上传；队列不占用输入框，完成只由最终消息确认。 */
export const createVideoOutbox = (
  dependencies: OutboxDependencies,
): VideoOutbox => {
  const tasks = new Map<string, VideoTask>();
  let tail = Promise.resolve();
  let generation = 0;

  /** 已取消记录最多保留三个封面，移交过的句柄不会被旧记录释放。 */
  const trimCancelled = (): void => {
    const cancelled = [...tasks.values()].filter(
      (task) => task.phase === 'cancelled',
    );
    for (const task of cancelled.slice(0, -3)) {
      tasks.delete(task.message.clientMsgId!);
      dependencies.release(
        task.message.conversationId,
        task.draft,
        !task.ownsDraft,
      );
    }
  };

  /** 每次异步返回都重新检查原任务与账号，取消后不可保存或继续发送。 */
  const valid = (task: VideoTask, attempt: number): boolean =>
    dependencies.active() &&
    tasks.get(task.message.clientMsgId!) === task &&
    task.attempt === attempt;

  /** 通知界面发送失败，保留同一任务与已上传数据供重试。 */
  const fail = (task: VideoTask, attempt: number, error: unknown): void => {
    if (!valid(task, attempt)) return;
    clearTimeout(task.timer);
    task.phase = 'failed';
    task.error = getRequestErrorMessage(error, '视频发送失败，请重试');
    dependencies.changed();
  };

  /** 同一任务只上传一次，重复完成请求仍等待最终 SSE，绝不把占位回执当作视频完成。 */
  const start = (task: VideoTask): void => {
    const attempt = ++task.attempt;
    clearTimeout(task.timer);
    task.phase = 'queued';
    task.error = '';
    dependencies.changed();
    /** 占位请求独立于上传队列，后续视频也能立即出现在接收方。 */
    const prepare = async (): Promise<boolean> => {
      try {
        const placeholder = parseUploadPlaceholder(task.message.content);
        const metadata =
          (placeholder?.targetType === 5
            ? validateTemporaryVideo({
                fileName: placeholder.fileName,
                fileSize: placeholder.fileSize,
                duration: placeholder.duration,
                thumbWidth: placeholder.thumbWidth,
                thumbHeight: placeholder.thumbHeight,
              })
            : null) ??
          validateTemporaryVideo({
            fileName: task.draft.fileName,
            fileSize: task.draft.fileSize,
            duration: task.draft.metadata.duration,
            thumbWidth: task.draft.metadata.thumbWidth,
            thumbHeight: task.draft.metadata.thumbHeight,
          });
        const remote = await dependencies.create(
          task.message.conversationId,
          task.message.clientMsgId!,
          metadata,
        );
        if (!valid(task, attempt)) return false;
        task.message = remote;
        if (['upload-cancelled', 'recalled'].includes(remote.messageType)) {
          dependencies.show(remote);
          acknowledge(remote);
          return false;
        }
        task.uploaded ??= parseVideoContent(remote.content) ?? undefined;
        dependencies.show(remote);
        return true;
      } catch (error) {
        fail(task, attempt, error);
        return false;
      }
    };
    const preparation = prepare();
    tail = tail
      .then(async (): Promise<void> => {
        if (!(await preparation) || !valid(task, attempt)) return;
        try {
          if (!task.uploaded) {
            task.phase = 'validating';
            dependencies.changed();
            const uploaded = await dependencies.upload(
              task.message.conversationId,
              task.draft.id,
              copyVideoMetadata(task.draft.metadata),
            );
            if (!valid(task, attempt)) return;
            task.uploaded = uploaded;
          }
          task.uploadedBytes = task.totalBytes;
          task.phase = 'confirming';
          dependencies.changed();
          task.timer = setTimeout(() => {
            fail(
              task,
              attempt,
              new Error('视频已上传，消息确认超时，点击重试'),
            );
          }, dependencies.confirmationTimeout ?? 10000);
          await dependencies.complete(
            task.message.conversationId,
            task.message.id,
            task.message.clientMsgId!,
            task.uploaded,
          );
        } catch (error) {
          fail(task, attempt, error);
        }
      })
      .catch((error: unknown): void => {
        fail(task, attempt, error);
      });
  };

  /** 本地待发送卡片先落库，返回后输入区即可移除草稿并继续输入。 */
  const enqueue = async (
    message: Message,
    draft: ComposerVideoDraft,
  ): Promise<void> => {
    const current = generation;
    if (
      !dependencies.active() ||
      !message.clientMsgId ||
      tasks.has(message.clientMsgId)
    )
      throw new Error('视频任务已存在或账号不可用');
    await dependencies.save(message);
    if (!dependencies.active() || current !== generation)
      throw new Error('视频所属账号或会话已变化');
    await dependencies.persist(
      message.conversationId,
      draft.id,
      message.clientMsgId,
      copyVideoMetadata(draft.metadata),
    );
    if (!dependencies.active() || current !== generation)
      throw new Error('视频所属账号或会话已变化');
    const task: VideoTask = {
      message,
      draft,
      phase: 'queued',
      uploadedBytes: 0,
      totalBytes: draft.fileSize,
      posterUrl: draft.posterUrl,
      error: '',
      attempt: 0,
      cancelRequested: false,
      ownsDraft: true,
      resending: false,
    };
    tasks.set(message.clientMsgId, task);
    dependencies.show(message);
    start(task);
  };

  /** 进度按原生句柄匹配，排队或失败任务不会被迟到计量覆盖。 */
  const progress = (value: VideoUploadProgress): void => {
    for (const task of tasks.values()) {
      if (
        task.draft.id === value.draftId &&
        task.message.conversationId === value.roomId &&
        task.totalBytes === value.totalBytes &&
        ['validating', 'uploading', 'finalizing'].includes(task.phase)
      ) {
        task.uploadedBytes = value.uploadedBytes;
        task.phase = value.phase;
        dependencies.changed();
        return;
      }
    }
  };

  /** 最终视频到达才释放发送状态；占位 SSE 只更新服务端消息标识。 */
  const acknowledge = (message: Message): void => {
    const task = message.clientMsgId
      ? tasks.get(message.clientMsgId)
      : undefined;
    if (
      !task ||
      message.conversationId !== task.message.conversationId ||
      message.senderId !== task.message.senderId ||
      message.status !== 'sent'
    )
      return;
    if (message.messageType === 'recalled') {
      clearTimeout(task.timer);
      task.attempt++;
      tasks.delete(message.clientMsgId!);
      void dependencies
        .stop(message.conversationId, task.draft.id)
        .catch(() => {});
      dependencies.release(message.conversationId, task.draft, !task.ownsDraft);
      dependencies.changed();
      return;
    }
    if (task.phase === 'cancelled') return;
    if (message.messageType === 'temporary') {
      task.message = message;
    } else if (
      message.messageType === 'video' ||
      message.messageType === 'upload-cancelled'
    ) {
      clearTimeout(task.timer);
      if (message.messageType === 'upload-cancelled') {
        task.attempt++;
        task.message = message;
        task.phase = 'cancelled';
        task.cancelRequested = true;
        task.error = '';
        void dependencies
          .stop(message.conversationId, task.draft.id)
          .catch(() => {});
        trimCancelled();
      } else {
        tasks.delete(message.clientMsgId!);
        dependencies.release(
          message.conversationId,
          task.draft,
          !task.ownsDraft,
        );
      }
      dependencies.changed();
    }
  };

  /** 失败时沿用 clientMsgId、占位 ID 和已上传分片，不产生第二条占位。 */
  const retry = (clientMsgId: string): boolean => {
    const task = tasks.get(clientMsgId);
    if (!task) return false;
    if (task.cancelRequested) {
      if (task.phase === 'cancel-failed')
        void cancel(task.message).catch(() => {});
      return true;
    }
    if (task.phase === 'failed' && dependencies.active()) start(task);
    return true;
  };

  /** 先停止原生上传，再幂等创建/定位占位并取消；取消失败只能重试取消，不能继续发送。 */
  const cancel = async (message: Message): Promise<void> => {
    if (!dependencies.active() || !message.clientMsgId)
      throw new Error('当前账号无法取消发送');
    const task = tasks.get(message.clientMsgId);
    if (task?.phase === 'canceling') return;
    const current = generation;
    const attempt = task ? ++task.attempt : 0;
    if (task) {
      task.cancelRequested = true;
      clearTimeout(task.timer);
      task.phase = 'canceling';
      task.error = '';
      dependencies.changed();
    }
    /** 取消过程同样不能跨账号、页面或会话删除继续提交。 */
    const currentTask = (): boolean =>
      dependencies.active() &&
      current === generation &&
      (!task || valid(task, attempt));
    try {
      if (task) await dependencies.stop(message.conversationId, task.draft.id);
      if (!currentTask()) return;
      const placeholder = parseUploadPlaceholder(message.content);
      if (!placeholder || placeholder.cancelled)
        throw new Error('该消息不能取消上传');
      // 创建请求可能超时但服务端已落库，复用 clientMsgId 取得或建立同一取消目标。
      if (placeholder.targetType === 5) {
        const remote = await dependencies.create(
          message.conversationId,
          message.clientMsgId,
          validateTemporaryVideo({
            fileName: placeholder.fileName,
            fileSize: placeholder.fileSize,
            duration: placeholder.duration,
            thumbWidth: placeholder.thumbWidth,
            thumbHeight: placeholder.thumbHeight,
          }),
        );
        if (!currentTask()) return;
        if (
          remote.messageType === 'video' ||
          remote.messageType === 'upload-cancelled'
        ) {
          dependencies.show(remote);
          acknowledge(remote);
          if (remote.messageType === 'video')
            throw new Error('视频已发送完成，无法取消上传');
          return;
        }
      }
      const cancelled = await dependencies.cancel(
        message.conversationId,
        message.clientMsgId,
      );
      if (!currentTask()) return;
      dependencies.show(cancelled);
      acknowledge(cancelled);
    } catch (error) {
      if (task && currentTask()) {
        task.phase = 'cancel-failed';
        task.error = getRequestErrorMessage(error, '取消未确认，请重试取消');
        dependencies.changed();
      }
      throw error;
    }
  };

  /** 取消后以新 clientMsgId 发送，旧终态与封面保留，不复活服务端原消息。 */
  const resend = async (message: Message): Promise<boolean> => {
    const task = message.clientMsgId
      ? tasks.get(message.clientMsgId)
      : undefined;
    if (!task || task.phase !== 'cancelled') return false;
    if (task.resending || !dependencies.active()) return true;
    if (!task.ownsDraft) return false;
    task.resending = true;
    const current = generation;
    const id = crypto.randomUUID();
    const draft = {
      ...task.draft,
      posterUrl: URL.createObjectURL(
        new Blob([new Uint8Array(task.draft.metadata.poster)], {
          type: 'image/jpeg',
        }),
      ),
    };
    task.ownsDraft = false;
    try {
      const content = validateTemporaryVideo({
        fileName: draft.fileName,
        fileSize: draft.fileSize,
        duration: draft.metadata.duration,
        thumbWidth: draft.metadata.thumbWidth,
        thumbHeight: draft.metadata.thumbHeight,
      });
      await enqueue(
        {
          ...message,
          id,
          clientMsgId: id,
          messageType: 'temporary',
          content: JSON.stringify(content),
          status: 'pending',
          createdAt: new Date().toISOString(),
          editedAt: null,
          deletedAt: null,
        },
        draft,
      );
      return true;
    } catch (error) {
      if (current === generation && tasks.get(message.clientMsgId!) === task)
        task.ownsDraft = true;
      dependencies.release(message.conversationId, draft, task.ownsDraft);
      throw error;
    } finally {
      task.resending = false;
    }
  };

  /** 退出或删除会话撤销任务与预览，迟到结果不能复活任务。 */
  const clear = (roomId?: string): void => {
    generation++;
    for (const [id, task] of tasks) {
      if (roomId && task.message.conversationId !== roomId) continue;
      tasks.delete(id);
      clearTimeout(task.timer);
      dependencies.release(
        task.message.conversationId,
        task.draft,
        !task.ownsDraft,
      );
    }
    dependencies.changed();
  };

  /** 只向视图暴露计量和本页面 Blob，不暴露主进程路径或上传凭据。 */
  const snapshot = (): Record<string, VideoSendView> =>
    Object.fromEntries(
      [...tasks].map(([id, task]) => [
        id,
        {
          phase: task.phase,
          uploadedBytes: task.uploadedBytes,
          totalBytes: task.totalBytes,
          posterUrl: task.posterUrl,
          error: task.error,
        },
      ]),
    );

  return {
    enqueue,
    progress,
    acknowledge,
    retry,
    cancel,
    resend,
    clear,
    snapshot,
  };
};
