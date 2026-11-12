<template>
  <header class="chat-content-heading">
    <button
      class="chat-small-button chat-mobile-back"
      title="返回会话"
      aria-label="返回会话"
      @click="emit('back')"
    >
      <el-icon><ArrowLeft /></el-icon>
    </button>
    <div class="chat-heading-copy">
      <h1 :title="title">{{ title }}</h1>
    </div>
    <button
      class="chat-conversation-menu"
      title="查看聊天记录"
      aria-label="查看聊天记录"
      :disabled="historyDisabled"
      @click="emit('history')"
    >
      <el-icon :size="21"><ChatDotRound /></el-icon>
      <el-icon :size="12"><ArrowDown /></el-icon>
    </button>
    <div v-if="!fileAssistant" class="chat-call-control">
      <button
        ref="callButton"
        type="button"
        class="chat-call-toggle"
        :title="groupCall ? '群通话' : '语音通话'"
        :aria-label="groupCall ? '群通话' : '语音通话'"
        :aria-haspopup="groupCall ? undefined : 'menu'"
        :aria-expanded="groupCall ? undefined : callOpen"
        :disabled="callDisabled"
        @click.stop="openCall"
      >
        <img
          class="chat-call-icon"
          :src="publicAssetUrl('video/VoiceAndVideo.svg')"
          alt=""
        />
      </button>
      <div v-if="callOpen && !groupCall" class="chat-call-menu" role="menu">
        <button
          type="button"
          class="chat-call-menu-item"
          role="menuitem"
          :disabled="callDisabled"
          @click="startAudioCall"
        >
          <img
            class="chat-call-menu-icon"
            :src="publicAssetUrl('video/VoiceCall.svg')"
            alt=""
          />
          <span>语音通话</span>
        </button>
        <button
          type="button"
          class="chat-call-menu-item"
          role="menuitem"
          :disabled="callDisabled"
          @click="startVideoCall"
        >
          <el-icon :size="18"><VideoCamera /></el-icon>
          <span>视频通话</span>
        </button>
      </div>
    </div>
    <button
      v-if="!fileAssistant"
      ref="detailsButton"
      type="button"
      class="chat-details-toggle"
      :class="{ 'is-active': detailsOpen }"
      title="聊天信息"
      aria-label="聊天信息"
      aria-controls="chat-conversation-details"
      :aria-expanded="detailsOpen"
      :disabled="detailsDisabled"
      @click="toggleDetails"
    >
      <el-icon :size="20"><MoreFilled /></el-icon>
    </button>
  </header>
</template>

<script setup lang="ts">
import { publicAssetUrl } from '../../../services/runtime/public-assets';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import {
  ArrowDown,
  ArrowLeft,
  ChatDotRound,
  MoreFilled,
  VideoCamera,
} from '@element-plus/icons-vue';

const props = defineProps<{
  title: string;
  fileAssistant: boolean;
  historyDisabled: boolean;
  detailsOpen: boolean;
  detailsDisabled?: boolean;
  callDisabled?: boolean;
  groupCall?: boolean;
}>();
const emit = defineEmits<{
  back: [];
  history: [];
  videoCall: [];
  audioCall: [];
  'update:detailsOpen': [value: boolean];
}>();
const detailsOpen = computed<boolean>({
  get: (): boolean => props.detailsOpen,
  set: (value: boolean): void => {
    emit('update:detailsOpen', value);
  },
});
const detailsButton = ref<HTMLButtonElement>();
const callButton = ref<HTMLButtonElement>();
const callOpen = ref(false);

/** 群聊直接进入统一邀请入口，单聊保留音视频选择。 */
const openCall = (): void => {
  if (props.groupCall) {
    startAudioCall();
    return;
  }
  callOpen.value = !callOpen.value;
};

/** 切换聊天详情侧栏的展开状态。 */
const toggleDetails = (): void => {
  detailsOpen.value = !detailsOpen.value;
};

/** 发起视频通话并关闭头部菜单。*/
const startVideoCall = (): void => {
  callOpen.value = false;
  emit('videoCall');
};

/** 发起语音通话并关闭头部菜单。 */
const startAudioCall = (): void => {
  callOpen.value = false;
  emit('audioCall');
};

/** 点击通话菜单外部时收起菜单。*/
const closeCallMenu = (event: PointerEvent): void => {
  if (
    callOpen.value &&
    event.target instanceof Node &&
    !callButton.value?.parentElement?.contains(event.target)
  )
    callOpen.value = false;
};

/** 收起设置侧栏后恢复键盘焦点。*/
const focusDetails = (): void => {
  detailsButton.value?.focus();
};

defineExpose({ focusDetails });

onMounted(() => document.addEventListener('pointerdown', closeCallMenu));
onBeforeUnmount(() =>
  document.removeEventListener('pointerdown', closeCallMenu),
);
</script>

<style>
.chat-content-heading {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 56px;
  flex-shrink: 0;
  padding: 10px 16px;
  border-bottom: 1px solid #e8e8e8;
}
.chat-heading-copy {
  flex: 1;
  min-width: 0;
}
.chat-heading-copy h1 {
  font-size: 16px;
  font-weight: 400;
  line-height: 24px;
  margin: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.chat-call-control {
  position: relative;
  flex-shrink: 0;
}
.chat-call-toggle {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #31549b;
  background: transparent;
  cursor: pointer;
}
.chat-call-toggle:hover:not(:disabled),
.chat-call-toggle[aria-expanded='true'] {
  background: #edf2f8;
}
.chat-call-icon {
  display: block;
  width: 20px;
  height: 20px;
  object-fit: contain;
}
.chat-call-toggle:disabled {
  color: #aaaab0;
  cursor: default;
}
.chat-call-menu {
  position: absolute;
  z-index: 20;
  top: 36px;
  right: 0;
  width: 160px;
  padding: 6px;
  border: 1px solid #e2e2e5;
  border-radius: 6px;
  background: #fff;
  box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
}
.chat-call-menu-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 0 9px;
  border: 0;
  border-radius: 4px;
  color: #303036;
  background: transparent;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}
.chat-call-menu-item:hover:not(:disabled) {
  background: #f0f0f2;
}
.chat-call-menu-item:disabled {
  color: #aaaab0;
  cursor: default;
}
.chat-call-menu-icon {
  display: block;
  width: 18px;
  height: 18px;
  object-fit: contain;
  opacity: 0.65;
}
.chat-conversation-menu {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 54px;
  height: 32px;
  flex-shrink: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #55555b;
  background: transparent;
  cursor: pointer;
}
.chat-conversation-menu:hover {
  background: #eee;
}
.chat-details-toggle {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #55555b;
  cursor: pointer;
}
.chat-details-toggle:hover,
.chat-details-toggle.is-active {
  background: #ececec;
}
@media (max-width: 720px) and (min-width: 561px) {
  .chat-content-heading {
    padding-inline: 16px;
  }
}
@media (max-width: 560px) {
  .chat-content-heading {
    padding-inline: 10px;
  }
}
</style>
