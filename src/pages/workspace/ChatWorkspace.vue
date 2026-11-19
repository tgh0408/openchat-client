<template>
  <section
    class="chat-workspace"
    :class="{
      'chat-workspace--detail':
        section === 'directory'
          ? Boolean(
              selectedFriend ||
              selectedGroup ||
              selectedApplication ||
              fileAssistantSelected,
            )
          : Boolean(activeId),
      'chat-workspace--directory': section === 'directory',
    }"
    aria-label="聊天工作台"
    @pointerdown="closeDetailsOnOutside"
    @keydown.esc="closeDetailsOnEscape"
  >
    <ChatTitleBar
      :is-desktop="isDesktop"
      :pinned="pinned"
      :offline-mode="offlineMode"
      :connection-label="connectionLabel"
      :connection-hint="connectionHint"
      @control="controlWindow"
      @close="emit('close')"
    />
    <ChatNavRail
      v-if="!detached"
      :user="session.user"
      :section="section"
      :file-assistant-active="fileAssistantActive"
      :has-file-assistant="Boolean(fileAssistantConversation)"
      :active-id="activeId"
      :file-busy="fileBusy"
      :sending="sending"
      :busy="busy"
      :chat-unread="totalUnreadCount"
      :friend-unread="friendUnread"
      @show-chats="showChats"
      @show-directory="showDirectory"
      @select-files="selectFiles"
      @open-history="openHistory"
      @open-settings="openSettings"
    />
    <ConversationSidebar
      v-if="!detached && section === 'chats'"
      v-model:search="search"
      section="chats"
      :conversations="conversations"
      :groups="groups"
      :previews="previews"
      :contacts="contacts"
      :user-id="session.user.id"
      :user-nickname="session.user.nickname"
      :active-id="activeId"
      :busy="busy"
      :initialization-failed="initializationFailed"
      :read-only="readOnly"
      :not-disturb-busy="notDisturbBusy"
      :format-time="formatTime"
      @select="selectConversationFromSidebar"
      @toggle-top="toggleConversationTop"
      @toggle-not-disturb="toggleConversationNotDisturb"
      @add-friend="openAddFriend"
      @create-group="showCreateGroup"
      @open-window="openConversationWindow"
      @delete-conversation="requestDeleteConversation"
      @hide-conversation="hideConversation"
    />
    <FriendDirectory
      v-else-if="!detached"
      v-model:search="search"
      :friends="friends"
      :groups="groups"
      :busy="friendsBusy"
      :groups-busy="groupsBusy"
      :error="friendsError"
      :groups-error="groupsError"
      :file-assistant-disabled="readOnly || busy || sending"
      :file-assistant-selected="fileAssistantSelected"
      :selected-uid="selectedFriend?.uid ?? null"
      :selected-room-id="selectedGroup?.roomId ?? null"
      :friend-unread="friendUnread"
      :friend-unread-application-uids="friendUnreadApplicationUids"
      :friend-unread-error="friendUnreadError"
      :read-only="readOnly"
      :read-applications="store.listFriendApplications"
      :selected-application="selectedApplication"
      :applications-revision="applicationsRevision"
      @select-application="selectFriendApplication"
      @applications-loaded="updateSelectedApplication"
      @select="selectFriend"
      @select-group="selectGroup"
      @select-files="selectFiles"
    />

    <section class="chat-content" aria-label="聊天内容">
      <ChatFeedback
        v-if="error || sessionError || recallFeedback || notice"
        :text="error || sessionError || recallFeedback?.text || notice"
        :is-error="Boolean(error || sessionError || recallFeedback)"
        :initialization-failed="initializationFailed"
        :read-only="readOnly"
        @retry="initialize"
        @logout="emit('logout')"
        @close="clearFeedback"
      />
      <FriendApplicationDetail
        v-if="section === 'directory' && selectedApplication"
        :key="selectedApplication.applyId"
        :application="selectedApplication"
        :busy="applicationApproving"
        :disabled="readOnly"
        :error="applicationError"
        :reply="replySelectedApplication"
        @back="clearFriendSelection"
        @approve="approveSelectedApplication"
      />
      <GroupDetailPanel
        v-else-if="section === 'directory' && selectedGroup"
        :group="selectedGroup"
        :opening="groupOpening"
        :disabled="readOnly || !isDesktop || sending"
        :error="groupDetailError"
        @back="clearFriendSelection"
        @enter="openGroup"
      />
      <FileAssistantDetailPanel
        v-else-if="section === 'directory' && fileAssistantSelected"
        :opening="fileAssistantOpening"
        :disabled="readOnly || !isDesktop || busy || sending"
        :error="fileAssistantError"
        @back="clearFriendSelection"
        @message="openFileAssistant"
      />
      <FriendDetailPanel
        v-else-if="section === 'directory'"
        :friend="selectedFriend"
        :detail="friendDetail"
        :loading="friendDetailBusy"
        :opening="friendOpening"
        :disabled="readOnly"
        :error="friendDetailError"
        :block-room-user="store.blockRoomUser"
        :unblock-room-user="store.unblockRoomUser"
        :delete-friend="store.deleteFriend"
        @back="clearFriendSelection"
        @refresh="refreshFriendDetail"
        @message="openFriend"
        @blocked="friendBlacklisted"
        @deleted="friendDeleted"
      />
      <div v-if="!activeId" class="chat-empty" aria-label="未选择会话">
        <el-icon :size="82"><ChatDotRound /></el-icon>
      </div>
      <div v-show="activeId" class="chat-conversation-view">
        <ChatConversationHeader
          ref="conversationHeader"
          v-model:details-open="detailsOpen"
          :title="activeTitle"
          :file-assistant="fileAssistantActive"
          :history-disabled="busy || sending || fileBusy"
          :call-disabled="groupRemoved || !canStartRtcCall"
          :group-call="activeConversation?.type === 1"
          @back="clearSelection"
          @history="openHistory"
          @video-call="startRtcCall(RtcMediaMode.VIDEO)"
          @audio-call="startRtcCall(RtcMediaMode.AUDIO)"
        />
        <div class="chat-conversation-body">
          <KeepAlive :max="MAX_CACHED_CONVERSATION_MESSAGES">
            <component
              v-if="renderedConversationId"
              :is="ChatMessageList"
              :key="renderedConversationId"
              ref="messageList"
              :conversation-id="renderedConversationId"
              :messages="activeMessages"
              :applying-friend="applyingFriend"
              :video-sends="videoSends"
              :recalling="[...recalling]"
              :deleting="[...deletingMessages]"
              :reeditable="reeditableMessageIds"
              :user-id="session.user.id"
              :avatar="session.user.avatar"
              :title="activeTitle"
              :contacts="contacts"
              :loading="loadingMessages"
              :has-more="moreMessages"
              :disabled="sending"
              :read-only="readOnly"
              :can-redial="canStartRtcCall"
              :read-ready="readReadyRoom === renderedConversationId"
              :unread-count="unreadNavigation?.count ?? 0"
              :locating-unread="locatingUnread"
              :load-older-page="() => loadOlder(true)"
              :read-message-batch="store.readCachedMessageBatch"
              @window-change="updateMessageWindow"
              @reply-navigation="locatingReply = $event"
              @navigation-error="error = $event"
              @locate-unread="locateUnread"
              @read="recordVisibleRead"
              @load-older="loadOlder"
              @retry="retrySend"
              @apply-friend="applyConversationFriend"
              @cancel-upload="cancelUpload"
              @recall="recallMessage"
              @delete="deleteMessage"
              @reply="selectReply"
              @reedit="reeditMessage"
              :can-recall-members="canRecallMembers"
              @contact-click="refreshContact"
              @contact-needed="ensureContact"
              @redial="startRtcCall"
            />
          </KeepAlive>
          <MessageComposer
            :key="groupRemoved ? 'removed' : 'active'"
            ref="messageComposer"
            v-model:draft="draft"
            :room-id="renderedConversationId"
            :reply-message="activeReply"
            :reply-sender="replySender"
            @cancel-reply="cancelReply"
            :image-drafts="activeImageDrafts"
            :video-drafts="videoDrafts[activeId] ?? []"
            :file-drafts="fileDrafts[activeId] ?? []"
            :user-emojis="userEmojis"
            :emoji-loading="emojiLoading"
            :emoji-error="emojiError"
            :busy-emoji-id="busyEmojiId"
            :emoji-operation="emojiOperation"
            :can-send-emojis="isRemoteConversation(activeId)"
            :can-send-media="isRemoteConversation(activeId) && !offlineMode"
            :uploading-image="uploadingImage"
            :send-voice="sendVoiceRecording"
            :group-removed="groupRemoved"
            :read-only="readOnly"
            @load-emojis="loadEmojis"
            @delete-emoji="deleteEmoji"
            @front-emoji="moveEmojiToFront"
            :sending="sending || uploadingImage"
            :loading-messages="loadingMessages"
            :initialization-failed="initializationFailed"
            :file-busy="fileBusy"
            :is-desktop="isDesktop"
            @send="sendComposer"
            @send-emoji="sendEmoji"
            @capture-screenshot="captureScreenshot"
            @remove-video="removeVideoDraft(activeId, $event)"
            @remove-file="removeFileDraft(activeId, $event)"
            @remove-image="removeImageDraft(activeId, $event)"
            @preview-image="openImageDraftPreview(activeId, $event)"
            @choose-files="chooseAttachments"
          />
          <ChatDetailsPanel
            :key="activeId"
            :open="detailsOpen"
            :conversation="activeConversation"
            :title="activeTitle"
            :disabled="
              readOnly ||
              busy ||
              initializationFailed ||
              sending ||
              fileBusy ||
              clearing
            "
            :allow-clear="!detached"
            :user-id="session.user.id"
            :group="groups.find((item) => item.roomId === activeId)"
            :list-friends="store.listFriends"
            :list-group-members="store.listGroupMembers"
            :add-group-members="store.addGroupMembers"
            :remove-group-members="store.removeGroupMembers"
            :exit-group="exitGroup"
            :dissolve-group="dissolveGroup"
            :group-removed="groupRemoved"
            :update-group-info="store.updateGroupInfo"
            @members-added="loadGroups"
            @members-removed="loadGroups"
            @group-updated="refreshGroupInfo"
            :toggle-top="toggleActiveConversationTop"
            :toggle-not-disturb="toggleActiveConversationNotDisturb"
            :not-disturb-busy="notDisturbBusy"
            @profile="openFriendProfile"
            @history="openHistory"
            @clear="clearOpen = true"
          />
        </div>
      </div>
    </section>

    <EmojiCollectionFeedback
      :text="friendSuccessFeedback"
      :pending="false"
      :failed="false"
    />
    <ChatDialogs
      v-model:delete-open="deleteOpen"
      v-model:clear-open="clearOpen"
      :active-title="activeTitle"
      :delete-title="deleteConversationTitle"
      :deleting="deleting"
      :clearing="clearing"
      :read-only="readOnly"
      @delete="deleteConversation"
      @clear="clearConversationHistory"
    />
    <RtcInviteMemberDialog
      v-if="createGroupOpen"
      mode="create-group"
      :members="createGroupMembers"
      :loading="createGroupLoading"
      :busy="createGroupBusy"
      :error="createGroupError"
      :submit-error="createGroupSubmitError"
      @cancel="cancelCreateGroup"
      @retry="loadCreateGroupFriends"
      @confirm="confirmCreateGroup"
    />
    <RtcInviteMemberDialog
      v-if="rtcInviteDialogOpen"
      :members="rtcInviteMembers"
      :loading="rtcInviteLoading"
      :busy="rtcInviteBusy"
      :error="rtcInviteError"
      @cancel="cancelRtcInviteDialog"
      @confirm="confirmRtcInvite"
    />
    <RtcRecoveryDialog
      :call="rtcRecovery"
      :busy="rtcRecoveryBusy"
      :error="rtcRecoveryError"
      @resolve="recoverRtcCall"
      @retry="refreshRtcRecovery"
      @dismiss="dismissRtcRecoveryError"
    />
    <RtcRedialDialog :open="rtcRedialDialogOpen" @resolve="resolveRtcRedial" />
  </section>
</template>

<script setup lang="ts">
import { publicAssetUrl } from '../../services/runtime/public-assets';
import {
  systemMessageText,
  parseGroupRemovalMessage,
  parseGroupInvitationMessage,
} from '../../../shared/chat/messages/system-message';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { ChatDotRound } from '@element-plus/icons-vue';
import type { AuthSession } from '../../services/auth/auth';
import {
  getAuthErrorMessage,
  getServerConfiguration,
} from '../../services/auth/auth';
import type {
  CachedMessagePage,
  Conversation,
  ConversationSummary,
  Message,
  MessagePosition,
} from '../../../shared/storage/database';
import type { ResourceSseStatus } from '../../../shared/windows/desktop';
import { RtcMediaMode } from '../../../shared/rtc/rtc';
import type { UserEmoji } from '../../../shared/chat/emoji';
import {
  encodeEmojiContent,
  parseEmojiContent,
} from '../../../shared/chat/emoji';
import type {
  ComposerImageDraft,
  SelectedImageDraft,
  StoredImageContent,
} from '../../../shared/media/image/image';
import {
  encodeImageContent,
  imageMessageBody,
} from '../../../shared/media/image/image';
import type { VoiceContent } from '../../../shared/media/voice/voice';
import { voiceMessageBody } from '../../../shared/media/voice/voice';
import { createMessageRecall } from '../../services/chat/messages/message-recall';
import { canDeleteMessage } from '../../../shared/chat/messages/message-deletion';
import {
  compareConversations,
  updateConversationActivity,
  upsertOrderedConversation,
} from '../../services/chat/conversations/conversation-order';
import {
  type MessagePreview,
  isSameMessagePreview,
  isSameMessageView,
  shouldUpdateMessagePreview,
} from '../../services/chat/messages/message-preview';
import type {
  ComposerVideoDraft,
  ComposerVideoItem,
  PreparingVideoDraft,
  StoredVideoContent,
  VideoDraftProcessingProgress,
} from '../../../shared/media/video/video';
import {
  isReadyVideoDraft,
  validateTemporaryVideo,
  validateVideo,
  videoMessageBody,
} from '../../../shared/media/video/video';
import { readVideoMetadata } from '../../services/media/video/video-metadata';
import type { VideoSendView } from '../../services/media/video/video-outbox';
import { createVideoOutbox } from '../../services/media/video/video-outbox';
import { parseUploadPlaceholder } from '../../../shared/chat/messages/upload-placeholder';
import type {
  ComposerFileDraft,
  FileDraftProcessingProgress,
  SelectedFileDraft,
} from '../../../shared/media/file/file-message';
import type {
  MediaDraftSelection,
  MediaDropResult,
} from '../../../shared/media/media-drafts';
import {
  FILE_ASSISTANT_TYPE,
  toHistoryMessage,
} from '../../../shared/chat/chat';
import {
  messageDisplayUid,
  parseRecallContent,
  shouldKeepRecalledMessage,
} from '../../../shared/chat/messages/recall-message';
import type { ResourceChatMessage } from '../../../shared/chat/messages/resource-message';
import { createChatStore } from '../../services/chat/chat';
import { createMessageRetryQueue } from '../../services/chat/messages/message-retry';
import {
  parseMessageRejectionNotice,
  FRIEND_VERIFICATION_REQUIRED_TEXT,
  parseMessageRejection,
} from '../../../shared/chat/messages/message-rejection';
import { createIncomingMessageReceiver } from '../../services/chat/messages/incoming-message';
import { createSoundPlaybackQueue } from '../../services/media/sound/sound-playback';
import { dispatchResourceMessage } from '../../services/events/resource-message';
import { useWorkspaceRtc } from './rtc/useWorkspaceRtc';
import RtcRecoveryDialog from './rtc/RtcRecoveryDialog.vue';
import RtcRedialDialog from './rtc/RtcRedialDialog.vue';
import { isFriendApplyNotification } from '../../../shared/contacts/friend-notification';
import { parseGroupMembersRemovedNotification } from '../../../shared/contacts/group-notification';
import type { GroupDepartureAction } from '../../../shared/contacts/group';
import { parseRoomHistorySyncNotification } from '../../../shared/chat/messages/room-history-sync';
import { useChatDirectory } from './directory/useChatDirectory';
import { useCreateGroup } from './directory/groups/useCreateGroup';
import { groupDisplayName } from '../../../shared/contacts/group-name';
import { useWorkspaceEmojis } from './emoji/useWorkspaceEmojis';
import { useWorkspaceContacts } from './conversation/useWorkspaceContacts';
import ChatTitleBar from './navigation/ChatTitleBar.vue';
import ChatNavRail from './navigation/ChatNavRail.vue';
import ChatDetailsPanel from './conversation/ChatDetailsPanel.vue';
import type { FriendProfileAnchor } from '../../../shared/contacts/friend-profile';
import ChatConversationHeader from './conversation/ChatConversationHeader.vue';
import ChatFeedback from './feedback/ChatFeedback.vue';
import EmojiCollectionFeedback from '../../components/chat/feedback/EmojiCollectionFeedback.vue';
import ConversationSidebar from './conversations/ConversationSidebar.vue';
import FriendDirectory from './directory/FriendDirectory.vue';
import FriendDetailPanel from './directory/friends/FriendDetailPanel.vue';
import FileAssistantDetailPanel from './directory/friends/FileAssistantDetailPanel.vue';
import FriendApplicationDetail from './directory/applications/FriendApplicationDetail.vue';
import GroupDetailPanel from './directory/groups/GroupDetailPanel.vue';
import ChatMessageList from '../../components/chat/messages/ChatMessageList.vue';
import { findUnreadTarget } from '../../services/chat/messages/unread-navigation';
import type { MessageScrollPosition } from '../../services/chat/messages/message-scroll-position';
import {
  applyMessageWindowUpdates,
  isMessagePlaceholder,
} from '../../services/chat/messages/message-window';
import type { MessageWindowUpdate } from '../../services/chat/messages/message-window';
import MessageComposer from '../../components/chat/composer/MessageComposer.vue';
import { canReplyToMessage } from '../../../shared/chat/messages/message-reply';
import { resolveMessageName } from '../../../shared/chat/messages/recall-message';
import ChatDialogs from './dialogs/ChatDialogs.vue';
import RtcInviteMemberDialog from './dialogs/RtcInviteMemberDialog.vue';

