import type { AuthSession } from '../../../shared/auth/auth';
import { parseAuthBase, SessionExpiredError } from '../../../shared/auth/auth';
import { requestConversationRead } from '../../../shared/chat/conversations/conversation-read';
import { requireAuthenticatedSession } from '../auth/auth';
import { createAuthenticatedApiClient } from '../network/api-client';
import {
  acknowledgeConversationRead,
  listPendingConversationReads,
  recordConversationRead,
  setConversationReadServer,
} from '../database/database';
import { createConversationReadQueue } from './conversation-read-queue';
import type { ConversationReadQueue } from './conversation-read-queue';

let queue: ConversationReadQueue | undefined;

/** 新授权建立唯一主进程队列；迟到结果仍绑定原会话对象。 */
export const startConversationReads = (
  session: AuthSession,
  notify: (roomId: string, unread: number) => void,
  expire: (session: AuthSession, error?: SessionExpiredError) => void,
): void => {
  stopConversationReads();
  setConversationReadServer(
    parseAuthBase(import.meta.env.VITE_AUTH_API_BASE?.trim()),
  );
  const api = createAuthenticatedApiClient((): void => {
    if (requireAuthenticatedSession() !== session)
      throw new Error('已读同步所属账号已变化');
  });
  queue = createConversationReadQueue({
    list: listPendingConversationReads,
    submit: (read): Promise<string> => requestConversationRead(api, read),
    acknowledge: (read, id): void => {
      const unread = acknowledgeConversationRead(read, id);
      if (unread !== null) notify(read.conversationId, unread);
    },
    validate: api.validateCurrent,
    report: (error): void => {
      if (error instanceof SessionExpiredError) expire(session, error);
      else console.warn('已读确认暂未完成，已保留本地进度。', error);
    },
  });
  queue.schedule();
};

/** 经 IPC 校验的实际阅读立即落库，网络提交由唯一队列合并。 */
export const stageConversationRead = (
  roomId: string,
  messageId: string,
): number => {
  if (!queue) throw new Error('已读同步尚未初始化');
  const unread = recordConversationRead(roomId, messageId);
  queue.schedule();
  return unread;
};

/** 登录、重连和正常退出可提前消费持久化待办。 */
export const flushConversationReads = async (): Promise<void> => {
  const current = queue;
  if (!current) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // 多个离线会话不能把列表初始化阻塞成逐个网络超时；队列仍在后台继续。
    await Promise.race([
      current.flush(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 3000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

/** 关闭最多等待两秒；超时后停止旧队列，剩余记录在重新授权后补交。 */
export const finishConversationReads = async (): Promise<void> => {
  const current = queue;
  if (!current) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async (): Promise<void> => {
        await current.flush();
        // 首轮可能复用在途请求，再提交一次请求期间已经持久化的新进度。
        await current.flush();
      })(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    current.stop();
    if (queue === current) queue = undefined;
  }
};

/** 授权失效不再请求网络或清除持久化待办。 */
export const stopConversationReads = (): void => {
  queue?.stop();
  queue = undefined;
  setConversationReadServer('');
};
