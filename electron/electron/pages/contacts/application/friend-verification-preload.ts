import { invokeIpc } from '../../../services/ipc/invoke';
import { contextBridge } from 'electron';
import type { FriendVerificationApi } from '../../../../shared/contacts/friend-application';

const api: FriendVerificationApi = {
  /** 读取主进程绑定的申请人，不向窗口传递授权凭据。 */
  read: () => invokeIpc('friend-verification:read'),
  /** 只提交本人设置，申请 ID 和对方 UID 不允许由子窗口更改。 */
  submit: (draft) =>
    invokeIpc('friend-verification:submit', {
      remark: draft.remark,
      tags: [...draft.tags],
      permission: draft.permission,
      hideMine: draft.hideMine,
      hideTheirs: draft.hideTheirs,
    }),
  /** 取消或成功后关闭本窗口。 */
  close: () => invokeIpc('friend-verification:close'),
};
contextBridge.exposeInMainWorld('friendVerificationDesktop', api);
