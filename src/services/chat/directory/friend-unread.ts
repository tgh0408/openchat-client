import type { FriendApplicationUnread } from '../../../../shared/contacts/friend-notification';

interface FriendUnreadDependencies {
  read: () => Promise<FriendApplicationUnread[]>;
  active: () => boolean;
  update: (applications: FriendApplicationUnread[]) => void;
  error: (error: unknown) => void;
}

/** 合并通知触发的查询；查询期间再收到事件时丢弃旧快照并补查一次。 */
export const createFriendUnreadSync = (
  dependencies: FriendUnreadDependencies,
): { refresh: () => Promise<void>; stop: () => void } => {
  let version = 0;
  let completedVersion = 0;
  let pending: Promise<void> | null = null;
  let stopped = false;

  /** 串行读取最新申请摘要，失败保留旧值，不把网络异常当作已读。 */
  const run = async (): Promise<void> => {
    while (!stopped && dependencies.active()) {
      const request = version;
      try {
        const count = await dependencies.read();
        if (stopped || !dependencies.active()) return;
        if (request !== version) continue;
        completedVersion = request;
        dependencies.update(count);
      } catch (error) {
        if (stopped || !dependencies.active()) return;
        if (request !== version) continue;
        completedVersion = request;
        dependencies.error(error);
      }
      return;
    }
  };

  /** 同批重复推送共享查询，只有最终权威结果可以更新角标。 */
  const refresh = (): Promise<void> => {
    if (stopped || !dependencies.active()) return Promise.resolve();
    version++;
    if (!pending)
      pending = run().finally((): void | Promise<void> => {
        pending = null;
        // Promise 完成和 finally 清理之间的微任务也可能收到通知。
        if (!stopped && dependencies.active() && completedVersion !== version)
          return refresh();
      });
    return pending;
  };

  /** 撤销当前账号任务，迟到结果与待补查事件均失效。 */
  const stop = (): void => {
    stopped = true;
    version++;
  };
  return { refresh, stop };
};
