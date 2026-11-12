import type { ImagePreviewRequest } from '../../windows/image-preview';

/** 拖拽只提交消息标识及附件类型，不接受页面提供的文件路径。 */
export interface MessageDragRequest extends ImagePreviewRequest {
  kind: 'image' | 'file' | 'video';
}

export interface MessageDragApi {
  /** 仅准备已有本地附件并返回短期凭据，不允许拖动触发下载。 */
  prepareMessageDrag: (request: MessageDragRequest) => Promise<string | null>;
  /** 在拖动手势中使用已准备好的附件启动系统拖拽。 */
  startMessageDrag: (ticket: string) => Promise<void>;
}
