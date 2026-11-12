<template>
  <header class="chat-titlebar" @dblclick="maximizeWindow">
    <div class="chat-window-heading">
      <span class="chat-brand">OpenChat</span>
      <span
        class="chat-connection"
        :class="{ 'chat-connection--offline': offlineMode }"
        :title="connectionHint"
        role="status"
        aria-label="连接状态"
        ><span class="chat-connection-dot" aria-hidden="true"></span
        >{{ connectionLabel }}</span
      >
    </div>
    <div class="window-actions" @dblclick.stop>
      <button
        v-if="isDesktop"
        class="icon-button"
        :class="{ 'is-active': pinned }"
        :title="pinned ? '取消置顶' : '置顶'"
        :aria-label="pinned ? '取消置顶' : '置顶'"
        :aria-pressed="pinned"
        @click="pinWindow"
      >
        <el-icon><PinIcon /></el-icon>
      </button>
      <button
        v-if="isDesktop"
        class="icon-button"
        title="最小化"
        aria-label="最小化"
        @click="minimizeWindow"
      >
        <el-icon><Minus /></el-icon>
      </button>
      <button
        v-if="isDesktop"
        class="icon-button"
        title="最大化 / 还原"
        aria-label="最大化或还原"
        @click="maximizeWindow"
      >
        <el-icon><FullScreen /></el-icon>
      </button>
      <button
        class="icon-button close-button"
        title="关闭"
        aria-label="关闭"
        @click="closeWindow"
      >
        <el-icon><Close /></el-icon>
      </button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { Close, FullScreen, Minus } from '@element-plus/icons-vue';
import PinIcon from '../../../components/icons/PinIcon.vue';

defineProps<{
  isDesktop: boolean;
  pinned: boolean;
  offlineMode: boolean;
  connectionLabel: string;
  connectionHint: string;
}>();
type TitleBarEmits = {
  (event: 'control', action: 'minimize' | 'maximize' | 'pin'): void;
  (event: 'close'): void;
};

const emit: TitleBarEmits = defineEmits<TitleBarEmits>();

/** 请求切换窗口置顶状态。 */
const pinWindow = (): void => {
  emit('control', 'pin');
};

/** 请求最小化窗口。 */
const minimizeWindow = (): void => {
  emit('control', 'minimize');
};

/** 请求最大化或还原窗口。 */
const maximizeWindow = (): void => {
  emit('control', 'maximize');
};

/** 请求关闭窗口。 */
const closeWindow = (): void => {
  emit('close');
};
</script>

<style>
.chat-titlebar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  -webkit-app-region: drag;
}
.chat-brand {
  padding-left: 14px;
  color: #777780;
  font-size: 11px;
}
.chat-window-heading {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}
.chat-connection {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  color: #63636a;
  font-size: 11px;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.chat-connection-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: #85858a;
}
.chat-connection--offline .chat-connection-dot {
  background: #a97628;
}
.chat-titlebar .icon-button {
  width: 44px;
  height: 30px;
  font-size: 13px;
}
.chat-titlebar .is-active {
  color: #00a962;
}
</style>
