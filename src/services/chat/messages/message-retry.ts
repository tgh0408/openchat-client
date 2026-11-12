import type {
  Message,
  MessagePosition,
} from '../../../../shared/storage/database';

interface RetryDependencies {
  active: () => boolean;
  list: (after: MessagePosition | null) => Promise<Message[]>;
  retry: (message: Message) => Promise<void>;
  report: (error: unknown) => void;
}

export interface MessageRetryQueue {
  run: (message: Message, action: () => Promise<void>) => Promise<void>;
  connection: (connected: boolean) => Promise<void>;
  acknowledge: (message: Message) => void;
  clear: () => void;
}

/** 每次 SSE 恢复只重试一轮；手动发送与自动重试共用单消息并发保护。 */
export const createMessageRetryQueue = (
  dependencies: RetryDependencies,
): MessageRetryQueue => {
  const running = new Map<string, Promise<void>>();
  const attempts = new Map<string, number>();
  let connected = false;
  let generation = 0;
  let stopped = false;
  let requested = false;
  let scanning: Promise<void> | undefined;

  /** clientMsgId 只在原账号会话和发送者范围内关联。 */
  const keyOf = (message: Message): string =>
    JSON.stringify([
      message.conversationId,
      message.senderId,
      message.clientMsgId ?? message.id,
    ]);

  /** 旧连接、退出或授权失效后不能继续遍历和发送。 */
  const valid = (version: number): boolean =>
    !stopped && connected && generation === version && dependencies.active();

  /** 以稳定游标分批读取，失败留待下次重连，不形成持续重试循环。 */
  const scan = async (): Promise<void> => {
    while (requested && !stopped && connected && dependencies.active()) {
      requested = false;
      const version = generation;
      let after: MessagePosition | null = null;
      try {
        while (valid(version)) {
          const page = await dependencies.list(after);
          if (!valid(version) || !page.length) break;
          for (const message of page) {
            if (!valid(version)) break;
            const key = keyOf(message);
            if (running.has(key) || attempts.get(key) === version) continue;
            attempts.set(key, version);
            try {
              await dependencies.retry(message);
            } catch (error) {
              if (valid(version)) dependencies.report(error);
            }
          }
          const last = page[page.length - 1]!;
          after = { createdAt: last.createdAt, id: last.id };
        }
      } catch (error) {
        if (valid(version)) dependencies.report(error);
      }
    }
  };

  /** 合并重复扫描请求，连接快速抖动时旧扫描结束后处理最新一轮。 */
  const requestScan = (): Promise<void> => {
    requested = true;
    if (!scanning) {
      scanning = Promise.resolve()
        .then(scan)
        .finally(() => {
          scanning = undefined;
          if (requested && !stopped && connected && dependencies.active())
            void requestScan();
        });
    }
    return scanning;
  };

  /** 同一消息的 HTTP 请求未结束时，不因超时或重连再并发提交。 */
  const run = (
    message: Message,
    action: () => Promise<void>,
  ): Promise<void> => {
    if (stopped || !dependencies.active()) return Promise.resolve();
    const key = keyOf(message);
    const existing = running.get(key);
    if (existing) return existing;
    const version = generation;
    attempts.set(key, version);
    const promise = Promise.resolve()
      .then(async (): Promise<void> => {
        if (!stopped && dependencies.active()) await action();
      })
      .finally(() => {
        if (running.get(key) === promise) running.delete(key);
        // 旧请求在重连后才失败时，补扫一次，避免错过本轮恢复。
        if (!stopped && connected && generation > version) void requestScan();
      });
    running.set(key, promise);
    return promise;
  };

  /** 仅由 SSE 真实连接状态推进轮次，重复 connected 通知不会重复重试。 */
  const connection = (value: boolean): Promise<void> => {
    if (stopped || connected === value) return scanning ?? Promise.resolve();
    connected = value;
    if (!value) {
      requested = false;
      return Promise.resolve();
    }
    generation++;
    return requestScan();
  };

  /** 已确认消息不再占用轮次记录，但仍等待原 HTTP 结束以保持并发保护。 */
  const acknowledge = (message: Message): void => {
    attempts.delete(keyOf(message));
  };

  /** 页面退出后废弃全部迟到任务，不接管下个账号。 */
  const clear = (): void => {
    stopped = true;
    connected = false;
    requested = false;
    attempts.clear();
    running.clear();
  };

  return { run, connection, acknowledge, clear };
};
