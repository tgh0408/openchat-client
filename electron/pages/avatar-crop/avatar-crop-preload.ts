import { invokeIpc } from '../../services/ipc/invoke';
import { contextBridge } from 'electron';
import type { AvatarCropApi } from '../../../shared/media/image/avatar-crop';

const api: AvatarCropApi = {
  /** 只读取本次原生选择的头像。 */
  read: (): Promise<Uint8Array> => invokeIpc('avatar-crop:read'),
  /** 提交本次裁剪结果，不开放路径或上传接口。 */
  confirm: async (bytes: Uint8Array): Promise<void> => {
    await invokeIpc('avatar-crop:confirm', bytes);
  },
  /** 关闭裁剪窗口并保留原头像。 */
  cancel: async (): Promise<void> => {
    await invokeIpc('avatar-crop:cancel');
  },
};

contextBridge.exposeInMainWorld('avatarCropDesktop', api);
