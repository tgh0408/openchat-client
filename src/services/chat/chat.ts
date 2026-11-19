import { getAuthApiBase } from '../../../shared/runtime/server-settings';
import type {
  Contact,
  Conversation,
  ConversationSummary,
  Message,
  IncomingMessageResult,
  MessagePosition,
  CachedMessagePage,
  HistoryQuery,
} from '../../../shared/storage/database';
import { FILE_ASSISTANT_TYPE } from '../../../shared/chat/chat';
import { canDeleteMessage } from '../../../shared/chat/messages/message-deletion';
import type { ImagePreviewRequest } from '../../../shared/windows/image-preview';
import { shouldKeepRecalledMessage } from '../../../shared/chat/messages/recall-message';
import { systemMessageText } from '../../../shared/chat/messages/system-message';
import {
  requestUserInfo,
  SessionExpiredError,
} from '../../../shared/auth/auth';
import type { AuthSession } from '../../../shared/auth/auth';
import { PLATFORM_CLIENT_IDS } from '../../../shared/auth/client-identity';
import { createApiClientFactory } from '../../../shared/api/api-client';
import {
  listRemoteFriends,
  requestFriendDetail,
  requestFriendDeletion,
  requestRoomBlacklist,
  requestRoomUnblacklist,
} from '../../../shared/contacts/friend';
import type { Friend, FriendDetail } from '../../../shared/contacts/friend';
import {
  requestFriendUnread,
  requestFriendApplications,
  requestReadFriendApplication,
  requestReplyFriendApplication,
} from '../../../shared/contacts/friend-notification';
import type {
  FriendApplicationPage,
  FriendApplicationUnread,
} from '../../../shared/contacts/friend-notification';
import {
  addRemoteGroupMembers,
  exitRemoteGroup,
  dissolveRemoteGroup,
  removeRemoteGroupMembers,
  listRemoteGroupMembers,
  listRemoteGroups,
  updateRemoteGroupInfo,
} from '../../../shared/contacts/group';
import type {
  GroupDirectoryItem,
  GroupMemberItem,
  UpdateGroupInfoRequest,
} from '../../../shared/contacts/group';
import {
  requestConversationTopStatus,
  requestConversationNotDisturb,
  requestHideConversation,
  requestRemoveConversation,
} from '../../../shared/chat/conversations/conversation-preferences';
import {
  isContactNameFresh,
  mergeContactProfiles,
} from '../../../shared/contacts/contact-name';
import { formatGroupDisplayName } from '../../../shared/contacts/group-name';

