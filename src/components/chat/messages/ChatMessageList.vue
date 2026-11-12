<template>
  <div
    ref="messagePanel"
    class="chat-messages"
    :aria-busy="loading || replyNavigating"
    @wheel.passive="markManualScroll"
    @touchmove.passive="markManualScroll"
    @pointerdown="markManualScroll"
    @pointermove.passive="markManualScroll"
    @keydown="markManualScroll"
  >
    <div v-if="unreadCount > 0 && !readOnly" class="chat-unread-navigation">
      <button
        type="button"
        class="chat-unread-jump"
        :disabled="
          loading || disabled || locatingUnread || replyNavigating || !readReady
        "
        :aria-busy="locatingUnread"
        :title="
          locatingUnread ? '正在定位未读消息' : '定位到上次已读后的第一条新消息'
        "
        :aria-label="`定位 ${unreadCount} 条新消息的起点`"
        @click="emit('locateUnread')"
      >
        <el-icon class="chat-unread-jump-icon" :size="16"
          ><DArrowLeft
        /></el-icon>
        <span>{{
          locatingUnread ? '正在定位...' : `${unreadCount}条新消息`
        }}</span>
      </button>
    </div>
    <BubbleList
      ref="bubbleList"
      class="chat-bubble-list"
      :list="messages"
      item-key="id"
      :item-type="getItemType"
      :virtual="true"
      :auto-scroll="false"
      :smooth-scroll="false"
      :show-back-button="false"
      :btn-loading="false"
      :load-more-top-threshold="80"
      @load-more-top="requestOlder"
    >
      <template #item="{ item: message, index }">
        <div
          v-if="isMessagePlaceholder(message)"
          class="chat-message-placeholder"
          :data-message-row="message.id"
          :style="{ height: `${message.placeholder.height}px` }"
          role="status"
        >
          <span>{{
            messageWindowErrors.get(message.id) || '正在读取消息…'
          }}</span>
          <button
            v-if="messageWindowErrors.has(message.id)"
            type="button"
            @click="messageWindow.retry"
          >
            重试
          </button>
        </div>
        <RowHighlight
          v-else
          class="chat-message-group"
          :data-message-row="message.id"
          :active="message.id === locatedMessageId"
          :viewport="scrollViewport"
        >
          <div
            v-if="index === 0 && !loading && !hasMore"
            class="chat-history-end"
            role="status"
          >
            没有更多消息了~
          </div>
          <div v-if="showMessageTime(index)" class="chat-message-time">
            {{ formatMessageTime(message.createdAt) }}
          </div>
          <div
            v-if="message.messageType === 'local-notice'"
            class="chat-message-rejection"
            :data-message-id="message.id"
            role="status"
          >
            {{ message.deletedAt ? '消息已移除' : rejectionText(message) }}
            <button
              v-if="
                !message.deletedAt &&
                rejectionText(message) === FRIEND_VERIFICATION_REQUIRED_TEXT
              "
              type="button"
              class="chat-friend-verification"
              :disabled="readOnly || applyingFriend"
              @click="emit('applyFriend', message)"
            >
              发送朋友验证
            </button>
          </div>
          <div
            v-else-if="message.messageType === 'system'"
            class="chat-system-message"
            :data-message-id="message.id"
          >
            <SystemMessage
              :content="message.deletedAt ? '消息已移除' : message.content"
              :user-id="userId"
            />
          </div>
          <div
            v-else-if="message.messageType === 'recalled'"
            class="chat-recalled-message"
            :data-message-id="message.id"
          >
            <span>{{
              formatRecallMessage(
                message.content,
                userId,
                message.conversationId,
                contacts,
              )
            }}</span>
            <button
              v-if="!readOnly && reeditable.includes(message.id)"
              type="button"
              class="chat-reedit-message"
              title="将原文放入草稿"
              :disabled="disabled || loading"
              @click="emit('reedit', message)"
            >
              重新编辑
            </button>
          </div>
          <article
            v-else
            class="chat-message"
            :class="{ 'chat-message--mine': message.senderId === userId }"
            :data-message-id="message.id"
            @contextmenu="showMessageMenu($event, message)"
          >
            <img
              v-if="message.senderId === userId"
              :src="avatar || DEFAULT_AVATAR_URL"
              alt="我的头像"
              draggable="false"
              @error="handleAvatarError"
            />
            <ChatContactAvatar
              v-else
              :uid="message.senderId"
              :contact="contacts[message.senderId]"
              :room-id="message.conversationId"
              @needed="emit('contactNeeded', $event, message.conversationId)"
              @refresh="emit('contactClick', $event, message.conversationId)"
            />
            <div class="chat-message-body">
              <div class="chat-message-row">
                <RtcCallMessage
                  v-if="
                    message.messageType === 'rtc-call' && !message.deletedAt
                  "
                  :content="message.content"
                  :user-id="userId"
                  :outgoing="message.senderId === userId"
                  :can-redial="canRedial"
                  @redial="emit('redial', $event)"
                />
                <span
                  v-else-if="
                    isSending(message) &&
                    !message.deletedAt &&
                    !(
                      isFileAttachment(message) &&
                      videoSends[message.clientMsgId ?? message.id]
                    )
                  "
                  class="chat-send-spinner"
                  aria-label="发送中"
                ></span>
                <button
                  v-else-if="
                    canRetry(message) &&
                    !message.deletedAt &&
                    message.senderId === userId
                  "
                  type="button"
                  class="chat-send-retry"
                  :class="{
                    'chat-send-retry--rejected': rejectionText(message),
                  }"
                  :title="retryTitle(message)"
                  aria-label="重试发送"
                  :disabled="readOnly"
                  @click="emit('retry', message)"
                >
                  !
                </button>
                <EmojiMessage
                  v-if="message.messageType === 'emoji' && !message.deletedAt"
                  :content="message.content"
                  :conversation-id="message.conversationId"
                  :message-id="message.id"
                  :can-add-emoji="!readOnly && canAddImageEmoji(message)"
                  :show-reply="showReply(message)"
                  @reply="selectReply(message)"
                  :can-recall="canRecall(message)"
                  :recalling="recalling.includes(message.id)"
                  @recall="emit('recall', message)"
                />
                <FileMessage
                  v-else-if="!message.deletedAt && isFileAttachment(message)"
                  :message="message"
                  :read-only="readOnly"
                  :send="videoSends[message.clientMsgId ?? message.id]"
                  :outgoing="message.senderId === userId"
                  :allow-send="true"
                  :show-reply="showReply(message)"
                  @reply="selectReply(message)"
                  @retry="emit('retry', message)"
                  @cancel="emit('cancelUpload', message)"
                  :can-recall="canRecall(message)"
                  :recalling="recalling.includes(message.id)"
                  @recall="emit('recall', message)"
                />
                <VoiceMessage
                  v-else-if="
                    message.messageType === 'audio' && !message.deletedAt
                  "
                  :message="message"
                  :outgoing="message.senderId === userId"
                  :disabled="readOnly"
                />
                <VideoMessage
                  v-else-if="
                    ['video', 'temporary', 'upload-cancelled'].includes(
                      message.messageType,
                    ) && !message.deletedAt
                  "
                  :message="message"
                  :read-only="readOnly"
                  :send="videoSends[message.clientMsgId ?? message.id]"
                  :outgoing="message.senderId === userId"
                  :allow-resend="true"
                  :show-reply="showReply(message)"
                  @reply="selectReply(message)"
                  @cancel="emit('cancelUpload', message)"
                  @resend="emit('retry', message)"
                  :can-recall="canRecall(message)"
                  :recalling="recalling.includes(message.id)"
                  @recall="emit('recall', message)"
                />
                <ImageMessage
                  v-else-if="
                    message.messageType === 'image' && !message.deletedAt
                  "
                  :content="message.content"
                  :conversation-id="message.conversationId"
                  :message-id="message.id"
                  :can-add-emoji="!readOnly && canAddImageEmoji(message)"
                  :show-reply="showReply(message)"
                  @reply="selectReply(message)"
                  :can-recall="canRecall(message)"
                  :recalling="recalling.includes(message.id)"
                  @recall="emit('recall', message)"
                />
                <p
                  v-else-if="
                    message.messageType !== 'rtc-call' || message.deletedAt
                  "
                >
                  {{ message.deletedAt ? '消息已移除' : message.content }}
                </p>
              </div>
              <ReplyMessage
                v-if="message.replyId && !message.deletedAt"
                :message="message"
                :user-id="userId"
                :contacts="contacts"
                :cached-target="replyTargets.get(message.replyId)"
                :updated-message="replyUpdates.get(message.replyId)"
                :disabled="readOnly"
                :locating="
                  replyNavigating || locatingUnread || loading || disabled
                "
                @locate="locateReply"
                @contact-needed="
                  emit('contactNeeded', $event.senderId, $event.conversationId)
                "
              />
            </div>
          </article>
        </RowHighlight>
      </template>
    </BubbleList>
    <ReplyReturnButton
      v-if="returnPoint"
      :class="{ 'chat-reply-return-raised': latestUnreadMessage }"
      :busy="replyNavigating || loading || locatingUnread"
      @return="returnToReply"
    />
    <MessageJumpButton
      v-if="
        !readOnly &&
        (latestUnreadMessage || (unreadCount > 0 && awayFromBottom))
      "
      label="跳转到最新消息"
      :busy="locatingLatest || locatingUnread"
      :disabled="
        loading || disabled || locatingUnread || replyNavigating || !readReady
      "
      @jump="latestUnreadMessage ? locateLatestUnread() : emit('locateUnread')"
    />
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../../services/runtime/public-assets';
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowRef,
  watch,
} from 'vue';
import { ElIcon } from 'element-plus';
import { DArrowLeft, RefreshLeft } from '@element-plus/icons-vue';
import { BubbleList } from 'vue-element-plus-x';
import type { BubbleListInstance } from 'vue-element-plus-x/types/BubbleList';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import 'element-plus/es/components/icon/style/css';
import 'vue-element-plus-x/es/BubbleList/index.css';
import type { Contact, Message } from '../../../../shared/storage/database';
import { compareMessageIds } from '../../../../shared/chat/conversations/conversation-deletion';
import {
  FRIEND_VERIFICATION_REQUIRED_TEXT,
  messageRejectionKey,
  parseMessageRejectionNotice,
} from '../../../../shared/chat/messages/message-rejection';
import { canAddImageEmoji } from '../../../../shared/chat/emoji';
import ChatContactAvatar from '../../avatar/ChatContactAvatar.vue';
import EmojiMessage from './EmojiMessage.vue';
import ImageMessage from './ImageMessage.vue';
import VideoMessage from './VideoMessage.vue';
import FileMessage from './FileMessage.vue';
import VoiceMessage from './VoiceMessage.vue';
import RtcCallMessage from './RtcCallMessage.vue';
import type { RtcMediaMode } from '../../../../shared/rtc/rtc';
import SystemMessage from './SystemMessage.vue';
import ReplyMessage from './ReplyMessage.vue';
import ReplyReturnButton from './ReplyReturnButton.vue';
import MessageJumpButton from './MessageJumpButton.vue';
import RowHighlight from '../feedback/RowHighlight.vue';
import { useRowHighlight } from '../feedback/row-highlight';
import { useMessageCopy } from './useMessageCopy';
import { replyMenuItem } from './reply-menu';
import {
  messageDeletionMenuKey,
  messageDeleteMenuItem,
} from './message-delete-menu';
import type { MessageDeletionMenu } from './message-delete-menu';
import { canDeleteMessage } from '../../../../shared/chat/messages/message-deletion';
import { canReplyToMessage } from '../../../../shared/chat/messages/message-reply';
import { parseUploadPlaceholder } from '../../../../shared/chat/messages/upload-placeholder';
import type { VideoSendView } from '../../../services/media/video/video-outbox';
import {
  formatRecallMessage,
  messageDisplayUid,
} from '../../../../shared/chat/messages/recall-message';
import type {
  MessageScrollPosition,
  MessageVirtualizer,
} from '../../../services/chat/messages/message-scroll-position';
import { isMessagePlaceholder } from '../../../services/chat/messages/message-window';
import type { MessageWindowUpdate } from '../../../services/chat/messages/message-window';
import { useMessageWindow } from './useMessageWindow';
import {
  captureMessageScrollPosition,
  findMessagePositionIndex,
  isMessageVirtualizer,
  normalizeMessageScrollOffset,
} from '../../../services/chat/messages/message-scroll-position';

