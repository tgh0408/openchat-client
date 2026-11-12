<template>
  <main class="chat-history-window" aria-label="聊天记录窗口">
    <header class="history-titlebar">
      <h1 :title="`与“${conversationTitle}”的聊天记录`">
        与“{{ conversationTitle }}”的聊天记录
      </h1>
      <div class="window-actions">
        <button
          class="icon-button"
          title="最小化"
          aria-label="最小化历史窗口"
          @click="emit('minimize')"
        >
          <el-icon><Minus /></el-icon>
        </button>
        <button
          class="icon-button close-button"
          title="关闭"
          aria-label="关闭历史窗口"
          @click="closeHistory"
        >
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </header>
    <div class="history-search">
      <el-input
        v-model="keyword"
        :prefix-icon="Search"
        placeholder="搜索"
        aria-label="搜索聊天记录"
        maxlength="256"
        clearable
      />
    </div>
    <div class="history-filters" aria-label="历史记录筛选">
      <button
        v-for="item in categories"
        :key="item.value"
        type="button"
        :class="{ 'is-active': category === item.value }"
        :aria-pressed="category === item.value"
        @click="toggleCategory(item.value)"
      >
        {{ item.label }}
      </button>
      <el-popover placement="bottom-end" :width="240" trigger="click">
        <template #reference
          ><button
            type="button"
            :class="{ 'is-active': date }"
            :aria-pressed="Boolean(date)"
          >
            日期
          </button></template
        >
        <div class="history-date">
          <label for="history-date">日期</label>
          <input
            id="history-date"
            v-model="date"
            type="date"
            aria-label="按日期筛选聊天记录"
          />
          <el-button link :disabled="!date" @click="clearDate"
            >清除日期</el-button
          >
        </div>
      </el-popover>
    </div>
    <div v-if="category !== 'all' || date" class="history-selection">
      <span>{{ filterLabel }}</span>
      <el-button link @click="clearFilters">全部记录</el-button>
    </div>
    <div v-if="navigationError" class="history-navigation-error" role="status">
      {{ navigationError }}
    </div>
    <div
      ref="resultList"
      class="history-results"
      :aria-busy="loading || navigatingReply"
      @scroll.passive="onHistoryScroll"
      @wheel.passive="markManualScroll"
      @touchmove.passive="markManualScroll"
      @pointerdown="markManualScroll"
      @keydown="markManualScroll"
    >
      <div v-if="offsetBase > 0" class="history-pagination">
        <el-button
          link
          :disabled="loading || navigatingReply"
          @click="loadNewer"
        >
          加载较新的消息
        </el-button>
      </div>
      <div v-if="error" class="history-empty" role="alert">
        <span>{{ error }}</span
        ><el-button link @click="retry">重试</el-button>
      </div>
      <div v-else-if="!records.length" class="history-empty" role="status">
        {{ loading ? '正在读取...' : '无内容' }}
      </div>
      <template v-else>
        <RowHighlight
          v-for="message in records"
          :key="message.id"
          tag="article"
          class="history-record"
          :data-message-row="message.id"
          :active="locatedMessageId === message.id"
          :viewport="resultList"
        >
          <div
            v-if="['system', 'local-notice'].includes(message.messageType)"
            class="history-system-message"
          >
            <time>{{ formatTimestamp(message.createdAt) }}</time>
            <p>
              <SystemMessage
                :content="
                  message.messageType === 'local-notice'
                    ? (parseMessageRejectionNotice(message)?.text ?? '')
                    : message.content
                "
                :user-id="userId"
              />
            </p>
          </div>
          <template v-else>
            <ChatContactAvatar
              v-if="messageDisplayUid(message)"
              class="history-contact-avatar"
              :uid="messageDisplayUid(message)!"
              :contact="contacts[messageDisplayUid(message)!]"
              :room-id="message.conversationId"
              @needed="loadContact(message)"
              @refresh="loadContact(message, true)"
            />
            <div class="history-record-body">
              <header>
                <span>{{ displayName(message) }}</span
                ><time>{{ formatTimestamp(message.createdAt) }}</time>
              </header>
              <span
                v-if="message.messageType !== 'text'"
                class="history-record-type"
                >{{ typeLabel(message.messageType) }}</span
              >
              <EmojiMessage
                v-if="message.messageType === 'emoji'"
                :content="message.content"
              />
              <FileMessage
                v-else-if="
                  message.messageType === 'file' ||
                  (['temporary', 'upload-cancelled'].includes(
                    message.messageType,
                  ) &&
                    parseUploadPlaceholder(message.content)?.targetType === 6)
                "
                :message="message"
                :show-cancelled-label="false"
              />
              <VoiceMessage
                v-else-if="message.messageType === 'audio'"
                :message="message"
                :outgoing="message.senderId === userId"
              />
              <VideoMessage
                v-else-if="
                  ['video', 'temporary', 'upload-cancelled'].includes(
                    message.messageType,
                  )
                "
                :message="message"
              />
              <ImageMessage
                v-else-if="message.messageType === 'image'"
                :content="message.content"
                :conversation-id="message.conversationId"
                :message-id="message.id"
                auto-download
              />
              <RtcCallMessage
                v-else-if="message.messageType === 'rtc-call'"
                :content="message.content"
                :user-id="userId"
                :outgoing="message.senderId === userId"
                :can-redial="Boolean(historyApi)"
                @redial="requestRtcCall"
              />
              <p v-else-if="message.messageType === 'recalled'">
                {{
                  formatRecallMessage(
                    message.content,
                    userId,
                    conversationId,
                    contacts,
                  )
                }}
              </p>
              <p v-else @contextmenu="showTextMenu($event, message)">
                {{ message.content }}
              </p>
              <ReplyMessage
                v-if="
                  message.replyId &&
                  !message.deletedAt &&
                  message.messageType !== 'recalled'
                "
                :message="message"
                :user-id="userId"
                :contacts="contacts"
                :cached-target="replyTargets.get(message.replyId)"
                :updated-message="replyUpdates.get(message.replyId)"
                :locating="loading || navigatingReply"
                @locate="locateReply"
                @contact-needed="loadContact"
              />
            </div>
          </template>
        </RowHighlight>
        <div class="history-pagination">
          <el-button
            v-if="hasMore"
            link
            :loading="loading"
            :disabled="navigatingReply"
            @click="loadMore"
            >加载更多</el-button
          ><span v-else>没有更多记录</span>
        </div>
      </template>
    </div>
    <ReplyReturnButton
      v-if="returnPoint"
      :busy="loading || navigatingReply"
      @return="returnToReply"
    />
  </main>
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../shared/api/api-error';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue';
import ContextMenu from '../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../services/context-menu/context-menu';
import { useMessageCopy } from '../../components/chat/messages/useMessageCopy';
import { ElButton, ElIcon, ElInput, ElPopover } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/popover/style/css';
import { Close, Minus, Search } from '@element-plus/icons-vue';
import type {
  HistoryCategory,
  HistoryQuery,
  Message,
  Contact,
} from '../../../shared/storage/database';
import EmojiMessage from '../../components/chat/messages/EmojiMessage.vue';
import ImageMessage from '../../components/chat/messages/ImageMessage.vue';
import VideoMessage from '../../components/chat/messages/VideoMessage.vue';
import FileMessage from '../../components/chat/messages/FileMessage.vue';
import VoiceMessage from '../../components/chat/messages/VoiceMessage.vue';
import RtcCallMessage from '../../components/chat/messages/RtcCallMessage.vue';
import SystemMessage from '../../components/chat/messages/SystemMessage.vue';
import ReplyMessage from '../../components/chat/messages/ReplyMessage.vue';
import ReplyReturnButton from '../../components/chat/messages/ReplyReturnButton.vue';
import RowHighlight from '../../components/chat/feedback/RowHighlight.vue';
import { useRowHighlight } from '../../components/chat/feedback/row-highlight';
import { parseMessageRejectionNotice } from '../../../shared/chat/messages/message-rejection';
import { parseUploadPlaceholder } from '../../../shared/chat/messages/upload-placeholder';
import ChatContactAvatar from '../../components/avatar/ChatContactAvatar.vue';
import {
  formatRecallMessage,
  messageDisplayUid,
  parseRecallContent,
  resolveMessageName,
} from '../../../shared/chat/messages/recall-message';
import {
  isContactNameFresh,
  mergeContactProfiles,
} from '../../../shared/contacts/contact-name';
import type { RtcMediaMode } from '../../../shared/rtc/rtc';

