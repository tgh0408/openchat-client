import type {
  ImagePreviewContext,
  ImagePreviewRequest,
} from '../../../shared/windows/image-preview';
import { parseImageContent } from '../../../shared/media/image/image';
import { parseText } from '../../services/database/database-validation';
import {
  findAdjacentImageMessage,
  getHistoryContext,
  getImagePreviewMessage,
} from '../../services/database/database';

/** 验证请求只含会话与消息标识，不接收页面提供的 URL 或文件路径。 */
export const parseImagePreviewRequest = (
  value: unknown,
): ImagePreviewRequest => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('无效的图片预览请求');
  const request = value as Record<string, unknown>;
  if (
    Object.keys(request).some(
      (key) => !['conversationId', 'messageId'].includes(key),
    )
  )
    throw new Error('无效的图片预览请求');
  return {
    conversationId: parseText(request.conversationId, 64),
    messageId: parseText(request.messageId, 64),
  };
};

/** 从授权内容库读取普通图片和邻接边界，损坏图片仍可在窗口内显示失败并切换。 */
export const readImagePreview = (
  request: ImagePreviewRequest,
): ImagePreviewContext => {
  const context = getHistoryContext(request.conversationId);
  const message = getImagePreviewMessage(
    request.conversationId,
    request.messageId,
  );
  const image = parseImageContent(message.content) ?? {
    url: null,
    fileName: '图片',
    fileSize: null,
  };
  return {
    conversationTitle: context.conversationTitle,
    messageId: message.id,
    image,
    hasPrevious:
      findAdjacentImageMessage(
        request.conversationId,
        message.id,
        'previous',
      ) !== null,
    hasNext:
      findAdjacentImageMessage(request.conversationId, message.id, 'next') !==
      null,
  };
};
