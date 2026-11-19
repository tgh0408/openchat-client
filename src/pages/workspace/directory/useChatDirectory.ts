import { ref, shallowRef, type Ref } from 'vue';
import type {
  Conversation,
  ConversationSummary,
} from '../../../../shared/storage/database';
import type { Friend, FriendDetail } from '../../../../shared/contacts/friend';
import type { FriendRemarkUpdated } from '../../../../shared/contacts/friend-remark';
import type {
  FriendApplication,
  FriendApplicationUnread,
} from '../../../../shared/contacts/friend-notification';
import {
  canApproveFriendApplication,
  canReplyFriendApplication,
} from '../../../../shared/contacts/friend-notification';
import type { GroupDirectoryItem } from '../../../../shared/contacts/group';
import { getAuthErrorMessage } from '../../../services/auth/auth';
import type { createChatStore } from '../../../services/chat/chat';
import { createFriendUnreadSync } from '../../../services/chat/directory/friend-unread';

interface ChatDirectoryOptions {
  store: Pick<
    ReturnType<typeof createChatStore>,
    | 'listFriends'
    | 'listGroups'
    | 'listGroupMembers'
    | 'getFriendUnread'
    | 'readFriendApplication'
    | 'replyFriendApplication'
    | 'getFriendDetail'
    | 'openFriendVerification'
    | 'syncRemoteContacts'
    | 'listConversations'
    | 'refreshConversationInfo'
  >;
  isDisposed: () => boolean;
  isReadOnly: () => boolean;
  isBusy: () => boolean;
  isSending: () => boolean;
  isDesktop: boolean;
  error: Ref<string>;
  notice: Ref<string>;
  showFriendSuccess: (text: string) => void;
  applyConversations: (
    summaries: ConversationSummary[],
    resetPreviews: boolean,
  ) => void;
  selectConversation: (
    conversation: Conversation,
    source: 'friend' | 'group',
  ) => Promise<void>;
  synchronizeConversations: () => Promise<void>;
}

interface ChatDirectory {
  friends: Ref<Friend[]>;
  friendsBusy: Ref<boolean>;
  friendsError: Ref<string>;
  friendUnread: Ref<number>;
  friendUnreadApplicationUids: Ref<ReadonlySet<string>>;
  friendUnreadError: Ref<string>;
  groups: Ref<GroupDirectoryItem[]>;
  groupsBusy: Ref<boolean>;
  groupsError: Ref<string>;
  selectedFriend: Ref<Friend | null>;
  fileAssistantSelected: Ref<boolean>;
  selectedApplication: Ref<FriendApplication | null>;
  applicationsRevision: Ref<number>;
  applicationApproving: Ref<boolean>;
  applicationError: Ref<string>;
  selectedGroup: Ref<GroupDirectoryItem | null>;
  groupOpening: Ref<boolean>;
  groupDetailError: Ref<string>;
  friendDetail: Ref<FriendDetail | null>;
  friendDetailBusy: Ref<boolean>;
  friendDetailError: Ref<string>;
  friendOpening: Ref<boolean>;
  friendUnreadSync: ReturnType<typeof createFriendUnreadSync>;
  loadFriends: () => Promise<void>;
  loadGroups: () => Promise<void>;
  groupExited: (roomId: string) => void;
  refreshGroupAvatar: (roomId: string) => Promise<void>;
  refreshGroupAvatarAfterRemoval: (
    roomId: string,
    removedUids: readonly string[],
  ) => Promise<void>;
  clearFriendSelection: () => void;
  selectFriendApplication: (application: FriendApplication) => void;
  updateSelectedApplication: (applications: FriendApplication[]) => void;
  approveSelectedApplication: () => Promise<void>;
  replySelectedApplication: (msg: string) => Promise<boolean>;
  refreshFriendDetail: () => Promise<void>;
  selectFriend: (friend: Friend) => void;
  selectFileAssistant: () => void;
  friendBlacklisted: (
    uid: string,
    roomId: string,
    blacklisted: boolean,
  ) => void;
  friendDeleted: (roomId: string) => void;
  friendAdded: (friend: Friend) => void;
  friendRemarkUpdated: (update: FriendRemarkUpdated) => void;
  selectGroup: (group: GroupDirectoryItem) => void;
  openGroup: () => Promise<void>;
  openFriend: () => Promise<void>;
  openSearchedFriend: (uid: string) => Promise<void>;
  resetDirectory: () => void;
}