const props = defineProps<{
  conversationId: string;
  conversationTitle: string;
  userId: string;
  searchMessages: (query: HistoryQuery) => Promise<Message[]>;
}>();
const emit = defineEmits<{ close: []; minimize: [] }>();
const historyApi = window.historyDesktop;
const contacts = ref<Record<string, Contact>>({});
const pendingContacts = new Set<string>();
const contactAttempts = new Map<string, number>();
let disposed = false;
const categories: { value: HistoryCategory; label: string }[] = [
  { value: 'file', label: '文件' },
  { value: 'media', label: '图片与视频' },
  { value: 'link', label: '链接' },
  { value: 'music', label: '音乐' },
  { value: 'miniapp', label: '小程序' },
  { value: 'channel', label: '视频号' },
];
const keyword = ref('');
const category = ref<HistoryCategory>('all');
const date = ref('');
const records = ref<Message[]>([]);
const replyTargets = computed(
  (): Map<string, Message> =>
    new Map(records.value.map((message) => [message.id, message])),
);
const replyUpdates = shallowRef(new Map<string, Message>());
const { copyMenuItem } = useMessageCopy();
let textMenu: ContextMenuInstance | undefined;

/** 历史文本也可复制，筛选或撤回后不执行旧菜单的操作。 */
const showTextMenu = (event: MouseEvent, message: Message): void => {
  if (message.messageType !== 'text' || message.deletedAt) return;
  event.preventDefault();
  event.stopPropagation();
  textMenu?.closeMenu();
  const target = { ...message };
  textMenu = ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    items: [
      copyMenuItem(
        { kind: 'text', text: target.content },
        () =>
          !disposed &&
          records.value.some(
            (item) =>
              item.id === target.id &&
              item.conversationId === target.conversationId &&
              item.messageType === 'text' &&
              !item.deletedAt &&
              item.content === target.content,
          ),
      ),
    ],
  });
};
onBeforeUnmount(() => textMenu?.closeMenu());
watch(records, () => textMenu?.closeMenu());
const recalledMessages = new Map<string, Message>();
const loading = ref(false);
const hasMore = ref(false);
const error = ref('');
const resultList = ref<HTMLDivElement>();
const offsetBase = ref(0);
const navigatingReply = ref(false);
const navigationError = ref('');
const {
  highlightedId: locatedMessageId,
  highlight,
  clear: clearHighlight,
} = useRowHighlight();
interface ReplyReturnPoint {
  sourceId: string;
  offset: number;
  keyword: string;
  category: HistoryCategory;
  date: string;
  records: Message[];
  offsetBase: number;
  hasMore: boolean;
}
const returnPoint = shallowRef<ReplyReturnPoint | null>(null);
let restoringView = false;
let manualScroll = false;
let navigationVersion = 0;
const filterLabel = computed((): string =>
  [categories.find((item) => item.value === category.value)?.label, date.value]
    .filter(Boolean)
    .join(' · '),
);
let generation = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

