import type { SelectedImageDraft } from './image/image';
import type { SelectedVideoDraft } from './video/video';
import type { SelectedFileDraft } from './file/file-message';

/** 主进程返回已校验的媒体草稿，不向页面暴露原生路径。 */
export interface MediaDraftSelection {
  images: SelectedImageDraft[];
  videos: SelectedVideoDraft[];
  files: SelectedFileDraft[];
}

/** preload 将图片和视频拖入结果绑定到最初放下文件的会话。 */
export interface MediaDropResult extends MediaDraftSelection {
  roomId: string;
  error: string | null;
  pending: boolean;
}