const props = defineProps<{
  conversationId: string;
  messages: Message[];
  applyingFriend: boolean;
  videoSends: Record<string, VideoSendView>;
  recalling: string[];
  deleting?: string[];
  reeditable: string[];
  canRecallMembers: boolean;
  userId: string;
  avatar?: string;
  title: string;
  contacts: Record<string, Contact>;
  loading: boolean;
  hasMore: boolean;
  disabled: boolean;
  readOnly: boolean;
  canRedial: boolean;
  readReady: boolean;
  unreadCount: number;
  locatingUnread: boolean;
  loadOlderPage: () => Promise<boolean>;
  readMessageBatch: (roomId: string, ids: string[]) => Promise<Message[]>;
}>();
const emit = defineEmits<{
  (event: 'loadOlder'): void;
  (event: 'retry', message: Message): void;
  (event: 'applyFriend', message: Message): void;
  (event: 'cancelUpload', message: Message): void;
  (event: 'recall', message: Message): void;
  (event: 'delete', message: Message): void;
  (event: 'reply', message: Message): void;
  (event: 'reedit', message: Message): void;
  (event: 'contactClick', uid: string, roomId: string): void;
  (event: 'contactNeeded', uid: string, roomId: string): void;
  (event: 'redial', mediaMode: RtcMediaMode): void;
  (event: 'read', message: Message): void;
  (event: 'locateUnread'): void;
  (event: 'replyNavigation', active: boolean): void;
  (event: 'navigationError', message: string): void;
  (event: 'windowChange', roomId: string, updates: MessageWindowUpdate[]): void;
}>();
const bubbleList = ref<BubbleListInstance>();
const messagePanel = ref<HTMLDivElement>();
const replyTargets = computed(
  (): Map<string, Message> =>
    new Map(
      props.messages
        .filter((message) => !isMessagePlaceholder(message))
        .map((message) => [message.id, message]),
    ),
);
const replyUpdates = shallowRef(new Map<string, Message>());
const unsubscribeReplyUpdates = window.desktop?.onConversationMessage(
  (message): void => {
    if (
      !props.messages.some(
        (source) =>
          !isMessagePlaceholder(source) &&
          source.conversationId === message.conversationId &&
          source.replyId === message.id,
      )
    )
      return;
    replyUpdates.value = new Map(replyUpdates.value).set(message.id, message);
  },
);
watch(
  () => props.messages[0]?.conversationId,
  (): void => {
    replyUpdates.value = new Map();
  },
);
onBeforeUnmount(() => unsubscribeReplyUpdates?.());
const {
  highlightedId: locatedMessageId,
  highlight,
  clear: clearHighlight,
} = useRowHighlight();
const { copyMenuItem } = useMessageCopy();
const scrollViewport = shallowRef<HTMLElement | null>(null);
let viewportObserver: ResizeObserver | undefined;
let previousViewportHeight = 0;
let previousScrollTop = 0;
let previousScrollHeight = 0;
let disposed = false;
let menu: ContextMenuInstance | undefined;
let readFrame: number | undefined;
const replyNavigating = ref(false);
const returnPoint = ref<{ source: Message; offset: number } | null>(null);
const latestUnreadIds = shallowRef<ReadonlySet<string>>(new Set());
const locatingLatest = ref(false);
const awayFromBottom = ref(false);
const latestUnreadMessage = computed((): Message | undefined =>
  props.messages.find(
    (message) =>
      latestUnreadIds.value.has(message.id) &&
      !message.deletedAt &&
      message.messageType !== 'recalled',
  ),
);
let replyNavigationVersion = 0;
let positionVersion = 0;
let manualScroll = false;
let scrollInputVersion = 0;
let preservationVersion = 0;
let returnCheckFrame: number | undefined;