/** 请求关闭当前独立历史窗口，不关闭主聊天窗口。 */
const closeHistory = (): void => {
  emit('close');
};

/** 同一分类再次点击时恢复全部类型，保留关键词和日期。 */
const toggleCategory = (value: HistoryCategory): void => {
  category.value = category.value === value ? 'all' : value;
};

/** 清除日期限制，保留当前分类和关键词。 */
const clearDate = (): void => {
  date.value = '';
};

/** 恢复所有分类及日期，保留用户正在搜索的关键词。 */
const clearFilters = (): void => {
  category.value = 'all';
  date.value = '';
};

/** 请求主聊天窗口回拨当前历史记录对应的语音或视频通话。 */
const requestRtcCall = async (mediaMode: RtcMediaMode): Promise<void> => {
  if (!historyApi) return;
  try {
    await historyApi.requestRtcCall(mediaMode);
  } catch (cause) {
    error.value = getRequestErrorMessage(
      cause,
      '发起回拨失败，请返回聊天窗口重试',
    );
  }
};

/** 显示本地完整日期和时间，便于区分不同日期的记录。 */
const formatTimestamp = (value: string): string =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

/** 用内容类型标注非文本消息，不把文本路径当成可访问的附件。 */
const typeLabel = (value: string): string =>
  ({
    file: '文件',
    image: '图片',
    emoji: '表情包',
    video: '视频',
    temporary: '上传中',
    'upload-cancelled': '已取消发送',
    audio: '语音',
    music: '音乐',
    miniapp: '小程序',
    channel: '视频号',
    system: '系统消息',
    recalled: '已撤回',
    'rtc-call': '通话',
  })[value] ?? '消息';

