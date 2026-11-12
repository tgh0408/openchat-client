import type { ImageOcrResult } from '../media/image/image-ocr';
import type { StoredImageContent, LocalImageData } from '../media/image/image';

/** 预览只接受消息标识，图片地址由主进程从当前内容库读取。 */
export interface ImagePreviewRequest {
  conversationId: string;
  messageId: string;
}

/** 独立窗口绑定的消息或临时图片及相邻缓存边界，不传递账号凭据。 */
export interface ImagePreviewContext {
  conversationTitle: string;
  messageId: string;
  image: StoredImageContent;
  hasPrevious: boolean;
  hasNext: boolean;
}

export interface ImagePreviewWindowState {
  pinned: boolean;
  maximized: boolean;
  fullscreen: boolean;
}

export type ImagePreviewWindowAction =
  'minimize' | 'maximize' | 'pin' | 'fullscreen' | 'close';

/** 预览窗口只能读取绑定会话、切换相邻图片和控制自身窗口。 */
export interface ImagePreviewApi {
  isRecognitionAvailable: () => Promise<boolean>;
  recognizeText: (
    messageId: string,
    jobId: string,
  ) => Promise<ImageOcrResult | null>;
  cancelRecognition: (jobId: string) => Promise<void>;
  readImage: (messageId: string) => Promise<LocalImageData>;
  getContext: () => Promise<ImagePreviewContext>;
  navigate: (direction: 'previous' | 'next') => Promise<ImagePreviewContext>;
  control: (
    action: ImagePreviewWindowAction,
  ) => Promise<ImagePreviewWindowState>;
  getWindowState: () => Promise<ImagePreviewWindowState>;
  onChanged: (callback: () => void) => () => void;
  onWindowState: (
    callback: (state: ImagePreviewWindowState) => void,
  ) => () => void;
}
