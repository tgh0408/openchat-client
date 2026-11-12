/** 本地启动阶段，不代表远端授权或内容库访问权限。 */
export type StartupPhase = 'settings' | 'accounts' | 'ready' | 'failed';

/** 校验启动通知，拒绝未知阶段。 */
export const isStartupPhase = (value: unknown): value is StartupPhase => {
  switch (value) {
    case 'settings':
    case 'accounts':
    case 'ready':
    case 'failed':
      return true;
    default:
      return false;
  }
};

/** 启动阶段只允许前进，防止快照响应覆盖较新的事件。 */
export const startupPhaseOrder = (phase: StartupPhase): number => {
  switch (phase) {
    case 'settings':
      return 0;
    case 'accounts':
      return 1;
    case 'ready':
      return 2;
    case 'failed':
      return 3;
  }
};
