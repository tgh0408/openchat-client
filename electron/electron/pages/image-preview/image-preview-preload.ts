import { invokeIpc } from '../../services/ipc/invoke';
import type { ImageOcrResult } from '../../../shared/media/image/image-ocr';
import { contextBridge, ipcRenderer } from 'electron';
import type { LocalImageData } from '../../../shared/media/image/image';
import type {
  ImagePreviewApi,
  ImagePreviewContext,
  ImagePreviewWindowAction,
  ImagePreviewWindowState,
} from '../../../shared/windows/image-preview';

/** 只读取主进程为当前窗口绑定的图片，不接收任意会话参数。 */
const getContext = async (): Promise<ImagePreviewContext> =>
  invokeIpc('image-preview:context');

/** 相邻图片范围由主进程限定到当前会话。 */
const navigate = async (
  direction: 'previous' | 'next',
): Promise<ImagePreviewContext> =>
  invokeIpc('image-preview:navigate', direction);

/** 执行白名单中的窗口操作，不影响主聊天窗口。 */
const control = async (
  action: ImagePreviewWindowAction,
): Promise<ImagePreviewWindowState> =>
  invokeIpc('image-preview:control', action);

/** 同步原生窗口状态，兼容系统窗口管理操作。 */
const getWindowState = async (): Promise<ImagePreviewWindowState> =>
  invokeIpc('image-preview:state');

/** 主页面再次打开图片时刷新预览，不传递 IPC 事件对象。 */
const onChanged = (callback: () => void): (() => void) => {
  const listener = (): void => callback();
  ipcRenderer.on('image-preview:changed', listener);
  return (): void => {
    ipcRenderer.removeListener('image-preview:changed', listener);
  };
};

/** 监听最大化、全屏和置顶变化，不暴露原始 IPC。 */
const onWindowState = (
  callback: (state: ImagePreviewWindowState) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    state: ImagePreviewWindowState,
  ): void => callback(state);
  ipcRenderer.on('image-preview:state', listener);
  return (): void => {
    ipcRenderer.removeListener('image-preview:state', listener);
  };
};

/** 当前图片本地优先读取，消息已切换时主进程拒绝旧请求。 */
const readImage = async (messageId: string): Promise<LocalImageData> =>
  invokeIpc('image-preview:read-image', messageId);

/** 只识别主进程绑定的当前图片，不接收地址、路径或页面提供的图片字节。 */
const recognizeText = async (
  messageId: string,
  jobId: string,
): Promise<ImageOcrResult | null> =>
  invokeIpc('image-preview:recognize-text', messageId, jobId);

/** 仅取消本页对应任务，迟到取消不能终止下一次识别。 */
const cancelRecognition = async (jobId: string): Promise<void> =>
  invokeIpc('image-preview:cancel-recognition', jobId);

/** 仅查询识别能力，不暴露本地模型路径或文件系统接口。 */
const isRecognitionAvailable = async (): Promise<boolean> =>
  invokeIpc('image-preview:recognition-available');

const imagePreviewDesktop: ImagePreviewApi = {
  isRecognitionAvailable,
  recognizeText,
  cancelRecognition,
  readImage,
  getContext,
  navigate,
  control,
  getWindowState,
  onChanged,
  onWindowState,
};
contextBridge.exposeInMainWorld('imagePreviewDesktop', imagePreviewDesktop);