/** 标题与正文使用同一名称规则，管理员代撤回显示管理员而不是原发送者。 */
const displayName = (message: Message): string => {
  const uid = messageDisplayUid(message);
  if (!uid) return '消息通知';
  if (uid === props.userId) return '我';
  return resolveMessageName(
    uid,
    message.conversationId,
    contacts.value[uid],
    message.messageType === 'recalled'
      ? parseRecallContent(message.content).recallName
      : null,
    message.messageType === 'recalled'
      ? parseRecallContent(message.content).recallGroupNickname
      : null,
  );
};

/** 可见消息按实际展示的人读取资料；合并请求并避免失败后连续重试。 */
const loadContact = async (
  message: Message,
  retry: boolean = false,
): Promise<void> => {
  const uid = messageDisplayUid(message);
  if (!uid || !historyApi || disposed || pendingContacts.has(uid)) return;
  if (
    !retry &&
    (isContactNameFresh(contacts.value[uid], message.conversationId) ||
      Date.now() - (contactAttempts.get(uid) ?? 0) < 30000)
  )
    return;
  pendingContacts.add(uid);
  contactAttempts.set(uid, Date.now());
  try {
    const contact = await historyApi.getMessageContact(message.id, retry);
    if (
      !disposed &&
      props.conversationId === message.conversationId &&
      contact?.id === uid
    )
      contacts.value[uid] = mergeContactProfiles(contacts.value[uid], contact);
  } catch {
    // 资料不可用时保留缓存或默认头像，不影响历史记录阅读。
  } finally {
    pendingContacts.delete(uid);
  }
};

/** 将本地自然日转为 UTC 半开区间，次日按日历递增以适配夏令时。 */
const dateRange = (): Pick<HistoryQuery, 'startAt' | 'endAt'> => {
  if (!date.value) return { startAt: null, endAt: null };
  const start = new Date(`${date.value}T00:00:00`);
  if (!Number.isFinite(start.getTime())) throw new Error('请选择有效日期');
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
};

/** 查询一页筛选结果，关闭或改变条件后忽略旧请求。 */
const fetchPage = async (append: boolean, version: number): Promise<void> => {
  loading.value = true;
  error.value = '';
  try {
    const page = await props.searchMessages({
      conversationId: props.conversationId,
      keyword: keyword.value.trim(),
      category: category.value,
      ...dateRange(),
      offset: append ? offsetBase.value + records.value.length : 0,
    });
    if (version !== generation) return;
    const current = page
      .map((message) => recalledMessages.get(message.id) ?? message)
      .filter((message) => !message.deletedAt);
    records.value = append ? [...records.value, ...current] : current;
    hasMore.value = page.length === 50;
  } catch {
    if (version === generation) error.value = '读取聊天记录失败，请重试';
  } finally {
    if (version === generation) loading.value = false;
  }
};

