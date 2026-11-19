import type { StartupPhase } from '../../../shared/runtime/startup';

interface StartupTasks {
  readSettings: () => Promise<void>;
  restoreAccounts: () => Promise<void>;
  registerServices: () => void;
  notify: (phase: StartupPhase) => void;
}

/** 首屏绘制后执行一次本地初始化，退出后不再注册业务接口或发布就绪。 */
export const createStartupController = (
  tasks: StartupTasks,
): {
  phase: () => StartupPhase;
  start: () => Promise<void>;
  stop: () => void;
} => {
  let phase: StartupPhase = 'settings';
  let pending: Promise<void> | undefined;
  let stopped = false;

  /** 只发布已实际到达的初始化阶段。 */
  const publish = (next: StartupPhase): void => {
    phase = next;
    tasks.notify(next);
  };

  /** 每个异步阶段结束后重新检查关闭状态，避免迟到恢复使应用重新就绪。 */
  const initialize = async (): Promise<void> => {
    try {
      if (stopped) return;
      await tasks.readSettings();
      if (stopped) return;
      publish('accounts');
      await tasks.restoreAccounts();
      if (stopped) return;
      tasks.registerServices();
      publish('ready');
    } catch (error) {
      if (stopped) return;
      publish('failed');
      throw error;
    }
  };

  return {
    phase: (): StartupPhase => phase,
    start: (): Promise<void> => (pending ??= initialize()),
    stop: (): void => {
      stopped = true;
    },
  };
};
