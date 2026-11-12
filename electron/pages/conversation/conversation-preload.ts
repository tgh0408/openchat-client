import { invokeIpc } from '../../services/ipc/invoke';
import { exposeContextMenuHost } from '../../services/ipc/context-menu-bridge';
import { contextBridge } from 'electron';
import {
  desktop,
  useConversationBridge,
} from '../../services/ipc/desktop-bridge';
import type {
  ConversationWindowApi,
  ConversationWindowContext,
} from '../../../shared/windows/conversation-window';
import type { ResourceSseMessage } from '../../../shared/windows/desktop';
import { parseRoomHistorySyncNotification } from '../../../shared/chat/messages/room-history-sync';

useConversationBridge();
exposeContextMenuHost();
const context: ConversationWindowApi['context'] =
  (): Promise<ConversationWindowContext> => invokeIpc('conversation:context');

/** 子窗口只接收主进程定向转发的补历史提示，不接收原始聊天正文。 */
const onHistorySyncResourceMessage = (
  callback: (message: ResourceSseMessage) => void,
): (() => void) =>
  desktop.onResourceMessage((message) => {
    if (parseRoomHistorySyncNotification(message.data)) callback(message);
  });

// 只暴露工作台实际使用的会话能力；登录、账号切换和全局数据操作不会进入子窗口。
const bridge = {
  ...desktop,
  onResourceMessage: onHistorySyncResourceMessage,
  close: (): Promise<void> => invokeIpc('conversation:control', 'close'),
  controlWindow: (action: 'minimize' | 'maximize' | 'pin'): Promise<boolean> =>
    invokeIpc('conversation:control', action),
  listConversations: async (): Promise<
    ConversationWindowContext['conversation'][]
  > => [(await context()).conversation],
  listUnconfirmedMessages: async (): Promise<never[]> => [],
  listContacts: async (): Promise<never[]> => [],
  listFriends: async (): Promise<never[]> => [],
  getFriendUnread: async (): Promise<number> => 0,
};
const excluded: (keyof typeof bridge)[] = [
  'openRtcCall',
  'resumeRtcCall',
  'rtcGetOngoingCalls',
  'rtcGetActiveCalls',
  'rtcGetGroupActiveCall',
  'onRtcCallClosed',
  'login',
  'register',
  'chooseRegistrationAvatar',
  'cancelRegistrationAvatar',
  'cancelLogin',
  'authorizeSession',
  'getLoginState',
  'selectLoginAccount',
  'resumeSession',
  'endSession',
  'getSessionAccess',
  'getStartupPhase',
  'startupRendered',
  'onStartupPhase',
  'openWorkspace',
  'getWorkspaceSession',
  'workspaceReady',
  'returnToLogin',
  'getLocalSettings',
  'saveLocalSettings',
  'saveDebugMode',
  'backupDatabase',
  'chooseFiles',
  'listStoredFiles',
  'deleteStoredFile',
  'saveConversation',
  'saveIncomingMessage',
  'deleteConversation',
  'clearConversation',
  'removeRemoteConversation',
  'hideRemoteConversation',
  'setConversationNotDisturb',
  'removeGroupMembers',
  'exitGroup',
  'dissolveGroup',
  'createGroup',
  'syncRemoteContacts',
  'beginConversationDrag',
  'showConversationDrag',
  'closeConversationDrag',
  'openConversation',
  'openAddFriend',
  'onTrayConversation',
  'openFriendVerification',
  'openFriendRemark',
  'blockRoomUser',
  'deleteFriend',
  'onFriendDeleted',
  'onFriendAdded',
  'unblockRoomUser',
  'getFriendDetail',
  'listFriendApplications',
  'replyFriendApplication',
  'confirmMessage',
];
const exposed = Object.fromEntries(
  Object.entries(bridge).filter(
    ([key]) => !excluded.some((item) => item === key),
  ),
);
contextBridge.exposeInMainWorld('desktop', exposed);
contextBridge.exposeInMainWorld('conversationDesktop', {
  context,
} satisfies ConversationWindowApi);
