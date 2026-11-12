import { invokeIpc } from '../../../services/ipc/invoke';
import { contextBridge } from 'electron';
import type { AddFriendWindowApi } from '../../../../shared/windows/add-friend-window';
import type { AddFriendSearchResult } from '../../../../shared/contacts/add-friend';
import type { RtcMediaMode } from '../../../../shared/rtc/rtc';
import type { FriendRemarkSettings } from '../../../../shared/contacts/friend-remark';
import { exposeContextMenuHost } from '../../../services/ipc/context-menu-bridge';

/** 只向主进程提交搜索词，不向窗口传递登录凭据。 */
const search = async (query: string): Promise<AddFriendSearchResult> =>
  invokeIpc('add-friend:search', query);

/** 关闭当前添加朋友窗口。 */
const close = async (): Promise<void> => {
  await invokeIpc('add-friend:close');
};

/** 请求主窗口打开当前搜索结果的好友会话，不接受任意房间号。 */
const openChat = async (): Promise<void> => {
  await invokeIpc('add-friend:open-chat');
};

/** 仅提交媒体类型，主进程使用当前搜索结果绑定的好友发起通话。 */
const requestCall = async (mediaMode: RtcMediaMode): Promise<void> => {
  await invokeIpc('add-friend:call', mediaMode);
};

/** 仅打开与主进程当前搜索结果一致的申请窗口。 */
const openApplication = async (
  targetUid: string,
): Promise<AddFriendSearchResult | null> =>
  invokeIpc('add-friend:open-application', targetUid);

/** 编辑主进程绑定的当前好友备注，不接受页面指定目标。 */
const openRemark = async (): Promise<FriendRemarkSettings | null> =>
  invokeIpc('add-friend:remark');

/** 仅提交黑名单状态，目标使用当前搜索结果。 */
const setBlacklisted = async (blocked: boolean): Promise<void> => {
  await invokeIpc('add-friend:blacklist', blocked);
};

/** 删除当前好友，仅传递用户确认的历史清理选项。 */
const deleteFriend = async (clearHistory: boolean): Promise<void> => {
  await invokeIpc('add-friend:delete', clearHistory);
};

const addFriendDesktop: AddFriendWindowApi = {
  search,
  close,
  openChat,
  requestCall,
  openApplication,
  openRemark,
  setBlacklisted,
  deleteFriend,
};
contextBridge.exposeInMainWorld('addFriendDesktop', addFriendDesktop);
exposeContextMenuHost();