const props = defineProps<{
  detached?: ConversationSummary;
  session: AuthSession | Pick<AuthSession, 'user'>;
  loggingOut: boolean;
  sessionError: string;
  readOnly: boolean;
}>();
const emit = defineEmits<{
  logout: [];
  close: [];
  localReadError: [];
  initialized: [];
}>();
const store = createChatStore(
  (): void => {
    if (!disposed) emit('localReadError');
  },
  (): AuthSession => {
    if (disposed || props.readOnly || !('accessToken' in props.session))
      throw new Error('页面或登录状态已失效，请重新登录');
    return props.session;
  },
);
const isDesktop = Boolean(window.desktop);
const serverConfiguration = getServerConfiguration();
const networkAvailable = ref(navigator.onLine);
const resourceSseStatus = ref<ResourceSseStatus>(
  isDesktop ? 'connecting' : 'stopped',
);
const offlineMode = computed(
  (): boolean =>
    props.readOnly ||
    serverConfiguration !== 'configured' ||
    !networkAvailable.value,
);
const connectionLabel = computed((): string => {
  switch (true) {
    case props.readOnly:
      return '本地只读';
    case offlineMode.value:
      return '离线模式';
    case !isDesktop:
      return '浏览器预览';
    case resourceSseStatus.value === 'connected':
      return '已连接';
    case resourceSseStatus.value === 'reconnecting':
      return '重连中';
    default:
      return '连接中';
  }
});
const connectionHint = computed((): string => {
  if (props.readOnly) return '登录已过期，仅显示本机已保存的记录';
  const storage = isDesktop ? '记录仅保存在本机' : '记录仅暂存在内存';
  if (serverConfiguration === 'missing') return `未配置服务器，${storage}`;
  if (serverConfiguration === 'invalid')
    return `服务器地址配置无效，${storage}`;
  if (!networkAvailable.value) return `当前网络不可用，${storage}`;
  if (!isDesktop) return `浏览器预览未接入资源 SSE，${storage}`;
  if (resourceSseStatus.value === 'connected')
    return `资源 SSE 已连接，${storage}`;
  if (resourceSseStatus.value === 'reconnecting')
    return `资源 SSE 正在重连，${storage}`;
  return `资源 SSE 正在连接，${storage}`;
});
const conversations = ref<Conversation[]>([]);
/** 汇总非免打扰会话的未读数，不受搜索筛选影响。 */
const totalUnreadCount = computed((): number =>
  conversations.value.reduce(
    (total, item) => (item.notDisturb === 1 ? total : total + item.unreadCount),
    0,
  ),
);
const previews = ref<Record<string, MessagePreview>>({});
const section = ref<'chats' | 'directory'>('chats');
const search = ref('');
const activeId = ref('');
const renderedConversationId = ref('');
const messages = shallowRef<Message[]>([]);
const conversationMessages = shallowRef(new Map<string, Message[]>());
const MAX_CACHED_CONVERSATION_MESSAGES = 8;
let synchronizingConversationMessages = false;
const activeMessages = computed(
  (): Message[] =>
    conversationMessages.value.get(activeId.value) ?? messages.value,
);
const uploadingImage = ref(false);
const drafts = ref<Record<string, string>>({});
const replyDrafts = shallowRef<Record<string, Message>>({});
const activeReply = computed(
  (): Message | null => replyDrafts.value[activeId.value] ?? null,
);
const replySender = computed((): string => {
  const reply = activeReply.value;
  if (!reply) return '';
  if (reply.senderId === props.session.user.id)
    return props.session.user.nickname;
  return resolveMessageName(
    reply.senderId,
    reply.conversationId,
    contacts.value[reply.senderId],
  );
});
const imageDrafts = ref<Record<string, ComposerImageDraft[]>>({});
const videoDrafts = shallowRef<Record<string, ComposerVideoItem[]>>({});
const fileDrafts = shallowRef<Record<string, ComposerFileDraft[]>>({});
const fileSends = shallowRef<Record<string, VideoSendView>>({});
const fileTimers = new Map<string, ReturnType<typeof setTimeout>>();
const fileTaskRooms = new Map<string, string>();
const fileTaskDrafts = new Map<string, string>();
const videoSends = shallowRef<Record<string, VideoSendView>>({});
const completedVideoIds = new Set<string>();
const activeImageDrafts = computed(
  (): ComposerImageDraft[] => imageDrafts.value[activeId.value] ?? [],
);
const draft = computed({
  get: (): string => drafts.value[activeId.value] ?? '',
  set: (value: string): void => {
    drafts.value[activeId.value] = value;
  },
});
/** 按后端类型找到列表中已有的文件助手会话。 */
const fileAssistantConversation = computed((): Conversation | undefined =>
  conversations.value.find((item) => item.type === FILE_ASSISTANT_TYPE),
);
/** 当前选择只引用已经落库的真实会话。 */
const activeConversation = computed((): Conversation | undefined =>
  conversations.value.find((item) => item.id === activeId.value),
);
/** 导航状态由会话类型决定，不依赖特殊房间号。 */
const fileAssistantActive = computed(
  (): boolean => activeConversation.value?.type === FILE_ASSISTANT_TYPE,
);
/** 文件助手使用固定名称，群聊优先使用本次目录补齐的显示名。 */
const activeTitle = computed((): string => {
  const conversation = activeConversation.value;
  switch (conversation?.type) {
    case FILE_ASSISTANT_TYPE:
      return '文件传输助手';
    case 1: {
      const group = groups.value.find(
        (item) => item.roomId === conversation.id,
      );
      return group ? groupDisplayName(group) : conversation.title;
    }
    default:
      return conversation?.title ?? '';
  }
});

/** 重新读取群资料并同步当前会话标题，避免侧栏和聊天头部继续显示旧名称。 */
const refreshGroupInfo = async (roomId: string): Promise<void> => {
  await loadGroups();
  const group = groups.value.find((item) => item.roomId === roomId);
  const conversation = conversations.value.find((item) => item.id === roomId);
  if (group && conversation) conversation.title = groupDisplayName(group);
};
const deleteTargetId = ref('');
const deleteConversationTitle = computed((): string => {
  const target = conversations.value.find(
    (item) => item.id === deleteTargetId.value,
  );
  if (!target) return activeTitle.value;
  return target.type === FILE_ASSISTANT_TYPE ? '文件传输助手' : target.title;
});
const busy = ref(false);
const initializationFailed = ref(false);
const loadingMessages = ref(false);
const moreMessages = ref(false);
let localMessageBefore: MessagePosition | null = null;
let reconnectSyncPending = false;
let resourceStatusVersion = 0;
const sending = ref(false);
const deleting = ref(false);
const hiding = ref(false);
const clearing = ref(false);
const fileBusy = ref(false);
let screenshotPending = false;
const pinned = ref(false);
const deleteOpen = ref(false);
const clearOpen = ref(false);
const detailsOpen = ref(false);
let unsubscribeFriendProfileChat: (() => void) | undefined;
let unsubscribeFriendDeleted: (() => void) | undefined;
let unsubscribeFriendAdded: (() => void) | undefined;
let unsubscribeFriendRemark: (() => void) | undefined;
const conversationHeader = ref<InstanceType<typeof ChatConversationHeader>>();
/** 点击聊天信息以外的区域时收起侧栏，不拦截原来的点击行为。 */
const closeDetailsOnOutside = (event: PointerEvent): void => {
  if (
    !detailsOpen.value ||
    !(event.target instanceof Element) ||
    event.target.closest('.chat-details-panel, .chat-details-toggle')
  )
    return;
  detailsOpen.value = false;
};

/** Escape 收起侧栏并将键盘焦点还给三点按钮。 */
const closeDetailsOnEscape = (event: KeyboardEvent): void => {
  if (!detailsOpen.value || event.isComposing) return;
  detailsOpen.value = false;
  conversationHeader.value?.focusDetails();
};

const error = ref('');
const notice = ref('');
const applyingFriend = ref(false);
const friendSuccessFeedback = ref('');
let friendSuccessFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

/** 清理好友操作成功提示及计时器，避免跨账号或页面残留。 */
const clearFriendSuccessFeedback = (): void => {
  if (friendSuccessFeedbackTimer !== undefined)
    clearTimeout(friendSuccessFeedbackTimer);
  friendSuccessFeedbackTimer = undefined;
  friendSuccessFeedback.value = '';
};

/** 好友操作和退群成功后沿用统一的居中提示。 */
const showFriendSuccess = (text: string): void => {
  if (disposed || props.readOnly) return;
  clearFriendSuccessFeedback();
  friendSuccessFeedback.value = text;
  friendSuccessFeedbackTimer = setTimeout(clearFriendSuccessFeedback, 1500);
};

/** 从本地验证提示打开绑定单聊的申请表单，关系是否仍需验证由主进程核对。 */
const applyConversationFriend = async (message: Message): Promise<void> => {
  if (
    disposed ||
    props.readOnly ||
    applyingFriend.value ||
    message.conversationId !== activeId.value ||
    activeConversation.value?.type !== 2 ||
    message.senderId !== props.session.user.id ||
    message.deletedAt ||
    parseMessageRejectionNotice(message)?.text !==
      FRIEND_VERIFICATION_REQUIRED_TEXT
  )
    return;
  if (!window.desktop) {
    notice.value = '朋友验证需在 Electron 桌面程序中打开';
    return;
  }
  const version = selectionVersion;
  applyingFriend.value = true;
  try {
    const submitted = await window.desktop.openConversationFriendApplication(
      message.conversationId,
    );
    if (
      !disposed &&
      !props.readOnly &&
      version === selectionVersion &&
      submitted
    ) {
      if (submitted.status === 'ADDED') showFriendSuccess('已添加');
      else showFriendSuccess('朋友验证已发送');
    }
  } catch (cause) {
    if (!disposed && !props.readOnly && version === selectionVersion)
      error.value = getAuthErrorMessage(cause, '打开朋友验证失败，请重试');
  } finally {
    applyingFriend.value = false;
  }
};

const messageList = ref<InstanceType<typeof ChatMessageList>>();
const readReadyRoom = ref('');
const unreadNavigation = ref<{ afterId: string; count: number } | null>(null);
const locatingUnread = ref(false);
const locatingReply = ref(false);
const recordedReads = new Map<string, string>();
interface ConversationViewState {
  position: MessageScrollPosition;
  unread: { afterId: string; count: number } | null;
}
const conversationViewStates = new Map<string, ConversationViewState>();

/** 按最近使用顺序缓存当前会话消息，并淘汰最久未访问的消息快照。 */
const cacheConversationMessages = (
  roomId: string,
  currentMessages: Message[],
): void => {
  const next = new Map(conversationMessages.value);
  next.delete(roomId);
  next.set(roomId, currentMessages);
  while (next.size > MAX_CACHED_CONVERSATION_MESSAGES) {
    const oldestRoomId = next.keys().next().value;
    if (oldestRoomId === undefined) break;
    next.delete(oldestRoomId);
  }
  conversationMessages.value = next;
};

watch(
  [activeId, messages],
  ([roomId, currentMessages]): void => {
    if (!roomId || synchronizingConversationMessages) return;
    cacheConversationMessages(roomId, currentMessages);
  },
  { flush: 'sync' },
);

/** 实际阅读先经主进程持久化，网络合并与退出补交不依赖页面存活。 */
const recordVisibleRead = async (message: Message): Promise<void> => {
  const desktop = window.desktop;
  if (
    !desktop ||
    disposed ||
    props.readOnly ||
    activeId.value !== message.conversationId ||
    readReadyRoom.value !== message.conversationId ||
    recordedReads.get(message.conversationId) === message.id
  )
    return;
  const version = selectionVersion;
  try {
    const saved = await desktop.recordConversationRead(
      message.conversationId,
      message.id,
    );
    if (saved && !disposed && version === selectionVersion)
      recordedReads.set(message.conversationId, message.id);
  } catch (cause) {
    if (!disposed && !props.readOnly && version === selectionVersion)
      error.value = getAuthErrorMessage(
        cause,
        '保存已读进度失败，请重新进入会话',
      );
  }
};
const messageComposer = ref<InstanceType<typeof MessageComposer>>();

/** 按会话保存引用快照，选中后聚焦正文，不能将只读或失效消息作为引用。 */
const selectReply = (message: Message): void => {
  const current = messages.value.find((item) => item.id === message.id);
  if (
    disposed ||
    props.readOnly ||
    groupRemoved.value ||
    !isRemoteConversation(activeId.value) ||
    !current ||
    isMessagePlaceholder(current) ||
    current.conversationId !== activeId.value ||
    !canReplyToMessage(current)
  )
    return;
  replyDrafts.value = {
    ...replyDrafts.value,
    [activeId.value]: { ...current },
  };
  void ensureContact(current.senderId, current.conversationId);
  void nextTick(() => {
    if (
      !disposed &&
      !props.readOnly &&
      activeId.value === current.conversationId
    )
      messageComposer.value?.focus();
  });
};

/** 只清理指定引用，异步发送完成不能抹掉后来重新选择的草稿。 */
const consumeReply = (roomId: string, reply: Message | null): void => {
  if (!reply || replyDrafts.value[roomId] !== reply) return;
  const next = { ...replyDrafts.value };
  delete next[roomId];
  replyDrafts.value = next;
};

/** 取消引用不修改已经输入的文字或附件。 */
const cancelReply = (): void => {
  consumeReply(activeId.value, activeReply.value);
  messageComposer.value?.focus();
};
let selectionVersion = 0;
let disposed = false;
const {
  userEmojis,
  emojiLoading,
  emojiError,
  busyEmojiId,
  emojiOperation,
  loadEmojis,
  deleteEmoji,
  moveEmojiToFront,
  invalidateEmojiRequests,
} = useWorkspaceEmojis({
  getSession: (): AuthSession | Pick<AuthSession, 'user'> => props.session,
  isReadOnly: (): boolean => props.readOnly,
  isDisposed: (): boolean => disposed,
});
const { contacts, ensureContact, refreshContact, updateContactRemark } =
  useWorkspaceContacts({
    store,
    getSession: (): AuthSession | Pick<AuthSession, 'user'> => props.session,
    isReadOnly: (): boolean => props.readOnly,
    isDisposed: (): boolean => disposed,
    isRemoteConversation: (roomId: string): boolean =>
      isRemoteConversation(roomId),
  });
const {
  friends,
  friendsBusy,
  friendsError,
  friendUnread,
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
  friendUnreadApplicationUids,
  loadFriends,
  loadGroups,
  groupExited: removeGroupFromDirectory,
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
  friendDeleted: removeFriendFromDirectory,
  friendAdded: addFriendToDirectory,
  friendRemarkUpdated,
  selectGroup,
  openGroup,
  openFriend,
  openSearchedFriend,
  resetDirectory,
} = useChatDirectory({
  store,
  isDisposed: (): boolean => disposed,
  isReadOnly: (): boolean => props.readOnly,
  isBusy: (): boolean => busy.value,
  isSending: (): boolean => sending.value,
  isDesktop,
  error,
  notice,
  showFriendSuccess,
  /** 通讯录同步后沿用原有摘要规则，是否清空旧预览由原入口决定。 */
  applyConversations: (
    summaries: ConversationSummary[],
    resetPreviews: boolean,
  ): void => {
    conversations.value = [...summaries].sort(compareConversations);
    if (resetPreviews) previews.value = {};
    for (const item of summaries)
      setPreview(
        item.id,
        item.lastMessage ?? '',
        item.lastMessageSenderId ?? undefined,
        item.lastMessageType,
        {
          messageId: item.lastMessageId,
          createdAt: item.lastMessageCreatedAt,
        },
      );
  },
  /** 保留好友和群入口各自的导航行为，再进入统一消息读取流程。 */
  selectConversation: async (
    conversation: Conversation,
    source: 'friend' | 'group',
  ): Promise<void> => {
    switch (source) {
      case 'friend':
        section.value = 'chats';
        break;
      case 'group':
        search.value = '';
        break;
    }
    await selectConversation(conversation);
  },
  synchronizeConversations: (): Promise<void> => incomingMessages.synchronize(),
});
let unsubscribeSseStatus: (() => void) | undefined;
let unsubscribeOpenFriendChat: (() => void) | undefined;
let unsubscribeTrayConversation: (() => void) | undefined;
let unsubscribeResourceMessage: (() => void) | undefined;
let unsubscribeMediaDrop: (() => void) | undefined;
let unsubscribeVideoProgress: (() => void) | undefined;
let unsubscribeVideoPreparation: (() => void) | undefined;
let unsubscribeFilePreparation: (() => void) | undefined;
let unsubscribeFileProgress: (() => void) | undefined;
const pendingTimers = new Map<
  string,
  { timer: ReturnType<typeof setTimeout>; message: Message }
>();

/** 清除当前工作台反馈，不改变会话或草稿。 */
const clearFeedback = (): void => {
  error.value = '';
  notice.value = '';
  recallFeedback.value = null;
};

/** 更新摘要及其来源，仅原始消息摘要按需补全发送者资料。 */
const setPreview = (
  id: string,
  text: string,
  senderId?: string,
  messageType?: string | null,
  source?: Pick<MessagePreview, 'messageId' | 'clientMsgId' | 'createdAt'>,
): void => {
  const next: MessagePreview = {
    text:
      messageType === 'system'
        ? systemMessageText(text, props.session.user.id)
        : text,
    senderId,
    messageType,
    ...source,
  };
  if (isSameMessagePreview(previews.value[id], next)) return;
  previews.value[id] = next;
  if (messageType === 'system' || messageType === 'local-notice') return;
  const uid =
    messageType === 'recalled' ? parseRecallContent(text).recallUid : senderId;
  if (uid) void ensureContact(uid, id);
};

/** 发送、历史读取与 SSE 共用预览规则，不改动消息正文。 */
const setMessagePreview = (message: Message): void => {
  const reply = replyDrafts.value[message.conversationId];
  if (reply?.id === message.id && !canReplyToMessage(message))
    consumeReply(message.conversationId, reply);
  const conversation = conversations.value.find(
    (item) => item.id === message.conversationId,
  );
  let previewText: string;
  switch (true) {
    case Boolean(message.deletedAt):
      previewText = '消息已移除';
      break;
    case message.messageType === 'local-notice':
      previewText = parseMessageRejectionNotice(message)?.text ?? '';
      break;
    case message.messageType === 'emoji':
      previewText = '[表情包]';
      break;
    case message.messageType === 'video':
      previewText = '[视频]';
      break;
    case message.messageType === 'file':
      previewText = '[文件]';
      break;
    case message.messageType === 'audio':
      previewText = '[语音]';
      break;
    case message.messageType === 'rtc-call':
      previewText = '[通话]';
      break;
    case message.messageType === 'temporary':
      previewText =
        parseUploadPlaceholder(message.content)?.targetType === 6
          ? '[文件上传中]'
          : '[视频上传中]';
      break;
    case message.messageType === 'upload-cancelled':
      previewText = '[已取消发送]';
      break;
    case message.messageType === 'image':
      previewText = '[图片]';
      break;
    default:
      previewText = message.content;
      break;
  }
  setPreview(
    message.conversationId,
    previewText,
    conversation?.type != null &&
      conversation.type !== FILE_ASSISTANT_TYPE &&
      message.messageType !== 'system' &&
      message.messageType !== 'local-notice' &&
      !message.deletedAt
      ? message.senderId
      : undefined,
    message.deletedAt ? null : message.messageType,
    {
      messageId: message.id,
      clientMsgId: message.clientMsgId,
      createdAt: message.createdAt,
    },
  );
};

