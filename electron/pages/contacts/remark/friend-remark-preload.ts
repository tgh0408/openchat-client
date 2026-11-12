import { invokeIpc } from '../../../services/ipc/invoke';
import { contextBridge } from 'electron';
import type { FriendRemarkApi } from '../../../../shared/contacts/friend-remark';

const api: FriendRemarkApi = {
  /** 读取当前窗口绑定的好友备注，不开放任意目标查询。 */
  read: () => invokeIpc('friend-remark:read'),
  /** 显式复制可编辑数据，不把 Vue 代理或任意目标传到主进程。 */
  submit: (draft) =>
    invokeIpc('friend-remark:submit', {
      remark: draft.remark,
      tags: [...draft.tags],
      phones: [...draft.phones],
      description: draft.description,
    }),
  /** 取消本次编辑，不写入数据库或请求服务端。 */
  close: () => invokeIpc('friend-remark:close'),
};

contextBridge.exposeInMainWorld('friendRemarkDesktop', api);
