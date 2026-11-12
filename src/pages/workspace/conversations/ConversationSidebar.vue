<template>
  <aside class="chat-sidebar" aria-label="会话列表">
    <div class="chat-search">
      <el-input
        v-model="search"
        placeholder="搜索"
        :prefix-icon="Search"
        clearable
        aria-label="搜索会话"
      />
      <el-dropdown
        class="chat-actions-dropdown"
        trigger="click"
        placement="bottom"
        popper-class="chat-actions-popper"
        :show-arrow="false"
        :offset="5"
        :disabled="readOnly || busy || initializationFailed"
      >
        <button
          type="button"
          class="chat-small-button"
          title="更多操作"
          aria-label="更多操作"
          :disabled="readOnly || busy || initializationFailed"
        >
          <el-icon :size="21"><CirclePlus /></el-icon>
        </button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item @click="emit('createGroup')">
              <el-icon :size="22"><ChatRound /></el-icon>
              <span>发起群聊</span>
            </el-dropdown-item>
            <el-dropdown-item @click="emit('addFriend')">
              <el-icon :size="22"><User /></el-icon>
              <span>添加朋友</span>
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>
    <p v-if="section === 'directory'" class="chat-list-label">本地会话</p>
    <div
      ref="viewport"
      class="chat-conversations"
      @keydown="navigateConversations"
    >
      <FixedSizeList
        v-if="viewportHeight > 0"
        ref="virtualList"
        :height="viewportHeight"
        width="100%"
        :total="displayedConversations.length"
        :item-size="CONVERSATION_ROW_HEIGHT"
        :init-scroll-offset="scrollOffset"
        :cache="5"
        @scroll="handleListScroll"
      >
        <template #default="{ index, style }">
          <ConversationRow
            :key="displayedConversations[index]!.id"
            :style="style"
            :conversation="displayedConversations[index]!"
            :preview="previews[displayedConversations[index]!.id]"
            :contact="previewContact(displayedConversations[index]!.id)"
            :group="groupsByRoom[displayedConversations[index]!.id]"
            :selected="activeId === displayedConversations[index]!.id"
            :user-id="userId"
            :user-nickname="userNickname"
            :format-time="formatTime"
            @click="selectAfterPointer($event, displayedConversations[index]!)"
            @pointerdown="
              startConversationDrag($event, displayedConversations[index]!)
            "
            @pointermove="moveConversationDrag"
            @pointerup="releaseConversationDrag"
            @pointercancel="finishConversationDrag"
            @lostpointercapture="finishConversationDrag"
            @dragstart.prevent
            @contextmenu.prevent.stop="
              showConversationMenu($event, displayedConversations[index]!)
            "
          />
        </template>
      </FixedSizeList>
    </div>
    <p v-if="busy" class="chat-list-label" role="status">正在读取...</p>
    <p v-else-if="!filteredConversations.length" class="chat-list-label">
      没有匹配的会话
    </p>
  </aside>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import {
  ElDropdown,
  ElDropdownItem,
  ElDropdownMenu,
  ElIcon,
  ElInput,
  FixedSizeList,
} from 'element-plus';
import 'element-plus/es/components/dropdown/style/css';
import 'element-plus/es/components/dropdown-item/style/css';
import 'element-plus/es/components/dropdown-menu/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/virtual-list/style/css';
import { ChatRound, CirclePlus, Search, User } from '@element-plus/icons-vue';
import type {
  Contact,
  Conversation,
} from '../../../../shared/storage/database';
import { FILE_ASSISTANT_TYPE } from '../../../../shared/chat/chat';
import type { GroupDirectoryItem } from '../../../../shared/contacts/group';
import {
  messagePreviewUid,
  type MessagePreview,
} from '../../../services/chat/messages/message-preview';
import {
  CONVERSATION_ROW_HEIGHT,
  conversationScrollOffset,
} from '../../../services/chat/conversations/conversation-viewport';
import ConversationRow from './ConversationRow.vue';