/** 发送确认换 ID 后仍按原 clientMsgId 寻找引用消息，不按数组下标定位。 */
const findReplySource = (source: Message): Message | undefined =>
  props.messages.find(
    (message) =>
      message.conversationId === source.conversationId &&
      (message.id === source.id ||
        (source.clientMsgId !== null &&
          message.clientMsgId === source.clientMsgId &&
          message.senderId === source.senderId)),
  );

/** 使用实际渲染行判断可见性，未渲染的虚拟行不能当作已到达。 */
const messageIsVisible = (messageId: string): boolean => {
  const viewport = scrollViewport.value;
  const row = viewport?.querySelector<HTMLElement>(
    `[data-message-row="${CSS.escape(messageId)}"]`,
  );
  if (!viewport || !row) return false;
  const bounds = row.getBoundingClientRect();
  const visible = viewport.getBoundingClientRect();
  return bounds.bottom > visible.top + 4 && bounds.top < visible.bottom - 4;
};

/** 手动滚回引用行后移除返回入口，程序定位和图片尺寸变化不触发清除。 */
const checkReturnedPosition = (): void => {
  returnCheckFrame = undefined;
  const point = returnPoint.value;
  if (!point || replyNavigating.value || !manualScroll) return;
  const source = findReplySource(point.source);
  if (source && messageIsVisible(source.id)) {
    returnPoint.value = null;
    manualScroll = false;
  }
};

/** 记录真实滚动输入，避免刚跳到附近原文就误判已经返回。 */
const markManualScroll = (event: Event): void => {
  if (
    event instanceof PointerEvent &&
    event.type === 'pointermove' &&
    event.buttons === 0
  )
    return;
  if (event.type === 'pointerdown' && event.target !== scrollViewport.value)
    return;
  if (
    event instanceof KeyboardEvent &&
    ![
      'ArrowUp',
      'ArrowDown',
      'PageUp',
      'PageDown',
      'Home',
      'End',
      ' ',
    ].includes(event.key)
  )
    return;
  if (returnPoint.value && !replyNavigating.value) manualScroll = true;
  scrollInputVersion++;
};

watch(replyNavigating, (active) => emit('replyNavigation', active), {
  flush: 'sync',
});
watch(
  () => props.readOnly,
  (): void => {
    messageWindow.invalidate();
    replyNavigationVersion++;
    positionVersion++;
    returnPoint.value = null;
    replyNavigating.value = false;
    latestUnreadIds.value = new Set();
    locatingLatest.value = false;
  },
);

