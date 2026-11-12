import type {
  UpdateDownloadProgress,
  UpdateReleaseInfo,
} from '../update/update';

/** 独立更新窗口使用的受控桌面桥接。 */
export interface UpdateWindowApi {
  getRelease: () => Promise<UpdateReleaseInfo>;
  close: () => Promise<void>;
  downloadUpdate: () => Promise<boolean>;
  cancelUpdate: () => Promise<void>;
  onUpdateProgress: (
    callback: (progress: UpdateDownloadProgress) => void,
  ) => () => void;
}