const props = defineProps<{
  section: 'chats' | 'directory';
  conversations: Conversation[];
  groups: GroupDirectoryItem[];
  previews: Record<string, MessagePreview>;
  contacts: Record<string, Contact>;
  userId: string;
  userNickname: string;
  activeId: string;
  busy: boolean;
  initializationFailed: boolean;
  readOnly: boolean;
  notDisturbBusy: boolean;
  formatTime: (value: string) => string;
}>();
const emit = defineEmits<{
  (event: 'createGroup'): void;
  (event: 'addFriend'): void;
  (event: 'select', conversation: Conversation): void;
  (event: 'toggleTop', conversation: Conversation, status: 0 | 1): void;
  (event: 'toggleNotDisturb', conversation: Conversation, status: 0 | 1): void;
  (event: 'openWindow', conversation: Conversation, outside: boolean): void;
  (event: 'deleteConversation', conversation: Conversation): void;
  (event: 'hideConversation', conversation: Conversation): void;
}>();
const search = defineModel<string>('search', { required: true });
const viewport = ref<HTMLElement>();
const viewportHeight = ref(0);
const virtualList = ref<{
  scrollTo: (offset: number) => void;
  scrollToItem: (index: number, alignment?: 'auto') => void;
}>();
const dragConversations = shallowRef<Conversation[]>();
let viewportObserver: ResizeObserver | undefined;
let scrollOffset = 0;
let conversationMenu: ContextMenuInstance | undefined;
const draggingId = ref('');
let dragPreview: HTMLElement | undefined;
let pointer:
  | {
      source: HTMLElement;
      pointerId: number;
      x: number;
      y: number;
      offsetX: number;
      offsetY: number;
      conversation: Conversation;
      id: string;
      started: boolean;
    }
  | undefined;
let suppressClick = false;

/** Escape 只取消拖拽，不能误打开独立窗口。 */
const cancelDragOnEscape = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') finishConversationDrag();
};

/** 拖动松手产生的 click 不切换会话，普通点击继续沿用原选择行为。 */
const selectAfterPointer = (
  event: MouseEvent,
  conversation: Conversation,
): void => {
  if (!suppressClick || event.detail === 0) emit('select', conversation);
};

/** 松手后请求主进程核对屏幕坐标；窗口内松手保持原列表。 */
const releaseConversationDrag = (event: PointerEvent): void => {
  const state = pointer;
  if (!state || event.pointerId !== state.pointerId) return;
  const shouldOpen =
    state.started &&
    (event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight);
  finishConversationDrag();
  if (shouldOpen && !props.readOnly)
    emit('openWindow', state.conversation, true);
};

/** 拖动结束或列表失效时释放临时卡片，保留原会话及选中状态。 */
const finishConversationDrag = (): void => {
  const state = pointer;
  pointer = undefined;
  if (state?.source.hasPointerCapture(state.pointerId))
    state.source.releasePointerCapture(state.pointerId);
  state?.source.classList.remove('is-pointer-dragging');
  if (state?.started)
    void window.desktop?.closeConversationDrag(state.id).catch(() => {});
  document.body.classList.remove('conversation-pointer-dragging');
  dragPreview?.remove();
  dragPreview = undefined;
  draggingId.value = '';
  dragConversations.value = undefined;
  window.removeEventListener('keydown', cancelDragOnEscape, true);
  window.removeEventListener('blur', finishConversationDrag);
};

/** 离开列表或切换上下文时关闭菜单，不保留旧会话的入口。 */
const closeConversationMenu = (): void => {
  conversationMenu?.closeMenu();
  conversationMenu = undefined;
};

/** 捕获鼠标指针，移出窗口后仍接收移动和释放，不进入系统原生拖放。 */
const startConversationDrag = (
  event: PointerEvent,
  conversation: Conversation,
): void => {
  const source = event.currentTarget;
  suppressClick = false;
  if (
    props.readOnly ||
    props.busy ||
    props.initializationFailed ||
    !(source instanceof HTMLElement) ||
    conversation.type === null ||
    event.button !== 0 ||
    !event.isPrimary ||
    event.pointerType !== 'mouse'
  ) {
    return;
  }
  finishConversationDrag();
  dragConversations.value = [...filteredConversations.value];
  const bounds = source.getBoundingClientRect();
  pointer = {
    source,
    pointerId: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    offsetX: event.clientX - bounds.left,
    offsetY: event.clientY - bounds.top,
    conversation,
    id: crypto.randomUUID(),
    started: false,
  };
  source.setPointerCapture(event.pointerId);
  window.addEventListener('keydown', cancelDragOnEscape, true);
  window.addEventListener('blur', finishConversationDrag);
};