/** 只确认前台最新区已渲染的消息，上翻历史、隐藏和补洞期间不推进。 */
const reportVisibleRead = (): void => {
  readFrame = undefined;
  const viewport = scrollViewport.value;
  if (
    disposed ||
    props.readOnly ||
    !props.readReady ||
    props.loading ||
    props.locatingUnread ||
    replyNavigating.value ||
    document.visibilityState !== 'visible' ||
    !document.hasFocus() ||
    !viewport ||
    viewport.clientHeight === 0 ||
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 8
  )
    return;
  let message: Message | undefined;
  for (let index = props.messages.length - 1; index >= 0; index--) {
    const item = props.messages[index]!;
    if (
      item.status === 'sent' &&
      !item.deletedAt &&
      /^[1-9]\d{0,18}$/.test(item.id)
    ) {
      message = item;
      break;
    }
  }
  if (!message) return;
  const element = viewport.querySelector<HTMLElement>(
    `[data-message-id="${CSS.escape(message.id)}"]`,
  );
  if (!element) return;
  const bounds = element.getBoundingClientRect();
  const visible = viewport.getBoundingClientRect();
  if (bounds.bottom > visible.top && bounds.top < visible.bottom) {
    if (latestUnreadIds.value.size > 0) latestUnreadIds.value = new Set();
    emit('read', message);
  }
};

/** 合并同一帧的滚动、渲染和焦点通知，不用定时轮询 DOM。 */
const scheduleVisibleRead = (): void => {
  if (!disposed && readFrame === undefined)
    readFrame = requestAnimationFrame(reportVisibleRead);
};

/** 记录正常滚动位置，尺寸变化引起的浏览器自动夹紧留给高度补偿处理。 */
const recordScrollPosition = (): void => {
  messageWindow.schedule();
  scheduleVisibleRead();
  closeMessageMenu();
  if (returnCheckFrame === undefined)
    returnCheckFrame = requestAnimationFrame(checkReturnedPosition);
  const viewport = scrollViewport.value;
  updateAwayFromBottom();
  if (!viewport || viewport.clientHeight !== previousViewportHeight) return;
  previousScrollTop = viewport.scrollTop;
  previousScrollHeight = viewport.scrollHeight;
};

/** 更新是否离开消息列表底部，用于决定是否显示未读跳转按钮。 */
const updateAwayFromBottom = (): void => {
  const viewport = scrollViewport.value;
  awayFromBottom.value = Boolean(
    viewport &&
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight > 8,
  );
};

/** 仅在视口此前位于底部时补偿高度变化，避免锚点阅读位置被重新推移。 */
const resizeMessageViewport = (): void => {
  messageWindow.schedule();
  const viewport = scrollViewport.value;
  if (disposed || !viewport || viewport.clientHeight === 0) return;
  const height = viewport.clientHeight;
  const wasAtBottom =
    previousScrollHeight > 0 &&
    previousScrollTop + previousViewportHeight >= previousScrollHeight - 8;
  if (
    wasAtBottom &&
    previousViewportHeight > 0 &&
    height !== previousViewportHeight
  ) {
    viewport.scrollTop = Math.max(
      0,
      previousScrollTop + previousViewportHeight - height,
    );
  }
  previousViewportHeight = height;
  previousScrollTop = viewport.scrollTop;
  previousScrollHeight = viewport.scrollHeight;
  updateAwayFromBottom();
  scheduleVisibleRead();
};

onMounted((): void => {
  // 使用 BubbleList 的实际滚动视口，继续由原组件维护虚拟列表和滚动事件。
  scrollViewport.value =
    messagePanel.value?.querySelector<HTMLElement>('.elx-bubble-list__list') ??
    null;
  const viewport = scrollViewport.value;
  if (!viewport) return;
  previousViewportHeight = viewport.clientHeight;
  previousScrollTop = viewport.scrollTop;
  previousScrollHeight = viewport.scrollHeight;
  updateAwayFromBottom();
  viewport.addEventListener('scroll', recordScrollPosition, { passive: true });
  viewportObserver = new ResizeObserver(resizeMessageViewport);
  viewportObserver.observe(viewport);
  window.addEventListener('focus', scheduleVisibleRead);
  document.addEventListener('visibilitychange', scheduleVisibleRead);
  scheduleVisibleRead();
});

/** 群管理权限来自本次详情，管理员可撤回上传占位；服务端仍逐次核验角色。 */
const canRecall = (message: Message): boolean => {
  if (
    props.readOnly ||
    message.status !== 'sent' ||
    message.deletedAt ||
    !/^[1-9]\d*$/.test(message.id) ||
    !/^[1-9]\d*$/.test(message.conversationId)
  )
    return false;
  if (props.canRecallMembers)
    return [
      'text',
      'image',
      'video',
      'file',
      'emoji',
      'audio',
      'temporary',
      'upload-cancelled',
    ].includes(message.messageType);
  return (
    message.senderId === props.userId &&
    ['text', 'image', 'video', 'file', 'emoji', 'audio'].includes(
      message.messageType,
    ) &&
    Date.now() - new Date(message.createdAt).getTime() <= 120000
  );
};

/** 仅为已确认的远端普通消息展示引用入口，不开放历史只读操作。 */
const showReply = (message: Message): boolean => {
  return !props.readOnly && canReplyToMessage(message);
};

/** 点击时重新读取列表中的消息，拒绝已撤回或虚拟列表复用后的旧目标。 */
const selectReply = (target: Message): void => {
  const current = props.messages.find(
    (message) =>
      message.id === target.id &&
      message.conversationId === target.conversationId,
  );
  if (
    !disposed &&
    !props.disabled &&
    current &&
    !isMessagePlaceholder(current) &&
    showReply(current)
  )
    emit('reply', { ...current });
};

/** 关闭消息右键菜单，避免虚拟列表复用后继续操作旧消息。 */
const closeMessageMenu = (): void => {
  menu?.closeMenu();
  menu = undefined;
};

/** 点击前重新读取列表目标，不能删除虚拟节点复用后的其他消息。 */
const deletionMenu: MessageDeletionMenu = (target) => {
  const current = props.messages.find(
    (message) =>
      message.id === target.messageId &&
      message.conversationId === target.conversationId,
  );
  if (props.readOnly || !current || !canDeleteMessage(current)) return [];
  return [
    messageDeleteMenuItem(
      Boolean(props.deleting?.includes(current.id)),
      (): void => {
        const message = props.messages.find(
          (item) =>
            item.id === target.messageId &&
            item.conversationId === target.conversationId,
        );
        if (
          !disposed &&
          !props.readOnly &&
          message &&
          !props.deleting?.includes(message.id) &&
          canDeleteMessage(message)
        )
          emit('delete', { ...message });
      },
    ),
  ];
};
provide(messageDeletionMenuKey, deletionMenu);