/** 输入后短暂防抖并立即清理旧结果，防止筛选条件和内容不一致。 */
const scheduleSearch = (): void => {
  if (restoringView) return;
  navigationVersion++;
  navigatingReply.value = false;
  returnPoint.value = null;
  clearHighlight();
  navigationError.value = '';
  offsetBase.value = 0;
  const version = ++generation;
  clearTimeout(timer);
  records.value = [];
  hasMore.value = false;
  error.value = '';
  loading.value = true;
  if (resultList.value) resultList.value.scrollTop = 0;
  timer = setTimeout(() => {
    void fetchPage(false, version);
  }, 250);
};

/** 在现有条件下读取下一页，避免并发请求导致重复记录。 */
const loadMore = (): void => {
  if (loading.value || !hasMore.value || navigatingReply.value) return;
  void fetchPage(true, generation);
};

/** 查询失败后从第一页重试，确保分页偏移与筛选条件一致。 */
const retry = (): void => {
  scheduleSearch();
};

/** 读取可见历史行，不使用文本匹配或浮点 ID 运算。 */
const findHistoryRow = (messageId: string): HTMLElement | null =>
  resultList.value?.querySelector<HTMLElement>(
    `[data-message-row="${CSS.escape(messageId)}"]`,
  ) ?? null;

/** 定位实际行并闪亮一次，底部空间不足时沿用浏览器滚动边界。 */
const scrollToHistoryRow = async (
  messageId: string,
  offset: number,
  version: number,
): Promise<boolean> => {
  clearHighlight();
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  if (disposed || version !== navigationVersion) return false;
  const viewport = resultList.value;
  const row = findHistoryRow(messageId);
  if (!viewport || !row) return false;
  viewport.scrollTop +=
    row.getBoundingClientRect().top -
    viewport.getBoundingClientRect().top -
    offset;
  highlight(messageId);
  return true;
};

/** 暂存当前筛选和引用行偏移，原文页与返回视图均保持只读。 */
const captureReturnPoint = (source: Message): ReplyReturnPoint | null => {
  const viewport = resultList.value;
  const row = findHistoryRow(source.id);
  if (!viewport || !row) return null;
  return {
    sourceId: source.id,
    offset:
      row.getBoundingClientRect().top - viewport.getBoundingClientRect().top,
    keyword: keyword.value,
    category: category.value,
    date: date.value,
    records: records.value,
    offsetBase: offsetBase.value,
    hasMore: hasMore.value,
  };
};

/** 切换定位视图时不触发搜索防抖，撤回终态优先于保存的旧快照。 */
const restoreReturnView = (point: ReplyReturnPoint): void => {
  restoringView = true;
  try {
    keyword.value = point.keyword;
    category.value = point.category;
    date.value = point.date;
    records.value = point.records
      .map((message) => recalledMessages.get(message.id) ?? message)
      .filter((message) => !message.deletedAt);
    offsetBase.value = point.offsetBase;
    hasMore.value = point.hasMore;
  } finally {
    restoringView = false;
  }
};

/** 原文不在筛选结果中时读取其本地上下文页，成功后提供返回入口。 */
const locateReply = async (source: Message): Promise<void> => {
  if (loading.value || navigatingReply.value || disposed || !source.replyId)
    return;
  const point = captureReturnPoint(source);
  if (!point) return;
  const version = ++navigationVersion;
  navigatingReply.value = true;
  navigationError.value = '';
  manualScroll = false;
  let changedView = false;
  try {
    if (!records.value.some((message) => message.id === source.replyId)) {
      if (!historyApi) throw new Error('原文不在当前缓存页面中。');
      const page = await historyApi.readReplyPage(source.id);
      if (disposed || version !== navigationVersion) return;
      if (!page || page.targetId !== source.replyId)
        throw new Error('原消息未缓存或已移除，无法定位。');
      if (!page.list.some((message) => message.id === page.targetId))
        throw new Error('原文所在的历史已变化，请重试。');
      restoreReturnView({
        ...point,
        keyword: '',
        category: 'all',
        date: '',
        records: page.list,
        offsetBase: page.offset,
        hasMore: page.list.length === 50,
      });
      changedView = true;
    }
    const positioned = await scrollToHistoryRow(source.replyId, 12, version);
    if (disposed || version !== navigationVersion) return;
    if (!positioned) throw new Error('定位原文失败，请重试。');
    returnPoint.value = point;
  } catch (cause) {
    if (!disposed && version === navigationVersion) {
      if (changedView) {
        restoreReturnView(point);
        await scrollToHistoryRow(point.sourceId, point.offset, version);
      }
      if (version === navigationVersion)
        navigationError.value =
          cause instanceof Error ? cause.message : '定位原文失败';
    }
  } finally {
    if (!disposed && version === navigationVersion)
      navigatingReply.value = false;
  }
};

