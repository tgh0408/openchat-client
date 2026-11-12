import type { ImageOcrResult } from '../../../../shared/media/image/image-ocr';

export interface ImageOcrTask {
  key: string;
  scope: object;
  conversationId: string;
  messageIds: readonly string[];
  execute: (signal: AbortSignal) => Promise<ImageOcrResult>;
}

interface PendingTask {
  task: ImageOcrTask;
  controller: AbortController;
  result: Promise<ImageOcrResult | null>;
  resolve: (result: ImageOcrResult | null) => void;
  reject: (error: unknown) => void;
}

interface ImageOcrQueue {
  enqueue: (task: ImageOcrTask) => Promise<ImageOcrResult | null>;
  cancel: (matches: (task: ImageOcrTask) => boolean) => void;
}

/** 串行读取和识别图片，同一授权中的重复请求共享任务，取消以空结果结束。 */
export const createImageOcrQueue = (): ImageOcrQueue => {
  const pending = new Set<PendingTask>();
  let running = false;

  /** 失败只结束当前图片；取消中的执行完全退出后才允许下一张进入识别进程。 */
  const drain = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      for (const entry of pending) {
        try {
          entry.controller.signal.throwIfAborted();
          const result = await entry.task.execute(entry.controller.signal);
          entry.resolve(entry.controller.signal.aborted ? null : result);
        } catch (error) {
          if (entry.controller.signal.aborted) entry.resolve(null);
          else entry.reject(error);
        } finally {
          pending.delete(entry);
        }
      }
    } finally {
      running = false;
    }
  };

  /** 排队时只保留任务描述，轮到执行才读取图片，避免囤积图片字节。 */
  const enqueue = (task: ImageOcrTask): Promise<ImageOcrResult | null> => {
    const existing = [...pending].find(
      (entry) =>
        !entry.controller.signal.aborted &&
        entry.task.scope === task.scope &&
        entry.task.key === task.key,
    );
    if (existing) return existing.result;
    let resolve!: PendingTask['resolve'];
    let reject!: PendingTask['reject'];
    const result = new Promise<ImageOcrResult | null>((accept, decline) => {
      resolve = accept;
      reject = decline;
    });
    // 调用方等待同一个结果；切图只放弃显示，任务继续运行。
    pending.add({
      task,
      controller: new AbortController(),
      result,
      resolve,
      reject,
    });
    void drain();
    return result;
  };

  /** 授权撤销、消息删除或显式取消只撤销匹配任务，不影响其他图片。 */
  const cancel = (matches: (task: ImageOcrTask) => boolean): void => {
    for (const entry of pending) {
      if (!matches(entry.task)) continue;
      entry.controller.abort();
      entry.resolve(null);
      pending.delete(entry);
    }
  };

  return { enqueue, cancel };
};
