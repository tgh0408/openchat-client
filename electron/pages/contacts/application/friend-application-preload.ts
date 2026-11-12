import { invokeIpc } from '../../../services/ipc/invoke';
import { contextBridge } from 'electron';
import type {
  FriendApplicationApi,
  FriendApplicationContext,
  FriendApplicationDraft,
} from '../../../../shared/contacts/friend-application';

/** 读取主进程绑定的申请对象与本人昵称。 */
const read = async (): Promise<FriendApplicationContext> =>
  invokeIpc('friend-application:read');

/** 取消申请并关闭当前窗口，不写入表单草稿。 */
const close = async (): Promise<void> => {
  await invokeIpc('friend-application:close');
};

/** 显式复制表单字段，避免把响应式代理或任意身份参数传入 IPC。 */
const submit = async (draft: FriendApplicationDraft): Promise<void> => {
  await invokeIpc('friend-application:submit', {
    message: draft.message,
    remark: draft.remark,
    tags: [...draft.tags],
    permission: draft.permission,
    hideMine: draft.hideMine,
    hideTheirs: draft.hideTheirs,
  });
};

const api: FriendApplicationApi = { read, submit, close };
contextBridge.exposeInMainWorld('friendApplicationDesktop', api);
