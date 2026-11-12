import { ipcMain } from 'electron';
import type { IpcMainInvokeEvent } from 'electron';

type ChatHandler = (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown;
const handlers = new Map<string, ChatHandler>();

/** 注册原有 IPC，同时供通过会话边界校验的独立窗口复用业务处理器。 */
export const handleChatIpc = (channel: string, handler: ChatHandler): void => {
  handlers.set(channel, handler);
  ipcMain.handle(channel, handler);
};

/** 保留真实发送窗口和事件，权限由独立窗口入口及原处理器共同校验。 */
export const dispatchChatIpc = (
  channel: string,
  event: IpcMainInvokeEvent,
  args: unknown[],
): unknown => {
  const handler = handlers.get(channel);
  if (!handler) throw new Error('聊天功能尚未就绪');
  return handler(event, ...args);
};
