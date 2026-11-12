import type { ImagePreviewRequest } from '../../windows/image-preview';

/** 复制附件只接受消息标识，原文件路径与名称由主进程读取。 */
export interface MessageCopyRequest extends ImagePreviewRequest {
  kind: 'image' | 'file' | 'video';
}

export interface MessageCopyApi {
  copyMessageAttachment: (request: MessageCopyRequest) => Promise<void>;
}