/** 越过鼠标移动阈值才显示预览，保留点击与会话原色。 */
const moveConversationDrag = (event: PointerEvent): void => {
  const state = pointer;
  if (!state || event.pointerId !== state.pointerId) return;
  if ((event.buttons & 1) === 0) {
    finishConversationDrag();
    return;
  }
  if (
    !state.started &&
    Math.hypot(event.clientX - state.x, event.clientY - state.y) < 6
  )
    return;
  event.preventDefault();
  if (!state.started) {
    state.started = true;
    suppressClick = true;
    draggingId.value = state.conversation.id;
    closeConversationMenu();
    state.source.classList.add('is-pointer-dragging');
    document.body.classList.add('conversation-pointer-dragging');
    const bounds = state.source.getBoundingClientRect();
    if (window.desktop) {
      void window.desktop.beginConversationDrag().catch(() => {
        if (pointer === state) finishConversationDrag();
      });
      void window.desktop
        .showConversationDrag({
          id: state.id,
          roomId: state.conversation.id,
          x: bounds.left,
          y: bounds.top,
          width: bounds.width,
          height: bounds.height,
          offsetX: state.offsetX,
          offsetY: state.offsetY,
        })
        .catch(() => {
          if (pointer === state) finishConversationDrag();
        });
    } else {
      const preview = state.source.cloneNode(true);
      if (preview instanceof HTMLElement) {
        preview.classList.add('chat-conversation-drag-preview');
        preview.setAttribute('aria-hidden', 'true');
        preview.tabIndex = -1;
        preview.style.width = `${bounds.width}px`;
        preview.style.height = `${bounds.height}px`;
        document.body.append(preview);
        dragPreview = preview;
      }
    }
  }
  if (dragPreview) {
    dragPreview.style.left = `${event.clientX - state.offsetX}px`;
    dragPreview.style.top = `${event.clientY - state.offsetY}px`;
  }
};

/** 展示会话右键菜单，并将置顶操作交给工作区请求服务端。 */
const showConversationMenu = (
  event: MouseEvent,
  conversation: Conversation,
): void => {
  closeConversationMenu();
  conversationMenu = ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 160,
    preserveIconWidth: false,
    onClose: (): void => {
      conversationMenu = undefined;
    },
    items: [
      {
        label: conversation.isTop === 1 ? '取消置顶' : '置顶',
        onClick: (): void => {
          const nextStatus: 0 | 1 = conversation.isTop === 1 ? 0 : 1;
          closeConversationMenu();
          emit('toggleTop', conversation, nextStatus);
        },
      },
      { label: '标为未读' },
      {
        label: conversation.notDisturb === 1 ? '取消消息免打扰' : '消息免打扰',
        divided: 'down',
        disabled:
          props.readOnly ||
          props.busy ||
          props.initializationFailed ||
          props.notDisturbBusy ||
          conversation.type === null,
        onClick: (): void => {
          closeConversationMenu();
          emit(
            'toggleNotDisturb',
            conversation,
            conversation.notDisturb === 1 ? 0 : 1,
          );
        },
      },
      {
        label: '独立窗口显示',
        disabled: props.readOnly || conversation.type === null,
        onClick: (): void => {
          closeConversationMenu();
          emit('openWindow', conversation, false);
        },
      },
      {
        label: '不显示',
        divided: 'down',
        onClick: (): void => {
          closeConversationMenu();
          emit('hideConversation', conversation);
        },
      },
      {
        label: '删除',
        customClass: 'chat-context-menu-danger',
        onClick: (): void => {
          closeConversationMenu();
          emit('deleteConversation', conversation);
        },
      },
    ],
  });
};

