<template>
  <div
    class="reply-message"
    tabindex="0"
    @contextmenu.capture.prevent.stop="showLocationMenu"
    @keydown.capture="onMenuKeydown"
  >
    <MessageQuote
      v-if="target && !unavailable"
      :key="`${target.conversationId}:${target.id}`"
      :message="target"
      :sender="sender"
      :disabled="disabled"
      compact
    />
    <div v-else class="reply-message-status" role="status">
      <span>{{ status }}</span>
      <button
        v-if="!loading && !unavailable"
        type="button"
        title="重新读取引用消息"
        aria-label="重新读取引用消息"
        @click="load"
      >
        <RefreshRight />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Position, RefreshRight } from '@element-plus/icons-vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import type { Contact, Message } from '../../../../shared/storage/database';
import {
  resolveMessageName,
  shouldKeepRecalledMessage,
} from '../../../../shared/chat/messages/recall-message';
import MessageQuote from './MessageQuote.vue';

const props = defineProps<{
  message: Message;
  userId: string;
  contacts: Record<string, Contact>;
  cachedTarget?: Message;
  updatedMessage?: Message | null;
  disabled?: boolean;
  locating?: boolean;
}>();
const emit = defineEmits<{
  contactNeeded: [message: Message];
  locate: [message: Message];
}>();
const target = ref<Message | null>(null);
const loading = ref(false);
const error = ref('');
let generation = 0;
let menu: ContextMenuInstance | undefined;
let disposed = false;

/** 引用区域只保留定位菜单，滚动、失焦和虚拟行复用后清除旧目标。 */
const closeLocationMenu = (): void => {
  menu?.closeMenu();
  menu = undefined;
};

/** 捕获媒体子组件的右键事件，不开放原消息的复制、撤回或附件菜单。 */
const showLocationMenu = (event: MouseEvent): void => {
  closeLocationMenu();
  const source = props.message;
  menu = ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    items: [
      {
        label: '定位到原文位置',
        icon: h(Position, { style: { width: '16px', height: '16px' } }),
        disabled: props.disabled || props.locating || !source.replyId,
        onClick: (): void => {
          if (
            !disposed &&
            !props.disabled &&
            !props.locating &&
            source.id === props.message.id &&
            source.replyId === props.message.replyId &&
            source.conversationId === props.message.conversationId
          )
            emit('locate', source);
          closeLocationMenu();
        },
      },
    ],
  });
};

/** 键盘菜单键与 Shift+F10 同样使用引用菜单，不进入媒体自身菜单。 */
const onMenuKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    return;
  event.preventDefault();
  event.stopPropagation();
  const element = event.currentTarget;
  if (!(element instanceof HTMLElement)) return;
  const bounds = element.getBoundingClientRect();
  showLocationMenu(
    new MouseEvent('contextmenu', {
      clientX: bounds.left,
      clientY: bounds.bottom,
    }),
  );
};
const unavailable = computed((): string => {
  if (target.value?.deletedAt) return '引用消息已移除';
  if (target.value?.messageType === 'recalled') return '引用消息已撤回';
  if (
    target.value &&
    !['text', 'image', 'emoji', 'video', 'file', 'audio'].includes(
      target.value.messageType,
    )
  )
    return '引用消息暂不支持展示';
  return '';
});
const status = computed((): string => {
  if (loading.value) return '正在读取引用消息...';
  return unavailable.value || error.value || '引用消息不存在';
});
const sender = computed((): string => {
  const message = target.value;
  if (!message) return '';
  if (message.senderId === props.userId) return '我';
  return resolveMessageName(
    message.senderId,
    message.conversationId,
    props.contacts[message.senderId],
  );
});

/** 只接受当前引用且属于同一会话的原消息，不递归展示原消息的引用。 */
const matchesTarget = (message: Message | null | undefined): boolean =>
  Boolean(
    message &&
    message.id === props.message.replyId &&
    message.conversationId === props.message.conversationId,
  );

/** 应用本地消息快照，撤回时立即卸载媒体并停止播放。 */
const applyTarget = (message: Message): void => {
  const update = props.updatedMessage;
  if (
    update &&
    matchesTarget(update) &&
    (update.deletedAt || shouldKeepRecalledMessage(update, message))
  ) {
    target.value = update;
    return;
  }
  if (shouldKeepRecalledMessage(target.value ?? undefined, message)) return;
  if (target.value?.deletedAt && !message.deletedAt) return;
  target.value = message;
  if (!message.deletedAt && message.messageType !== 'recalled')
    emit('contactNeeded', message);
};

/** 精确读取已保存的引用关系，切换消息或收到更新后丢弃迟到结果。 */
const load = async (): Promise<void> => {
  const current = ++generation;
  target.value = null;
  error.value = '';
  loading.value = true;
  try {
    const api = window.historyDesktop ?? window.desktop;
    const message = api
      ? await api.readMessageReply(
          props.message.conversationId,
          props.message.id,
        )
      : props.cachedTarget;
    if (current !== generation) return;
    if (message && matchesTarget(message)) applyTarget(message);
  } catch (cause) {
    if (current === generation)
      error.value = cause instanceof Error ? cause.message : '读取引用消息失败';
  } finally {
    if (current === generation) loading.value = false;
  }
};

/** 已落库更新优先于在途读取，缺失的原消息补入缓存后可立即展示。 */
const updateTarget = (message: Message | null | undefined): void => {
  if (!message || !matchesTarget(message)) return;
  generation++;
  loading.value = false;
  error.value = '';
  applyTarget(message);
};

watch(
  () => [props.message.conversationId, props.message.id, props.message.replyId],
  load,
  { immediate: true },
);
watch(() => props.updatedMessage, updateTarget);
watch(() => props.cachedTarget, updateTarget);
watch(() => [props.message, props.disabled, props.locating], closeLocationMenu);
onMounted((): void => {
  window.addEventListener('scroll', closeLocationMenu, true);
  if (!window.contextMenuHost)
    window.addEventListener('blur', closeLocationMenu);
});
onBeforeUnmount((): void => {
  disposed = true;
  generation++;
  closeLocationMenu();
  window.removeEventListener('scroll', closeLocationMenu, true);
  window.removeEventListener('blur', closeLocationMenu);
});
</script>

<style scoped>
.reply-message {
  max-width: 100%;
  min-width: 0;
}
.reply-message-status {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 24px;
  margin-top: 2px;
  padding-left: 8px;
  border-left: 2px solid #dedee2;
  color: #92929b;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
.reply-message-status button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 4px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.reply-message-status button:hover,
.reply-message-status button:focus-visible {
  background: #e8e8eb;
  color: #45454c;
}
.reply-message-status svg {
  width: 14px;
  height: 14px;
}
</style>