/** 文本均提供复制，撤回菜单继续遵循发送者、时间及群管理权限。 */
const showMessageMenu = (event: MouseEvent, message: Message): void => {
  const copyable = message.messageType === 'text' && !message.deletedAt;
  const recallable = canRecall(message);
  const replyVisible = showReply(message);
  const deleteItems = deletionMenu({
    conversationId: message.conversationId,
    messageId: message.id,
  });
  if (!copyable && !recallable && !replyVisible && !deleteItems.length) return;
  event.preventDefault();
  event.stopPropagation();
  closeMessageMenu();
  const target: Message = { ...message };
  const recalling = props.recalling.includes(message.id);
  menu = ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    onClose: (): void => {
      menu = undefined;
    },
    items: [
      ...(copyable
        ? [
            copyMenuItem(
              { kind: 'text', text: target.content },
              () =>
                !props.readOnly &&
                props.messages.some(
                  (item) =>
                    item.id === target.id &&
                    item.conversationId === target.conversationId &&
                    item.messageType === 'text' &&
                    !item.deletedAt &&
                    item.content === target.content,
                ),
            ),
          ]
        : []),
      ...(replyVisible ? [replyMenuItem(() => selectReply(target))] : []),
      ...(recallable
        ? [
            {
              label: '撤回消息',
              icon: h(RefreshLeft, {
                style: { width: '16px', height: '16px' },
              }),
              disabled: recalling,
              onClick: (): void => {
                if (!disposed && !props.readOnly) emit('recall', target);
              },
            },
          ]
        : []),
      ...deleteItems,
    ],
  });
};

/** 文件卡片自行显示上传圆环，避免同时出现重复的发送指示。 */
const isFileAttachment = (message: Message): boolean =>
  message.messageType === 'file' ||
  (['temporary', 'upload-cancelled'].includes(message.messageType) &&
    parseUploadPlaceholder(message.content)?.targetType === 6);

/** 占位回执不结束发送态，直到最终视频确认或明确失败。 */
const isSending = (message: Message): boolean => {
  const task = props.videoSends[message.clientMsgId ?? message.id];
  return task
    ? !['failed', 'cancel-failed', 'cancelled'].includes(task.phase)
    : message.messageType !== 'temporary' && message.status === 'pending';
};

/** 活跃失败任务仍显示重试；重登占位由视频卡片核验本机来源后提供恢复入口。 */
const canRetry = (message: Message): boolean => {
  const task = props.videoSends[message.clientMsgId ?? message.id];
  if (message.messageType === 'upload-cancelled') return false;
  if (message.messageType === 'temporary')
    return task?.phase === 'failed' || task?.phase === 'cancel-failed';
  return message.status === 'failed';
};

/** 从已加载本地提示恢复失败按钮的原因，提示记录本身不受原消息状态影响。 */
const rejections = computed((): ReadonlyMap<string, string> => {
  const values = new Map<string, string>();
  for (const message of props.messages) {
    const notice = parseMessageRejectionNotice(message);
    if (!notice || message.deletedAt) continue;
    values.set(
      messageRejectionKey({ ...message, clientMsgId: notice.clientMsgId }),
      notice.text,
    );
  }
  return values;
});

/** 本地提示独立展示；原消息仅在失败时通过按钮显示关联原因。 */
const rejectionText = (message: Message): string => {
  if (message.messageType === 'local-notice')
    return parseMessageRejectionNotice(message)?.text ?? '';
  if (
    message.senderId !== props.userId ||
    message.status !== 'failed' ||
    message.deletedAt ||
    message.messageType === 'recalled'
  )
    return '';
  return rejections.value.get(messageRejectionKey(message)) ?? '';
};

/** 失败按钮保留重试入口，悬浮时显示本条消息的实际拒收原因。 */
const retryTitle = (message: Message): string => {
  if (props.readOnly) return '登录已过期，无法重试';
  const reason = rejectionText(message);
  return reason ? `${reason} 点击重试` : '发送失败，点击重试';
};

/** 使用自定义消息插槽，沿用本地消息布局且无需复制整个历史数组。 */
const getItemType = (): string => 'chat-message';

const fiveMinutes = 5 * 60 * 1000;

/** 判断第 index 条消息是否显示时间分隔：首条、间隔超五分钟或最新消息久未更新时显示。 */
const showMessageTime = (index: number): boolean => {
  const message = props.messages[index];
  if (!message) return false;
  if (index === 0) return true;
  const previous = props.messages[index - 1];
  const gap =
    new Date(message.createdAt).getTime() -
    new Date(previous.createdAt).getTime();
  if (gap >= fiveMinutes) return true;
  return (
    index === props.messages.length - 1 &&
    Date.now() - new Date(message.createdAt).getTime() >= fiveMinutes
  );
};

/** 格式化消息时间：当天显示时:分，非当天显示完整日期时间。 */
const formatMessageTime = (value: string): string => {
  const date = new Date(value);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
};

/** 远程头像失效时回退到本地默认头像，避免消息头像显示为空白。 */
const handleAvatarError = (event: Event): void => {
  const image = event.currentTarget;
  if (!(image instanceof HTMLImageElement) || image.dataset.fallback) return;
  image.dataset.fallback = 'true';
  image.src = DEFAULT_AVATAR_URL;
};

/** 响应虚拟列表到达顶部的请求，自动加载上一页历史消息。 */
const requestOlder = (): void => {
  if (props.loading) return;
  if (replyNavigating.value) {
    bubbleList.value?.loadMoreTopComplete();
    return;
  }
  if (!props.hasMore || props.disabled) {
    bubbleList.value?.loadMoreTopComplete();
    return;
  }
  emit('loadOlder');
};

/** 使用虚拟列表定位最新消息，不依赖尚未渲染的消息 DOM。 */
const scrollToBottom = (): void => {
  replyNavigationVersion++;
  positionVersion++;
  replyNavigating.value = false;
  locatingLatest.value = false;
  returnPoint.value = null;
  clearHighlight();
  bubbleList.value?.scrollToBottom(false);
  scheduleVisibleRead();
};

/** 查询滚动前的位置，避免新消息把正在阅读未读起点的用户拉回底部。 */
const isAtBottom = (): boolean => {
  const viewport = scrollViewport.value;
  return (
    !viewport ||
    viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 8
  );
};

