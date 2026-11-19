import { invokeIpc } from '../../services/ipc/invoke';
import { contextBridge, ipcRenderer } from 'electron';
import type { IpcRendererEvent } from 'electron';
import type { LocalImageData } from '../../../shared/media/image/image';
import type {
  ScreenshotApi,
  ScreenshotRegion,
  ScreenshotSnapshot,
  ScrollScreenshotOverlay,
  ScrollScreenshotProgress,
} from '../../../shared/media/screenshot/screenshot';

/** 在隔离侧创建临时预览地址，避免整屏字节再次通过 contextBridge 复制。 */
const read = async (requestId: string): Promise<ScreenshotSnapshot> => {
  const image: LocalImageData & { windows: ScreenshotRegion[] } =
    await invokeIpc('screenshot:read', requestId);
  return {
    url: URL.createObjectURL(
      new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
    ),
    windows: image.windows,
  };
};

/** 空窗口完成挂载后允许主进程发送截图任务，不在预热阶段读取屏幕。 */
const connect = async (): Promise<void> => {
  await invokeIpc('screenshot:connect');
};

/** 只转发任务编号或清空通知，不向页面暴露 Electron 事件对象。 */
const onRequest = (
  callback: (requestId: string | null) => void,
): (() => void) => {
  const listener = (_event: IpcRendererEvent, value: unknown): void => {
    if (value === null || typeof value === 'string') callback(value);
  };
  ipcRenderer.on('screenshot:request', listener);
  return (): void => {
    ipcRenderer.removeListener('screenshot:request', listener);
  };
};

/** 上报当前任务图像解码和绘制结果，旧任务不能唤醒复用窗口。 */
const ready = async (requestId: string, loaded: boolean): Promise<void> => {
  await invokeIpc('screenshot:ready', requestId, loaded);
};

/** 只提交归一化选区，实际裁剪和草稿创建由主进程完成。 */
const confirm = async (
  requestId: string,
  region: ScreenshotRegion,
): Promise<void> => {
  await invokeIpc('screenshot:confirm', requestId, {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  });
};

/** 取消本次截图，不改写系统剪贴板或创建图片草稿。 */
const cancel = async (requestId: string): Promise<void> => {
  await invokeIpc('screenshot:cancel', requestId);
};

/** 仅提交手动滚动截图选区，不向页面开放全局输入或任意窗口控制。 */
const startScroll = async (
  requestId: string,
  region: ScreenshotRegion,
): Promise<void> => {
  await invokeIpc('screenshot:scroll', requestId, {
    x: region.x,
    y: region.y,
    width: region.width,
    height: region.height,
  });
};

/** 遮罩接住单击后请求结束当前任务，不向页面开放窗口形状或全局输入。 */
const finishScroll = async (requestId: string): Promise<void> => {
  await invokeIpc('screenshot:scroll-finish', requestId);
};

/** 同步主进程指定的遮罩状态，不向页面开放原生窗口形状或鼠标穿透控制。 */
const onScrollOverlay = (
  callback: (overlay: ScrollScreenshotOverlay) => void,
): (() => void) => {
  const listener = (
    _event: IpcRendererEvent,
    overlay: ScrollScreenshotOverlay,
  ): void => callback(overlay);
  ipcRenderer.on('screenshot:scroll-overlay', listener);
  return (): void => {
    ipcRenderer.removeListener('screenshot:scroll-overlay', listener);
  };
};

/** 转发有界缩略图与状态，不向渲染层暴露原始抓屏或窗口句柄。 */
const onScrollProgress = (
  callback: (progress: ScrollScreenshotProgress) => void,
): (() => void) => {
  const listener = (
    _event: IpcRendererEvent,
    progress: ScrollScreenshotProgress,
  ): void => callback(progress);
  ipcRenderer.on('screenshot:scroll-progress', listener);
  return (): void => {
    ipcRenderer.removeListener('screenshot:scroll-progress', listener);
  };
};

const screenshotDesktop: ScreenshotApi = {
  connect,
  onRequest,
  read,
  ready,
  confirm,
  cancel,
  startScroll,
  finishScroll,
  onScrollOverlay,
  onScrollProgress,
};
contextBridge.exposeInMainWorld('screenshotDesktop', screenshotDesktop);