interface ChatStore {
  deleteMessage: (target: ImagePreviewRequest) => Promise<void>;
  searchMessages: (query: HistoryQuery) => Promise<Message[]>;
  listConversations: () => Promise<ConversationSummary[]>;
  saveConversation: (id: string, title: string) => Promise<Conversation>;
  listMessages: (
    id: string,
    offset?: number,
    limit?: number,
  ) => Promise<Message[]>;
  syncMessageHistory: (
    roomId: string,
    mode: 'latest' | 'older',
  ) => Promise<void>;
  readCachedMessagePage: (
    roomId: string,
    before: MessagePosition | null,
  ) => Promise<CachedMessagePage>;
  readCachedMessageBatch: (roomId: string, ids: string[]) => Promise<Message[]>;
  saveMessage: (message: Message) => Promise<boolean>;
  saveIncomingMessage: (
    message: Message,
    incrementUnread: boolean,
  ) => Promise<IncomingMessageResult>;
  readRecalledMessageText: (
    conversationId: string,
    messageId: string,
  ) => Promise<string | null>;
  confirmMessage: (clientMsgId: string, serverId: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  clearConversation: (id: string) => Promise<void>;
  removeRemoteConversation: (id: string) => Promise<void>;
  hideRemoteConversation: (id: string) => Promise<void>;
  syncRemoteContacts: () => Promise<number>;
  listFriends: () => Promise<Friend[]>;
  getFriendUnread: () => Promise<FriendApplicationUnread[]>;
  listFriendApplications: (pageNo: number) => Promise<FriendApplicationPage>;
  readFriendApplication: (applyId: string) => Promise<void>;
  replyFriendApplication: (applyId: string, msg: string) => Promise<void>;
  openFriendVerification: (
    applyId: string,
    friendId: string,
  ) => Promise<boolean>;
  listGroups: () => Promise<GroupDirectoryItem[]>;
  createGroup: (uids: string[]) => Promise<GroupDirectoryItem>;
  listGroupMembers: (roomId: string) => Promise<GroupMemberItem[]>;
  addGroupMembers: (roomId: string, uids: string[]) => Promise<void>;
  removeGroupMembers: (roomId: string, uids: string[]) => Promise<void>;
  exitGroup: (roomId: string) => Promise<void>;
  dissolveGroup: (roomId: string) => Promise<void>;
  updateGroupInfo: (request: UpdateGroupInfoRequest) => Promise<void>;
  setConversationTop: (roomId: string, status: 0 | 1) => Promise<void>;
  setConversationNotDisturb: (roomId: string, status: 0 | 1) => Promise<void>;
  getFriendDetail: (uid: string, roomId: string) => Promise<FriendDetail>;
  blockRoomUser: (roomId: string, uid: string) => Promise<void>;
  deleteFriend: (roomId: string, clearHistory: boolean) => Promise<void>;
  unblockRoomUser: (roomId: string, uid: string) => Promise<void>;
  refreshConversationInfo: (roomId: string) => Promise<ConversationSummary>;
  getContactProfile: (
    uid: string,
    force?: boolean,
    roomId?: string,
  ) => Promise<Contact>;
  listContacts: () => Promise<Contact[]>;
}

/** 为当前页面提供 SQLite 访问；纯浏览器预览仅使用隔离的内存副本。 */
export const createChatStore = (
  onLocalReadError?: () => void,
  getSession?: () => AuthSession,
): ChatStore => {
  const contactProfiles = new Map<string, Contact>();
  const conversations = new Map<string, Conversation>();
  const messages = new Map<string, Message>();
  const createBrowserApiClient = createApiClientFactory({
    base: getAuthApiBase,
    clientId: PLATFORM_CLIENT_IDS.WEB,
    getSession: (): AuthSession | null => getSession?.() ?? null,
  });

  /** 桌面持久化本地标记，浏览器只标记当前内存记录，均不发送删除请求。 */
  const deleteMessage = async (target: ImagePreviewRequest): Promise<void> => {
    if (window.desktop) return window.desktop.deleteMessage(target);
    const message = messages.get(target.messageId);
    if (!message || message.conversationId !== target.conversationId)
      throw new Error('消息不存在');
    if (message.deletedAt) return;
    if (!canDeleteMessage(message)) throw new Error('只能删除正常消息');
    messages.set(message.id, {
      ...message,
      content: '',
      deletedAt: new Date().toISOString(),
    });
  };

  /** 按 UID 获取头像，优先复用浏览器预览中的联系人缓存。*/
  const hydrateAvatarByUid = async (
    uid: string,
    roomId?: string,
  ): Promise<string | null> => {
    const cached = contactProfiles.get(uid);
    if (cached?.avatar) return cached.avatar;
    try {
      return (await getContactProfile(uid, cached !== undefined, roomId))
        .avatar;
    } catch (cause) {
      if (cause instanceof SessionExpiredError) throw cause;
      return null;
    }
  };

  /** 分批读取会话摘要，消息正文仍按需分页读取。 */
  const listConversations = async (): Promise<ConversationSummary[]> => {
    if (!window.desktop) {
      return Promise.all(
        [...conversations.values()].map(
          async (conversation): Promise<ConversationSummary> => {
            const [message] = await listMessages(conversation.id, 0, 1);
            let lastMessage: string | null;
            switch (true) {
              case Boolean(message?.deletedAt):
                lastMessage = '消息已移除';
                break;
              case message?.messageType === 'emoji':
                lastMessage = '[表情包]';
                break;
              case message?.messageType === 'video':
                lastMessage = '[视频]';
                break;
              case message?.messageType === 'file':
                lastMessage = '[文件]';
                break;
              case message?.messageType === 'audio':
                lastMessage = '[语音]';
                break;
              case message?.messageType === 'rtc-call':
                lastMessage = '[通话]';
                break;
              case message?.messageType === 'image':
                lastMessage = '[图片]';
                break;
              case message?.messageType === 'recalled':
                lastMessage = message.content;
                break;
              case message?.messageType === 'system':
                lastMessage = systemMessageText(message.content);
                break;
              default:
                lastMessage = message?.content.slice(0, 120) ?? null;
                break;
            }
            return {
              ...conversation,
              lastMessage,
              lastMessageId: message?.id ?? null,
              lastMessageCreatedAt: message?.createdAt ?? null,
              lastMessageType: message?.deletedAt ? null : message?.messageType,
              lastMessageSenderId:
                conversation.type !== null &&
                conversation.type !== FILE_ASSISTANT_TYPE &&
                message &&
                message.messageType !== 'system' &&
                !message.deletedAt
                  ? message.senderId
                  : null,
            };
          },
        ),
      );
    }
    const result: ConversationSummary[] = [];
    let page: ConversationSummary[];
    do {
      page = await window.desktop.listConversations(200, result.length);
      result.push(...page);
    } while (page.length === 200);
    return result;
  };

  /** 创建一个本地会话，不发起联系人或远端聊天请求。 */
  const saveConversation = async (
    id: string,
    title: string,
  ): Promise<Conversation> => {
    if (window.desktop) {
      return window.desktop.saveConversation({
        id,
        title,
        participantId: null,
      });
    }
    const timestamp = new Date().toISOString();
    const value: Conversation = {
      id,
      title,
      participantId: null,
      avatar: null,
      type: null,
      isTop: 0,
      unreadCount: 0,
      createdAt: conversations.get(id)?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    conversations.set(id, value);
    return value;
  };

  /** 按时间倒序读取一页消息，保留与 SQLite 相同的排序规则。 */
  const listMessages = async (
    id: string,
    offset = 0,
    limit = 50,
  ): Promise<Message[]> => {
    if (window.desktop) return window.desktop.listMessages(id, limit, offset);
    return [...messages.values()]
      .filter((message) => message.conversationId === id && !message.deletedAt)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .slice(offset, offset + limit);
  };

  /** 同步由主进程按连接代次去重，浏览器仍只使用内存记录。 */
  const syncMessageHistory = async (
    roomId: string,
    mode: 'latest' | 'older',
  ): Promise<void> => {
    if (!window.desktop) throw new Error('远端聊天记录需要在桌面程序中读取');
    await window.desktop.syncMessageHistory(roomId, mode);
  };

  /** 稳定读取一页本地消息，浏览器按相同时间与 ID 顺序分页。 */
  const readCachedMessagePage = async (
    roomId: string,
    before: MessagePosition | null,
  ): Promise<CachedMessagePage> => {
    if (window.desktop) {
      try {
        return await window.desktop.readCachedMessagePage(roomId, before);
      } catch (cause) {
        onLocalReadError?.();
        throw cause;
      }
    }
    const rows = [...messages.values()]
      .filter(
        (message) =>
          message.conversationId === roomId &&
          !message.deletedAt &&
          (!before ||
            message.createdAt < before.createdAt ||
            (message.createdAt === before.createdAt && message.id < before.id)),
      )
      .sort((a, b) => {
        switch (true) {
          case a.createdAt === b.createdAt && a.id < b.id:
            return 1;
          case a.createdAt === b.createdAt && a.id > b.id:
            return -1;
          case a.createdAt === b.createdAt:
            return 0;
          case a.createdAt < b.createdAt:
            return 1;
          default:
            return -1;
        }
      })
      .slice(0, 51);
    const list = rows.slice(0, 50);
    const last = list[list.length - 1];
    return {
      list,
      before: last ? { id: last.id, createdAt: last.createdAt } : before,
      hasMoreLocal: rows.length > 50,
      hasMoreRemote: false,
    };
  };

  /** 回读占位对应的已存消息；浏览器沿用内存来源且限制单批数量。 */
  const readCachedMessageBatch = async (
    roomId: string,
    ids: string[],
  ): Promise<Message[]> => {
    if (ids.length < 1 || ids.length > 50)
      throw new Error('无效的消息回读数量');
    if (window.desktop) {
      try {
        return await window.desktop.readCachedMessageBatch(roomId, ids);
      } catch (cause) {
        onLocalReadError?.();
        throw cause;
      }
    }
    return ids.flatMap((id) => {
      const message = messages.get(id);
      return message && message.conversationId === roomId && !message.deletedAt
        ? [message]
        : [];
    });
  };

  /** 从当前账号读取撤回编辑副本；浏览器不伪造本地原文。 */
  const readRecalledMessageText = async (
    conversationId: string,
    messageId: string,
  ): Promise<string | null> => {
    if (!window.desktop) return null;
    return window.desktop.readRecalledMessageText(conversationId, messageId);
  };

  /** 先保存消息再更新摘要；不会伪造远端送达状态。 */
  const saveMessage = async (message: Message): Promise<boolean> => {
    if (window.desktop) return window.desktop.saveMessage(message);
    if (messages.get(message.id)?.deletedAt) return false;
    if (shouldKeepRecalledMessage(messages.get(message.id), message))
      return false;
    messages.set(message.id, message);
    const conversation = conversations.get(message.conversationId);
    if (conversation) conversation.updatedAt = message.createdAt;
    return true;
  };

  /** 实时接收仅由桌面主窗口落库，浏览器不伪造 SSE 或未读状态。 */
  const saveIncomingMessage = async (
    message: Message,
    incrementUnread: boolean,
  ): Promise<IncomingMessageResult> => {
    if (!window.desktop) throw new Error('实时消息需要在桌面程序中接收');
    return window.desktop.saveIncomingMessage(message, incrementUnread);
  };

  /** 发送确认后把消息 id 更新为后端消息 id；浏览器预览更新内存副本。 */
  const confirmMessage = async (
    clientMsgId: string,
    serverId: string,
  ): Promise<void> => {
    if (window.desktop) {
      await window.desktop.confirmMessage(clientMsgId, serverId);
      return;
    }
    const message = messages.get(clientMsgId);
    if (!message || message.deletedAt || messages.get(serverId)?.deletedAt)
      return;
    messages.delete(clientMsgId);
    message.id = serverId;
    message.status = 'sent';
    messages.set(serverId, message);
  };

  /** 删除本地会话及关联消息，不触碰原始文件。 */
  const deleteConversation = async (id: string): Promise<void> => {
    if (window.desktop) return window.desktop.deleteConversation(id);
    conversations.delete(id);
    for (const [key, message] of messages) {
      if (message.conversationId === id) messages.delete(key);
    }
  };

  /** 物理删除浏览器内存会话，桌面端同时清理已下载的应用媒体缓存。 */
  const clearConversation = async (id: string): Promise<void> => {
    if (window.desktop) {
      await window.desktop.clearConversation(id);
      return;
    }
    conversations.delete(id);
    for (const [key, message] of messages) {
      if (message.conversationId === id) messages.delete(key);
    }
  };

  /** 先请求服务端逻辑删除 contact，再由页面删除本地会话数据。 */
  const removeRemoteConversation = async (id: string): Promise<void> => {
    if (window.desktop) {
      await window.desktop.removeRemoteConversation(id);
      return;
    }
    const api = createBrowserApiClient();
    await requestRemoveConversation(api, id);
    api.validateCurrent();
  };

  /** 先请求服务端隐藏会话，页面成功后仅移除当前视图，不删除本地历史。 */
  const hideRemoteConversation = async (id: string): Promise<void> => {
    if (window.desktop) {
      await window.desktop.hideRemoteConversation(id);
      return;
    }
    const api = createBrowserApiClient();
    await requestHideConversation(api, id);
    api.validateCurrent();
  };

  /** 浏览器按相同条件查询内存历史，桌面交给 SQLite 在分页前筛选。 */
  const searchMessages = async (query: HistoryQuery): Promise<Message[]> => {
    if (window.desktop) return window.desktop.searchMessages(query);
    return [...messages.values()]
      .filter((message) => {
        if (
          message.conversationId !== query.conversationId ||
          message.deletedAt
        )
          return false;
        const content = (
          message.messageType === 'system'
            ? systemMessageText(message.content)
            : message.content
        ).toLowerCase();
        if (!content.includes(query.keyword.trim().toLowerCase())) return false;
        if (
          query.startAt &&
          query.endAt &&
          (message.createdAt < query.startAt ||
            message.createdAt >= query.endAt)
        )
          return false;
        if (query.category === 'all') return true;
        if (query.category === 'media')
          return ['image', 'video', 'emoji'].includes(message.messageType);
        if (query.category === 'link')
          return (
            !['emoji', 'image', 'video', 'file', 'audio'].includes(
              message.messageType,
            ) &&
            (content.includes('https://') || content.includes('http://'))
          );
        return message.messageType === query.category;
      })
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .slice(query.offset, query.offset + 50);
  };

  /** 桌面同步后端最近会话到本地；浏览器预览不接入远端会话。 */
  const syncRemoteContacts = async (): Promise<number> => {
    if (window.desktop) return window.desktop.syncRemoteContacts();
    return 0;
  };

  /** 拉取好友联系人；桌面端由主进程请求，浏览器预览使用 WEB 平台标识。 */
  const listFriends = async (): Promise<Friend[]> => {
    if (window.desktop) return window.desktop.listFriends();
    const api = createBrowserApiClient();
    const friends = await listRemoteFriends(api);
    const result = await Promise.all(
      friends.map(async (friend): Promise<Friend> => {
        const cached = contactProfiles.get(friend.uid);
        if (cached) return { ...friend, avatar: cached.avatar };
        if (!friend.roomId) return friend;
        try {
          const detail = await requestFriendDetail(
            api,
            friend.uid,
            friend.roomId,
          );
          api.validateCurrent();
          const timestamp = new Date().toISOString();
          const contact = mergeContactProfiles(
            contactProfiles.get(friend.uid),
            {
              id: friend.uid,
              nickname: detail.name || friend.name,
              avatar: detail.avatar,
              signature: detail.personalitySignature,
              updatedAt: timestamp,
              remark: detail.remark,
              nameUpdatedAt: timestamp,
            },
          );
          contactProfiles.set(friend.uid, contact);
          return { ...friend, avatar: contact.avatar };
        } catch (cause) {
          if (cause instanceof SessionExpiredError) throw cause;
          return friend;
        }
      }),
    );
    api.validateCurrent();
    return result;
  };

  /** 桌面经认证桥接读取未读申请，浏览器仅请求真实接口。 */
  const getFriendUnread = async (): Promise<FriendApplicationUnread[]> => {
    if (window.desktop) return window.desktop.getFriendUnread();
    return requestFriendUnread(createBrowserApiClient());
  };

  /** 按页读取当前账号申请，不因打开列表批量确认已读。 */
  const listFriendApplications = async (
    pageNo: number,
  ): Promise<FriendApplicationPage> => {
    if (window.desktop) return window.desktop.listFriendApplications(pageNo);
    const page = await requestFriendApplications(
      createBrowserApiClient(),
      pageNo,
    );
    return {
      ...page,
      list: await Promise.all(
        page.list.map(async (item) => ({
          ...item,
          avatar: await hydrateAvatarByUid(item.peerUid),
        })),
      ),
    };
  };

  /** 只确认当前点击的好友申请。 */
  const readFriendApplication = async (applyId: string): Promise<void> => {
    if (window.desktop) {
      await window.desktop.readFriendApplication(applyId);
      return;
    }
    await requestReadFriendApplication(createBrowserApiClient(), applyId);
  };

  /** 桌面经受控主进程回复，浏览器使用当前真实授权请求。 */
  const replyFriendApplication = async (
    applyId: string,
    msg: string,
  ): Promise<void> => {
    if (window.desktop) {
      await window.desktop.replyFriendApplication(applyId, msg);
      return;
    }
    await requestReplyFriendApplication(createBrowserApiClient(), {
      applyId,
      msg,
    });
  };

  /** 验证在独立桌面窗口进行；浏览器预览不绕过确认直接审批。 */
  const openFriendVerification = async (
    applyId: string,
    friendId: string,
  ): Promise<boolean> => {
    if (window.desktop)
      return window.desktop.openFriendVerification(applyId, friendId);
    throw new Error('请在桌面客户端进行朋友验证');
  };

  /** 拉取群聊通讯录；桌面端由主进程请求，浏览器使用 WEB 平台标识。 */
  const listGroups = async (): Promise<GroupDirectoryItem[]> => {
    if (window.desktop) return window.desktop.listGroups();
    const api = createBrowserApiClient();
    const groups = await listRemoteGroups(api);
    return Promise.all(
      groups.map(async (group) => {
        const avatarList = await Promise.all(
          group.avatarUidList.map((uid) =>
            hydrateAvatarByUid(uid, group.roomId),
          ),
        );
        api.validateCurrent();
        return {
          ...group,
          avatarList,
          displayName: formatGroupDisplayName(
            group.name,
            group.avatarUidList.map(
              (uid) => contactProfiles.get(uid)?.nickname,
            ),
          ),
        };
      }),
    );
  };

  /** 创建后需同步桌面会话，浏览器不创建无法进入的群聊。 */
  const createGroup = async (uids: string[]): Promise<GroupDirectoryItem> => {
    if (!window.desktop) throw new Error('请在桌面客户端发起群聊');
    return window.desktop.createGroup(uids);
  };

  /** 读取群成员，桌面端经过主进程，浏览器端使用当前真实授权。 */
  const listGroupMembers = async (
    roomId: string,
  ): Promise<GroupMemberItem[]> => {
    if (window.desktop) return window.desktop.listGroupMembers(roomId);
    const members = await listRemoteGroupMembers(
      createBrowserApiClient(),
      roomId,
    );
    return Promise.all(
      members.map(async (member) => ({
        ...member,
        avatar: await hydrateAvatarByUid(member.uid, roomId),
      })),
    );
  };

  /** 桌面走受控主进程，浏览器使用同一真实添加成员接口。 */
  const addGroupMembers = async (
    roomId: string,
    uids: string[],
  ): Promise<void> => {
    if (window.desktop) return window.desktop.addGroupMembers(roomId, uids);
    await addRemoteGroupMembers(createBrowserApiClient(), { roomId, uids });
  };

  /** 桌面走受控主进程，浏览器使用同一真实移出成员接口。 */
  const removeGroupMembers = async (
    roomId: string,
    uids: string[],
  ): Promise<void> => {
    if (window.desktop) return window.desktop.removeGroupMembers(roomId, uids);
    await removeRemoteGroupMembers(createBrowserApiClient(), { roomId, uids });
  };

  /** 桌面退出由主进程确认并通知窗口，浏览器调用同一真实接口。 */
  const exitGroup = async (roomId: string): Promise<void> => {
    if (window.desktop) return window.desktop.exitGroup(roomId);
    await exitRemoteGroup(createBrowserApiClient(), roomId);
  };

  /** 群主解散使用独立的受控桥接，浏览器调用相同真实接口。 */
  const dissolveGroup = async (roomId: string): Promise<void> => {
    if (window.desktop) return window.desktop.dissolveGroup(roomId);
    await dissolveRemoteGroup(createBrowserApiClient(), roomId);
  };

  /** 桌面端通过受控主进程更新群资料，浏览器端使用当前真实授权。 */
  const updateGroupInfo = async (
    request: UpdateGroupInfoRequest,
  ): Promise<void> => {
    if (window.desktop) return window.desktop.updateGroupInfo(request);
    await updateRemoteGroupInfo(createBrowserApiClient(), request);
  };

  /** 更新当前账号的会话置顶状态，浏览器预览只保留内存会话排序。 */
  const setConversationTop = async (
    roomId: string,
    status: 0 | 1,
  ): Promise<void> => {
    if (window.desktop)
      return window.desktop.setConversationTop(roomId, status);
    const api = createBrowserApiClient();
    await requestConversationTopStatus(api, roomId, status);
    api.validateCurrent();
  };

  /** 桌面使用受控桥接，浏览器只请求真实接口且不持久化设置。 */
  const setConversationNotDisturb = async (
    roomId: string,
    status: 0 | 1,
  ): Promise<void> => {
    if (window.desktop)
      return window.desktop.setConversationNotDisturb(roomId, status);
    const api = createBrowserApiClient();
    await requestConversationNotDisturb(api, roomId, status);
    api.validateCurrent();
  };

  /** 桌面由主进程获取好友详情，浏览器请求后重新核对当前会话。 */
  const getFriendDetail = async (
    uid: string,
    roomId: string,
  ): Promise<FriendDetail> => {
    if (window.desktop) return window.desktop.getFriendDetail(uid, roomId);
    const api = createBrowserApiClient();
    const detail = await requestFriendDetail(api, uid, roomId);
    api.validateCurrent();
    return detail;
  };

  /** 桌面走受控 IPC，浏览器使用本次绑定的真实授权请求好友拉黑。 */
  const blockRoomUser = async (roomId: string, uid: string): Promise<void> => {
    if (window.desktop) return window.desktop.blockRoomUser(roomId, uid);
    await requestRoomBlacklist(createBrowserApiClient(), roomId, uid);
  };

  /** 桌面经受控 IPC 移出黑名单，浏览器使用同一真实认证协议。 */
  const unblockRoomUser = async (
    roomId: string,
    uid: string,
  ): Promise<void> => {
    if (window.desktop) return window.desktop.unblockRoomUser(roomId, uid);
    await requestRoomUnblacklist(createBrowserApiClient(), roomId, uid);
  };

  /** 桌面刷新远端房间详情，浏览器不伪造服务器响应。 */
  const refreshConversationInfo = async (
    roomId: string,
  ): Promise<ConversationSummary> => {
    if (!window.desktop) throw new Error('会话详情需要在桌面程序中读取');
    return window.desktop.refreshConversationInfo(roomId);
  };

  /** 桌面通过主进程，浏览器以当前真实授权请求资料，浏览器名称仅保存在内存。 */
  const getContactProfile = async (
    uid: string,
    force: boolean = false,
    roomId?: string,
  ): Promise<Contact> => {
    if (window.desktop)
      return window.desktop.getContactProfile(uid, force, roomId);
    const session = getSession?.();
    if (!session) throw new Error('请先登录');
    const cached = contactProfiles.get(uid);
    if (!force && cached && isContactNameFresh(cached, roomId)) return cached;
    const timestamp = new Date().toISOString();
    const profile = await requestUserInfo(
      getAuthApiBase(),
      session,
      uid,
      undefined,
      roomId,
    );
    if (getSession?.() !== session) throw new Error('账号已切换');
    const contact = mergeContactProfiles(contactProfiles.get(uid), {
      id: uid,
      nickname: profile.name || `用户 ${uid}`,
      avatar: profile.avatar,
      signature: profile.signature,
      updatedAt: timestamp,
      remark: profile.remark,
      nameUpdatedAt: timestamp,
      ...(roomId
        ? {
            groupNicknames: { [roomId]: profile.groupNickname },
            groupNamesUpdatedAt: { [roomId]: timestamp },
          }
        : {}),
    });
    contactProfiles.set(uid, contact);
    return contact;
  };

  /** 桌面读取本地缓存的对方资料；浏览器预览无缓存。 */
  const listContacts = async (): Promise<Contact[]> => {
    if (window.desktop) return window.desktop.listContacts();
    return [...contactProfiles.values()];
  };

  return {
    deleteMessage,
    searchMessages,
    listConversations,
    saveConversation,
    listMessages,
    syncMessageHistory,
    readCachedMessagePage,
    readCachedMessageBatch,
    saveMessage,
    saveIncomingMessage,
    readRecalledMessageText,
    confirmMessage,
    deleteConversation,
    clearConversation,
    removeRemoteConversation,
    hideRemoteConversation,
    syncRemoteContacts,
    listFriends,
    getFriendUnread,
    listFriendApplications,
    readFriendApplication,
    replyFriendApplication,
    openFriendVerification,
    listGroups,
    createGroup,
    listGroupMembers,
    addGroupMembers,
    removeGroupMembers,
    exitGroup,
    dissolveGroup,
    updateGroupInfo,
    setConversationTop,
    setConversationNotDisturb,
    getFriendDetail,
    blockRoomUser,
    /** 桌面经主进程提交，浏览器使用绑定当前授权的真实接口。 */
    deleteFriend: async (
      roomId: string,
      clearHistory: boolean,
    ): Promise<void> => {
      if (window.desktop)
        return window.desktop.deleteFriend(roomId, clearHistory);
      const api = createBrowserApiClient();
      await requestFriendDeletion(api, roomId, clearHistory);
      api.validateCurrent();
      if (clearHistory) await clearConversation(roomId);
    },
    unblockRoomUser,
    refreshConversationInfo,
    getContactProfile,
    listContacts,
  };
};