/** 仅登记上翻期间的新到消息；调用方在合并前排除重复记录和发送确认。 */
const trackIncomingMessage = (message: Message): void => {
  if (
    disposed ||
    props.readOnly ||
    !props.readReady ||
    isAtBottom() ||
    message.senderId === props.userId ||
    message.status !== 'sent' ||
    message.deletedAt ||
    message.messageType === 'recalled' ||
    !/^[1-9]\d{0,18}$/.test(message.id)
  )
    return;
  // 落库通知也可能来自历史补页，不将当前消息区间之前的记录作为实时新消息。
  for (let index = props.messages.length - 1; index >= 0; index--) {
    const item = props.messages[index]!;
    if (
      item.status !== 'sent' ||
      !/^[1-9]\d{0,18}$/.test(item.id) ||
      latestUnreadIds.value.has(item.id)
    )
      continue;
    if (
      message.createdAt < item.createdAt ||
      (message.createdAt === item.createdAt &&
        compareMessageIds(message.id, item.id) <= 0)
    )
      return;
    break;
  }
  latestUnreadIds.value = new Set(latestUnreadIds.value).add(message.id);
};

/** 按消息 ID 定位虚拟行，短暂标记目标，不自行提交已读确认。 */
const scrollToMessage = async (
  messageId: string,
  offset: number = 0,
  preserveReturn: boolean = false,
): Promise<boolean> => {
  if (!preserveReturn) returnPoint.value = null;
  const version = ++positionVersion;
  clearHighlight();
  await nextTick();
  if (disposed || version !== positionVersion) return false;
  const index = props.messages.findIndex((message) => message.id === messageId);
  const handle = bubbleList.value?.virtualizerRef;
  if (index < 0 || !isMessageVirtualizer(handle)) return false;
  for (let attempt = 0; attempt < 4; attempt++) {
    handle.scrollToIndex(index, { align: 'start', offset, smooth: false });
    await nextTick();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    if (disposed || version !== positionVersion) return false;
    if (messageIsVisible(messageId)) {
      if (!(await messageWindow.ensure(messageId))) return false;
      if (disposed || version !== positionVersion) return false;
      break;
    }
  }
  if (!messageIsVisible(messageId)) return false;
  highlight(messageId);
  return true;
};

/** 跳到本轮新消息的第一条并复用行高亮，失败保留入口，期间到达的新消息不丢失。 */
const locateLatestUnread = async (): Promise<void> => {
  const target = latestUnreadMessage.value;
  if (
    !target ||
    disposed ||
    props.readOnly ||
    !props.readReady ||
    props.loading ||
    props.disabled ||
    props.locatingUnread ||
    replyNavigating.value
  )
    return;
  const pending = latestUnreadIds.value;
  const version = ++replyNavigationVersion;
  locatingLatest.value = true;
  replyNavigating.value = true;
  try {
    const positioned = await scrollToMessage(target.id);
    if (disposed || version !== replyNavigationVersion) return;
    if (positioned) {
      latestUnreadIds.value = new Set(
        [...latestUnreadIds.value].filter((id) => !pending.has(id)),
      );
    } else {
      emit('navigationError', '定位未读消息失败，请重试。');
    }
  } catch {
    if (!disposed && version === replyNavigationVersion)
      emit('navigationError', '定位未读消息失败，请重试。');
  } finally {
    if (!disposed && version === replyNavigationVersion) {
      locatingLatest.value = false;
      replyNavigating.value = false;
      scheduleVisibleRead();
    }
  }
};

/** 沿既有连续分页查找原文，每次最多补二十页，不伪造中间历史已加载。 */
const locateReply = async (source: Message): Promise<void> => {
  if (
    replyNavigating.value ||
    props.loading ||
    props.disabled ||
    props.locatingUnread ||
    props.readOnly ||
    disposed
  )
    return;
  const current = findReplySource(source);
  if (!current?.replyId || current.deletedAt) return;
  const handle = bubbleList.value?.virtualizerRef;
  const sourceIndex = props.messages.findIndex(
    (message) => message.id === current.id,
  );
  if (!isMessageVirtualizer(handle) || sourceIndex < 0) return;
  const point = {
    source: { ...current },
    offset: handle.scrollOffset - handle.getItemOffset(sourceIndex),
  };
  const version = ++replyNavigationVersion;
  replyNavigating.value = true;
  manualScroll = false;
  try {
    for (let page = 0; page <= 20; page++) {
      if (disposed || version !== replyNavigationVersion || props.readOnly)
        return;
      const latest = findReplySource(current);
      if (!latest || latest.replyId !== current.replyId || latest.deletedAt)
        return;
      const original = props.messages.find(
        (message) => message.id === current.replyId,
      );
      if (original) {
        if (original.deletedAt) throw new Error('原消息已移除，无法定位。');
        const positioned = await scrollToMessage(original.id, 0, true);
        if (disposed || version !== replyNavigationVersion) return;
        if (!positioned) throw new Error('定位原文失败，请重试。');
        returnPoint.value = point;
        return;
      }
      if (!props.hasMore)
        throw new Error('未找到原消息，可能尚未同步或已移除。');
      if (page === 20)
        throw new Error('原文距离较远，已加载部分历史，请再次定位。');
      if (!(await props.loadOlderPage()))
        throw new Error('读取原文所在的历史失败，请重试。');
    }
  } catch (cause) {
    if (!disposed && version === replyNavigationVersion)
      emit(
        'navigationError',
        cause instanceof Error ? cause.message : '定位原文失败',
      );
  } finally {
    if (!disposed && version === replyNavigationVersion)
      replyNavigating.value = false;
  }
};

/** 返回原引用行及行内偏移，成功定位后才移除返回按钮。 */
const returnToReply = async (): Promise<void> => {
  const point = returnPoint.value;
  if (!point || replyNavigating.value || props.loading || props.locatingUnread)
    return;
  const source = findReplySource(point.source);
  if (!source || source.deletedAt) {
    returnPoint.value = null;
    emit('navigationError', '引用消息已移除，无法返回。');
    return;
  }
  const version = ++replyNavigationVersion;
  replyNavigating.value = true;
  try {
    const positioned = await scrollToMessage(source.id, point.offset, true);
    if (disposed || version !== replyNavigationVersion) return;
    if (positioned) returnPoint.value = null;
    else emit('navigationError', '返回引用位置失败，请重试。');
  } finally {
    if (!disposed && version === replyNavigationVersion)
      replyNavigating.value = false;
  }
};

