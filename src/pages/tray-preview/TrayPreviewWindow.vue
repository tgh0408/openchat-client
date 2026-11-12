<template>
  <section
    class="tray-preview"
    aria-label="未读会话"
    @keydown.esc="hidePreview"
  >
    <div class="tray-preview-list">
      <button
        v-for="item in conversations"
        :key="item.id"
        type="button"
        class="tray-preview-row"
        :disabled="opening"
        :title="item.title"
        @click="openConversation(item.id)"
      >
        <span class="tray-preview-avatar">
          <GroupAvatar
            v-if="item.type === 1 && item.group"
            :group="item.group"
          />
          <AvatarImage v-else :src="item.avatar" />
          <span
            class="tray-preview-badge"
            :aria-label="`${item.unreadCount} 条未读消息`"
            >{{ item.unreadCount > 99 ? '99+' : item.unreadCount }}</span
          >
        </span>
        <span class="tray-preview-name">{{ item.title }}</span>
      </button>
      <p v-if="!conversations.length" class="tray-preview-empty">
        暂无未读消息
      </p>
    </div>
    <footer class="tray-preview-footer">
      <span v-if="error" class="tray-preview-error" role="alert">{{
        error
      }}</span>
      <button type="button" :disabled="opening" @click="ignoreMessages">
        暂不处理
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import AvatarImage from '../../components/avatar/AvatarImage.vue';
import GroupAvatar from '../../components/avatar/GroupAvatar.vue';
import type { TrayConversation } from '../../../shared/windows/tray-preview';

const api = window.trayPreviewDesktop;
const conversations = shallowRef<TrayConversation[]>([]);
const opening = ref(false);
const error = ref('');
let disposed = false;
let revision = 0;
let unsubscribe: (() => void) | undefined;

/** 点击后由主进程恢复主窗口并定位到绑定会话。 */
const openConversation = async (id: string): Promise<void> => {
  if (!api || opening.value) return;
  opening.value = true;
  error.value = '';
  try {
    await api.open(id);
  } catch {
    error.value = '打开失败，请重试';
  } finally {
    opening.value = false;
  }
};
/** 忽略当前提醒但保留真实未读计数。 */
const ignoreMessages = async (): Promise<void> => {
  try {
    await api?.ignore();
  } catch {
    error.value = '操作失败，请重试';
  }
};
/** Escape 收起预览，不改变提醒状态。 */
const hidePreview = (): void => {
  void api?.hide().catch(() => {});
};

onMounted(async (): Promise<void> => {
  if (!api) return;
  unsubscribe = api.onChanged((items) => {
    revision++;
    conversations.value = items;
    error.value = '';
  });
  const currentRevision = revision;
  try {
    const items = await api.read();
    if (disposed) return;
    if (revision === currentRevision) conversations.value = items;
    await nextTick();
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (!disposed) void api.ready().catch(() => {});
      }),
    );
  } catch {
    error.value = '读取失败，请重新打开';
  }
});
onBeforeUnmount(() => {
  disposed = true;
  unsubscribe?.();
});
</script>

<style>
.tray-preview {
  box-sizing: border-box;
  width: 100vw;
  height: 100dvh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #ededed;
  border: 1px solid #d4d4d4;
  border-radius: 8px;
  user-select: none;
}
.tray-preview-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 5px 0;
  scrollbar-width: thin;
  scrollbar-color: #b3b3b3 transparent;
}
.tray-preview-row {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  height: 58px;
  padding: 7px 16px 7px 13px;
  border: 0;
  background: transparent;
  color: #202020;
  text-align: left;
  cursor: pointer;
}
.tray-preview-row:hover,
.tray-preview-row:focus-visible {
  background: #dedede;
  outline: none;
}
.tray-preview-avatar {
  position: relative;
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
}
.tray-preview-avatar > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
.tray-preview-badge {
  position: absolute;
  right: -9px;
  top: -7px;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: #fa5151;
  color: white;
  font-size: 11px;
  line-height: 17px;
  text-align: center;
}
.tray-preview-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 22px;
}
.tray-preview-footer {
  box-sizing: border-box;
  flex: 0 0 44px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 0 16px;
  border-top: 1px solid #e1e1e1;
}
.tray-preview-footer button {
  border: 0;
  padding: 5px 0 5px 10px;
  background: transparent;
  color: #576b95;
  cursor: pointer;
  white-space: nowrap;
  font-size: 13px;
}
.tray-preview-footer button:hover {
  color: #334b7b;
}
.tray-preview-error {
  font-size: 12px;
  color: #c53e3e;
}
.tray-preview-empty {
  padding: 15px;
  color: #888;
  font-size: 13px;
}
</style>