/** 管理通讯录选择及异步请求；会话读取与摘要更新仍交由工作台协调。 */
export const useChatDirectory = (
  options: ChatDirectoryOptions,
): ChatDirectory => {
  const {
    store,
    isDisposed,
    isReadOnly,
    isBusy,
    isSending,
    isDesktop,
    error,
    notice,
    showFriendSuccess,
    applyConversations,
    selectConversation,
    synchronizeConversations,
  } = options;

  const friends = shallowRef<Friend[]>([]);
  const friendsBusy = ref(false);
  const friendsError = ref('');
  const friendUnread = ref(0);
  const friendUnreadApplicationUids = shallowRef<ReadonlySet<string>>(
    new Set(),
  );
  const friendUnreadError = ref('');
  let friendsRequestVersion = 0;
  const groups = shallowRef<GroupDirectoryItem[]>([]);
  const groupsBusy = ref(false);
  const groupsError = ref('');
  let groupsRequestVersion = 0;
  let groupsRefreshPending = false;
  const selectedFriend = shallowRef<Friend | null>(null);
  const fileAssistantSelected = ref(false);
  const selectedApplication = shallowRef<FriendApplication | null>(null);
  const applicationsRevision = ref(0);
  const applicationApproving = ref(false);
  const applicationError = ref('');
  const selectedGroup = shallowRef<GroupDirectoryItem | null>(null);
  const groupOpening = ref(false);
  const groupDetailError = ref('');
  const friendDetail = shallowRef<FriendDetail | null>(null);
  const friendDetailBusy = ref(false);
  const friendDetailError = ref('');
  const friendOpening = ref(false);
  let friendDetailVersion = 0;
  const friendUnreadSync = createFriendUnreadSync({
    read: store.getFriendUnread,
    active: (): boolean => !isDisposed() && !isReadOnly(),
    update: (applications: FriendApplicationUnread[]): void => {
      friendUnread.value = applications.length;
      friendUnreadApplicationUids.value = new Set(
        applications.map((application) => application.uid),
      );
      friendUnreadError.value = '';
    },
    error: (): void => {
      friendUnreadError.value = '好友申请未读状态同步失败，请重试';
    },
  });
  /** 拉取当前账号好友联系人，旧请求不能覆盖新页面或新账号。 */
  const loadFriends = async (): Promise<void> => {
    if (isReadOnly()) {
      friends.value = [];
      friendsError.value = '登录已过期，请重新登录';
      return;
    }
    const version = ++friendsRequestVersion;
    friendsBusy.value = true;
    friendsError.value = '';
    try {
      const result = await store.listFriends();
      if (isDisposed() || isReadOnly() || version !== friendsRequestVersion)
        return;
      friends.value = result;
    } catch (cause) {
      if (isDisposed() || version !== friendsRequestVersion) return;
      friendsError.value = getAuthErrorMessage(cause, '联系人读取失败，请重试');
    } finally {
      if (!isDisposed() && version === friendsRequestVersion)
        friendsBusy.value = false;
    }
  };

  /** 拉取群聊；查询期间的入群通知合并补查，旧快照不能覆盖新成员头像。 */
  const loadGroups = async (): Promise<void> => {
    if (isDisposed()) return;
    if (isReadOnly()) {
      groups.value = [];
      groupsError.value = '登录已过期，请重新登录';
      return;
    }
    if (groupsBusy.value) {
      groupsRefreshPending = true;
      return;
    }
    const version = ++groupsRequestVersion;
    groupsBusy.value = true;
    groupsError.value = '';
    try {
      do {
        groupsRefreshPending = false;
        try {
          const result = await store.listGroups();
          if (isDisposed() || isReadOnly() || version !== groupsRequestVersion)
            return;
          if (groupsRefreshPending) continue;
          groups.value = result;
          groupsError.value = '';
        } catch (cause) {
          if (isDisposed() || isReadOnly() || version !== groupsRequestVersion)
            return;
          if (groupsRefreshPending) continue;
          groupsError.value = getAuthErrorMessage(
            cause,
            '群聊读取失败，请重试',
          );
        }
      } while (groupsRefreshPending);
    } finally {
      if (!isDisposed() && version === groupsRequestVersion)
        groupsBusy.value = false;
    }
  };

  /** 本机退出成功后移除群目录项，旧列表不能重新补回已退出的群。 */
  const groupExited = (roomId: string): void => {
    if (isDisposed() || isReadOnly()) return;
    groupsRequestVersion++;
    groupsRefreshPending = false;
    groupsBusy.value = false;
    groups.value = groups.value.filter((group) => group.roomId !== roomId);
    if (selectedGroup.value?.roomId === roomId) clearFriendSelection();
  };

  /** 入群仅在头像未满九人或群资料缺失时刷新，不影响其他主动列表读取。 */
  const refreshGroupAvatar = async (roomId: string): Promise<void> => {
    const group = groups.value.find((item) => item.roomId === roomId);
    if (group && group.memberCount >= 9) return;
    await loadGroups();
  };

  /** 仅完整九宫格且未移出其中成员时跳过；在途快照仍须失效并补查。 */
  const refreshGroupAvatarAfterRemoval = async (
    roomId: string,
    removedUids: readonly string[],
  ): Promise<void> => {
    const group = groups.value.find((item) => item.roomId === roomId);
    if (
      !groupsBusy.value &&
      group &&
      group.memberCount > 9 &&
      new Set(group.avatarUidList).size === 9 &&
      !group.avatarUidList.some((uid) => removedUids.includes(uid))
    )
      return;
    await loadGroups();
  };

  /** 清除通讯录选择，使在途详情及打开会话请求失效。 */
  const clearFriendSelection = (): void => {
    friendDetailVersion++;
    fileAssistantSelected.value = false;
    selectedApplication.value = null;
    applicationError.value = '';
    selectedGroup.value = null;
    groupOpening.value = false;
    groupDetailError.value = '';
    selectedFriend.value = null;
    friendDetail.value = null;
    friendDetailBusy.value = false;
    friendDetailError.value = '';
    friendOpening.value = false;
  };

  /** 确认当前点击申请的本人阅读状态，失败保留原未读摘要并提示重试。 */
  const markFriendApplicationRead = async (applyId: string): Promise<void> => {
    try {
      await store.readFriendApplication(applyId);
      if (isDisposed() || isReadOnly()) return;
      await friendUnreadSync.refresh();
    } catch (cause) {
      if (!isDisposed() && !isReadOnly())
        friendUnreadError.value = getAuthErrorMessage(
          cause,
          '好友申请已打开，但未读状态同步失败，请重试',
        );
    }
  };

  /** 申请与好友、群资料互斥选择，完整邀请语直接来自已校验的申请列表。 */
  const selectFriendApplication = (application: FriendApplication): void => {
    if (isReadOnly() || isDisposed()) return;
    clearFriendSelection();
    selectedApplication.value = application;
    void markFriendApplicationRead(application.applyId);
  };

  /** 同步仍在查看的申请，不因后台列表更新而切换用户选择。 */
  const updateSelectedApplication = (
    applications: FriendApplication[],
  ): void => {
    const selected = selectedApplication.value;
    if (!selected || isReadOnly() || isDisposed()) return;
    const updated = applications.find(
      (item) => item.applyId === selected.applyId,
    );
    if (!updated || (selected.status !== 1 && updated.status === 1)) return;
    selectedApplication.value = updated;
  };

  /** 回复仅作用于原选择；失败保留草稿，成功重新读取服务端消息列表。 */
  const replySelectedApplication = async (msg: string): Promise<boolean> => {
    const application = selectedApplication.value;
    if (
      !application ||
      !canReplyFriendApplication(application) ||
      applicationApproving.value ||
      isReadOnly() ||
      isDisposed()
    )
      return false;
    const version = friendDetailVersion;
    applicationApproving.value = true;
    applicationError.value = '';
    try {
      await store.replyFriendApplication(application.applyId, msg);
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return false;
      return true;
    } catch (cause) {
      if (!isDisposed() && !isReadOnly() && version === friendDetailVersion)
        applicationError.value = getAuthErrorMessage(cause, '回复失败，请重试');
      return false;
    } finally {
      if (!isDisposed() && !isReadOnly()) {
        applicationApproving.value = false;
        applicationsRevision.value++;
      }
    }
  };

  /** 等待原生验证窗口结果，取消和旧选择的迟到结果不改变申请状态。 */
  const approveSelectedApplication = async (): Promise<void> => {
    const application = selectedApplication.value;
    if (
      !application ||
      !canApproveFriendApplication(application) ||
      applicationApproving.value ||
      isReadOnly() ||
      isDisposed()
    )
      return;
    const version = friendDetailVersion;
    applicationApproving.value = true;
    applicationError.value = '';
    try {
      const approved = await store.openFriendVerification(
        application.applyId,
        application.uid,
      );
      if (!approved || isDisposed() || isReadOnly()) return;
      if (version === friendDetailVersion)
        selectedApplication.value = { ...application, status: 2 };
      showFriendSuccess('已添加');
      void loadFriends();
      try {
        await synchronizeConversations();
      } catch (cause) {
        if (!isDisposed() && !isReadOnly())
          notice.value = getAuthErrorMessage(
            cause,
            '好友已添加，但会话同步失败，请从通讯录打开聊天重试',
          );
      }
    } catch (cause) {
      if (!isDisposed() && !isReadOnly() && version === friendDetailVersion)
        applicationError.value = getAuthErrorMessage(
          cause,
          '好友验证失败，请稍后重试',
        );
    } finally {
      if (!isDisposed() && !isReadOnly()) {
        applicationApproving.value = false;
        applicationsRevision.value++;
      }
    }
  };

  /** 按 UID 获取真实详情，较早请求不能覆盖新的好友选择。 */
  const refreshFriendDetail = async (): Promise<void> => {
    const friend = selectedFriend.value;
    if (!friend || isDisposed() || isReadOnly() || friendOpening.value) return;
    const version = ++friendDetailVersion;
    friendDetail.value = null;
    friendDetailBusy.value = true;
    friendDetailError.value = '';
    try {
      if (!friend.roomId) throw new Error('该好友缺少可用房间，请刷新后重试');
      const detail = await store.getFriendDetail(friend.uid, friend.roomId);
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      friendDetail.value = detail;
    } catch (cause) {
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      friendDetailError.value = getAuthErrorMessage(
        cause,
        '好友资料读取失败，请重试',
      );
    } finally {
      if (!isDisposed() && version === friendDetailVersion)
        friendDetailBusy.value = false;
    }
  };

  /** 点击好友只展示资料，不读取会话详情或推进已读。 */
  const selectFriend = (friend: Friend): void => {
    if (isReadOnly()) return;
    clearFriendSelection();
    selectedFriend.value = friend;
    void refreshFriendDetail();
  };

  /** 文件助手只展示固定资料，发消息前不恢复会话或推进已读。 */
  const selectFileAssistant = (): void => {
    if (isReadOnly() || isDisposed() || fileAssistantSelected.value) return;
    clearFriendSelection();
    fileAssistantSelected.value = true;
  };

  /** 只更新当前房间的已确认状态，不删除好友、聊天记录或其他房间的数据。 */
  const friendBlacklisted = (
    uid: string,
    roomId: string,
    blacklisted: boolean,
  ): void => {
    if (
      isDisposed() ||
      isReadOnly() ||
      friendDetail.value?.uid !== uid ||
      friendDetail.value.roomId !== roomId
    )
      return;
    friendDetail.value = { ...friendDetail.value, blacklisted };
    notice.value = blacklisted ? '已加入黑名单' : '已移出黑名单';
  };

  /** 仅移除已确认删除的通讯录条目，并废弃可能恢复旧关系的在途列表。 */
  const friendDeleted = (roomId: string): void => {
    if (isDisposed() || isReadOnly()) return;
    friendsRequestVersion++;
    friendsBusy.value = false;
    friends.value = friends.value.filter((friend) => friend.roomId !== roomId);
    if (selectedFriend.value?.roomId === roomId) clearFriendSelection();
    showFriendSuccess('已删除');
  };

  /** 从本次直接添加结果补入联系人，废弃旧列表响应，不再查询服务端确认。 */
  const friendAdded = (friend: Friend): void => {
    if (isDisposed() || isReadOnly()) return;
    friendsRequestVersion++;
    friendsBusy.value = false;
    friendsError.value = '';
    friends.value = [
      ...friends.value.filter((item) => item.uid !== friend.uid),
      friend,
    ];
    showFriendSuccess('已添加');
  };

  /** 已确认备注优先覆盖当前快照，废弃旧详情并重新读取通讯录排序。 */
  const friendRemarkUpdated = (update: FriendRemarkUpdated): void => {
    if (isDisposed() || isReadOnly()) return;
    const changes = {
      remark: update.settings.remark,
      displayName: update.settings.remark || update.name,
    };
    friends.value = friends.value.map((friend) =>
      friend.uid === update.uid ? { ...friend, ...changes } : friend,
    );
    if (selectedFriend.value?.uid === update.uid) {
      selectedFriend.value = { ...selectedFriend.value, ...changes };
      friendDetailVersion++;
      friendDetailBusy.value = false;
      friendOpening.value = false;
      if (friendDetail.value?.uid === update.uid) {
        friendDetail.value = {
          ...friendDetail.value,
          ...changes,
          remarkSettings: update.settings,
        };
      } else {
        void refreshFriendDetail();
      }
    }
    void loadFriends();
  };

  /** 点击群条目只展示通讯录摘要，不读取消息或推进已读。 */
  const selectGroup = (group: GroupDirectoryItem): void => {
    if (isReadOnly() || isDisposed()) return;
    clearFriendSelection();
    selectedGroup.value = group;
  };

  /** 明确进入后同步真实群会话，切换选择或授权失效时丢弃迟到结果。 */
  const openGroup = async (): Promise<void> => {
    const group = selectedGroup.value;
    if (
      !group ||
      groupOpening.value ||
      isReadOnly() ||
      isDisposed() ||
      !isDesktop ||
      isSending()
    )
      return;
    const version = friendDetailVersion;
    groupOpening.value = true;
    groupDetailError.value = '';
    try {
      const currentGroups = await store.listGroups();
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      const currentGroup = currentGroups.find(
        (item) => item.roomId === group.roomId,
      );
      if (!currentGroup) throw new Error('你已不在该群中，或群聊已解散');
      selectedGroup.value = currentGroup;
      await store.syncRemoteContacts();
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      let summaries = await store.listConversations();
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      let conversation = summaries.find(
        (item) => item.id === group.roomId && item.type === 1,
      );
      if (!conversation) {
        const restored = await store.refreshConversationInfo(group.roomId);
        if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
          return;
        if (restored.type !== 1)
          throw new Error('群聊会话暂不可用，请稍后重试');
        summaries = [...summaries, restored];
        conversation = restored;
      }
      applyConversations(summaries, false);
      await selectConversation(conversation, 'group');
    } catch (cause) {
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      groupDetailError.value = getAuthErrorMessage(
        cause,
        '进入群聊失败，请重试',
      );
    } finally {
      if (!isDisposed() && version === friendDetailVersion)
        groupOpening.value = false;
    }
  };

  /** 点击发消息后使用详情返回的真实房间号进入单聊，不创建占位会话。 */
  const openFriend = async (): Promise<void> => {
    const detail = friendDetail.value;
    if (
      !detail?.roomId ||
      friendOpening.value ||
      friendDetailBusy.value ||
      isDisposed() ||
      isReadOnly()
    )
      return;
    const version = friendDetailVersion;
    friendOpening.value = true;
    friendDetailError.value = '';
    try {
      await store.syncRemoteContacts();
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      let summaries = await store.listConversations();
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      applyConversations(summaries, true);
      let conversation = summaries.find((item) => item.id === detail.roomId);
      if (!conversation) {
        const restored = await store.refreshConversationInfo(detail.roomId);
        if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
          return;
        summaries = [...summaries, restored];
        conversation = restored;
      }
      applyConversations(summaries, true);
      await selectConversation(conversation, 'friend');
    } catch (cause) {
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      friendDetailError.value = getAuthErrorMessage(
        cause,
        '打开联系人失败，请重试',
      );
    } finally {
      if (!isDisposed() && version === friendDetailVersion)
        friendOpening.value = false;
    }
  };

  /** 接收搜索窗口的好友选择，复用已有详情与进入单聊流程。 */
  const openSearchedFriend = async (uid: string): Promise<void> => {
    if (isDisposed() || isReadOnly() || isBusy() || friendOpening.value) return;
    clearFriendSelection();
    const version = friendDetailVersion;
    try {
      const currentFriends = await store.listFriends();
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      const friend = currentFriends.find((item) => item.uid === uid);
      if (!friend?.roomId) throw new Error('该好友会话暂不可用，请刷新后重试');
      const detail = await store.getFriendDetail(uid, friend.roomId);
      if (isDisposed() || isReadOnly() || version !== friendDetailVersion)
        return;
      friendDetail.value = detail;
      await openFriend();
      if (friendDetailError.value) error.value = friendDetailError.value;
    } catch (cause) {
      if (!isDisposed() && !isReadOnly() && version === friendDetailVersion)
        error.value = getAuthErrorMessage(cause, '打开好友会话失败，请重试');
    }
  };

  /** 授权失效时清空目录，并使旧列表和详情请求失效。 */
  const resetDirectory = (): void => {
    friendUnreadSync.stop();
    friendUnread.value = 0;
    friendUnreadApplicationUids.value = new Set();
    friendUnreadError.value = '';
    clearFriendSelection();
    friendsRequestVersion++;
    friends.value = [];
    friendsBusy.value = false;
    groupsRequestVersion++;
    groupsRefreshPending = false;
    groups.value = [];
    groupsBusy.value = false;
  };

  return {
    friends,
    friendsBusy,
    friendsError,
    friendUnread,
    friendUnreadApplicationUids,
    friendUnreadError,
    groups,
    groupsBusy,
    groupsError,
    selectedFriend,
    fileAssistantSelected,
    selectedApplication,
    applicationsRevision,
    applicationApproving,
    applicationError,
    selectedGroup,
    groupOpening,
    groupDetailError,
    friendDetail,
    friendDetailBusy,
    friendDetailError,
    friendOpening,
    friendUnreadSync,
    loadFriends,
    loadGroups,
    groupExited,
    refreshGroupAvatar,
    refreshGroupAvatarAfterRemoval,
    clearFriendSelection,
    selectFriendApplication,
    updateSelectedApplication,
    approveSelectedApplication,
    replySelectedApplication,
    refreshFriendDetail,
    selectFriend,
    selectFileAssistant,
    friendBlacklisted,
    friendDeleted,
    friendAdded,
    friendRemarkUpdated,
    selectGroup,
    openGroup,
    openFriend,
    openSearchedFriend,
    resetDirectory,
  };
};
