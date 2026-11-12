import { invokeIpc } from '../../services/ipc/invoke';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  VideoPlayerApi,
  VideoPlayerContext,
  VideoPlaybackProgress,
} from '../../../shared/media/video/video';

/** 只取得主进程绑定视频的临时地址，不接受任意消息、URL 或文件路径。 */
const getContext = async (): Promise<VideoPlayerContext> =>
  invokeIpc('video-player:context');

/** 播放期间报告当前窗口的位置，主进程节流写入数据库。 */
const updateProgress = async (progress: VideoPlaybackProgress): Promise<void> =>
  invokeIpc('video-player:progress', progress);

/** 暂停、拖动或关闭时立即保存；尚未加载视频时不覆盖已有位置。 */
const saveProgress = async (
  progress: VideoPlaybackProgress | null,
): Promise<void> => invokeIpc('video-player:save-progress', progress);

/** 主进程拦截关闭后请求最后一次位置，订阅不暴露原始 IPC。 */
const onClosing = (callback: () => void): (() => void) => {
  const listener = (): void => callback();
  ipcRenderer.on('video-player:closing', listener);
  return (): void => {
    ipcRenderer.removeListener('video-player:closing', listener);
  };
};

const api: VideoPlayerApi = {
  getContext,
  updateProgress,
  saveProgress,
  onClosing,
};
contextBridge.exposeInMainWorld('videoPlayerDesktop', api);
