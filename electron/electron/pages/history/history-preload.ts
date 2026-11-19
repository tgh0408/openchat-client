import { invokeIpc } from '../../services/ipc/invoke';
import { exposeContextMenuHost } from '../../services/ipc/context-menu-bridge';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  HistoryWindowApi,
  HistoryWindowContext,
} from '../../../shared/windows/desktop';
import type {
  Contact,
  HistoryQuery,
  Message,
} from '../../../shared/storage/database';
import type { ImagePreviewRequest } from '../../../shared/windows/image-preview';
import type { LocalImageData } from '../../../shared/media/image/image';
import type { LocalVideoUpload } from '../../../shared/media/video/video';
import type { RtcMediaMode } from '../../../shared/rtc/rtc';
import type { FileAvailability } from '../../../shared/media/file/file-message';

/** 读取主进程为当前窗口绑定的会话，不通过 URL 传递用户资料。 */
const getContext = async (): Promise<HistoryWindowContext> => {
  return invokeIpc('history:context');
};

/** 只查询当前窗口绑定的会话历史，主进程再次校验所有筛选参数。 */
const searchMessages = async (query: HistoryQuery): Promise<Message[]> => {
  return invokeIpc('history:search', query);
};

/** 最小化当前历史窗口，不影响主窗口。 */
const minimize = async (): Promise<void> => {
  await invokeIpc('history:minimize');
};

/** 关闭当前历史窗口，不退出应用。 */
const close = async (): Promise<void> => {
  await invokeIpc('history:close');
};

/** 请求主聊天窗口按历史记录的媒体类型发起回拨。 */
const requestRtcCall = async (mediaMode: RtcMediaMode): Promise<void> => {
  await invokeIpc('history:rtc-call-request', mediaMode);
};

/** 仅为当前历史会话请求图片窗口，主进程再次验证会话与消息。 */
const openImagePreview = async (
  request: ImagePreviewRequest,
): Promise<void> => {
  await invokeIpc('image-preview:open', request);
};

/** 只读取历史窗口绑定会话的图片，主进程会再次校验消息归属。 */
const readMessageImage = async (
  request: ImagePreviewRequest,
): Promise<LocalImageData> => invokeIpc('image:read-message', request);

/** 请求主进程定位当前历史图片的本地文件。*/
const showImageInFolder = async (
  request: ImagePreviewRequest,
): Promise<void> => {
  await invokeIpc('history:show-image-in-folder', request);
};

/** 按绑定会话的消息标识读取发送者公开资料。 */
const getMessageContact = async (
  messageId: string,
  force: boolean = false,
): Promise<Contact | null> =>
  invokeIpc('history:message-contact', messageId, force);

/** 查询历史会话的视频缓存，不触发下载。 */
const videoStatus = async (request: ImagePreviewRequest): Promise<boolean> =>
  invokeIpc('video:status', request);
/** 读取绑定会话的视频封面，不请求视频正文。 */
const readVideoPoster = async (
  request: ImagePreviewRequest,
): Promise<LocalImageData> => invokeIpc('video:poster', request);
/** 定位绑定历史会话的视频，主进程重新校验窗口和消息归属。 */
const showVideoInFolder = async (request: ImagePreviewRequest): Promise<void> =>
  invokeIpc('video:show-in-folder', request);
/** 仅显示本机保存的上传封面，不向历史窗口开放恢复发送能力。 */
const readVideoUpload = async (
  request: ImagePreviewRequest,
): Promise<LocalVideoUpload | null> => invokeIpc('video:read-upload', request);
/** 仅显式下载绑定会话的视频，主进程仍要求有效 JWT。 */
const downloadVideo = async (request: ImagePreviewRequest): Promise<void> =>
  invokeIpc('video:download', request);
/** 只打开已落盘的视频。 */
const openVideo = async (request: ImagePreviewRequest): Promise<void> =>
  invokeIpc('video:open', request);

/** 订阅主进程确认的撤回或本人删除通知，移除页面时解绑，不开放通用 IPC。 */
const onMessageRecalled = (
  listener: (message: Message) => void,
): (() => void) => {
  /** 删除只传递移除标识，正文不回传；其他事件不进入终态通知通道。 */
  const receive = (
    _event: Electron.IpcRendererEvent,
    message: Message,
  ): void => {
    if (message?.messageType === 'recalled' || message?.deletedAt)
      listener(message);
  };
  ipcRenderer.on('history:message-recalled', receive);
  return (): void => {
    ipcRenderer.removeListener('history:message-recalled', receive);
  };
};

const historyDesktop: HistoryWindowApi = {
  copyMessageAttachment: (request) =>
    invokeIpc('message:copy-attachment', request),
  prepareMessageDrag: (request) => invokeIpc('message-drag:prepare', request),
  startMessageDrag: (ticket) => invokeIpc('message-drag:start', ticket),
  readVoice: (request) => invokeIpc('voice:read', request),
  requestRtcCall,
  onMessageRecalled,
  readMessageReply: (conversationId, messageId) =>
    invokeIpc('history:message-reply', conversationId, messageId),
  readReplyPage: (messageId) => invokeIpc('history:reply-page', messageId),
  fileStatus: async (request: ImagePreviewRequest): Promise<FileAvailability> =>
    invokeIpc('file:status', request),
  downloadFile: async (request: ImagePreviewRequest): Promise<void> =>
    invokeIpc('file:download', request),
  showFileInFolder: async (request: ImagePreviewRequest): Promise<void> =>
    invokeIpc('file:show-in-folder', request),
  saveFileAs: async (request: ImagePreviewRequest): Promise<boolean> =>
    invokeIpc('file:save-as', request),
  videoStatus,
  readVideoPoster,
  showVideoInFolder,
  readVideoUpload,
  downloadVideo,
  openVideo,
  getMessageContact,
  readMessageImage,
  readLocalMessageImage: (request) =>
    invokeIpc('image:read-local-message', request),
  showImageInFolder,
  openImagePreview,
  getContext,
  searchMessages,
  minimize,
  close,
};
contextBridge.exposeInMainWorld('historyDesktop', historyDesktop);
exposeContextMenuHost();
