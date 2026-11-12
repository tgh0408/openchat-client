import type { Message } from '../../../../shared/storage/database';
import { parseGroupInvitationMessage } from '../../../../shared/chat/messages/system-message';

interface IncomingMessageDependencies {
  context: () => object | null;
  hasConversation: (roomId: string) => boolean;
  synchronize: (roomId: string | null, validate: () => void) => Promise<void>;
  save: (message: Message, synchronized: boolean) => Promise<boolean>;
  onGroupInvitation?: (roomId: string) => void;
}

/** 新会话先同步再收消息；同一页面并发到达的消息共用同步，不伪造会话或已读状态。 */
export const createIncomingMessageReceiver = (
  dependencies: IncomingMessageDependencies,
): {
  receive: (message: Message) => Promise<boolean>;
  synchronize: (refreshAfterPending?: boolean) => Promise<void>;
} => {
  const pending = new Map<
    string,
    { context: object; promise: Promise<void> }
  >();

  /** 捕获本次页面授权，账号切换、失效或卸载后拒绝继续处理。 */
  const requireContext = (): object => {
    const context = dependencies.context();
    if (!context) throw new Error('页面或登录状态已失效');
    return context;
  };

  /** 每个异步步骤后复核原上下文，不将旧结果应用到新账号。 */
  const validateContext = (context: object): void => {
    if (dependencies.context() !== context)
      throw new Error('页面或登录状态已变化');
  };

  /** 合并审批回调和新会话消息触发的同步，失败后允许下一次重新请求。 */
  const synchronizeRoom = async (
    roomId: string | null,
    refreshAfterPending: boolean = false,
  ): Promise<void> => {
    const context = requireContext();
    const key = roomId ?? '';
    const current = pending.get(key);
    if (current?.context === context) {
      await current.promise;
      validateContext(context);
      // 重连时原查询可能仍在进行；等待旧查询后合并一次新的读取。
      if (refreshAfterPending) await synchronizeRoom(roomId);
      return;
    }
    const promise = dependencies.synchronize(roomId, (): void =>
      validateContext(context),
    );
    const request = { context, promise };
    pending.set(key, request);
    try {
      await promise;
      validateContext(context);
    } finally {
      if (pending.get(key) === request) pending.delete(key);
    }
  };

  /** 鍏ㄩ儴鍚屾杩滅浼氳瘽锛岀敤浜庨噸杩炲拰鐩綍鍒锋柊。*/
  const synchronize = async (
    refreshAfterPending: boolean = false,
  ): Promise<void> => {
    await synchronizeRoom(null, refreshAfterPending);
  };

  /** 缺失会话只用真实列表补齐；同步未返回目标时不尝试违反外键的写入。 */
  const receive = async (message: Message): Promise<boolean> => {
    const context = requireContext();
    const synchronized = !dependencies.hasConversation(message.conversationId);
    if (synchronized) await synchronizeRoom(message.conversationId);
    validateContext(context);
    if (!dependencies.hasConversation(message.conversationId))
      throw new Error('消息所属会话尚未同步，请从通讯录打开聊天重试');
    const saved = await dependencies.save(message, synchronized);
    validateContext(context);
    if (
      saved &&
      !message.deletedAt &&
      message.messageType === 'system' &&
      parseGroupInvitationMessage(message.content)
    )
      dependencies.onGroupInvitation?.(message.conversationId);
    return saved;
  };

  return { receive, synchronize };
};
