import type { PendingConversationRead } from '../../../shared/chat/conversations/conversation-read';

export interface ConversationReadQueue {
  schedule: () => void;
  flush: () => Promise<void>;
  stop: () => void;
}

/** 固定窗口合并已读；待办由数据库持有，定时器和在途请求不是可靠性依据。 */
export const createConversationReadQueue = (dependencies: {
  list: (after: string) => PendingConversationRead[];
  submit: (read: PendingConversationRead) => Promise<string>;
  acknowledge: (read: PendingConversationRead, id: string) => void;
  validate: () => void;
  report: (error: unknown) => void;
}): ConversationReadQueue => {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> | undefined;
  let retryDelay = 1000;

  /** 首条进度开启一秒窗口，后续进度不推迟截止时间。 */
  const schedule = (): void => {
    if (stopped || timer || running) return;
    timer = setTimeout((): void => {
      timer = undefined;
      void flush();
    }, retryDelay);
  };

  /** 一轮按稳定会话游标扫描，每个会话只提交取出时的最新水位。 */
  const consume = async (): Promise<void> => {
    let after = '';
    let failed = false;
    try {
      while (!stopped) {
        dependencies.validate();
        const reads = dependencies.list(after);
        if (!reads.length) break;
        for (const read of reads) {
          if (stopped) return;
          dependencies.validate();
          after = read.conversationId;
          try {
            const id = await dependencies.submit(read);
            if (stopped) return;
            dependencies.validate();
            dependencies.acknowledge(read, id);
          } catch (error) {
            failed = true;
            if (!stopped) dependencies.report(error);
          }
        }
      }
    } catch (error) {
      failed = true;
      if (!stopped) dependencies.report(error);
    }
    retryDelay = failed
      ? Math.min(Math.max(retryDelay * 2, 5000), 30000)
      : 1000;
  };

  /** 手动刷新合并在途请求；请求期间新增进度仍留待下一轮，不无限阻塞关闭。 */
  const flush = async (): Promise<void> => {
    if (stopped) return;
    clearTimeout(timer);
    timer = undefined;
    if (running) return running;
    const operation = consume();
    running = operation;
    try {
      await operation;
    } finally {
      if (running === operation) running = undefined;
      if (!stopped) {
        try {
          dependencies.validate();
          if (dependencies.list('').length) schedule();
        } catch (error) {
          dependencies.report(error);
        }
      }
    }
  };

  /** 撤销旧授权的定时器与落库资格，未确认记录继续留在原账号库。 */
  const stop = (): void => {
    stopped = true;
    clearTimeout(timer);
    timer = undefined;
  };
  return { schedule, flush, stop };
};