watch(
  () => [props.activeId, props.readOnly, props.section, search.value],
  closeConversationMenu,
);
onBeforeUnmount(closeConversationMenu);
watch(
  () => [
    props.readOnly,
    props.busy,
    props.initializationFailed,
    props.section,
    search.value,
  ],
  finishConversationDrag,
);
watch(
  () =>
    !draggingId.value ||
    props.conversations.some((item) => item.id === draggingId.value),
  (exists: boolean): void => {
    if (!exists) finishConversationDrag();
  },
);
onBeforeUnmount(finishConversationDrag);

/** 按真实房间号关联通讯录群资料，让会话与通讯录共用成员头像。 */
const groupsByRoom = computed((): Record<string, GroupDirectoryItem> =>
  Object.fromEntries(props.groups.map((group) => [group.roomId, group])),
);

/** 根据会话类型显示名称，不依赖特殊房间号。 */
const conversationName = (conversation: Conversation): string =>
  conversation.type === FILE_ASSISTANT_TYPE
    ? '文件传输助手'
    : conversation.title;

/** 沿用工作区维护的会话顺序，仅在搜索时过滤，不重复排序。 */
const filteredConversations = computed((): Conversation[] => {
  const query = search.value.trim().toLocaleLowerCase();
  if (!query) return props.conversations;
  return props.conversations.filter((item) =>
    conversationName(item).toLocaleLowerCase().includes(query),
  );
});

/** 指针捕获期间固定行顺序，避免新消息重排使拖动源被虚拟列表回收。 */
const displayedConversations = computed(
  (): Conversation[] => dragConversations.value ?? filteredConversations.value,
);

/** 只向可见行传递本次摘要涉及的联系人。 */
const previewContact = (id: string): Contact | undefined => {
  const uid = messagePreviewUid(props.previews[id]);
  return uid ? props.contacts[uid] : undefined;
};

/** 虚拟滚动复用原菜单关闭行为，滚动时取消尚未结束的指针拖动。 */
const handleListScroll = (_direction: string, offset: number): void => {
  const moved = scrollOffset !== offset;
  scrollOffset = offset;
  closeConversationMenu();
  if (moved && pointer) finishConversationDrag();
};

/** 按侧栏实际高度调整可见区域，窄屏隐藏后重新显示也会重新测量。 */
const measureViewport = (): void => {
  viewportHeight.value = viewport.value?.clientHeight ?? 0;
  const list = displayedConversations.value;
  const offset = conversationScrollOffset(
    list,
    list,
    scrollOffset,
    viewportHeight.value,
  );
  if (virtualList.value) virtualList.value.scrollTo(offset);
  else scrollOffset = offset;
};

/** 上下方向键及首尾键可访问屏幕外会话，Enter 和空格仍使用原生按钮行为。 */
const navigateConversations = async (event: KeyboardEvent): Promise<void> => {
  const source = event.target;
  if (!(source instanceof HTMLElement) || !source.dataset.conversationId)
    return;
  const list = displayedConversations.value;
  let index = list.findIndex(
    (item) => item.id === source.dataset.conversationId,
  );
  switch (event.key) {
    case 'ArrowDown':
      index++;
      break;
    case 'ArrowUp':
      index--;
      break;
    case 'Home':
      index = 0;
      break;
    case 'End':
      index = list.length - 1;
      break;
    default:
      return;
  }
  event.preventDefault();
  index = Math.max(0, Math.min(index, list.length - 1));
  const id = list[index]?.id;
  if (!id) return;
  virtualList.value?.scrollToItem(index);
  await nextTick();
  viewport.value
    ?.querySelector<HTMLElement>(`[data-conversation-id="${CSS.escape(id)}"]`)
    ?.focus({ preventScroll: true });
};

watch(displayedConversations, (next, previous): void => {
  closeConversationMenu();
  virtualList.value?.scrollTo(
    conversationScrollOffset(
      previous,
      next,
      scrollOffset,
      viewportHeight.value,
    ),
  );
});
watch(search, (): void => {
  scrollOffset = 0;
  virtualList.value?.scrollTo(0);
});
onMounted((): void => {
  measureViewport();
  viewportObserver = new ResizeObserver(measureViewport);
  if (viewport.value) viewportObserver.observe(viewport.value);
});
onBeforeUnmount((): void => viewportObserver?.disconnect());
</script>