/** 格式化本地时间，非当天显示月日。 */
const formatTime = (value: string): string => {
  const date = new Date(value);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
};

/** 加载持久化会话。 */
const initialize = async (): Promise<void> => {
  if (busy.value) return;
  busy.value = true;
  if (!props.readOnly) void loadGroups();
  if (!props.readOnly && !props.detached && window.desktop) void loadEmojis();
  clearFeedback();
  try {
    if (window.desktop && !props.readOnly && !props.detached) {
      try {
        await window.desktop.syncRemoteContacts();
      } catch (error) {
        // 同步远端会话失败不阻断本地会话展示，但提示原因便于排查。
        notice.value = getAuthErrorMessage(
          error,
          '同步会话列表失败，请稍后重试',
        );
      }
    }
    const summaries = await store.listConversations();
    if (disposed) return;
    conversations.value = [...summaries].sort(compareConversations);
    previews.value = {};
    for (const item of summaries)
      setPreview(
        item.id,
        item.lastMessage ?? '',
        item.lastMessageSenderId ?? undefined,
        item.lastMessageType,
        {
          messageId: item.lastMessageId,
          createdAt: item.lastMessageCreatedAt,
        },
      );
    initializationFailed.value = false;
  } catch {
    initializationFailed.value = true;
    error.value = '读取本地会话失败，请重试。';
  } finally {
    busy.value = false;
  }
  if (props.detached && !initializationFailed.value && !disposed)
    await selectConversation(props.detached);
};

/** 主窗口仅提交会话标识，由主进程决定复用或创建独立窗口。 */
const openConversationWindow = async (
  conversation: Conversation,
  outside: boolean,
): Promise<void> => {
  if (!window.desktop) {
    notice.value = '独立聊天窗口需在桌面程序中打开';
    return;
  }
  try {
    await window.desktop.openConversation(conversation.id, outside);
  } catch (cause) {
    if (!disposed)
      error.value = getAuthErrorMessage(cause, '打开独立聊天窗口失败');
  }
};

/** 保存当前会话的消息视口和未读定位状态，供再次进入会话时恢复。 */
const saveConversationViewState = (): void => {
  const roomId = activeId.value;
  const activeMessageList = messageList.value;
  if (
    !roomId ||
    !activeMessageList ||
    activeMessageList.conversationId !== roomId
  )
    return;
  const position = activeMessageList.captureScrollPosition();
  if (!position) return;
  conversationViewStates.set(roomId, {
    position,
    unread: unreadNavigation.value,
  });
};

/** 原位替换缓存正文，拒绝隐藏窗口及已被实时事件更新的旧结果。 */
const updateMessageWindow = (
  roomId: string,
  updates: MessageWindowUpdate[],
): void => {
  if (
    disposed ||
    roomId !== activeId.value ||
    roomId !== renderedConversationId.value
  )
    return;
  messages.value = applyMessageWindowUpdates(messages.value, updates);
};

/** 开始切换会话但保留旧组件实例，让 KeepAlive 负责冻结和恢复消息视口。 */
const beginConversationSelection = (roomId: string): void => {
  const nextMessages = conversationMessages.value.get(roomId) ?? [];
  saveConversationViewState();
  selectionVersion++;
  unreadNavigation.value = null;
  locatingUnread.value = false;
  locatingReply.value = false;
  synchronizingConversationMessages = true;
  try {
    activeId.value = roomId;
    renderedConversationId.value = roomId;
    messages.value = nextMessages;
  } finally {
    synchronizingConversationMessages = false;
  }
  cacheConversationMessages(roomId, nextMessages);
};

const clearSelection = (): void => {
  saveConversationViewState();
  selectionVersion++;
  unreadNavigation.value = null;
  locatingUnread.value = false;
  locatingReply.value = false;
  activeId.value = '';
  loadingMessages.value = false;
  localMessageBefore = null;
  reconnectSyncPending = false;
};

/** 打开当前会话的历史记录，搜索范围不受已加载消息页数限制。 */
const openHistory = async (): Promise<void> => {
  if (!activeId.value || busy.value || sending.value || fileBusy.value) return;
  if (!window.desktop) {
    notice.value = '独立聊天记录窗口需在 Electron 桌面程序中打开';
    return;
  }
  try {
    await window.desktop.openHistory(activeId.value);
  } catch {
    error.value = '打开聊天记录窗口失败，请重试';
  }
};

/** 打开独立设置窗口；浏览器预览只提示桌面端能力限制。 */
const openSettings = async (): Promise<void> => {
  if (!window.desktop) {
    notice.value = '独立设置窗口需在 Electron 桌面程序中打开';
    return;
  }
  try {
    await window.desktop.openSettings();
  } catch {
    error.value = '打开设置窗口失败，请重试';
  }
};

/** 资料只在原会话的侧栏仍展开时打开，群成员复用单聊资料窗口。 */
const openFriendProfile = async (
  anchor: FriendProfileAnchor,
  targetUid?: string,
): Promise<void> => {
  const conversation = activeConversation.value;
  if (
    disposed ||
    props.readOnly ||
    busy.value ||
    initializationFailed.value ||
    !detailsOpen.value ||
    (conversation?.type !== 2 && conversation?.type !== 1) ||
    (conversation?.type === 1 && !targetUid)
  )
    return;
  if (!window.desktop) {
    notice.value = '好友资料浮窗需在 Electron 桌面程序中打开';
    return;
  }

  try {
    await window.desktop.openFriendProfile(conversation.id, anchor, targetUid);
  } catch (cause) {
    if (!disposed && selectionVersion === selectionVersion && detailsOpen.value)
      error.value = getAuthErrorMessage(cause, '打开好友资料窗口失败，请重试');
  }
};

/** 从聊天详情切换当前会话置顶状态，复用统一的服务端确认流程。 */
const toggleActiveConversationTop = async (status: 0 | 1): Promise<void> => {
  const conversation = activeConversation.value;
  if (!conversation) throw new Error('当前会话不存在');
  await toggleConversationTop(conversation, status, false);
};

/** 离开资料入口后关闭原生浮窗，不影响主页面其他操作。 */
const dismissFriendProfile = (): void => {
  void window.desktop?.closeFriendProfile().catch(() => {
    // 主窗口销毁或授权撤销时，主进程也会清理资料窗口。
  });
};

/** 打开独立添加朋友窗口，浏览器预览不伪造原生窗口。 */
const openAddFriend = async (): Promise<void> => {
  if (disposed || props.readOnly || busy.value || initializationFailed.value)
    return;
  if (!window.desktop) {
    notice.value = '添加朋友窗口需在 Electron 桌面程序中打开';
    return;
  }
  try {
    await window.desktop.openAddFriend();
  } catch {
    if (!disposed) error.value = '打开添加朋友窗口失败，请重试';
  }
};

/** 返回聊天列表，保留当前正在阅读的会话。 */
const showChats = (): void => {
  clearFriendSelection();
  section.value = 'chats';
};

/** 查看好友联系人目录，不把好友资料伪装成本地会话。 */
const showDirectory = (): void => {
  if (sending.value) return;
  clearFriendSelection();
  section.value = 'directory';
  clearSelection();
  void loadFriends();
  void loadGroups();
};

const incomingMessageSound = publicAssetUrl('sounds/收到消息.wav');
const notDisturbBusy = ref(false);
let notDisturbVersion = 0;
const messageSounds = createSoundPlaybackQueue(
  props.detached ? [] : [incomingMessageSound],
);
const incomingMessages = createIncomingMessageReceiver({
  context: (): object | null =>
    disposed || props.readOnly ? null : props.session,
  /** 仅刷新本群尚未满九人的拼接头像，不等待读取或改变当前会话。 */
  onGroupInvitation: (roomId: string): void => {
    void refreshGroupAvatar(roomId);
  },
  hasConversation: (roomId): boolean =>
    conversations.value.some((conversation) => conversation.id === roomId),
  /** 列表接口不标记已读；只补入新会话，不覆盖其他消息刚更新的摘要和选择。 */
  synchronize: async (roomId, validate): Promise<void> => {
    validate();
    const preferenceVersion = notDisturbVersion;
    if (roomId) {
      const refreshed = await store.refreshConversationInfo(roomId);
      validate();
      const current = conversations.value.find(
        (conversation) => conversation.id === roomId,
      );
      const hasNewerMessage =
        current !== undefined && current.updatedAt > refreshed.updatedAt;
      const restored: ConversationSummary = current
        ? {
            ...refreshed,
            notDisturb:
              preferenceVersion === notDisturbVersion && !notDisturbBusy.value
                ? refreshed.notDisturb
                : current.notDisturb,
            unreadCount: current.unreadCount,
            updatedAt: hasNewerMessage
              ? current.updatedAt
              : refreshed.updatedAt,
          }
        : refreshed;
      conversations.value = upsertOrderedConversation(
        conversations.value,
        restored,
      );
      if (!current) {
        setPreview(
          restored.id,
          restored.lastMessage ?? '',
          restored.lastMessageSenderId ?? undefined,
          restored.lastMessageType,
          {
            messageId: restored.lastMessageId,
            createdAt: restored.lastMessageCreatedAt,
          },
        );
      }
      return;
    }
    await store.syncRemoteContacts();
    validate();
    const summaries = await store.listConversations();
    validate();
    if (preferenceVersion === notDisturbVersion && !notDisturbBusy.value) {
      const preferences = new Map(
        summaries.map((item) => [item.id, item.notDisturb]),
      );
      for (const conversation of conversations.value) {
        const status = preferences.get(conversation.id);
        if (status !== undefined) conversation.notDisturb = status;
      }
    }
    const known = new Set(
      conversations.value.map((conversation) => conversation.id),
    );
    const added = summaries.filter(
      (conversation) => !known.has(conversation.id),
    );
    for (const item of added) {
      conversations.value = upsertOrderedConversation(
        conversations.value,
        item,
      );
      setPreview(
        item.id,
        item.lastMessage ?? '',
        item.lastMessageSenderId ?? undefined,
        item.lastMessageType,
        { messageId: item.lastMessageId, createdAt: item.lastMessageCreatedAt },
      );
    }
  },
  /** 新消息先计未读，实际阅读另行确认；新会话由数据库快照边界避免重复计数。 */
  save: async (message, synchronized): Promise<boolean> => {
    const session = props.session;
    const result = await store.saveIncomingMessage(message, !synchronized);
    if (disposed || props.readOnly || props.session !== session) return false;
    return result.saved;
  },
});

/** 断线恢复后同步真实群会话，不标记已读或自动切换会话。 */
const synchronizeGroupConversations = async (): Promise<void> => {
  if (disposed || props.readOnly || props.detached) return;
  const session = props.session;
  try {
    await incomingMessages.synchronize(true);
    if (disposed || props.readOnly || props.session !== session) return;
    await loadGroups();
  } catch (cause) {
    if (!disposed && !props.readOnly && props.session === session)
      error.value = getAuthErrorMessage(cause, '群会话同步失败');
  }
};

/** 等待消息渲染后滚动至底部。 */
const scrollToBottom = async (): Promise<void> => {
  const version = selectionVersion;
  await nextTick();
  if (!disposed && version === selectionVersion)
    messageList.value?.scrollToBottom();
};

const deletedMessageIds = new Set<string>();
const deletingMessages = ref(new Set<string>());
const deletionVersions = new Map<string, number>();

/** 删除后只读取本地摘要和未读，不因删除发起远端请求。 */
const refreshDeletedSummary = async (roomId: string): Promise<void> => {
  const version = (deletionVersions.get(roomId) ?? 0) + 1;
  deletionVersions.set(roomId, version);
  const owner = props.session.user.id;
  const preview = previews.value[roomId];
  const unread = conversations.value.find(
    (item) => item.id === roomId,
  )?.unreadCount;
  try {
    const summary = (await store.listConversations()).find(
      (item) => item.id === roomId,
    );
    if (
      disposed ||
      props.readOnly ||
      owner !== props.session.user.id ||
      deletionVersions.get(roomId) !== version ||
      !summary
    )
      return;
    const conversation = conversations.value.find((item) => item.id === roomId);
    if (!conversation) return;
    if (conversation.unreadCount === unread)
      conversation.unreadCount = summary.unreadCount;
    if (previews.value[roomId] !== preview) return;
    setPreview(
      roomId,
      summary.lastMessage ?? '',
      summary.lastMessageSenderId ?? undefined,
      summary.lastMessageType,
      {
        messageId: summary.lastMessageId,
        createdAt: summary.lastMessageCreatedAt,
      },
    );
  } catch (failure) {
    if (!disposed && !props.readOnly && owner === props.session.user.id)
      notice.value = getAuthErrorMessage(
        failure,
        '消息已删除，会话摘要刷新失败',
      );
  }
};

/** 本地标记提交后同步当前客户端的已缓存视图，同时清理引用草稿。 */
const applyMessageDeletion = (message: Message): void => {
  const key = `${message.conversationId}:${message.id}`;
  if (deletedMessageIds.has(key)) return;
  deletedMessageIds.add(key);
  /** 缓存可能包含其他会话消息，按房间和消息共同过滤。 */
  const keep = (item: Message): boolean =>
    item.id !== message.id || item.conversationId !== message.conversationId;
  cacheConversationMessages(
    message.conversationId,
    (conversationMessages.value.get(message.conversationId) ?? []).filter(keep),
  );
  if (activeId.value === message.conversationId)
    messages.value = messages.value.filter(keep);
  if (replyDrafts.value[message.conversationId]?.id === message.id) {
    const drafts = { ...replyDrafts.value };
    delete drafts[message.conversationId];
    replyDrafts.value = drafts;
  }
  const preview = previews.value[message.conversationId];
  if (!preview?.messageId || preview.messageId === message.id)
    setPreview(message.conversationId, '');
  void refreshDeletedSummary(message.conversationId);
};

/** 删除只写入当前客户端内容库，不影响服务端或其他客户端。 */
const deleteMessage = async (message: Message): Promise<void> => {
  if (
    disposed ||
    props.readOnly ||
    !canDeleteMessage(message) ||
    deletingMessages.value.has(message.id)
  )
    return;
  const owner = props.session.user.id;
  deletingMessages.value = new Set(deletingMessages.value).add(message.id);
  try {
    await store.deleteMessage({
      conversationId: message.conversationId,
      messageId: message.id,
    });
    if (!disposed && !props.readOnly && owner === props.session.user.id)
      applyMessageDeletion(message);
  } catch (failure) {
    if (
      !disposed &&
      !props.readOnly &&
      owner === props.session.user.id &&
      !deletedMessageIds.has(`${message.conversationId}:${message.id}`)
    )
      error.value = getAuthErrorMessage(failure, '删除消息失败，请重试');
  } finally {
    const pending = new Set(deletingMessages.value);
    pending.delete(message.id);
    deletingMessages.value = pending;
  }
};