/** 按实际渲染的消息行捕获视口锚点，避免只依赖虚拟器的像素下标。 */
const captureVisibleMessagePosition = (
  virtualizer: MessageVirtualizer | undefined,
): MessageScrollPosition | null => {
  const viewport = scrollViewport.value;
  if (!viewport || !virtualizer) return null;
  const viewportBounds = viewport.getBoundingClientRect();
  const rows = Array.from(
    viewport.querySelectorAll<HTMLElement>('[data-message-row]'),
  );
  const intersectingRows = rows.filter((row) => {
    const bounds = row.getBoundingClientRect();
    return (
      bounds.bottom > viewportBounds.top && bounds.top < viewportBounds.bottom
    );
  });
  if (intersectingRows.length === 0) return null;
  const completeRow = intersectingRows.find((row) => {
    const bounds = row.getBoundingClientRect();
    return (
      bounds.top >= viewportBounds.top && bounds.bottom <= viewportBounds.bottom
    );
  });
  const row = completeRow ?? intersectingRows[0];
  const messageId = row?.dataset.messageRow;
  if (!row || !messageId) return null;
  const index = props.messages.findIndex((message) => message.id === messageId);
  if (index < 0) return null;
  const virtualItem = row.closest<HTMLElement>(
    '.elx-bubble-list__virtual-item',
  );
  const anchorBounds = (virtualItem ?? row).getBoundingClientRect();
  return captureMessageScrollPosition(
    props.messages,
    virtualizer,
    isAtBottom(),
    index,
    -(anchorBounds.top - viewportBounds.top),
  );
};

/** 保留插入历史消息前的可见锚点和行内偏移，避免分页后视口跳动。 */
const preserveScroll = async (update: () => void): Promise<void> => {
  const preservation = ++preservationVersion;
  const virtualizer = bubbleList.value?.virtualizerRef;
  const handle = isMessageVirtualizer(virtualizer) ? virtualizer : undefined;
  const position =
    captureVisibleMessagePosition(handle) ??
    captureMessageScrollPosition(props.messages, handle, isAtBottom());
  const inputVersion = scrollInputVersion;
  const navigationVersion = positionVersion;
  update();
  await nextTick();
  if (!handle || !position) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (
      disposed ||
      preservation !== preservationVersion ||
      inputVersion !== scrollInputVersion ||
      navigationVersion !== positionVersion ||
      !scrollViewport.value?.isConnected
    )
      return;
    const nextIndex = findMessagePositionIndex(props.messages, position);
    if (nextIndex < 0) return;
    handle.scrollToIndex(nextIndex, {
      align: 'start',
      offset: normalizeMessageScrollOffset(position.offset),
      smooth: false,
    });
    if (attempt < 2)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
  }
};

/** 缓存当前会话消息视口位置，供切换会话后恢复原来的阅读位置。 */
const captureScrollPosition = (): MessageScrollPosition | null => {
  const virtualizer = bubbleList.value?.virtualizerRef;
  const handle = isMessageVirtualizer(virtualizer) ? virtualizer : undefined;
  return (
    captureVisibleMessagePosition(handle) ??
    captureMessageScrollPosition(props.messages, handle, isAtBottom())
  );
};

/** 恢复会话消息视口位置，锚点缺失时返回 false 交由上层决定回退策略。 */
const restoreScrollPosition = async (
  position: MessageScrollPosition,
): Promise<boolean> => {
  const version = ++positionVersion;
  await nextTick();
  if (disposed || version !== positionVersion) return false;
  if (position.atBottom) {
    scrollToBottom();
    return true;
  }
  const virtualizer = bubbleList.value?.virtualizerRef;
  const handle = isMessageVirtualizer(virtualizer) ? virtualizer : undefined;
  if (!handle) return false;
  const index = findMessagePositionIndex(props.messages, position);
  if (index < 0) return false;
  handle.scrollToIndex(index, {
    align: 'start',
    offset: normalizeMessageScrollOffset(position.offset),
    smooth: false,
  });
  await nextTick();
  if (disposed || version !== positionVersion) return false;
  const restoredIndex = findMessagePositionIndex(props.messages, position);
  return (
    restoredIndex >= 0 &&
    (await messageWindow.ensure(props.messages[restoredIndex]!.id))
  );
};

const messageWindow = useMessageWindow({
  roomId: props.conversationId,
  messages: (): Message[] => props.messages,
  viewport: scrollViewport,
  virtualizer: (): MessageVirtualizer | undefined => {
    const handle = bubbleList.value?.virtualizerRef;
    return isMessageVirtualizer(handle) ? handle : undefined;
  },
  read: (roomId: string, ids: string[]): Promise<Message[]> =>
    props.readMessageBatch(roomId, ids),
  replace: (updates: MessageWindowUpdate[]): void =>
    emit('windowChange', props.conversationId, updates),
  preserve: preserveScroll,
});
const messageWindowErrors = messageWindow.errors;

watch(
  () => props.messages,
  (): void => {
    const references = new Set(
      props.messages
        .filter((message) => !isMessagePlaceholder(message))
        .map((message) => message.replyId),
    );
    replyUpdates.value = new Map(
      [...replyUpdates.value].filter(([id]) => references.has(id)),
    );
    messageWindow.schedule();
  },
  { flush: 'post' },
);