/** 恢复定位前的筛选结果和引用行，避免返回到另一组同名搜索结果。 */
const returnToReply = async (): Promise<void> => {
  const point = returnPoint.value;
  if (!point || loading.value || navigatingReply.value) return;
  const version = ++navigationVersion;
  navigatingReply.value = true;
  restoreReturnView(point);
  try {
    if (await scrollToHistoryRow(point.sourceId, point.offset, version))
      returnPoint.value = null;
  } finally {
    if (!disposed && version === navigationVersion)
      navigatingReply.value = false;
  }
};

/** 标记用户滚动意图，程序定位及媒体加载导致的滚动不会提前移除返回入口。 */
const markManualScroll = (event: Event): void => {
  if (event.type === 'pointerdown' && event.target !== resultList.value) return;
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
  if (returnPoint.value && !navigatingReply.value) manualScroll = true;
};

/** 用户已手动回到引用行时清除返回入口，同时关闭旧右键菜单。 */
const onHistoryScroll = (): void => {
  textMenu?.closeMenu();
  const point = returnPoint.value;
  if (!point || navigatingReply.value || !manualScroll) return;
  const viewport = resultList.value;
  const row = findHistoryRow(point.sourceId);
  if (!viewport || !row) return;
  const bounds = row.getBoundingClientRect();
  const visible = viewport.getBoundingClientRect();
  if (bounds.bottom > visible.top + 4 && bounds.top < visible.bottom - 4)
    returnPoint.value = null;
};

/** 原文上下文页支持继续读取较新消息，前插时保持当前行的屏幕位置。 */
const loadNewer = async (): Promise<void> => {
  if (loading.value || navigatingReply.value || offsetBase.value === 0) return;
  const version = generation;
  const previousOffset = offsetBase.value;
  const offset = Math.max(0, previousOffset - 50);
  const viewport = resultList.value;
  const height = viewport?.scrollHeight ?? 0;
  const top = viewport?.scrollTop ?? 0;
  loading.value = true;
  try {
    const page = await props.searchMessages({
      conversationId: props.conversationId,
      keyword: '',
      category: 'all',
      startAt: null,
      endAt: null,
      offset,
    });
    if (disposed || version !== generation) return;
    const existing = new Set(records.value.map((message) => message.id));
    const newer = page
      .slice(0, previousOffset - offset)
      .filter((message) => !existing.has(message.id))
      .map((message) => recalledMessages.get(message.id) ?? message)
      .filter((message) => !message.deletedAt);
    records.value = [...newer, ...records.value];
    offsetBase.value = offset;
    await nextTick();
    if (disposed || version !== generation) return;
    if (viewport) viewport.scrollTop = top + viewport.scrollHeight - height;
  } catch {
    if (!disposed && version === generation)
      navigationError.value = '读取较新历史失败，请重试。';
  } finally {
    if (!disposed && version === generation) loading.value = false;
  }
};

watch([keyword, category, date, () => props.conversationId], scheduleSearch, {
  immediate: true,
  flush: 'sync',
});
/** 撤回立即清除已展示正文；后续查询仍由 SQLite 在分页前筛选。 */
const unsubscribeRecall = historyApi?.onMessageRecalled((message): void => {
  if (disposed || message.conversationId !== props.conversationId) return;
  replyUpdates.value = new Map(replyUpdates.value).set(message.id, message);
  recalledMessages.set(message.id, message);
  if (message.deletedAt) {
    records.value = records.value.filter((record) => record.id !== message.id);
    return;
  }
  records.value = records.value.map((record) =>
    record.id === message.id ? message : record,
  );
});