<style>
.chat-search {
  display: flex;
  align-items: center;
  gap: 9px;
  height: 62px;
  padding: 12px;
  flex-shrink: 0;
}
.chat-search .el-input {
  min-width: 0;
}
.chat-search .el-input__wrapper {
  background: #f9f9f9;
  box-shadow: none;
  padding: 1px 8px;
}
.chat-search .el-input__inner {
  font-size: 13px;
}
.chat-conversations {
  overflow: hidden;
  min-height: 0;
  flex: 1;
}
.chat-conversations .el-vl__window {
  overflow-anchor: none;
}
.chat-list-label {
  margin: 12px;
  color: #96969d;
  font-size: 12px;
  text-align: center;
}
.chat-conversation {
  display: flex;
  align-items: center;
  width: 100%;
  height: 73px;
  gap: 10px;
  padding: 10px 12px;
  text-align: left;
  border: 0;
  background: transparent;
  color: #202023;
  cursor: pointer;
  user-select: none;
  -webkit-app-region: no-drag;
}
.chat-conversation:hover {
  background: #e2e2e5;
}
.chat-conversation.is-pointer-dragging:not(.is-selected) {
  background: #ededee;
}
body.conversation-pointer-dragging,
body.conversation-pointer-dragging * {
  cursor: grabbing !important;
}
.chat-conversation.is-selected {
  color: #fff;
  background: #12aa76;
}
.chat-conversation.is-selected .chat-conversation-preview,
.chat-conversation.is-selected time {
  color: #e0f5ed;
}
.chat-conversation.is-selected .chat-conversation-copy {
  border-bottom-color: transparent;
}
.chat-conversation:disabled {
  cursor: default;
}
.chat-conversation-drag-preview {
  position: fixed;
  top: 0;
  left: -10000px;
  overflow: hidden;
  border-radius: 8px;
  pointer-events: none;
}
.chat-conversation-avatar {
  position: relative;
  width: 42px;
  height: 42px;
  flex-shrink: 0;
}
.chat-unread-badge {
  position: absolute;
  top: -9px;
  right: -9px;
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  box-sizing: border-box;
  border-radius: 9px;
  background: #fa5151;
  color: #fff;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  white-space: nowrap;
  pointer-events: none;
}
.chat-conversation-copy {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
  height: 100%;
  border-bottom: 1px solid #e5e5e7;
}
.chat-conversation-top {
  display: flex;
  align-items: center;
  gap: 7px;
  min-width: 0;
}
.chat-conversation-name {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
  line-height: 22px;
}
.chat-conversation-top .chat-conversation-name {
  flex: 1;
}
.chat-conversation time {
  flex-shrink: 0;
  font-size: 11px;
  color: #98989e;
}
.chat-conversation-preview {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 12px;
  line-height: 18px;
  color: #99999f;
}
.chat-avatar > .chat-conversation-group-avatar {
  --group-avatar-size: 42px;
}

.chat-actions-dropdown {
  flex-shrink: 0;
}

.chat-actions-popper.el-popper {
  overflow: hidden;
  border: 0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 4px 18px rgb(0 0 0 / 16%);
}

.chat-actions-popper .el-dropdown-menu {
  min-width: 128px;
  padding: 4px 0;
}

.chat-actions-popper .el-dropdown-menu__item {
  height: 40px;
  padding: 0 16px;
  color: #202020;
  font-size: 15px;
  line-height: 20px;
  letter-spacing: 0;
}

.chat-actions-popper .el-dropdown-menu__item .el-icon {
  flex-shrink: 0;
  margin-right: 10px;
}

.chat-actions-popper .el-dropdown-menu__item:not(.is-disabled):hover,
.chat-actions-popper .el-dropdown-menu__item:not(.is-disabled):focus {
  color: #202020;
  background: #f0f0f0;
}
</style>