/** 合并远端记录与本地未确认记录，按消息时间升序返回并消除重复项。 */
const mergeMessages = (...groups: Message[][]): Message[] => {
  const values = new Map<string, Message>();
  const clientIds = new Map<string, string>();
  for (const group of groups) {
    for (const message of group) {
      if (deletedMessageIds.has(`${message.conversationId}:${message.id}`))
        continue;
      const key = message.clientMsgId
        ? JSON.stringify([
            message.conversationId,
            message.senderId,
            message.clientMsgId,
          ])
        : null;
      const previousId = key ? clientIds.get(key) : undefined;
      const previous = values.get(previousId ?? message.id);
      if (shouldKeepRecalledMessage(previous, message)) continue;
      if (
        previous?.messageType === 'upload-cancelled' &&
        message.messageType !== 'upload-cancelled' &&
        message.messageType !== 'recalled'
      )
        continue;
      if (
        message.messageType === 'temporary' &&
        previous &&
        previous.messageType !== 'temporary'
      )
        continue;
      if (
        previous?.status === 'sent' &&
        (message.status === 'pending' || message.status === 'failed')
      )
        continue;
      if (previousId) values.delete(previousId);
      values.set(
        message.id,
        previous?.deletedAt
          ? { ...message, content: '', deletedAt: previous.deletedAt }
          : message,
      );
      if (key) clientIds.set(key, message.id);
    }
  }
  return [...values.values()].sort(
    (a, b) =>
      a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
};

/** 取消同会话本人消息的发送超时，并更新发送请求持有的对象。 */
const settleConfirmedMessage = (message: Message): void => {
  if (message.messageType === 'local-notice') return;
  if (message.messageType === 'recalled') {
    recalledIds.add(message.id);
    messageRecall.acknowledge(message);
    void messageRecall.restore(message).catch((): void => {
      if (
        !disposed &&
        !props.readOnly &&
        activeId.value === message.conversationId
      )
        notice.value = '读取撤回原文失败，请重新进入会话重试';
    });
  }
  messageRetry.acknowledge(message);
  if (
    ['video', 'file', 'upload-cancelled', 'recalled'].includes(
      message.messageType,
    )
  )
    completedVideoIds.add(message.id);
  videoOutbox.acknowledge(message);
  if (
    message.clientMsgId &&
    message.senderId === props.session.user.id &&
    ['file', 'upload-cancelled', 'recalled'].includes(message.messageType)
  ) {
    const native = fileTaskDrafts.get(message.clientMsgId);
    if (message.messageType === 'recalled' && native)
      void window.desktop
        ?.releaseFileDraft(message.conversationId, native)
        .catch(() => {});
    clearTimeout(fileTimers.get(message.clientMsgId));
    fileTimers.delete(message.clientMsgId);
    fileTaskRooms.delete(message.clientMsgId);
    fileTaskDrafts.delete(message.clientMsgId);
    const next = { ...fileSends.value };
    delete next[message.clientMsgId];
    fileSends.value = next;
    videoSends.value = { ...videoOutbox.snapshot(), ...next };
  }
  for (const existing of messages.value) {
    if (
      existing.conversationId === message.conversationId &&
      existing.senderId === message.senderId &&
      (existing.id === message.id ||
        (message.clientMsgId !== null &&
          existing.clientMsgId === message.clientMsgId))
    ) {
      existing.id = message.id;
      existing.status = 'sent';
    }
  }
  if (message.clientMsgId && message.senderId === props.session.user.id) {
    const pending = pendingTimers.get(message.clientMsgId);
    if (pending?.message.conversationId === message.conversationId) {
      clearTimeout(pending.timer);
      pending.message.id = message.id;
      pending.message.status = 'sent';
      pendingTimers.delete(message.clientMsgId);
    }
  }
};

/** 应用本地读取的消息，仅已确认记录可以取消发送超时。 */
const applyConfirmedMessages = (page: Message[]): void => {
  for (const message of page) {
    if (message.status === 'sent') settleConfirmedMessage(message);
  }
  let visiblePage: Message[];
  switch (props.readOnly) {
    case true:
      visiblePage = page.map((message): Message => {
        if (message.status === 'pending')
          return { ...message, status: 'failed' };
        return message;
      });
      break;
    default:
      visiblePage = page;
      break;
  }
  messages.value = mergeMessages(messages.value, visiblePage);
  const newest = messages.value[messages.value.length - 1];
  if (!newest || isMessagePlaceholder(newest)) return;
  const conversation = conversations.value.find(
    (item) => item.id === newest.conversationId,
  );
  if (
    conversation &&
    shouldUpdateMessagePreview(
      previews.value[conversation.id],
      newest,
      conversation.updatedAt,
    )
  ) {
    setMessagePreview(newest);
    conversations.value = updateConversationActivity(
      conversations.value,
      newest.conversationId,
      newest.createdAt,
    );
  }
};

/** 只有桌面已同步的远端会话使用服务端游标，本地会话保持原分页。 */
const isRemoteConversation = (conversationId: string): boolean =>
  isDesktop &&
  conversations.value.some(
    (item) => item.id === conversationId && item.type !== null,
  ) &&
  serverConfiguration === 'configured';

/** 更新本地分页位置；远端余量不取决于本地返回的条数。 */
const applyCachedPage = (page: CachedMessagePage): void => {
  applyConfirmedMessages(page.list);
  localMessageBefore = page.before;
  moreMessages.value =
    page.hasMoreLocal ||
    (page.hasMoreRemote &&
      !props.readOnly &&
      isRemoteConversation(activeId.value));
};

/** 同步后重读本地最新页，初次进入替换快照，重连时保留已有阅读位置。 */
const refreshCachedMessages = async (
  id: string,
  version: number,
  replace: boolean,
): Promise<void> => {
  const snapshot = new Set(messages.value);
  const page = await store.readCachedMessagePage(id, null);
  if (disposed || version !== selectionVersion) return;
  /** 初次进入只保留本地查询期间到达的实时消息，避免旧快照覆盖确认结果。 */
  const update = (): void => {
    if (replace)
      messages.value = messages.value.filter(
        (message) => !snapshot.has(message),
      );
    applyCachedPage(page);
  };
  const activeMessageList = messageList.value;
  if (!replace && activeMessageList && activeMessageList.conversationId === id)
    await activeMessageList.preserveScroll(update);
  else update();
};

/** 重连或订阅完成后补齐当前会话；忙碌时延后，其他会话下次选择时同步。 */
const syncAfterReconnect = async (): Promise<void> => {
  if (
    !reconnectSyncPending ||
    props.readOnly ||
    disposed ||
    loadingMessages.value ||
    locatingUnread.value ||
    locatingReply.value ||
    sending.value ||
    deleting.value ||
    !isRemoteConversation(activeId.value)
  )
    return;
  reconnectSyncPending = false;
  const id = activeId.value;
  const version = selectionVersion;
  loadingMessages.value = true;
  try {
    await refreshSelectedConversation(id, version);
    if (disposed || version !== selectionVersion) return;
    if (removedGroups.value[id]) {
      await refreshCachedMessages(id, version, false);
      if (!disposed && version === selectionVersion) readReadyRoom.value = id;
      return;
    }
    await store.syncMessageHistory(id, 'latest');
    if (disposed || version !== selectionVersion) return;
    await refreshCachedMessages(id, version, false);
    if (!disposed && version === selectionVersion) readReadyRoom.value = id;
  } catch (cause) {
    if (!disposed && version === selectionVersion) {
      await refreshLocalAfterSyncFailure(id, version);
      if (disposed || version !== selectionVersion) return;
      if (removedGroups.value[id]) {
        readReadyRoom.value = id;
        return;
      }
      error.value = getAuthErrorMessage(
        cause,
        '补同步消息失败，已保留本地记录，请重新选择会话重试。',
      );
    }
  } finally {
    if (version === selectionVersion) {
      loadingMessages.value = false;
      if (reconnectSyncPending) void syncAfterReconnect();
    }
  }
};

/** 同步被拒绝后重新读取本地分页；授权失效仍由主进程拒绝访问。 */
const refreshLocalAfterSyncFailure = async (
  id: string,
  version: number,
): Promise<void> => {
  try {
    await refreshCachedMessages(id, version, false);
  } catch {
    // 保留已展示快照，认证生命周期负责关闭失效账号的内容页面。
  }
};

let contactInfoVersion = 0;
/** 刷新当前点击的会话详情，退出群只保留本地会话和消息。 */
const refreshSelectedConversation = async (
  id: string,
  version: number,
  captureUnread: boolean = false,
): Promise<void> => {
  if (props.readOnly) return;
  const requestVersion = ++contactInfoVersion;
  const preferenceVersion = notDisturbVersion;
  canRecallMembers.value = false;
  const previewBefore = previews.value[id];
  try {
    const refreshed = await store.refreshConversationInfo(id);
    if (
      disposed ||
      version !== selectionVersion ||
      activeId.value !== id ||
      requestVersion !== contactInfoVersion
    )
      return;
    removedGroups.value[id] = refreshed.groupRemoved === true;
    if (refreshed.groupRemoved) unreadNavigation.value = null;
    else if (captureUnread)
      unreadNavigation.value =
        refreshed.unreadCount > 0 && refreshed.lastReadMsgId !== undefined
          ? { afterId: refreshed.lastReadMsgId, count: refreshed.unreadCount }
          : null;
    canRecallMembers.value =
      refreshed.type === 1 && refreshed.canRecallMembers === true;
    const index = conversations.value.findIndex((item) => item.id === id);
    const current = conversations.value[index];
    if (!current) return;
    const hasNewerMessage = current.updatedAt > refreshed.updatedAt;
    conversations.value = upsertOrderedConversation(conversations.value, {
      id: refreshed.id,
      title: refreshed.title,
      participantId: refreshed.participantId,
      avatar: refreshed.avatar,
      type: refreshed.type,
      isTop: refreshed.isTop,
      notDisturb:
        preferenceVersion === notDisturbVersion && !notDisturbBusy.value
          ? refreshed.notDisturb
          : current.notDisturb,
      unreadCount: current.unreadCount,
      createdAt: refreshed.createdAt,
      updatedAt: hasNewerMessage ? current.updatedAt : refreshed.updatedAt,
    });
    if (
      previews.value[id] === previewBefore &&
      (!hasNewerMessage ||
        refreshed.lastMessageId === previewBefore?.messageId) &&
      !(
        previewBefore?.messageType === 'recalled' &&
        refreshed.lastMessageType !== 'recalled' &&
        (refreshed.lastMessageCreatedAt ?? refreshed.updatedAt) <=
          (previewBefore.createdAt ?? current.updatedAt)
      )
    )
      setPreview(
        id,
        refreshed.lastMessage ?? '',
        refreshed.lastMessageSenderId ?? undefined,
        refreshed.lastMessageType,
        {
          messageId: refreshed.lastMessageId,
          createdAt: refreshed.lastMessageCreatedAt,
        },
      );
  } catch (cause) {
    if (
      !disposed &&
      !props.readOnly &&
      version === selectionVersion &&
      requestVersion === contactInfoVersion
    ) {
      console.warn('刷新会话详情失败，已保留本地数据。');
      error.value = getAuthErrorMessage(
        cause,
        '刷新会话详情失败，已保留本地数据，请重新点击会话重试。',
      );
    }
  }
};

/** 恢复会话的缓存视口；锚点尚未加载时补齐旧消息，最终回退到最新位置。 */
const restoreConversationViewState = async (
  roomId: string,
  version: number,
): Promise<void> => {
  const state = conversationViewStates.get(roomId);
  if (state) unreadNavigation.value = state.unread;
  if (!state) {
    await scrollToBottom();
    return;
  }
  const activeMessageList = messageList.value;
  if (!activeMessageList || activeMessageList.conversationId !== roomId) return;
  for (let attempt = 0; attempt <= 20; attempt++) {
    if (disposed || version !== selectionVersion || activeId.value !== roomId)
      return;
    if (await activeMessageList.restoreScrollPosition(state.position)) return;
    if (!moreMessages.value || !(await loadOlder(true))) break;
  }
  if (disposed || version !== selectionVersion || activeId.value !== roomId)
    return;
  await scrollToBottom();
  conversationViewStates.delete(roomId);
};

const selectConversation = async (
  conversation: Conversation,
  preserveCachedView: boolean = false,
): Promise<void> => {
  if (sending.value) return;
  const hasCachedMessages =
    (conversationMessages.value.get(conversation.id)?.length ?? 0) > 0;
  beginConversationSelection(conversation.id);
  clearFeedback();
  readReadyRoom.value = '';
  recordedReads.delete(conversation.id);
  canRecallMembers.value = false;
  section.value = 'chats';
  const version = selectionVersion;
  const useCachedView =
    preserveCachedView && renderedConversationId.value === conversation.id;
  if (useCachedView)
    unreadNavigation.value =
      conversationViewStates.get(conversation.id)?.unread ?? null;
  const details =
    !props.readOnly && isRemoteConversation(conversation.id)
      ? refreshSelectedConversation(conversation.id, version, true)
      : Promise.resolve();
  loadingMessages.value = !useCachedView;
  try {
    if (!useCachedView) {
      const cached = await store.readCachedMessagePage(conversation.id, null);
      if (disposed || version !== selectionVersion) return;
      applyCachedPage(cached);
      if (!props.readOnly && isRemoteConversation(conversation.id)) {
        const uids = new Set(messages.value.map(messageDisplayUid));
        for (const uid of uids)
          if (uid) void refreshContact(uid, conversation.id);
      }
      await restoreConversationViewState(conversation.id, version);
      if (disposed || version !== selectionVersion) return;
    }
    if (!props.readOnly && isRemoteConversation(conversation.id)) {
      await details;
      if (disposed || version !== selectionVersion) return;
      if (removedGroups.value[conversation.id]) {
        await refreshCachedMessages(
          conversation.id,
          version,
          !useCachedView && !hasCachedMessages,
        );
        if (!disposed && version === selectionVersion)
          readReadyRoom.value = conversation.id;
        return;
      }
      await store.syncMessageHistory(conversation.id, 'latest');
      if (disposed || version !== selectionVersion) return;
      await refreshCachedMessages(
        conversation.id,
        version,
        !useCachedView && !hasCachedMessages,
      );
      if (!disposed && version === selectionVersion)
        readReadyRoom.value = conversation.id;
      if (!useCachedView)
        await restoreConversationViewState(conversation.id, version);
    }
  } catch (cause) {
    if (!disposed && version === selectionVersion) {
      await refreshLocalAfterSyncFailure(conversation.id, version);
      if (disposed || version !== selectionVersion) return;
      if (removedGroups.value[conversation.id]) {
        readReadyRoom.value = conversation.id;
        return;
      }
      error.value = getAuthErrorMessage(
        cause,
        '读取或同步消息失败，已保留本地记录，请重新选择会话重试。',
      );
    }
  } finally {
    if (version === selectionVersion) {
      loadingMessages.value = false;
      if (reconnectSyncPending) void syncAfterReconnect();
    }
  }
};

/** 处理会话列表点击；再次点击当前会话时清空聊天区选中状态。 */
const selectConversationFromSidebar = async (
  conversation: Conversation,
): Promise<void> => {
  if (sending.value) return;
  if (activeId.value === conversation.id) {
    clearSelection();
    return;
  }
  await selectConversation(
    conversation,
    renderedConversationId.value === conversation.id,
  );
};

/** 从托盘打开当前账号的真实会话，复用选择、未读定位及窄屏详情流程。 */
const openTrayConversation = async (roomId: string): Promise<void> => {
  if (disposed || props.readOnly || props.detached) return;
  if (sending.value) {
    error.value = '消息正在发送，请稍后从会话列表打开';
    return;
  }
  const version = selectionVersion;
  try {
    // 新消息可能先落库再补入页面，按分页读取本地列表以定位已有房间。
    let conversation = conversations.value.find((item) => item.id === roomId);
    if (!conversation && window.desktop) {
      for (let offset = 0; ; offset += 200) {
        const page = await window.desktop.listConversations(200, offset);
        if (disposed || props.readOnly || version !== selectionVersion) return;
        conversation = page.find((item) => item.id === roomId);
        if (conversation || page.length < 200) break;
      }
      if (conversation)
        conversations.value = upsertOrderedConversation(
          conversations.value,
          conversation,
        );
    }
    if (!conversation) throw new Error('会话已移除');
    await selectConversation(conversation);
  } catch {
    if (!disposed && version === selectionVersion)
      error.value = '打开会话失败，请从会话列表重试';
  }
};

const {
  canStartRtcCall,
  rtcRedialDialogOpen,
  resolveRtcRedial,
  rtcRecovery,
  rtcRecoveryBusy,
  rtcRecoveryError,
  recoverRtcCall,
  refreshRtcRecovery,
  dismissRtcRecoveryError,
  rtcInviteDialogOpen,
  rtcInviteMembers,
  rtcInviteLoading,
  rtcInviteBusy,
  rtcInviteError,
  cancelRtcInviteDialog,
  confirmRtcInvite,
  startRtcCall,
  handleRtcWindowSse,
} = useWorkspaceRtc({
  store,
  getSession: (): AuthSession | Pick<AuthSession, 'user'> => props.session,
  isReadOnly: (): boolean => props.readOnly,
  isDetached: (): boolean => Boolean(props.detached),
  isDisposed: (): boolean => disposed,
  offlineMode,
  activeId,
  activeConversation,
  conversations,
  error,
  selectConversation,
  openSearchedFriend,
});

const {
  open: createGroupOpen,
  members: createGroupMembers,
  loading: createGroupLoading,
  busy: createGroupBusy,
  loadError: createGroupError,
  submitError: createGroupSubmitError,
  show: showCreateGroup,
  cancel: cancelCreateGroup,
  confirm: confirmCreateGroup,
  loadFriends: loadCreateGroupFriends,
} = useCreateGroup({
  store,
  getSession: (): AuthSession | Pick<AuthSession, 'user'> => props.session,
  isUnavailable: (): boolean =>
    disposed || props.readOnly || props.loggingOut || Boolean(props.detached),
  isOffline: (): boolean => offlineMode.value,
  error,
  /** 先同步真实会话再进入，不根据所选好友伪造群成员或本地房间。 */
  onCreated: async (group): Promise<void> => {
    const session = props.session;
    /** 每次异步同步后复核原页面，防止退出期间打开新会话。 */
    const validate = (): void => {
      if (
        disposed ||
        props.readOnly ||
        props.loggingOut ||
        props.session !== session
      )
        throw new Error('页面或账号已切换');
    };
    notice.value = '群聊已创建';
    await loadGroups();
    validate();
    await incomingMessages.synchronize(true);
    validate();
    let conversation = conversations.value.find(
      (item) => item.id === group.roomId,
    );
    if (!conversation) {
      const restored = await store.refreshConversationInfo(group.roomId);
      validate();
      if (restored.type !== 1) throw new Error('群聊会话暂不可用');
      conversations.value = upsertOrderedConversation(
        conversations.value,
        restored,
      );
      conversation = restored;
    }
    if (conversation.type !== 1) throw new Error('群聊会话类型不匹配');
    section.value = 'chats';
    search.value = '';
    await selectConversation(conversation);
  },
});

const topRequests = new Map<string, Promise<void>>();

/** 服务端确认后更新当前记录，不覆盖请求期间收到的新消息和未读数。 */
const toggleConversationNotDisturb = async (
  conversation: Conversation,
  status: 0 | 1,
  surfaceError: boolean = true,
): Promise<void> => {
  if (
    props.readOnly ||
    disposed ||
    notDisturbBusy.value ||
    conversation.type === null
  )
    return;
  const session = props.session;
  notDisturbBusy.value = true;
  notDisturbVersion++;
  try {
    await store.setConversationNotDisturb(conversation.id, status);
    if (disposed || props.readOnly || props.session !== session) return;
    const current = conversations.value.find(
      (item) => item.id === conversation.id,
    );
    if (current) current.notDisturb = status;
  } catch (cause) {
    if (
      surfaceError &&
      !disposed &&
      !props.readOnly &&
      props.session === session
    )
      error.value = getAuthErrorMessage(cause, '免打扰设置失败，请重试');
    if (!surfaceError) throw cause;
  } finally {
    notDisturbBusy.value = false;
    notDisturbVersion++;
  }
};

/** 详情开关与右键菜单共用设置入口，错误留在当前详情面板。 */
const toggleActiveConversationNotDisturb = async (
  status: 0 | 1,
): Promise<void> => {
  const conversation = conversations.value.find(
    (item) => item.id === activeId.value,
  );
  if (conversation)
    await toggleConversationNotDisturb(conversation, status, false);
};

/** 请求会话置顶并在服务端成功后更新本地排序，避免失败时出现假置顶。 */
const toggleConversationTop = async (
  conversation: Conversation,
  status: 0 | 1,
  surfaceError: boolean = true,
): Promise<void> => {
  if (
    props.readOnly ||
    disposed ||
    conversation.type === null ||
    topRequests.has(conversation.id)
  )
    return;
  const previous = topRequests.get(conversation.id) ?? Promise.resolve();
  const request = previous.then(async (): Promise<void> => {
    if (disposed || props.readOnly) return;
    try {
      await store.setConversationTop(conversation.id, status);
      if (disposed || props.readOnly) return;
      const current = conversations.value.find(
        (item) => item.id === conversation.id,
      );
      if (current)
        conversations.value = upsertOrderedConversation(conversations.value, {
          ...current,
          isTop: status,
        });
    } catch (cause) {
      if (surfaceError && !disposed && !props.readOnly)
        error.value = getAuthErrorMessage(cause, '会话置顶失败，请重试');
      if (!surfaceError) throw cause;
    }
  });
  topRequests.set(conversation.id, request);
  try {
    await request;
  } finally {
    if (topRequests.get(conversation.id) === request)
      topRequests.delete(conversation.id);
  }
};

/** 加载更早一页并保持当前滚动位置。 */
const loadOlder = async (forNavigation: boolean = false): Promise<boolean> => {
  if (
    !activeId.value ||
    !moreMessages.value ||
    loadingMessages.value ||
    sending.value ||
    ((locatingUnread.value || locatingReply.value) && !forNavigation)
  )
    return false;
  const version = selectionVersion;
  const id = activeId.value;
  loadingMessages.value = true;
  try {
    let page = await store.readCachedMessagePage(id, localMessageBefore);
    if (disposed || version !== selectionVersion) return false;
    // 重连后仍保留已展示的旧记录，跳过这些重复缓存而不跳过本地分页位置。
    const visibleIds = new Set(messages.value.map((message) => message.id));
    const cached: Message[] = [...page.list];
    while (
      page.hasMoreLocal &&
      page.list.every((message) => visibleIds.has(message.id))
    ) {
      page = await store.readCachedMessagePage(id, page.before);
      if (disposed || version !== selectionVersion) return false;
      cached.push(...page.list);
    }
    if (
      !cached.some((message) => !visibleIds.has(message.id)) &&
      !page.hasMoreLocal &&
      page.hasMoreRemote &&
      !props.readOnly &&
      isRemoteConversation(id)
    ) {
      const before = page.before;
      await store.syncMessageHistory(id, 'older');
      if (disposed || version !== selectionVersion) return false;
      page = await store.readCachedMessagePage(id, before);
      if (disposed || version !== selectionVersion) return false;
      cached.push(...page.list);
    }
    /** 本地和新补齐的消息一起前插，列表锚点不依赖已加载记录数量。 */
    const update = (): void => {
      applyCachedPage({ ...page, list: cached });
    };
    const activeMessageList = messageList.value;
    if (activeMessageList && activeMessageList.conversationId === id)
      await activeMessageList.preserveScroll(update);
    else update();
    return !disposed && version === selectionVersion;
  } catch (cause) {
    if (!disposed && version === selectionVersion) {
      await refreshLocalAfterSyncFailure(id, version);
      if (disposed || version !== selectionVersion) return false;
      error.value = getAuthErrorMessage(cause, '读取历史消息失败，请重试。');
    }
    return false;
  } finally {
    if (version === selectionVersion) {
      loadingMessages.value = false;
      if (reconnectSyncPending) void syncAfterReconnect();
    }
  }
};

/** 分页补到本次进入时的未读起点，失败、切换或授权失效时停止且保留重试入口。 */
const locateUnread = async (): Promise<void> => {
  const snapshot = unreadNavigation.value;
  if (
    !snapshot ||
    readReadyRoom.value !== activeId.value ||
    locatingUnread.value ||
    locatingReply.value ||
    loadingMessages.value ||
    sending.value ||
    props.readOnly ||
    disposed
  )
    return;
  const version = selectionVersion;
  const id = activeId.value;
  locatingUnread.value = true;
  try {
    // 每次点击最多补 20 页，防止极长未读区间持续占用页面和网络。
    for (let page = 0; page <= 20; page++) {
      if (disposed || props.readOnly || version !== selectionVersion) return;
      const target = findUnreadTarget(
        messages.value,
        snapshot.afterId,
        props.session.user.id,
        moreMessages.value,
      );
      if (!target.needsOlder) {
        if (!target.messageId) {
          notice.value = '未找到可定位的未读消息，请重新进入会话刷新。';
          return;
        }
        const positioned = await messageList.value?.scrollToMessage(
          target.messageId,
        );
        if (disposed || version !== selectionVersion) return;
        if (positioned) unreadNavigation.value = null;
        else error.value = '定位未读消息失败，请重试。';
        return;
      }
      if (page === 20) {
        notice.value = '未读消息较多，已加载一部分，请再次点击继续定位。';
        return;
      }
      if (!(await loadOlder(true))) return;
    }
  } catch {
    if (!disposed && !props.readOnly && version === selectionVersion)
      error.value = '定位未读消息失败，请重试。';
  } finally {
    if (!disposed && version === selectionVersion && activeId.value === id) {
      locatingUnread.value = false;
      if (reconnectSyncPending) void syncAfterReconnect();
    }
  }
};

watch(locatingReply, (active): void => {
  if (!active && reconnectSyncPending) void syncAfterReconnect();
});

/** 记录用户准备删除的会话，右键菜单目标不要求必须是当前选中会话。 */
const requestDeleteConversation = (conversation?: Conversation): void => {
  if (props.readOnly || deleting.value || sending.value || fileBusy.value)
    return;
  const target = conversation ?? activeConversation.value;
  if (!target || target.type === FILE_ASSISTANT_TYPE) return;
  deleteTargetId.value = target.id;
  deleteOpen.value = true;
};

/** 从界面状态中移除已清空的会话，并释放该会话的草稿和媒体句柄。 */
const removeConversationFromView = (id: string): void => {
  conversations.value = conversations.value.filter((item) => item.id !== id);
  delete drafts.value[id];
  consumeReply(id, replyDrafts.value[id] ?? null);
  messageRecall.forgetConversation(id);
  clearImageDrafts(id);
  delete previews.value[id];
  if (activeId.value === id) clearSelection();
  const cached = new Map(conversationMessages.value);
  cached.delete(id);
  conversationMessages.value = cached;
  conversationViewStates.delete(id);
  if (renderedConversationId.value === id) {
    renderedConversationId.value = '';
    messages.value = [];
  }
};

/** 隐藏服务端会话并从当前工作台移除，不清空本地历史。 */
const hideConversation = async (conversation?: Conversation): Promise<void> => {
  if (
    props.readOnly ||
    hiding.value ||
    sending.value ||
    fileBusy.value ||
    clearing.value
  )
    return;
  const target = conversation ?? activeConversation.value;
  if (!target || target.type === null) return;
  hiding.value = true;
  try {
    await store.hideRemoteConversation(target.id);
    if (disposed || props.readOnly) return;
    removeConversationFromView(target.id);
  } catch (cause) {
    if (!disposed && !props.readOnly)
      error.value = getAuthErrorMessage(cause, '隐藏会话失败，请重试。');
  } finally {
    hiding.value = false;
  }
};

/** 服务端及本地清理成功后，更新视图并沿用收藏表情的成功提示。 */
const friendDeleted = (roomId: string, clearHistory: boolean): void => {
  if (disposed || props.readOnly) return;
  removeFriendFromDirectory(roomId);
  if (clearHistory) removeConversationFromView(roomId);
};

/** 本地先清理并记录删除边界，再按连接状态同步服务端。 */
const removeConversationData = async (id: string): Promise<void> => {
  const conversation = conversations.value.find((item) => item.id === id);
  if (!conversation) throw new Error('会话不存在');
  const remote = conversation.type !== null;
  if (!window.desktop && remote) await store.removeRemoteConversation(id);
  await store.clearConversation(id);
  if (disposed || props.readOnly) return;
  removeConversationFromView(id);
  if (window.desktop && remote) {
    if (!offlineMode.value && resourceSseStatus.value === 'connected') {
      try {
        await store.removeRemoteConversation(id);
      } catch (cause) {
        if (!disposed && !props.readOnly)
          notice.value = getAuthErrorMessage(
            cause,
            '本地记录已清空，服务端将在重连后继续同步。',
          );
      }
    } else {
      notice.value = '本地记录已清空，服务端将在重连后继续同步。';
    }
  }
};

/** 用户确认后按清空聊天记录的完整语义删除会话。 */
const deleteConversation = async (): Promise<void> => {
  if (props.readOnly) return;
  if (deleting.value || sending.value || fileBusy.value || clearing.value)
    return;
  const id = deleteTargetId.value || activeId.value;
  const conversation = conversations.value.find((item) => item.id === id);
  if (!conversation || conversation.type === FILE_ASSISTANT_TYPE) return;
  deleting.value = true;
  try {
    await removeConversationData(id);
    if (disposed || props.readOnly) return;
    deleteTargetId.value = '';
    deleteOpen.value = false;
  } catch (cause) {
    error.value = getAuthErrorMessage(cause, '删除会话失败，请重试。');
  } finally {
    deleting.value = false;
  }
};

/** 桌面先原子清空本地并记录删除边界，再尝试同步；离线操作留待重连消费。 */
const clearConversationHistory = async (): Promise<void> => {
  if (props.readOnly) return;
  if (
    clearing.value ||
    deleting.value ||
    sending.value ||
    fileBusy.value ||
    !isRemoteConversation(activeId.value)
  )
    return;
  const id = activeId.value;
  clearing.value = true;
  try {
    await removeConversationData(id);
    if (disposed || props.readOnly) return;
    clearOpen.value = false;
  } catch (cause) {
    error.value = getAuthErrorMessage(cause, '清空聊天记录失败，请重试。');
  } finally {
    clearing.value = false;
  }
};

/** 生成本地消息并落库，桌面再请求后端并等待 SSE 确认。 */
const sendMessage = async (
  emoji?: UserEmoji,
  image?: StoredImageContent,
  targetId: string = activeId.value,
  text?: string,
  video?: StoredVideoContent,
  voice?: VoiceContent,
  reply: Message | null = replyDrafts.value[targetId] ?? null,
): Promise<boolean> => {
  if (props.readOnly || removedGroups.value[targetId]) return false;
  const id = targetId;
  if (
    disposed ||
    ((image || video || voice) && !isRemoteConversation(id)) ||
    (emoji &&
      (!isRemoteConversation(id) ||
        !userEmojis.value.some(
          (item) => item.imgId === emoji.imgId && item.url === emoji.url,
        )))
  )
    return false;
  let content = (text ?? drafts.value[id] ?? '').trim();
  switch (true) {
    case voice !== undefined:
      content = JSON.stringify(voice);
      break;
    case video !== undefined:
      if (video !== undefined) content = JSON.stringify(validateVideo(video));
      break;
    case image !== undefined:
      if (image !== undefined) content = encodeImageContent(image);
      break;
    case emoji !== undefined:
      if (emoji !== undefined)
        content = encodeEmojiContent(emoji.imgId, emoji.url);
      break;
  }
  // 已上传图片发往最初房间，不受后来切换的会话加载状态影响。
  if (
    !content ||
    !id ||
    sending.value ||
    (loadingMessages.value && !image && !video && !voice) ||
    initializationFailed.value ||
    fileBusy.value
  )
    return false;
  sending.value = true;
  clearFeedback();
  const clientMsgId = crypto.randomUUID();
  let messageType: string;
  switch (true) {
    case voice !== undefined:
      messageType = 'audio';
      break;
    case video !== undefined:
      messageType = 'video';
      break;
    case image !== undefined:
      messageType = 'image';
      break;
    case emoji !== undefined:
      messageType = 'emoji';
      break;
    default:
      messageType = 'text';
      break;
  }
  const remote = isRemoteConversation(id);
  let status = 'sent';
  if (remote)
    status =
      offlineMode.value || resourceSseStatus.value !== 'connected'
        ? 'failed'
        : 'pending';
  const message: Message = {
    id: clientMsgId,
    clientMsgId,
    replyId: reply?.id ?? null,
    conversationId: id,
    senderId: props.session.user.id,
    content,
    messageType,
    status,
    autoRetryReason: remote && status === 'failed' ? 'offline' : null,
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
  };
  try {
    if (!(await store.saveMessage(message))) throw new Error('消息未保存');
    if (disposed) return false;
    consumeReply(id, reply);
    if (
      !emoji &&
      !image &&
      !video &&
      !voice &&
      (drafts.value[id] ?? '').trim() === content
    )
      drafts.value[id] = '';
    setMessagePreview(message);
    conversations.value = updateConversationActivity(
      conversations.value,
      id,
      message.createdAt,
    );
    if (activeId.value === id) {
      if (!messages.value.some((item) => isSameMessageView(item, message)))
        messages.value = mergeMessages(messages.value, [message]);
      await scrollToBottom();
    }
    const send = remote ? trackSend(message) : Promise.resolve();
    void send.catch((sendError: unknown): void => {
      if (!disposed)
        error.value =
          sendError instanceof Error
            ? sendError.message
            : '消息发送失败，请重试。';
    });
    return true;
  } catch {
    error.value = '消息未保存，请重试。';
    return false;
  } finally {
    sending.value = false;
    if (reconnectSyncPending) void syncAfterReconnect();
  }
};

/** 发送已收藏的图片表情。 */
const sendEmoji = async (emoji: UserEmoji): Promise<void> => {
  if (uploadingImage.value) return;
  await sendMessage(emoji);
};

let sendingVoice = false;
/** 完成 MinIO 直传后才创建普通消息，失败不生成上传占位。 */
const sendVoiceRecording = async (
  roomId: string,
  bytes: Uint8Array<ArrayBufferLike>,
): Promise<void> => {
  if (
    sendingVoice ||
    removedGroups.value[roomId] ||
    disposed ||
    props.readOnly ||
    !window.desktop ||
    !isRemoteConversation(roomId)
  )
    throw new Error('当前无法发送语音');
  if (offlineMode.value || resourceSseStatus.value !== 'connected')
    throw new Error('连接尚未就绪，录音已保留，请稍后重试');
  sendingVoice = true;
  const reply = replyDrafts.value[roomId] ?? null;
  try {
    const uploaded = await window.desktop.uploadVoice(roomId, bytes);
    if (disposed || props.readOnly) return;
    if (
      !(await sendMessage(
        undefined,
        undefined,
        roomId,
        undefined,
        undefined,
        uploaded,
        reply,
      ))
    )
      throw new Error('语音尚未保存，请重试');
  } finally {
    sendingVoice = false;
  }
};

/** 通过受控草稿标识打开独立图片窗口，不在输入区叠加图片弹层。 */
const openImageDraftPreview = async (
  roomId: string,
  id: string,
): Promise<void> => {
  try {
    if (!window.desktop) throw new Error('请使用桌面客户端预览图片草稿');
    await window.desktop.openImageDraftPreview(roomId, id);
  } catch (failure) {
    if (!disposed && activeId.value === roomId)
      error.value = failure instanceof Error ? failure.message : '图片预览失败';
  }
};

/** 撤销当前会话预览和主进程句柄，不删除磁盘原文件。 */
const removeImageDraft = (roomId: string, id: string): void => {
  const images = imageDrafts.value[roomId] ?? [];
  const image = images.find((item) => item.id === id);
  if (!image) return;
  URL.revokeObjectURL(image.previewUrl);
  imageDrafts.value[roomId] = images.filter((item) => item.id !== id);
  void window.desktop?.releaseImageDrafts(roomId, [id]).catch(() => {
    // 页面/账号销毁后主进程已统一清理，不恢复已发送或已移除的草稿。
  });
};

/** 离开账号、授权失效或删除会话时释放全部相关预览。 */
const clearImageDrafts = (roomId?: string): void => {
  clearVideoDrafts(roomId);
  for (const room of roomId ? [roomId] : Object.keys(fileDrafts.value))
    for (const draft of fileDrafts.value[room] ?? [])
      removeFileDraft(room, draft.id);
  for (const [id, room] of fileTaskRooms) {
    if (roomId && room !== roomId) continue;
    clearTimeout(fileTimers.get(id));
    fileTimers.delete(id);
    fileTaskRooms.delete(id);
    const native = fileTaskDrafts.get(id);
    if (native)
      void window.desktop?.releaseFileDraft(room, native).catch(() => {});
    fileTaskDrafts.delete(id);
    const next = { ...fileSends.value };
    delete next[id];
    fileSends.value = next;
  }
  videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
  for (const id of roomId ? [roomId] : Object.keys(imageDrafts.value)) {
    for (const image of imageDrafts.value[id] ?? [])
      removeImageDraft(id, image.id);
    delete imageDrafts.value[id];
  }
};

/** 原生结果转为本页面 Blob 预览，迟到结果不能进入新账号或其他会话。 */
const acceptImageDrafts = (
  roomId: string,
  images: SelectedImageDraft[],
): void => {
  if (disposed || props.readOnly || !isRemoteConversation(roomId)) {
    void window.desktop
      ?.releaseImageDrafts(
        roomId,
        images.map((image) => image.id),
      )
      .catch(() => {});
    return;
  }
  const previews = images.map((image): ComposerImageDraft => ({
    id: image.id,
    fileName: image.fileName,
    fileSize: image.fileSize,
    previewUrl: URL.createObjectURL(
      new Blob([new Uint8Array(image.previewBytes)], {
        type: image.contentType,
      }),
    ),
  }));
  imageDrafts.value[roomId] = [
    ...(imageDrafts.value[roomId] ?? []),
    ...previews,
  ];
};

/** 截图完成后只加入发起会话的图片草稿，取消不改变已有草稿。 */
const captureScreenshot = async (hideWindow: boolean = true): Promise<void> => {
  const desktop = window.desktop;
  const roomId = activeId.value;
  if (
    !desktop ||
    disposed ||
    props.readOnly ||
    offlineMode.value ||
    !isRemoteConversation(roomId) ||
    uploadingImage.value ||
    sending.value ||
    screenshotPending ||
    fileBusy.value ||
    loadingMessages.value ||
    initializationFailed.value
  )
    return;
  // 不复用文件忙碌状态，避免不隐藏截图时把按钮变灰和提示栏跳动截入画面。
  screenshotPending = true;
  try {
    const selection = await desktop.captureScreenshot(roomId, hideWindow);
    if (!selection.images.length) return;
    await acceptMediaDrafts(roomId, selection);
    if (!disposed && !props.readOnly && activeId.value === roomId)
      clearFeedback();
  } catch (failure) {
    if (!disposed && !props.readOnly && activeId.value === roomId)
      error.value =
        failure instanceof Error ? failure.message : '截图失败，请重试';
  } finally {
    screenshotPending = false;
  }
};

/** 先展示原生草稿，逐个解析并在原位置替换封面，不创建待发送消息。 */
const acceptMediaDrafts = async (
  roomId: string,
  selection: MediaDraftSelection,
): Promise<void> => {
  /** 解码前后确认原账号页面和会话仍可接收草稿。 */
  const validate = (): void => {
    if (disposed || props.readOnly || !isRemoteConversation(roomId))
      throw new Error('页面或会话已变化，请重新选择文件');
  };
  try {
    validate();
    acceptImageDrafts(roomId, selection.images);
    fileDrafts.value = {
      ...fileDrafts.value,
      [roomId]: [
        ...(fileDrafts.value[roomId] ?? []),
        ...selection.files.map((selected): ComposerFileDraft => ({
          ...selected,
          processing: selected.needsPreparation ? 'hashing' : 'ready',
          processingProgress: 0,
          processingError: '',
        })),
      ],
    };
    videoDrafts.value = {
      ...videoDrafts.value,
      [roomId]: [
        ...(videoDrafts.value[roomId] ?? []),
        ...selection.videos.map((selected): PreparingVideoDraft => ({
          ...selected,
          processing: selected.needsPreparation ? 'hashing' : 'preview',
          processingProgress: 0,
          processingError: '',
        })),
      ],
    };
    await nextTick();
    if (
      !disposed &&
      !props.readOnly &&
      activeId.value === roomId &&
      (selection.images.length ||
        selection.videos.length ||
        selection.files.length)
    )
      messageComposer.value?.focus();
    for (const selected of selection.videos) {
      /** 移除或清理后的草稿不得被迟到解析结果重新加入。 */
      const present = (): boolean =>
        !disposed &&
        !props.readOnly &&
        isRemoteConversation(roomId) &&
        Boolean(
          videoDrafts.value[roomId]?.some((item) => item.id === selected.id),
        );
      if (!present()) continue;
      try {
        let metadata = selected.metadata;
        if (!metadata) {
          if (selected.needsPreparation) {
            if (!window.desktop) throw new Error('视频解析需要桌面客户端');
            metadata = await window.desktop.prepareVideoDraft(
              roomId,
              selected.id,
            );
          } else {
            metadata = await readVideoMetadata(selected.previewUrl);
          }
        }
        if (!present()) continue;
        const ready: ComposerVideoDraft = {
          ...selected,
          needsPreparation: false,
          metadata,
          posterUrl: URL.createObjectURL(
            new Blob([new Uint8Array(metadata.poster)], { type: 'image/jpeg' }),
          ),
        };
        videoDrafts.value = {
          ...videoDrafts.value,
          [roomId]: (videoDrafts.value[roomId] ?? []).map((item) =>
            item.id === selected.id ? ready : item,
          ),
        };
      } catch (failure) {
        if (!present()) continue;
        videoDrafts.value = {
          ...videoDrafts.value,
          [roomId]: (videoDrafts.value[roomId] ?? []).map(
            (item): ComposerVideoItem =>
              item.id === selected.id
                ? {
                    ...selected,
                    processing: 'failed',
                    processingProgress: 0,
                    processingError:
                      failure instanceof Error
                        ? failure.message
                        : '视频解析失败',
                  }
                : item,
          ),
        };
      }
    }
    for (const selected of selection.files) {
      if (!selected.needsPreparation) continue;
      /** 移除和清理后的文件不再接收准备结果。 */
      const present = (): boolean =>
        !disposed &&
        !props.readOnly &&
        isRemoteConversation(roomId) &&
        Boolean(
          fileDrafts.value[roomId]?.some((item) => item.id === selected.id),
        );
      if (!present()) continue;
      try {
        if (!window.desktop) throw new Error('文件准备需要桌面客户端');
        await window.desktop.prepareFileDraft(roomId, selected.id);
        if (!present()) continue;
        fileDrafts.value = {
          ...fileDrafts.value,
          [roomId]: (fileDrafts.value[roomId] ?? []).map(
            (item): ComposerFileDraft =>
              item.id === selected.id
                ? {
                    ...item,
                    needsPreparation: false,
                    processing: 'ready',
                    processingProgress: 100,
                  }
                : item,
          ),
        };
      } catch (failure) {
        if (!present()) continue;
        fileDrafts.value = {
          ...fileDrafts.value,
          [roomId]: (fileDrafts.value[roomId] ?? []).map(
            (item): ComposerFileDraft =>
              item.id === selected.id
                ? {
                    ...item,
                    processing: 'failed',
                    processingError:
                      failure instanceof Error
                        ? failure.message
                        : '文件准备失败',
                  }
                : item,
          ),
        };
      }
    }
  } catch (failure) {
    for (const image of selection.images) removeImageDraft(roomId, image.id);
    for (const video of selection.videos) removeVideoDraft(roomId, video.id);
    for (const file of selection.files) removeFileDraft(roomId, file.id);
    await window.desktop
      ?.releaseImageDrafts(
        roomId,
        selection.images.map((image) => image.id),
      )
      .catch(() => {});
    await Promise.all(
      selection.videos.map((video) =>
        window.desktop?.releaseVideoDraft(roomId, video.id).catch(() => {}),
      ),
    );
    await Promise.all(
      selection.files.map((file) =>
        window.desktop?.releaseFileDraft(roomId, file.id).catch(() => {}),
      ),
    );
    throw failure;
  }
};

/** 文件读取进度不作用于已移除、失败或就绪的草稿。 */
const updateFilePreparation = (progress: FileDraftProcessingProgress): void => {
  if (disposed || props.readOnly) return;
  const items = fileDrafts.value[progress.roomId];
  if (
    !items?.some(
      (item) => item.id === progress.draftId && item.processing === 'hashing',
    )
  )
    return;
  fileDrafts.value = {
    ...fileDrafts.value,
    [progress.roomId]: items.map((item): ComposerFileDraft =>
      item.id === progress.draftId && item.processing === 'hashing'
        ? { ...item, processingProgress: progress.progress }
        : item,
    ),
  };
};

/** 进度只更新仍在准备的原会话草稿，已移除或已就绪的条目不再响应。 */
const updateVideoPreparation = (
  progress: VideoDraftProcessingProgress,
): void => {
  if (disposed || props.readOnly) return;
  const items = videoDrafts.value[progress.roomId];
  if (
    !items?.some(
      (item) => item.id === progress.draftId && !isReadyVideoDraft(item),
    )
  )
    return;
  videoDrafts.value = {
    ...videoDrafts.value,
    [progress.roomId]: items.map((item): ComposerVideoItem => {
      if (
        item.id !== progress.draftId ||
        isReadyVideoDraft(item) ||
        item.processing === 'failed'
      )
        return item;
      return {
        ...item,
        processing: progress.phase,
        processingProgress: progress.progress,
      };
    }),
  };
};

/** 真实拖入事件由 preload 处理，封面准备期间保持忙碌并绑定最初的会话。 */
const receiveMediaDrop = async (result: MediaDropResult): Promise<void> => {
  if (result.pending) {
    if (!disposed) {
      fileBusy.value = true;
      clearFeedback();
    }
    return;
  }
  try {
    if (result.error) {
      if (!disposed) error.value = result.error;
      return;
    }
    await acceptMediaDrafts(result.roomId, result);
  } catch (failure) {
    if (!disposed)
      error.value =
        failure instanceof Error ? failure.message : '读取拖入媒体失败';
  } finally {
    fileBusy.value = false;
  }
};

/** 释放封面 Blob 与主进程视频句柄，不删除用户原视频。 */
const removeVideoDraft = (roomId: string, id: string): void => {
  const draft = videoDrafts.value[roomId]?.find((item) => item.id === id);
  if (!draft) return;
  if (isReadyVideoDraft(draft)) URL.revokeObjectURL(draft.posterUrl);
  videoDrafts.value = {
    ...videoDrafts.value,
    [roomId]: videoDrafts.value[roomId]!.filter((item) => item.id !== id),
  };
  void window.desktop?.releaseVideoDraft(roomId, id).catch(() => {});
};

/** 退出、只读切换和删除会话时释放视频草稿。 */
const clearVideoDrafts = (roomId?: string): void => {
  videoOutbox.clear(roomId);
  for (const room of roomId ? [roomId] : Object.keys(videoDrafts.value)) {
    for (const draft of videoDrafts.value[room] ?? [])
      removeVideoDraft(room, draft.id);
    const nextDrafts = { ...videoDrafts.value };
    delete nextDrafts[room];
    videoDrafts.value = nextDrafts;
  }
};

/** 待发送卡片与普通消息共用列表和摘要，但网络上传不持有输入区的发送锁。 */
const showOutgoingVideo = (message: Message): void => {
  if (disposed) return;
  const conversation = conversations.value.find(
    (item) => item.id === message.conversationId,
  );
  if (conversation && message.createdAt >= conversation.updatedAt) {
    conversations.value = updateConversationActivity(
      conversations.value,
      message.conversationId,
      message.createdAt,
    );
    setMessagePreview(message);
  }
  if (activeId.value === message.conversationId) {
    const present = messages.value.some(
      (item) => item.clientMsgId === message.clientMsgId,
    );
    if (!messages.value.some((item) => isSameMessageView(item, message)))
      messages.value = mergeMessages(messages.value, [message]);
    if (!present) void scrollToBottom();
  }
};

const videoOutbox = createVideoOutbox({
  active: (): boolean => !disposed && !props.readOnly,
  save: async (message): Promise<void> => {
    await store.saveMessage(message);
  },
  persist: (roomId, id, clientMsgId, metadata): Promise<void> =>
    window.desktop!.persistVideoDraft(roomId, id, clientMsgId, metadata),
  show: showOutgoingVideo,
  changed: (): void => {
    videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
  },
  create: (roomId, clientMsgId, content): Promise<Message> =>
    window.desktop!.createVideoPlaceholder(roomId, clientMsgId, content),
  upload: (roomId, id, metadata): Promise<StoredVideoContent> =>
    window.desktop!.uploadVideoDraft(roomId, id, metadata),
  complete: (roomId, id, clientMsgId, content): Promise<void> =>
    window.desktop!.completeVideoPlaceholder(roomId, id, clientMsgId, content),
  cancel: (roomId, clientMsgId): Promise<Message> =>
    window.desktop!.cancelUploadPlaceholder(roomId, clientMsgId),
  stop: (roomId, id): Promise<void> =>
    window.desktop!.stopVideoDraft(roomId, id),
  release: (roomId, draft, keepNative): void => {
    URL.revokeObjectURL(draft.posterUrl);
    if (!keepNative)
      void window.desktop?.releaseVideoDraft(roomId, draft.id).catch(() => {});
  },
});

/** 取消仅对本人占位开放；网络失败保留明确错误，不伪造远端取消结果。 */
const cancelUpload = async (message: Message): Promise<void> => {
  if (props.readOnly || disposed || message.senderId !== props.session.user.id)
    return;
  try {
    if (parseUploadPlaceholder(message.content)?.targetType === 6) {
      const id = message.clientMsgId ?? message.id;
      clearTimeout(fileTimers.get(id));
      const task: VideoSendView | undefined = fileSends.value[id];
      if (task) {
        const cancellingTask: VideoSendView = { ...task, phase: 'canceling' };
        fileSends.value = {
          ...fileSends.value,
          [id]: cancellingTask,
        };
        videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
      }
      try {
        const cancelled = await window.desktop!.cancelFileUpload(
          message.conversationId,
          id,
        );
        if (!disposed && !props.readOnly) {
          showOutgoingVideo(cancelled);
          settleConfirmedMessage(cancelled);
        }
      } catch (failure: unknown) {
        if (!disposed && task && fileTaskRooms.has(id)) {
          const failedTask: VideoSendView = {
            ...task,
            phase: 'cancel-failed',
            error: failure instanceof Error ? failure.message : '取消未确认',
          };
          fileSends.value = {
            ...fileSends.value,
            [id]: failedTask,
          };
          videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
        }
        throw failure;
      }
      return;
    }
    await videoOutbox.cancel(message);
  } catch (failure) {
    if (!disposed)
      error.value = failure instanceof Error ? failure.message : '取消发送失败';
  }
};

/** 移除文件草稿只释放原生句柄，不删除磁盘原文件。 */
const removeFileDraft = (roomId: string, id: string): void => {
  fileDrafts.value = {
    ...fileDrafts.value,
    [roomId]: (fileDrafts.value[roomId] ?? []).filter((item) => item.id !== id),
  };
  void window.desktop?.releaseFileDraft(roomId, id).catch(() => {});
};

/** 统一选择附件，由主进程按类型和大小分流后加入原会话草稿。 */
const chooseAttachments = async (): Promise<void> => {
  const roomId = activeId.value;
  if (
    !window.desktop ||
    props.readOnly ||
    disposed ||
    fileBusy.value ||
    offlineMode.value ||
    uploadingImage.value ||
    sending.value ||
    loadingMessages.value ||
    initializationFailed.value ||
    !isRemoteConversation(roomId)
  )
    return;
  fileBusy.value = true;
  clearFeedback();
  try {
    await acceptMediaDrafts(
      roomId,
      await window.desktop.chooseAttachments(roomId),
    );
  } catch (failure) {
    if (!disposed)
      error.value = failure instanceof Error ? failure.message : '选择文件失败';
  } finally {
    fileBusy.value = false;
  }
};

/** 文件失败可按原消息恢复；HTTP 完成后仍等待最终 SSE，超时保留续传入口。 */
const startFileSend = async (
  message: Message,
  draftId?: string,
): Promise<void> => {
  if (
    !window.desktop ||
    disposed ||
    props.readOnly ||
    message.senderId !== props.session.user.id
  )
    return;
  const placeholder = parseUploadPlaceholder(message.content);
  if (!placeholder || placeholder.targetType !== 6 || placeholder.cancelled)
    return;
  const id = message.clientMsgId ?? message.id;
  const previous = fileSends.value[id];
  if (previous && !['failed', 'cancel-failed'].includes(previous.phase)) return;
  if (previous?.phase === 'cancel-failed') {
    await cancelUpload(message);
    return;
  }
  clearTimeout(fileTimers.get(id));
  fileTimers.delete(id);
  const native = draftId ?? fileTaskDrafts.get(id);
  if (native) fileTaskDrafts.set(id, native);
  const task: VideoSendView = {
    phase: 'validating',
    totalBytes: placeholder.fileSize,
    uploadedBytes: 0,
    posterUrl: '',
    error: '',
  };
  fileTaskRooms.set(id, message.conversationId);
  fileSends.value = { ...fileSends.value, [id]: task };
  videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
  /** 迟到失败和计时器不能覆盖确认后的消息或新页面。 */
  const fail = (failure: unknown): void => {
    const current: VideoSendView | undefined = fileSends.value[id];
    if (
      disposed ||
      props.readOnly ||
      !fileTaskRooms.has(id) ||
      !current ||
      ['canceling', 'cancel-failed'].includes(current.phase)
    )
      return;
    const failedTask: VideoSendView = {
      ...current,
      phase: 'failed',
      error: failure instanceof Error ? failure.message : '文件发送失败',
    };
    fileSends.value = {
      ...fileSends.value,
      [id]: failedTask,
    };
    videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
  };
  try {
    await window.desktop.sendFileDraft(message.conversationId, id, native);
    const current: VideoSendView | undefined = fileSends.value[id];
    if (
      disposed ||
      props.readOnly ||
      !current ||
      ['canceling', 'cancel-failed'].includes(current.phase)
    )
      return;
    const confirmingTask: VideoSendView = { ...current, phase: 'confirming' };
    fileSends.value = {
      ...fileSends.value,
      [id]: confirmingTask,
    };
    videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
    fileTimers.set(
      id,
      setTimeout(
        () => fail(new Error('文件已上传，消息确认超时，请重试')),
        10000,
      ),
    );
  } catch (failure) {
    fail(failure);
  }
};

/** 文件先保存本地占位，再移交主进程上传，不阻塞输入框。 */
const enqueueFile = async (
  roomId: string,
  file: SelectedFileDraft,
  reply: Message | null,
  replyId: string | null = reply?.id ?? null,
): Promise<void> => {
  const id = crypto.randomUUID();
  const message: Message = {
    id,
    clientMsgId: id,
    replyId,
    conversationId: roomId,
    senderId: props.session.user.id,
    content: JSON.stringify({
      targetType: 6,
      cancelled: false,
      fileName: file.fileName,
      fileSize: file.fileSize,
    }),
    messageType: 'temporary',
    status: 'pending',
    createdAt: new Date().toISOString(),
    editedAt: null,
    deletedAt: null,
  };
  await store.saveMessage(message);
  if (disposed || props.readOnly) return;
  consumeReply(roomId, reply);
  showOutgoingVideo(message);
  fileDrafts.value = {
    ...fileDrafts.value,
    [roomId]: (fileDrafts.value[roomId] ?? []).filter(
      (item) => item.id !== file.id,
    ),
  };
  void startFileSend(message, file.id);
};

/** 立即落库并发出真实占位，原生草稿移交队列而非释放。 */
const enqueueVideo = async (
  roomId: string,
  video: ComposerVideoDraft,
  reply: Message | null,
  replyId: string | null = reply?.id ?? null,
): Promise<void> => {
  const clientMsgId = crypto.randomUUID();
  const content = validateTemporaryVideo({
    fileName: video.fileName,
    fileSize: video.fileSize,
    duration: video.metadata.duration,
    thumbWidth: video.metadata.thumbWidth,
    thumbHeight: video.metadata.thumbHeight,
  });
  await videoOutbox.enqueue(
    {
      id: clientMsgId,
      clientMsgId,
      replyId,
      conversationId: roomId,
      senderId: props.session.user.id,
      content: JSON.stringify(content),
      messageType: 'temporary',
      status: 'pending',
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
    },
    video,
  );
  consumeReply(roomId, reply);
  videoDrafts.value = {
    ...videoDrafts.value,
    [roomId]: (videoDrafts.value[roomId] ?? []).filter(
      (item) => item.id !== video.id,
    ),
  };
};

/** 点击发送后依次处理文字、图片和视频，失败时保留尚未提交的草稿。 */
const sendComposer = async (): Promise<void> => {
  if (groupRemoved.value) return;
  const roomId = activeId.value;
  if (
    disposed ||
    props.readOnly ||
    sending.value ||
    uploadingImage.value ||
    fileBusy.value ||
    loadingMessages.value ||
    initializationFailed.value
  )
    return;
  const text = (drafts.value[roomId] ?? '').trim();
  const reply = replyDrafts.value[roomId] ?? null;
  const images = [...(imageDrafts.value[roomId] ?? [])];
  const videos = [...(videoDrafts.value[roomId] ?? [])];
  if (videos.some((video) => !isReadyVideoDraft(video))) {
    error.value = '请等待视频解析完成，或移除解析失败的视频';
    return;
  }
  const attachments = [...(fileDrafts.value[roomId] ?? [])];
  if (attachments.some((file) => file.processing !== 'ready')) {
    error.value = '请等待文件准备完成，或移除准备失败的文件';
    return;
  }
  if (
    !roomId ||
    (!text && !images.length && !videos.length && !attachments.length)
  )
    return;
  if (
    (images.length || videos.length || attachments.length) &&
    (!window.desktop || offlineMode.value || !isRemoteConversation(roomId))
  ) {
    error.value = '当前无法发送图片，请恢复连接后重试';
    return;
  }
  uploadingImage.value = true;
  clearFeedback();
  try {
    if (
      text &&
      !(await sendMessage(
        undefined,
        undefined,
        roomId,
        text,
        undefined,
        undefined,
        reply,
      ))
    )
      return;
    for (const video of videos) {
      if (disposed || props.readOnly) return;
      if (!isReadyVideoDraft(video)) return;
      await enqueueVideo(roomId, video, reply);
    }
    for (const file of attachments) {
      if (disposed || props.readOnly) return;
      await enqueueFile(roomId, file, reply);
    }
    for (const image of images) {
      if (disposed || props.readOnly) return;
      const uploaded = await window.desktop!.uploadImageDraft(roomId, image.id);
      if (disposed || props.readOnly) return;
      if (
        !(await sendMessage(
          undefined,
          uploaded,
          roomId,
          undefined,
          undefined,
          undefined,
          reply,
        ))
      )
        return;
      removeImageDraft(roomId, image.id);
    }
  } catch (uploadError) {
    if (!disposed)
      error.value =
        uploadError instanceof Error
          ? uploadError.message
          : '图片发送失败，请重试';
  } finally {
    uploadingImage.value = false;
  }
};

/** SSE 与历史页共用文本、图片和表情映射，迟到确认也修复失败状态。 */
const handleIncomingMessage = async (
  message: ResourceChatMessage,
): Promise<void> => {
  if (disposed || props.readOnly) return;
  let localMessage: Message | null;
  try {
    localMessage = toHistoryMessage(message);
  } catch {
    console.error('SSE 推送消息转换失败，未记录消息正文。');
    if (activeId.value === message.message.roomId)
      error.value = '收到的消息格式无效，请重新进入会话重试';
    return;
  }
  if (!localMessage) return;
  const previous = messages.value.find((item) => item.id === localMessage?.id);
  if (previous && shouldKeepRecalledMessage(previous, localMessage))
    localMessage = previous;
  if (
    recalledIds.has(localMessage.id) &&
    localMessage?.messageType !== 'recalled'
  )
    return;
  try {
    if (!(await incomingMessages.receive(localMessage))) return;
  } catch (cause) {
    console.error('SSE 推送消息同步或落库失败。');
    if (!disposed && !props.readOnly)
      notice.value = getAuthErrorMessage(
        cause,
        '接收消息失败，请从通讯录打开聊天重新同步',
      );
    return;
  }
  if (disposed || props.readOnly) return;
  if (
    localMessage.messageType === 'temporary' &&
    completedVideoIds.has(localMessage.id)
  )
    return;
  const unchanged = messages.value.some((item) =>
    isSameMessageView(item, localMessage),
  );
  // 当前会话仅在窗口可见且获得焦点时静音，切到其他窗口后仍需响铃。
  if (
    !props.detached &&
    !props.loggingOut &&
    conversations.value.find((item) => item.id === localMessage.conversationId)
      ?.notDisturb !== 1 &&
    (localMessage.conversationId !== activeId.value ||
      document.visibilityState === 'hidden' ||
      !document.hasFocus()) &&
    localMessage.senderId !== props.session.user.id &&
    !localMessage.deletedAt &&
    localMessage.messageType !== 'recalled' &&
    localMessage.messageType !== 'temporary'
  )
    messageSounds.enqueue(incomingMessageSound);
  settleConfirmedMessage(localMessage);
  const { conversationId, createdAt } = localMessage;
  refreshGroupAfterSystemMessage(localMessage);
  const conversation = conversations.value.find(
    (item) => item.id === conversationId,
  );
  if (
    conversation &&
    shouldUpdateMessagePreview(
      previews.value[conversationId],
      <Message>localMessage,
      conversation.updatedAt,
    )
  ) {
    conversations.value = updateConversationActivity(
      conversations.value,
      conversationId,
      createdAt,
    );
    setMessagePreview(localMessage);
  }
  if (activeId.value === conversationId && !unchanged) {
    const followLatest =
      !locatingUnread.value &&
      !locatingReply.value &&
      (messageList.value?.isAtBottom() ?? true);
    const wasPresent = messages.value.some(
      (item) =>
        item.id === localMessage?.id ||
        (localMessage?.clientMsgId !== null &&
          item.clientMsgId === localMessage.clientMsgId &&
          item.senderId === localMessage.senderId),
    );
    if (!wasPresent && !followLatest)
      messageList.value?.trackIncomingMessage(localMessage);
    messages.value = mergeMessages(messages.value, [localMessage]);
    if (!wasPresent && followLatest) await scrollToBottom();
  }
};

const messageRecall = createMessageRecall({
  active: (): boolean => !disposed && !props.readOnly,
  context: (): number => selectionVersion,
  userId: (): string => props.session.user.id,
  readText: (target): Promise<string | null> =>
    store.readRecalledMessageText(target.conversationId, target.id),
  send: async (target): Promise<void> => {
    await window.desktop!.sendMessage({
      roomId: target.conversationId,
      msgType: 2,
      clientMsgId: crypto.randomUUID(),
      body: { msgId: target.id },
    });
  },
});
const recalling = messageRecall.pending;
const recallFeedback = messageRecall.feedback;
const recalledIds = new Set<string>();
const canRecallMembers = ref(false);
const removedGroups = ref<Record<string, boolean>>({});
const groupRemoved = computed(
  (): boolean => removedGroups.value[activeId.value] === true,
);

/** 退出或解散确认更新原群的本地视图，不删除会话、草稿或历史。 */
const applyGroupExited = (
  userId: string,
  roomId: string,
  action: GroupDepartureAction,
): void => {
  if (disposed || props.readOnly || userId !== props.session.user.id) return;
  if (props.detached && props.detached.id !== roomId) return;
  removedGroups.value[roomId] = true;
  removeGroupFromDirectory(roomId);
  if (!props.detached)
    showFriendSuccess(action === 'dissolve' ? '已解散' : '已退出');
  if (activeId.value !== roomId) return;
  contactInfoVersion++;
  canRecallMembers.value = false;
  unreadNavigation.value = null;
  detailsOpen.value = false;
  const version = selectionVersion;
  void refreshLocalAfterSyncFailure(roomId, version).then((): void => {
    if (!disposed && !props.readOnly && version === selectionVersion)
      readReadyRoom.value = roomId;
  });
};

/** 请求退出绑定群，桌面由主进程通知所有窗口，浏览器仅更新当前授权。 */
const exitGroup = async (roomId: string): Promise<void> => {
  if (disposed || props.readOnly || props.loggingOut || props.detached)
    throw new Error('当前无法退出群聊');
  if (offlineMode.value) throw new Error('当前离线，无法退出群聊');
  const session = props.session;
  await store.exitGroup(roomId);
  if (!window.desktop && !disposed && props.session === session)
    applyGroupExited(session.user.id, roomId, 'exit');
};

/** 群主明确确认后才解散，成功通知与普通退出共用本地状态清理。 */
const dissolveGroup = async (roomId: string): Promise<void> => {
  if (disposed || props.readOnly || props.loggingOut || props.detached)
    throw new Error('当前无法解散群聊');
  if (offlineMode.value) throw new Error('当前离线，无法解散群聊');
  const session = props.session;
  await store.dissolveGroup(roomId);
  if (!window.desktop && !disposed && props.session === session)
    applyGroupExited(session.user.id, roomId, 'dissolve');
};

/** 群系统消息触发详情和群资料重读；成员变更仍以服务端确认后的状态为准。 */
const refreshGroupAfterSystemMessage = (message: Message): void => {
  if (
    disposed ||
    props.readOnly ||
    message.deletedAt ||
    message.messageType !== 'system' ||
    message.conversationId !== activeId.value ||
    activeConversation.value?.type !== 1
  )
    return;
  const removal = parseGroupRemovalMessage(message.content);
  const invited = parseGroupInvitationMessage(message.content);
  const membershipChanged =
    removal?.memberUid === props.session.user.id ||
    (groupRemoved.value && invited !== null);
  const id = message.conversationId;
  const version = selectionVersion;
  void refreshSelectedConversation(id, version).then(
    async (): Promise<void> => {
      if (
        disposed ||
        props.readOnly ||
        version !== selectionVersion ||
        activeId.value !== id
      )
        return;
      // 标题优先读取通讯录群资料，因此详情刷新后还需使该快照同步更新。
      void loadGroups();
      if (!membershipChanged) return;
      if (removedGroups.value[id]) {
        await refreshLocalAfterSyncFailure(id, version);
        if (!disposed && !props.readOnly && version === selectionVersion)
          readReadyRoom.value = id;
      } else {
        reconnectSyncPending = true;
        void syncAfterReconnect();
      }
    },
  );
};
const reeditableMessageIds = computed((): string[] =>
  messages.value
    .filter((message) => messageRecall.editText(message) !== null)
    .map((message) => message.id),
);

/** 将本人撤回的原文追加到所属会话草稿，保留已有输入，不自动发送。 */
const reeditMessage = async (message: Message): Promise<void> => {
  if (
    disposed ||
    props.readOnly ||
    sending.value ||
    loadingMessages.value ||
    message.conversationId !== activeId.value
  )
    return;
  const current = messages.value.find((item) => item.id === message.id);
  if (!current) return;
  const text = messageRecall.editText(current);
  if (text === null) return;
  const existing = drafts.value[current.conversationId] ?? '';
  const next = existing ? `${existing}\n${text}` : text;
  if (next.length > 10000) {
    error.value = '合并后的草稿超过 10000 字，请先整理输入框内容再重新编辑';
    return;
  }
  drafts.value[current.conversationId] = next;
  const version = selectionVersion;
  await nextTick();
  if (!disposed && !props.readOnly && version === selectionVersion)
    messageComposer.value?.focus();
};

/** 撤回沿用发送 IPC，只在 SSE 或历史确认后替换正文；超时允许再次提交同一目标。 */
const recallMessage = async (message: Message): Promise<void> => {
  if (
    !window.desktop ||
    disposed ||
    props.readOnly ||
    message.messageType === 'recalled' ||
    recalledIds.has(message.id) ||
    recalling.value.has(message.id)
  )
    return;
  if (offlineMode.value || resourceSseStatus.value !== 'connected') {
    error.value = '连接恢复后才能撤回消息';
    return;
  }
  await messageRecall.recall(message);
};

/** 所有普通消息发送共用单消息锁，避免手动重试和重连重复提交。 */
const trackSend = (message: Message): Promise<void> =>
  messageRetry.run(message, async (): Promise<void> => {
    if (message.status === 'failed') {
      if (offlineMode.value || resourceSseStatus.value !== 'connected') return;
      await retryOrdinaryMessage(message);
      return;
    }
    await submitMessage(message);
  });

/** 请求后端发送消息并设置确认超时，离线时立即标记失败且不发起 HTTP。 */
const submitMessage = async (message: Message): Promise<void> => {
  if (
    !window.desktop ||
    disposed ||
    props.readOnly ||
    message.status !== 'pending'
  )
    return;
  if (offlineMode.value || resourceSseStatus.value !== 'connected') {
    await markMessageFailed(message, 'offline');
    return;
  }
  // 超时资格由主进程记录，页面的确认计时器不能覆盖真实请求结果。
  delete message.autoRetryReason;
  const clientMsgId = message.clientMsgId ?? message.id;
  if (pendingTimers.has(clientMsgId)) return;
  if (
    messages.value.some(
      (item) =>
        item.conversationId === message.conversationId &&
        item.senderId === message.senderId &&
        item.clientMsgId === clientMsgId &&
        item.status === 'sent',
    )
  )
    return;
  const timer = setTimeout(() => {
    void markMessageFailed(message);
  }, 10000);
  pendingTimers.set(clientMsgId, { timer, message });
  try {
    let msgType: 1 | 4 | 5 | 8 | 9;
    let body: Record<string, unknown>;
    switch (message.messageType) {
      case 'audio':
        msgType = 8;
        body = voiceMessageBody(message.content);
        break;
      case 'video':
        msgType = 5;
        body = videoMessageBody(message.content);
        break;
      case 'image':
        msgType = 4;
        body = imageMessageBody(message.content);
        break;
      case 'emoji':
        msgType = 9;
        body = {
          emojiId: parseEmojiContent(message.content)?.emojiId ?? '',
        };
        break;
      default:
        msgType = 1;
        body = { content: message.content, replyMsgId: null, atUidList: null };
        break;
    }
    await window.desktop.sendMessage({
      roomId: message.conversationId,
      replyId: message.replyId ?? null,
      msgType,
      clientMsgId,
      body,
    });
  } catch (cause) {
    await markMessageFailed(message);
    const rejection = parseMessageRejection(getAuthErrorMessage(cause, ''));
    if (rejection !== null) {
      // 主进程已原子保存失败状态和本地提示，由落库通知及历史分页展示。
      return;
    }
    throw cause;
  }
};

/** 标记失败并清理超时，拒收记录由主进程独立持久化。 */
const markMessageFailed = async (
  message: Message,
  autoRetryReason?: 'offline',
): Promise<boolean> => {
  if (disposed || props.readOnly) return false;
  const clientMsgId = message.clientMsgId ?? message.id;
  const entry = pendingTimers.get(clientMsgId);
  if (entry) {
    clearTimeout(entry.timer);
    pendingTimers.delete(clientMsgId);
  }
  if (message.status !== 'pending') return message.status === 'failed';
  message.status = 'failed';
  if (autoRetryReason) message.autoRetryReason = autoRetryReason;
  try {
    await store.saveMessage(message);
    updateVisibleOutgoing(message);
    return true;
  } catch {
    if (!disposed) error.value = '保存消息发送状态失败，请重试。';
    return false;
  }
};

/** 重试发送失败的消息，沿用原 clientMsgId 重新请求并计时。 */
const retrySend = async (
  message: Message,
  automatic: boolean = false,
): Promise<void> => {
  if (removedGroups.value[message.conversationId]) return;
  if (automatic) {
    await messageRetry.run(message, (): Promise<void> =>
      retryOrdinaryMessage(message, true),
    );
    return;
  }
  if (
    message.messageType === 'upload-cancelled' &&
    parseUploadPlaceholder(message.content)?.targetType === 6
  ) {
    if (
      !window.desktop ||
      disposed ||
      props.readOnly ||
      fileBusy.value ||
      message.senderId !== props.session.user.id
    )
      return;
    fileBusy.value = true;
    let restored: SelectedFileDraft | undefined;
    try {
      restored = await window.desktop.restoreFileDraft({
        conversationId: message.conversationId,
        messageId: message.id,
      });
      if (disposed || props.readOnly) return;
      await enqueueFile(
        message.conversationId,
        restored,
        null,
        message.replyId ?? null,
      );
      restored = undefined;
    } catch (failure) {
      if (!disposed)
        error.value =
          failure instanceof Error ? failure.message : '重新发送文件失败';
    } finally {
      if (restored)
        void window.desktop
          .releaseFileDraft(message.conversationId, restored.id)
          .catch(() => {});
      fileBusy.value = false;
    }
    return;
  }
  if (
    message.messageType === 'temporary' &&
    parseUploadPlaceholder(message.content)?.targetType === 6
  ) {
    await startFileSend(message);
    return;
  }
  if (message.messageType === 'upload-cancelled') {
    if (
      props.readOnly ||
      disposed ||
      fileBusy.value ||
      message.deletedAt ||
      message.senderId !== props.session.user.id
    )
      return;
    try {
      if (await videoOutbox.resend(message)) return;
    } catch (failure) {
      if (!disposed)
        error.value =
          failure instanceof Error ? failure.message : '重新发送失败';
      return;
    }
  }
  if (
    message.senderId === props.session.user.id &&
    !props.readOnly &&
    !disposed &&
    message.messageType !== 'upload-cancelled' &&
    videoOutbox.retry(message.clientMsgId ?? message.id)
  )
    return;
  if (
    message.messageType === 'temporary' ||
    message.messageType === 'upload-cancelled'
  ) {
    if (
      props.readOnly ||
      disposed ||
      fileBusy.value ||
      message.senderId !== props.session.user.id
    )
      return;
    const expected = parseUploadPlaceholder(message.content);
    if (!expected || expected.targetType !== 5 || !window.desktop) return;
    fileBusy.value = true;
    let selected: ComposerVideoDraft | undefined;
    try {
      const native = await window.desktop.restoreVideoDraft({
        conversationId: message.conversationId,
        messageId: message.id,
      });
      await acceptMediaDrafts(message.conversationId, {
        images: [],
        videos: [native],
        files: [],
      });
      selected = videoDrafts.value[message.conversationId]?.find(
        (item): item is ComposerVideoDraft =>
          item.id === native.id && isReadyVideoDraft(item),
      );
      if (
        !selected ||
        selected.fileName !== expected.fileName ||
        selected.fileSize !== expected.fileSize ||
        selected.metadata.duration !== expected.duration ||
        selected.metadata.thumbWidth !== expected.thumbWidth ||
        selected.metadata.thumbHeight !== expected.thumbHeight
      )
        throw new Error('本机保存的视频来源与占位不匹配，无法恢复上传');
      if (message.messageType === 'upload-cancelled') {
        await enqueueVideo(
          message.conversationId,
          selected,
          null,
          message.replyId ?? null,
        );
        return;
      }
      await videoOutbox.enqueue(message, selected);
      videoDrafts.value = {
        ...videoDrafts.value,
        [message.conversationId]: videoDrafts.value[
          message.conversationId
        ]!.filter((item) => item.id !== selected!.id),
      };
    } catch (failure) {
      if (selected) removeVideoDraft(message.conversationId, selected.id);
      if (!disposed)
        error.value =
          failure instanceof Error ? failure.message : '恢复视频发送失败';
    } finally {
      fileBusy.value = false;
    }
    return;
  }
  if (
    props.readOnly ||
    message.status !== 'failed' ||
    message.deletedAt ||
    message.senderId !== props.session.user.id ||
    loadingMessages.value ||
    disposed
  )
    return;
  try {
    await messageRetry.run(message, (): Promise<void> =>
      retryOrdinaryMessage(message),
    );
  } catch (sendError) {
    if (!disposed)
      error.value =
        sendError instanceof Error
          ? sendError.message
          : '消息发送失败，请重试。';
  }
};

/** 重试前读取最新记录，跳过已确认、删除和仍等待当前连接确认的消息。 */
const retryOrdinaryMessage = async (
  snapshot: Message,
  automatic: boolean = false,
): Promise<void> => {
  const desktop = window.desktop;
  if (removedGroups.value[snapshot.conversationId]) return;
  if (!desktop || disposed || props.readOnly) return;
  const message = await desktop.readOutgoingMessage(
    snapshot.conversationId,
    snapshot.clientMsgId ?? snapshot.id,
  );
  if (
    disposed ||
    props.readOnly ||
    !message ||
    message.deletedAt ||
    message.senderId !== props.session.user.id
  )
    return;
  if (message.status === 'sent') {
    settleConfirmedMessage(message);
    updateVisibleOutgoing(message);
    return;
  }
  if (
    (automatic &&
      message.autoRetryReason !== 'offline' &&
      message.autoRetryReason !== 'timeout') ||
    !['text', 'emoji', 'image', 'video', 'audio'].includes(
      message.messageType,
    ) ||
    !['pending', 'failed'].includes(message.status) ||
    pendingTimers.has(message.clientMsgId ?? message.id)
  )
    return;
  message.status = 'pending';
  delete message.autoRetryReason;
  await store.saveMessage(message);
  if (disposed || props.readOnly) return;
  updateVisibleOutgoing(message);
  await submitMessage(message);
};

/** 后台重试只更新已展示的消息，不把未加载的旧历史追加到虚拟列表。 */
const updateVisibleOutgoing = (message: Message): void => {
  if (
    !disposed &&
    activeId.value === message.conversationId &&
    messages.value.some(
      (item) =>
        item.id === message.id ||
        (item.clientMsgId === message.clientMsgId &&
          item.senderId === message.senderId),
    )
  )
    messages.value = mergeMessages(messages.value, [message]);
};

const messageRetry = createMessageRetryQueue({
  active: (): boolean =>
    !disposed &&
    !props.readOnly &&
    (Boolean(props.detached) ||
      ('accessToken' in props.session &&
        Boolean(props.session.accessToken.trim()) &&
        (props.session.expiresAt === null ||
          props.session.expiresAt * 1000 > Date.now()))),
  list: async (after): Promise<Message[]> =>
    window.desktop?.listUnconfirmedMessages(after) ?? [],
  retry: (message): Promise<void> => retrySend(message, true),
  report: (failure): void => {
    if (!disposed)
      error.value =
        failure instanceof Error ? failure.message : '自动重试消息失败';
  },
});

const fileAssistantOpening = ref(false);
const fileAssistantError = ref('');
let fileAssistantRequestVersion = 0;

watch(
  fileAssistantSelected,
  (): void => {
    fileAssistantRequestVersion++;
    fileAssistantOpening.value = false;
    fileAssistantError.value = '';
  },
  { flush: 'sync' },
);

/** 选择固定联系人只展示资料，点击发送消息后才打开会话。 */
const selectFiles = (): void => {
  if (busy.value || sending.value || disposed || props.readOnly) return;
  if (section.value !== 'directory') showDirectory();
  selectFileAssistant();
};

/** 用户明确发消息后定位真实房间，恢复隐藏会话并进入聊天。 */
const openFileAssistant = async (): Promise<void> => {
  if (
    section.value !== 'directory' ||
    !fileAssistantSelected.value ||
    busy.value ||
    sending.value ||
    disposed ||
    props.readOnly ||
    fileAssistantOpening.value
  )
    return;
  if (!window.desktop) return;
  const session = props.session;
  const version = selectionVersion;
  const requestVersion = fileAssistantRequestVersion;
  /** 账号或用户选择变化后，不用迟到结果切走当前页面。 */
  const isCurrent = (): boolean =>
    !disposed &&
    !props.readOnly &&
    section.value === 'directory' &&
    fileAssistantSelected.value &&
    props.session === session &&
    selectionVersion === version &&
    fileAssistantRequestVersion === requestVersion;
  fileAssistantOpening.value = true;
  fileAssistantError.value = '';
  try {
    const roomId = await window.desktop.getFileAssistantRoomId();
    if (!isCurrent()) return;
    const conversation = await store.refreshConversationInfo(roomId);
    if (!isCurrent()) return;
    if (conversation.type !== FILE_ASSISTANT_TYPE)
      throw new Error('文件助手房间类型无效');
    conversations.value = upsertOrderedConversation(
      conversations.value,
      conversation,
    );
    setPreview(
      conversation.id,
      conversation.lastMessage ?? '',
      undefined,
      conversation.lastMessageType,
      {
        messageId: conversation.lastMessageId,
        createdAt: conversation.lastMessageCreatedAt,
      },
    );
    clearFriendSelection();
    await selectConversation(conversation);
  } catch (cause) {
    if (isCurrent())
      fileAssistantError.value = getAuthErrorMessage(
        cause,
        '打开文件助手失败，请重试',
      );
  } finally {
    if (fileAssistantRequestVersion === requestVersion)
      fileAssistantOpening.value = false;
  }
};

/** 调用受限原生窗口操作；网页预览不模拟原生窗口状态。 */
const controlWindow = async (
  action: 'minimize' | 'maximize' | 'pin',
): Promise<void> => {
  if (!window.desktop) return;
  try {
    const value = await window.desktop.controlWindow(action);
    if (action === 'pin') pinned.value = value;
  } catch {
    error.value = '窗口操作失败，请重试。';
  }
};

/** 只记录浏览器提供的网络可用性，不将有网视为聊天服务器已连接。 */
const updateNetworkAvailability = (): void => {
  networkAvailable.value = navigator.onLine;
  if (!networkAvailable.value) {
    void messageRetry.connection(false);
    for (const entry of pendingTimers.values())
      void markMessageFailed(entry.message);
  }
};

/** 页面挂载后同步主进程已经建立的资源 SSE 状态。 */
const restoreResourceSseStatus = async (): Promise<void> => {
  if (!window.desktop) return;
  const version = resourceStatusVersion;
  const status = await window.desktop.getResourceSseStatus();
  if (!disposed && version === resourceStatusVersion)
    updateResourceStatus(status);
};

/** SSE 恢复后重试跨会话未确认消息，并仅对当前会话补历史。 */
const updateResourceStatus = (status: ResourceSseStatus): void => {
  if (disposed) return;
  const previous = resourceSseStatus.value;
  if (status === 'connected' && previous !== 'connected' && !props.detached)
    applicationsRevision.value++;
  resourceSseStatus.value = status;
  if (status !== 'connected') {
    for (const entry of pendingTimers.values())
      void markMessageFailed(entry.message);
  }
  void messageRetry.connection(status === 'connected');
  if (
    status === 'connected' &&
    previous === 'reconnecting' &&
    !props.readOnly &&
    !props.detached
  ) {
    void friendUnreadSync.refresh();
    void synchronizeGroupConversations();
  }
  if (
    status === 'connected' &&
    !props.readOnly &&
    previous !== 'connected' &&
    isRemoteConversation(activeId.value)
  ) {
    readReadyRoom.value = '';
    reconnectSyncPending = true;
    void syncAfterReconnect();
  }
};

/** 到期后取消旧视图请求和发送计时，只重读当前账号本地缓存。 */
const enterReadOnly = async (): Promise<void> => {
  conversationViewStates.clear();
  conversationMessages.value = new Map();
  replyDrafts.value = {};
  unreadNavigation.value = null;
  locatingUnread.value = false;
  locatingReply.value = false;
  resetDirectory();
  messageRecall.clear();
  messageRetry.clear();
  clearImageDrafts();
  selectionVersion++;
  const version = selectionVersion;
  reconnectSyncPending = false;
  invalidateEmojiRequests();
  deleteOpen.value = false;
  clearOpen.value = false;
  deleteTargetId.value = '';
  loadingMessages.value = false;
  for (const entry of pendingTimers.values()) {
    clearTimeout(entry.timer);
    entry.message.status = 'failed';
  }
  pendingTimers.clear();
  messages.value = messages.value.map((message) =>
    message.status === 'pending' ? { ...message, status: 'failed' } : message,
  );
  error.value = '';
  notice.value = '';
  try {
    if (window.desktop) {
      const cachedContacts = await window.desktop.listContacts();
      if (disposed || version !== selectionVersion) return;
      contacts.value = Object.fromEntries(
        cachedContacts.map((item) => [item.id, item]),
      );
    }
    if (activeId.value)
      await refreshCachedMessages(activeId.value, version, false);
  } catch {
    if (!disposed && version === selectionVersion)
      error.value = '读取本地历史失败，请重新选择会话重试。';
  }
};

watch(section, (value): void => {
  if (value !== 'directory') clearFriendSelection();
});

watch(
  [activeId, section, () => props.readOnly, () => props.session.user.id],
  () => {
    detailsOpen.value = false;
    dismissFriendProfile();
  },
);

watch(detailsOpen, (open): void => {
  if (!open) dismissFriendProfile();
});

watch(
  () => props.readOnly,
  (readOnly): void => {
    if (readOnly) void enterReadOnly();
  },
);
watch([messages, groupRemoved], (): void => {
  const reply = activeReply.value;
  if (!reply) return;
  const current = messages.value.find(
    (message) =>
      message.id === reply.id &&
      message.conversationId === reply.conversationId,
  );
  if (groupRemoved.value || (current && !canReplyToMessage(current)))
    consumeReply(reply.conversationId, reply);
});

watch([() => props.session, () => props.readOnly], clearFriendSuccessFeedback, {
  flush: 'sync',
});

watch(
  [() => props.session, () => props.readOnly, () => props.loggingOut],
  messageSounds.clear,
  { flush: 'sync' },
);
watch(
  [() => props.session.user.id, () => props.readOnly, () => props.loggingOut],
  (): void => {
    replyDrafts.value = {};
  },
  { flush: 'sync' },
);

let unsubscribeConversationMessage: (() => void) | undefined;
let unsubscribeConversationRead: (() => void) | undefined;
let unsubscribeGroupExited: (() => void) | undefined;
/** 另一窗口落库后只更新视图，不重复保存或重新处理 SSE。 */
const receiveConversationMessage = (message: Message): void => {
  if (disposed || props.readOnly) return;
  if (props.detached && message.conversationId !== props.detached.id) return;
  if (message.deletedAt) {
    applyMessageDeletion(message);
    return;
  }
  if (deletedMessageIds.has(`${message.conversationId}:${message.id}`)) return;
  if (props.detached) refreshGroupAfterSystemMessage(message);
  const unchanged = messages.value.some((item) =>
    isSameMessageView(item, message),
  );
  if (message.status === 'sent') settleConfirmedMessage(message);
  const conversation = conversations.value.find(
    (item) => item.id === message.conversationId,
  );
  if (
    conversation &&
    shouldUpdateMessagePreview(
      previews.value[message.conversationId],
      message,
      conversation.updatedAt,
    )
  ) {
    conversations.value = updateConversationActivity(
      conversations.value,
      message.conversationId,
      message.createdAt,
    );
    setMessagePreview(message);
  }
  if (message.conversationId === activeId.value && !unchanged) {
    const followLatest =
      !locatingUnread.value &&
      !locatingReply.value &&
      (messageList.value?.isAtBottom() ?? true);
    const present = messages.value.some(
      (item) =>
        item.id === message.id ||
        (message.clientMsgId && item.clientMsgId === message.clientMsgId),
    );
    if (
      !present &&
      messages.value.length > 0 &&
      message.createdAt < messages.value[0]!.createdAt
    )
      return;
    if (!present && !followLatest)
      messageList.value?.trackIncomingMessage(message);
    messages.value = mergeMessages(messages.value, [message]);
    if (!present && followLatest) void scrollToBottom();
  }
};

onMounted(() => {
  unsubscribeGroupExited = window.desktop?.onGroupExited(applyGroupExited);
  if (!props.detached)
    unsubscribeTrayConversation = window.desktop?.onTrayConversation((id) => {
      void openTrayConversation(id);
    });
  unsubscribeConversationRead = window.desktop?.onConversationRead((state) => {
    if (disposed || props.readOnly || state.userId !== props.session.user.id)
      return;
    const conversation = conversations.value.find(
      (item) => item.id === state.conversationId,
    );
    if (conversation) {
      conversation.unreadCount = state.unreadCount;
      if (state.notDisturb !== undefined)
        conversation.notDisturb = state.notDisturb;
    }
  });
  unsubscribeConversationMessage = window.desktop?.onConversationMessage(
    receiveConversationMessage,
  );
  unsubscribeFriendProfileChat = window.desktop?.onFriendProfileChat(
    (roomId) => {
      if (disposed || props.readOnly || roomId !== activeId.value) return;
      detailsOpen.value = false;
      void nextTick(() => messageComposer.value?.focus());
    },
  );
  unsubscribeOpenFriendChat = window.desktop?.onOpenFriendChat((uid) => {
    void openSearchedFriend(uid);
  });
  if (!props.detached)
    unsubscribeFriendDeleted = window.desktop?.onFriendDeleted(friendDeleted);
  if (!props.detached)
    unsubscribeFriendAdded = window.desktop?.onFriendAdded((userId, friend) => {
      if (userId === props.session.user.id) addFriendToDirectory(friend);
    });
  unsubscribeFriendRemark = window.desktop?.onFriendRemarkUpdated((update) => {
    if (disposed || props.readOnly || update.userId !== props.session.user.id)
      return;
    updateContactRemark(update);
    const conversation = conversations.value.find(
      (item) => item.id === update.roomId,
    );
    if (conversation?.type === 2)
      conversation.title = update.settings.remark || update.name;
    friendRemarkUpdated(update);
  });
  window.addEventListener('online', updateNetworkAvailability);
  window.addEventListener('offline', updateNetworkAvailability);
  unsubscribeSseStatus = window.desktop?.onResourceStatus((status) => {
    resourceStatusVersion++;
    updateResourceStatus(status);
  });
  unsubscribeResourceMessage = window.desktop?.onResourceMessage((raw) => {
    const historySync = parseRoomHistorySyncNotification(raw.data);
    if (historySync) {
      if (
        !disposed &&
        !props.readOnly &&
        historySync.roomId === activeId.value
      ) {
        reconnectSyncPending = true;
        void syncAfterReconnect();
      }
      return;
    }
    if (props.detached) return;
    handleRtcWindowSse(raw);
    if (isFriendApplyNotification(raw.data, props.session.user.id)) {
      if (!disposed && !props.readOnly) {
        applicationsRevision.value++;
        void friendUnreadSync.refresh();
      }
      return;
    }
    const removed = parseGroupMembersRemovedNotification(raw.data);
    if (removed) {
      if (!disposed && !props.readOnly)
        void refreshGroupAvatarAfterRemoval(removed.roomId, removed.uids);
      return;
    }
    dispatchResourceMessage(raw, handleIncomingMessage);
  });
  unsubscribeMediaDrop = window.desktop?.onMediaDrop(receiveMediaDrop);
  unsubscribeVideoPreparation = window.desktop?.onVideoDraftProcessingProgress(
    updateVideoPreparation,
  );
  unsubscribeFilePreparation = window.desktop?.onFileDraftProcessingProgress(
    updateFilePreparation,
  );
  unsubscribeVideoProgress = window.desktop?.onVideoUploadProgress(
    videoOutbox.progress,
  );
  unsubscribeFileProgress = window.desktop?.onFileUploadProgress(
    (progress): void => {
      const task = fileSends.value[progress.draftId];
      if (
        disposed ||
        props.readOnly ||
        !task ||
        fileTaskRooms.get(progress.draftId) !== progress.roomId ||
        !['validating', 'uploading', 'finalizing'].includes(task.phase)
      )
        return;
      fileSends.value = {
        ...fileSends.value,
        [progress.draftId]: {
          ...task,
          phase: progress.phase,
          uploadedBytes: progress.uploadedBytes,
        },
      };
      videoSends.value = { ...videoOutbox.snapshot(), ...fileSends.value };
    },
  );
  void restoreResourceSseStatus();
  if (!props.detached) void friendUnreadSync.refresh();
  void initialize().then(() => {
    if (!disposed) emit('initialized');
  });
});
onBeforeUnmount(() => {
  replyDrafts.value = {};
  messageSounds.dispose();
  clearFriendSuccessFeedback();
  unsubscribeConversationMessage?.();
  unsubscribeConversationRead?.();
  unsubscribeGroupExited?.();
  unsubscribeFriendProfileChat?.();
  unsubscribeFriendDeleted?.();
  unsubscribeFriendAdded?.();
  unsubscribeFriendRemark?.();
  dismissFriendProfile();
  friendUnreadSync.stop();
  unsubscribeOpenFriendChat?.();
  unsubscribeTrayConversation?.();
  messageRecall.clear();
  messageRetry.clear();
  unsubscribeVideoProgress?.();
  unsubscribeVideoPreparation?.();
  unsubscribeFilePreparation?.();
  unsubscribeFileProgress?.();
  unsubscribeMediaDrop?.();
  unsubscribeMediaDrop = undefined;
  clearImageDrafts();
  window.removeEventListener('online', updateNetworkAvailability);
  window.removeEventListener('offline', updateNetworkAvailability);
  unsubscribeSseStatus?.();
  unsubscribeSseStatus = undefined;
  unsubscribeResourceMessage?.();
  unsubscribeResourceMessage = undefined;
  for (const entry of pendingTimers.values()) clearTimeout(entry.timer);
  pendingTimers.clear();
  disposed = true;
  selectionVersion++;
});
</script>

<style>
.desktop-window.desktop-window--chat {
  width: 100vw;
  height: 100dvh;
  border: 0;
  border-radius: 0;
  background: #c4c4c8;
}
.chat-workspace {
  display: grid;
  /* 导航固定 59px，列表收缩时为聊天区保留至少 430px。 */
  grid-template-columns: 59px clamp(196px, calc(100% - 489px), 240px) minmax(
      0,
      1fr
    );
  grid-template-rows: 31px minmax(0, 1fr);
  width: 100%;
  height: 100%;
  padding: 0 3px 3px 0;
}
.chat-sidebar {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #ededee;
  border-radius: 6px 0 0 6px;
}
.chat-small-button {
  display: inline-grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #66666b;
  background: transparent;
  cursor: pointer;
}
.chat-small-button:hover {
  background: #e1e1e4;
}
.chat-small-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.chat-avatar {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 7px;
  font-size: 20px;
}
.chat-avatar--files {
  color: #fff;
  background: #00c66a;
}
.chat-avatar--contact {
  color: #fff;
  background: #6997b3;
}
.chat-avatar {
  position: relative;
  overflow: hidden;
}
.chat-avatar > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.chat-content {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  position: relative;
  overflow: hidden;
  border-radius: 0 6px 6px 0;
  background: #f8f8f8;
}
.chat-empty {
  flex: 1;
  display: grid;
  place-items: center;
  color: #e1e1e1;
}
.chat-workspace--directory .chat-empty {
  display: none;
}
.chat-conversation-view {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.chat-conversation-body {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
.chat-workspace .el-dialog {
  max-width: calc(100vw - 32px);
  border-radius: 6px;
}
.chat-workspace button:focus-visible {
  outline: 2px solid #00ae68;
  outline-offset: -2px;
}
.chat-mobile-back {
  display: none;
}
@media (width < 690px) {
  .chat-workspace {
    grid-template-columns: 59px minmax(0, 1fr);
  }
  .chat-content {
    display: none;
  }
  .chat-workspace--detail .chat-sidebar {
    display: none;
  }
  .chat-workspace--detail .chat-content {
    display: flex;
  }
  .chat-mobile-back {
    display: inline-grid;
  }
}
</style>