watch(
  () => [props.messages, props.loading, props.readReady],
  scheduleVisibleRead,
  { flush: 'post' },
);
watch(
  () => props.loading,
  (loading) => {
    if (!loading) bubbleList.value?.loadMoreTopComplete();
  },
  { flush: 'post' },
);
watch(
  () => props.messages,
  (messages): void => {
    const seen = new Set<string>();
    for (const message of messages) {
      if (message.messageType !== 'recalled' || isMessagePlaceholder(message))
        continue;
      const uid = messageDisplayUid(message);
      const key = JSON.stringify([message.conversationId, uid]);
      if (uid && uid !== props.userId && !seen.has(key)) {
        seen.add(key);
        emit('contactNeeded', uid, message.conversationId);
      }
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  disposed = true;
  replyNavigationVersion++;
  positionVersion++;
  emit('replyNavigation', false);
  if (returnCheckFrame !== undefined) cancelAnimationFrame(returnCheckFrame);
  if (readFrame !== undefined) cancelAnimationFrame(readFrame);
  window.removeEventListener('focus', scheduleVisibleRead);
  document.removeEventListener('visibilitychange', scheduleVisibleRead);
  viewportObserver?.disconnect();
  scrollViewport.value?.removeEventListener('scroll', recordScrollPosition);
  scrollViewport.value = null;
  closeMessageMenu();
});

defineExpose({
  conversationId: props.conversationId,
  scrollToBottom,
  scrollToMessage,
  isAtBottom,
  preserveScroll,
  captureScrollPosition,
  restoreScrollPosition,
  trackIncomingMessage,
});
</script>

<style>
.chat-messages {
  --chat-message-left-padding: 24px;
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  user-select: text;
}
.chat-unread-navigation {
  display: flex;
  justify-content: flex-end;
  flex: 0 0 32px;
  padding: 0 16px 4px var(--chat-message-left-padding);
}
.chat-unread-jump {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  height: 26px;
  max-width: 100%;
  padding: 0 12px;
  border: 1px solid #dceee3;
  border-radius: 999px;
  background: #fff;
  color: #159455;
  box-shadow: 0 1px 5px #00000008;
  font: inherit;
  font-size: 12px;
  line-height: 24px;
  cursor: pointer;
  user-select: none;
}
.chat-unread-jump span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-unread-jump-icon {
  flex-shrink: 0;
  transform: rotate(90deg);
}
.chat-unread-jump:hover:not(:disabled) {
  background: #edf8f1;
  border-color: #b5dec5;
}
.chat-unread-jump:focus-visible {
  outline: 2px solid #159455;
  outline-offset: 2px;
}
.chat-unread-jump:disabled {
  cursor: default;
  opacity: 0.65;
}
.chat-bubble-list {
  isolation: isolate;
  flex: 1;
  min-height: 0;
}
.chat-messages .elx-bubble-list__list {
  height: 100%;
  overflow-x: hidden;
  padding-right: 16px;
}
/* 虚拟列表自带的左侧 2px 留白也移到行内，让高亮贴齐边缘。 */
.chat-messages
  .chat-bubble-list
  .elx-bubble-list__list.elx-bubble-list__list--virtual {
  padding-left: 0;
}
.chat-messages .elx-bubble-list__virtual-item {
  padding-bottom: 4px;
}
.chat-messages .elx-bubble-list__virtual-item:has(> .chat-message-placeholder) {
  padding-block: 0 !important;
}
.chat-message-placeholder {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  overflow: hidden;
  color: #8b8b91;
  font-size: 12px;
  overflow-anchor: none;
}
.chat-message-placeholder button {
  border: 0;
  background: transparent;
  color: #159455;
  cursor: pointer;
}
.chat-messages
  .chat-bubble-list
  .elx-bubble-list__list
  .elx-bubble-list__spacer {
  height: 0;
}
.chat-history-end {
  padding: 4px 16px 8px 0;
  text-align: center;
  color: #a8a8ae;
  font-size: 11px;
}
.chat-message-group {
  /* 高亮覆盖相邻行间距的一半：虚拟列表顶部 16px + 底部 4px。 */
  --row-highlight-block-outset: 10px;
  width: 100%;
  padding-left: calc(var(--chat-message-left-padding) + 2px);
}
.chat-message {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  margin: 0;
}
.chat-reply-return-raised {
  --message-jump-bottom: 54px;
}
.chat-message > img,
.chat-message > .chat-avatar {
  width: 35px;
  height: 35px;
  border-radius: 5px;
  object-fit: cover;
}
.chat-message > .chat-avatar--contact {
  border: 0;
  padding: 0;
  cursor: pointer;
}
.chat-message--mine {
  flex-direction: row-reverse;
}
.chat-message-body {
  min-width: 0;
  max-width: 78%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
}
.chat-message--mine .chat-message-body {
  align-items: flex-end;
}
.chat-message-body p {
  margin: 0;
  padding: 10px 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  background: #fff;
  border: 1px solid #e9e9e9;
  border-radius: 5px;
}
.chat-message--mine .chat-message-body p {
  background: #a9e97b;
  border-color: #a9e97b;
}
.chat-message-time {
  margin: 10px 0 6px;
  text-align: center;
  color: #a5a5ab;
  font-size: 11px;
  user-select: none;
}
.chat-message-row {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}
.chat-message-row p {
  min-width: 0;
}
.chat-send-spinner {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 2px solid #d9d9dd;
  border-top-color: #a0a0a6;
  border-radius: 50%;
  animation: chat-spin 0.8s linear infinite;
}
@keyframes chat-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  /* 仅保留消息发送中的等待反馈，不解除其他界面动画限制。 */
  .chat-workspace .chat-send-spinner {
    animation: chat-spin 0.8s linear infinite !important;
  }
}
.chat-send-retry {
  display: inline-grid;
  place-items: center;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: #f04a3e;
  color: #fff;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
.chat-send-retry--rejected {
  width: 20px;
  height: 20px;
  margin-right: 4px;
  background: #ff4d55;
  font-size: 14px;
}
.chat-message-rejection {
  margin: 20px 0 12px;
  padding: 0 12px;
  color: #9999a1;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  overflow-wrap: anywhere;
}
.chat-friend-verification {
  margin-left: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #365b91;
  font: inherit;
  cursor: pointer;
}
.chat-friend-verification:hover:not(:disabled) {
  text-decoration: underline;
}
.chat-friend-verification:disabled {
  opacity: 0.5;
  cursor: default;
}
@media (max-width: 720px) and (min-width: 561px) {
  .chat-messages {
    --chat-message-left-padding: 16px;
    padding-right: 16px;
  }
}
@media (max-width: 560px) {
  .chat-messages {
    --chat-message-left-padding: 12px;
    padding-right: 12px;
  }
}
@media (max-width: 560px) {
  .chat-message-body {
    max-width: 80%;
  }
}
</style>

<style scoped>
.chat-system-message,
.chat-recalled-message {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: center;
  gap: 4px 8px;
  padding: 8px 16px;
  color: #777;
  font-size: 12px;
  text-align: center;
  overflow-wrap: anywhere;
}
.chat-system-message {
  white-space: pre-wrap;
  line-height: 1.6;
}
.chat-reedit-message {
  flex: 0 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
  color: #405b91;
  font: inherit;
  cursor: pointer;
}
.chat-reedit-message:hover:not(:disabled) {
  text-decoration: underline;
}
.chat-reedit-message:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
