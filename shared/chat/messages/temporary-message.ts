import { requestApi } from '../../api/api-client';
import { parseApiResult } from '../../api/api-response';
import type { AuthSession } from '../../auth/auth';
import { parseMessagePage, toHistoryMessage } from '../chat';
import type { Message } from '../../storage/database';
import {
  validateTemporaryVideo,
  validateVideo,
  videoMessageBody,
} from '../../media/video/video';
import type {
  StoredVideoContent,
  TemporaryVideoContent,
} from '../../media/video/video';
import {
  validateFileMetadata,
  validateFileContent,
} from '../../media/file/file-message';
import type { FileMetadata, FileContent } from '../../media/file/file-message';
import { parseReplyId } from './message-reply';

/** 占位接口沿用当前授权和平台 clientId，畸形响应不能被当作成功。 */
const requestTemporary = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  method: 'POST' | 'PUT',
  suffix: string,
  body: Record<string, unknown>,
): Promise<unknown> => {
  return requestApi(
    { base, session, clientId },
    {
      path: `/capi/chat/msg/temporary${suffix}`,
      method,
      body,
      timeoutMs: 15000,
      serviceName: '视频占位',
      parse: (value: unknown): unknown => {
        const result = parseApiResult(value, '视频占位');
        if (!('data' in result)) throw new Error('视频占位请求失败');
        return result.data;
      },
    },
  );
};

/** 单条响应复用历史协议校验，不信任 HTTP 返回的账号或会话。 */
const parseMessages = (data: unknown[], roomId: string): Message[] => {
  const page = parseMessagePage({
    success: true,
    code: 200,
    data: { list: data, isFirst: true, isLast: true, cursor: null },
  });
  return page.list.map((remote): Message => {
    const message = toHistoryMessage(remote);
    if (
      !message ||
      message.conversationId !== roomId ||
      !['temporary', 'video', 'file', 'upload-cancelled', 'recalled'].includes(
        message.messageType,
      )
    )
      throw new Error('视频占位响应无效');
    return message;
  });
};

/** 文件沿用占位接口，类型明确为 6，不附带视频封面字段。 */
export const requestCreateFileTemporary = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  roomId: string,
  clientMsgId: string,
  content: FileMetadata,
  replyId?: string | null,
): Promise<Message> => {
  const metadata = validateFileMetadata(content);
  const data = await requestTemporary(base, session, clientId, 'POST', '', {
    roomId,
    clientMsgId,
    msgType: 3,
    replyId: parseReplyId(replyId),
    body: {
      targetType: 6,
      fileName: metadata.fileName,
      fileSize: String(metadata.fileSize),
    },
  });
  const message = parseMessages([data], roomId)[0]!;
  if (
    message.senderId !== session.user.id ||
    message.clientMsgId !== clientMsgId
  )
    throw new Error('文件占位身份不匹配');
  return message;
};

/** 文件完成与视频字段分离，仍由最终 SSE 确认送达。 */
export const requestCompleteFileTemporary = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  roomId: string,
  msgId: string,
  clientMsgId: string,
  content: FileContent,
): Promise<void> => {
  const file = validateFileContent(content);
  await requestTemporary(base, session, clientId, 'PUT', '', {
    roomId,
    msgId,
    clientMsgId,
    fileBody: {
      content: file.url,
      uploadAddress: file.url,
      fileName: file.fileName,
      fileSize: String(file.fileSize),
    },
  });
};

/** 幂等创建占位，HTTP 返回真实 ID，送达仍依赖后续 SSE。 */
export const requestCreateTemporary = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  roomId: string,
  clientMsgId: string,
  content: TemporaryVideoContent,
  replyId?: string | null,
): Promise<Message> => {
  const metadata = validateTemporaryVideo(content);
  const data = await requestTemporary(base, session, clientId, 'POST', '', {
    roomId,
    clientMsgId,
    msgType: 3,
    replyId: parseReplyId(replyId),
    body: {
      ...metadata,
      targetType: 5,
      fileSize: String(metadata.fileSize),
      duration: String(metadata.duration),
    },
  });
  const message = parseMessages([data], roomId)[0]!;
  if (
    message.senderId !== session.user.id ||
    message.clientMsgId !== clientMsgId
  )
    throw new Error('视频占位身份不匹配');
  return message;
};

/** 服务端取消终态回执可立即展示；最终完成已先提交时不得伪造取消成功。 */
export const requestCancelTemporary = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  roomId: string,
  clientMsgId: string,
): Promise<Message> => {
  const data = await requestTemporary(
    base,
    session,
    clientId,
    'POST',
    '/cancel',
    { roomId, clientMsgId },
  );
  const message = parseMessages([data], roomId)[0]!;
  if (
    message.senderId !== session.user.id ||
    message.clientMsgId !== clientMsgId ||
    message.messageType !== 'upload-cancelled'
  )
    throw new Error('取消发送响应无效');
  return message;
};
/** 上传完成只请求替换原消息，空成功响应不表示 SSE 已确认。 */
export const requestCompleteTemporary = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  roomId: string,
  msgId: string,
  clientMsgId: string,
  video: StoredVideoContent,
): Promise<void> => {
  await requestTemporary(base, session, clientId, 'PUT', '', {
    roomId,
    msgId,
    clientMsgId,
    body: videoMessageBody(JSON.stringify(validateVideo(video))),
  });
};

/** 重连只刷新已缓存占位，不改变历史游标或已读位置。 */
export const requestTemporaryState = async (
  base: string | undefined,
  session: AuthSession,
  clientId: string,
  roomId: string,
  msgIds: string[],
): Promise<Message[]> => {
  const data = await requestTemporary(
    base,
    session,
    clientId,
    'POST',
    '/state',
    { roomId, msgIds },
  );
  if (!Array.isArray(data) || data.length > msgIds.length)
    throw new Error('视频占位状态响应无效');
  const messages = parseMessages(data, roomId);
  if (messages.some((message) => !msgIds.includes(message.id)))
    throw new Error('视频占位标识不匹配');
  return messages;
};
