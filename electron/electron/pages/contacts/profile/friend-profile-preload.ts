import { invokeIpc } from '../../../services/ipc/invoke';
import { exposeContextMenuHost } from '../../../services/ipc/context-menu-bridge';
import { contextBridge } from 'electron';
import type { FriendProfileApi } from '../../../../shared/contacts/friend-profile';

const api: FriendProfileApi = {
  /** 只读取当前资料窗口绑定的摘要。 */
  context: () => invokeIpc('friend-profile:context'),
  /** 删除主进程绑定的好友，不接受页面传入目标。 */
  deleteFriend: (clearHistory: boolean) =>
    invokeIpc('friend-profile:delete', clearHistory),
  /** 读取绑定好友的真实详情，不接受页面指定 UID。 */
  read: () => invokeIpc('friend-profile:read'),
  /** 只为绑定的非好友打开申请表单，不允许页面指定申请对象。 */
  openApplication: () => invokeIpc('friend-profile:application'),
  /** 只为主进程绑定的好友打开备注窗口。 */
  openRemark: () => invokeIpc('friend-profile:remark'),
  /** 只改变绑定好友的黑名单状态，不接收页面提供的 UID 或房间。 */
  setBlacklisted: (blocked) => invokeIpc('friend-profile:blacklist', blocked),
  /** 返回绑定的聊天，不直接发送消息。 */
  message: () => invokeIpc('friend-profile:message'),
  /** 只提交媒体类型，好友和单聊房间由主进程绑定。 */
  requestCall: (mediaMode) => invokeIpc('friend-profile:call', mediaMode),
  /** 关闭当前资料窗口。 */
  close: () => invokeIpc('friend-profile:close'),
};

contextBridge.exposeInMainWorld('friendProfileDesktop', api);
exposeContextMenuHost();
