import type { SessionInvalidationReason } from './auth';
import type { ResourceSseMessage } from '../windows/desktop';

/** 只接受当前账号的专用授权失效事件，不把聊天正文或畸形通知当作退出指令。 */
export const readSessionInvalidation = (
  message: ResourceSseMessage,
  userId: string,
): SessionInvalidationReason | null => {
  if (message.event !== 'auth-invalidated') return null;
  let value: unknown;
  try {
    value = JSON.parse(message.data);
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    !('uid' in value) ||
    value.uid !== userId ||
    !('reason' in value)
  )
    return null;
  switch (value.reason) {
    case 'SESSION_REPLACED':
    case 'SESSION_EXPIRED':
      return value.reason;
    default:
      return null;
  }
};
