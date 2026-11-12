<template>
  <div class="message-emoji" @dragstart.prevent @contextmenu="showEmojiMenu">
    <el-image
      v-if="emoji?.url"
      :key="`${emoji.url}:${attempt}`"
      :src="emoji.url"
      alt="表情包"
      fit="contain"
      loading="lazy"
      draggable="false"
    >
      <template #placeholder>
        <span class="message-emoji-status" role="status">加载中...</span>
      </template>
      <template #error>
        <div class="message-emoji-status">
          <span>加载失败</span>
          <button
            type="button"
            title="重新加载表情包"
            aria-label="重新加载表情包"
            @click.stop="reload"
          >
            <el-icon :size="18"><Refresh /></el-icon>
          </button>
        </div>
      </template>
    </el-image>
    <span v-else class="message-emoji-status" role="status">表情包不可用</span>
    <EmojiCollectionFeedback
      :text="emojiFeedback"
      :pending="addingEmoji"
      :failed="emojiFailed"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElIcon, ElImage } from 'element-plus';
import { Refresh, RefreshLeft, Star } from '@element-plus/icons-vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import type { MenuItem } from '@imengyu/vue3-context-menu';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/image/style/css';
import { parseEmojiContent } from '../../../../shared/chat/emoji';
import type { StoredEmojiContent } from '../../../../shared/chat/emoji';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';
import { useEmojiCollection } from '../composer/useEmojiCollection';
import EmojiCollectionFeedback from '../feedback/EmojiCollectionFeedback.vue';
import { replyMenuItem } from './reply-menu';
import { useMessageDeletionMenu } from './message-delete-menu';
const deletionMenu = useMessageDeletionMenu();

const props = defineProps<{
  content: string;
  conversationId?: string;
  messageId?: string;
  canAddEmoji?: boolean;
  canRecall?: boolean;
  showReply?: boolean;
  recalling?: boolean;
}>();
const emit = defineEmits<{ recall: []; reply: [] }>();
/** 历史只读展示没有标识或收藏权限，不开放写入菜单。 */
const getTarget = (): ImagePreviewRequest | null =>
  props.canAddEmoji && props.conversationId && props.messageId
    ? { conversationId: props.conversationId, messageId: props.messageId }
    : null;
const {
  addingEmoji,
  emojiFeedback,
  emojiFailed,
  finishEmojiFeedback,
  addEmoji,
} = useEmojiCollection(getTarget);
let menu: ContextMenuInstance | undefined;
let menuVersion = 0;
let disposed = false;
const attempt = ref(0);
const emoji = computed((): StoredEmojiContent | null =>
  parseEmojiContent(props.content),
);

/** 重建失败的图片请求，不改动原始地址和消息发送状态。 */
const reload = (): void => {
  attempt.value++;
};

/** 取消旧菜单及等待中的本地缓存查询。 */
const closeEmojiMenu = (): void => {
  menuVersion++;
  menu?.closeMenu();
  menu = undefined;
};

/** 等待缓存时发生其他交互，不再弹出迟到菜单。 */
const cancelPendingMenu = (): void => {
  if (!menu) menuVersion++;
};

/** 表情按缓存中的 ID 判断收藏，保留适用的引用入口和撤回操作。 */
const showEmojiMenu = async (event: MouseEvent): Promise<void> => {
  const request = getTarget();
  const deleteItems =
    props.conversationId && props.messageId
      ? deletionMenu({
          conversationId: props.conversationId,
          messageId: props.messageId,
        })
      : [];
  if (
    (!request && !props.canRecall && !props.showReply && !deleteItems.length) ||
    window.historyDesktop
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  closeEmojiMenu();
  const version = menuVersion;
  const items: MenuItem[] = [];
  if (props.showReply)
    items.push(
      replyMenuItem(() => {
        if (!disposed && version === menuVersion && props.showReply)
          emit('reply');
      }),
    );
  if (props.canRecall)
    items.push({
      label: '撤回消息',
      icon: h(RefreshLeft, { style: { width: '16px', height: '16px' } }),
      disabled: props.recalling,
      onClick: (): void => {
        if (!disposed && props.canRecall && !props.recalling) emit('recall');
      },
    });
  if (request && window.desktop && !addingEmoji.value) {
    try {
      if (typeof window.desktop.isImageEmojiCollected !== 'function')
        throw new Error('请重启程序以加载表情收藏状态接口');
      const collected = await window.desktop.isImageEmojiCollected(request);
      if (disposed || version !== menuVersion) return;
      if (!collected)
        items.push({
          label: '添加到表情',
          icon: h(Star, { style: { width: '16px', height: '16px' } }),
          onClick: (): void => {
            void addEmoji(request);
          },
        });
    } catch (error) {
      if (disposed || version !== menuVersion) return;
      finishEmojiFeedback(
        error instanceof Error ? error.message : '读取表情缓存失败',
        true,
      );
    }
  }
  items.push(...deleteItems);
  if (!items.length || disposed || version !== menuVersion) return;
  const currentMenu = ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    items,
    onClose: (): void => {
      if (menu === currentMenu) menu = undefined;
    },
  });
  menu = currentMenu;
};

watch(
  () => [
    props.conversationId,
    props.messageId,
    props.content,
    props.canAddEmoji,
    props.canRecall,
    props.showReply,
  ],
  closeEmojiMenu,
  { flush: 'sync' },
);
onMounted(() => {
  if (!window.contextMenuHost) window.addEventListener('blur', closeEmojiMenu);
  window.addEventListener('pointerdown', cancelPendingMenu);
  window.addEventListener('keydown', cancelPendingMenu);
});
onBeforeUnmount(() => {
  disposed = true;
  closeEmojiMenu();
  window.removeEventListener('blur', closeEmojiMenu);
  window.removeEventListener('pointerdown', cancelPendingMenu);
  window.removeEventListener('keydown', cancelPendingMenu);
});
</script>

<style scoped>
.message-emoji {
  width: 144px;
  max-width: 100%;
  min-width: 0;
  aspect-ratio: 1;
}
.message-emoji .el-image {
  display: block;
  width: 100%;
  height: 100%;
}
.message-emoji-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  color: #757575;
  font-size: 12px;
}
.message-emoji-status button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #dcdcdc;
  border-radius: 4px;
  background: #fff;
  color: #666;
  cursor: pointer;
}
</style>