onBeforeUnmount(() => {
  unsubscribeRecall?.();
  disposed = true;
  generation++;
  navigationVersion++;
  clearTimeout(timer);
});
</script>

<style>
.chat-history-window {
  position: relative;
  isolation: isolate;
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100dvh;
  padding: 0;
  border: 1px solid #dedee1;
  border-radius: 8px;
  overflow: hidden;
  background: #fafafa;
}
.history-navigation-error {
  flex-shrink: 0;
  padding: 4px 16px;
  color: #a54a41;
  font-size: 12px;
}
.history-titlebar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  min-height: 38px;
  margin: 0;
  padding-left: 88px;
  -webkit-app-region: drag;
}
.history-titlebar h1 {
  flex: 1;
  min-width: 0;
  text-align: center;
  margin: 0;
  font-size: 13px;
  line-height: 20px;
  font-weight: 400;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.history-titlebar .icon-button {
  width: 44px;
  height: 38px;
}
.history-titlebar .window-actions {
  flex-shrink: 0;
}
.history-window-error {
  position: fixed;
  top: 38px;
  inset-inline: 0;
  padding: 8px 16px;
  color: #a33c32;
  background: #fff0ed;
  font-size: 12px;
}
.history-search {
  padding: 10px 24px 8px;
}
.history-search .el-input {
  height: 44px;
}
.history-search .el-input__wrapper {
  padding-inline: 12px;
  background: transparent;
  box-shadow: 0 0 0 1px #e2e2e5 inset;
}
.history-search .el-input__inner {
  font-size: 15px;
}
.history-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 20px;
  padding: 0 26px 8px;
  border-bottom: 1px solid #eeeef0;
}
.history-filters button {
  position: relative;
  height: 32px;
  padding: 0;
  border: 0;
  color: #294984;
  background: transparent;
  font: inherit;
  font-size: 15px;
  cursor: pointer;
}
.history-filters button.is-active::after {
  content: '';
  position: absolute;
  bottom: 0;
  inset-inline: 0;
  height: 2px;
  background: #12aa76;
}
.history-filters button:focus-visible {
  outline: 2px solid #12aa76;
  outline-offset: 2px;
}
.history-date {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.history-date input {
  min-width: 0;
  padding: 8px;
  border: 1px solid #ddd;
  border-radius: 4px;
  color: #555;
}
.history-selection {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 24px;
  color: #909097;
  font-size: 12px;
}
.history-results {
  flex: 1;
  min-height: 0;
  overflow: auto;
  user-select: text;
}
.history-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 12px;
  color: #a0a0a8;
  font-size: 13px;
}
.history-record {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 16px 24px;
  border-bottom: 1px solid #eeeef0;
}
.history-record > .history-contact-avatar {
  width: 34px;
  height: 34px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  background: transparent;
}
.history-system-message {
  width: 100%;
  min-width: 0;
  color: #777;
  text-align: center;
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.history-system-message p {
  margin: 6px 0 0;
  white-space: pre-wrap;
}
.history-contact-avatar > img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.history-record-body {
  flex: 1;
  min-width: 0;
}
.history-record-body header {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 12px;
  color: #94949b;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.history-record-body time {
  font-size: 11px;
}
.history-record-body p {
  margin: 6px 0 0;
  color: #333;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.history-record-type {
  display: inline-block;
  margin-top: 6px;
  color: #758594;
  font-size: 11px;
}
.history-pagination {
  padding: 16px;
  text-align: center;
  color: #aaa;
  font-size: 12px;
}
@media (max-width: 560px) {
  .history-search {
    padding-inline: 16px;
  }
  .history-filters {
    padding-inline: 16px;
    gap: 4px 16px;
  }
  .history-record {
    padding-inline: 16px;
  }
}
</style>
