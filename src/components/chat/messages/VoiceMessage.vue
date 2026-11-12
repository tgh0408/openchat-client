<template>
  <div class="voice-message">
    <button
      type="button"
      class="voice-bubble"
      :class="{
        'voice-bubble--mine': outgoing,
        'voice-bubble--playing': playing,
      }"
      :style="{ width: `${Math.min(240, 86 + (voice?.second ?? 1) * 2)}px` }"
      :disabled="disabled || !voice"
      :title="title"
      :aria-label="title"
      :aria-pressed="playing"
      @click="toggle"
    >
      <el-icon v-if="loading" class="voice-wave" :size="20"
        ><Loading
      /></el-icon>
      <span v-else class="voice-wave voice-signal" aria-hidden="true"
        ><i></i><i></i><i></i
      ></span>
      <span>{{ voice?.second ?? '?' }}"</span>
    </button>
    <span v-if="error" class="voice-error" role="alert">{{ error }}</span>
  </div>
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../../shared/api/api-error';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { Loading } from '@element-plus/icons-vue';
import type { Message } from '../../../../shared/storage/database';
import { parseVoice } from '../../../../shared/media/voice/voice';
import {
  claimVoicePlayback,
  releaseVoicePlayback,
} from '../../../services/media/voice/voice-playback';

const props = defineProps<{
  message: Message;
  outgoing?: boolean;
  disabled?: boolean;
}>();
const voice = computed(() => parseVoice(props.message.content));
const playing = ref(false);
const loading = ref(false);
const error = ref('');
const title = computed((): string => {
  if (!voice.value) return '语音不可用';
  if (error.value) return '加载失败，点击重试';
  return playing.value || loading.value ? '停止播放' : '播放语音';
});
let audio: HTMLAudioElement | undefined;
let url: string | undefined;
let version = 0;

/** 停止并释放音频及 Blob，避免账号失效、撤回或虚拟行复用后继续播放。 */
const stop = (): void => {
  version++;
  audio?.pause();
  if (audio) {
    audio.removeAttribute('src');
    audio.load();
  }
  audio = undefined;
  if (url) URL.revokeObjectURL(url);
  url = undefined;
  playing.value = false;
  loading.value = false;
  releaseVoicePlayback(stop);
};

/** 点击后通过消息归属受控读取，不直接加载消息中的远程 URL。 */
const toggle = async (): Promise<void> => {
  if (playing.value || loading.value) {
    stop();
    return;
  }
  if (props.disabled || !voice.value) return;
  const api = window.desktop ?? window.historyDesktop;
  if (!api) {
    error.value = '请在桌面程序中播放语音';
    return;
  }
  claimVoicePlayback(stop);
  const current = ++version;
  error.value = '';
  loading.value = true;
  try {
    const bytes = await api.readVoice({
      conversationId: props.message.conversationId,
      messageId: props.message.id,
    });
    if (current !== version || props.disabled) return;
    url = URL.createObjectURL(
      new Blob([new Uint8Array(bytes)], { type: 'audio/wav' }),
    );
    audio = new Audio(url);
    audio.onended = stop;
    audio.onerror = (): void => {
      stop();
      error.value = '播放失败，点击重试';
    };
    await audio.play();
    if (current !== version) return;
    loading.value = false;
    playing.value = true;
  } catch (cause) {
    if (current !== version) return;
    stop();
    error.value = getRequestErrorMessage(cause, '语音加载失败，点击重试');
  }
};

watch(() => [props.message.id, props.message.content, props.disabled], stop);
onBeforeUnmount(stop);
</script>

<style scoped>
.voice-message {
  max-width: 100%;
  min-width: 0;
}
.voice-bubble {
  position: relative;
  display: flex;
  align-items: center;
  gap: 10px;
  justify-content: flex-start;
  height: 40px;
  max-width: 100%;
  padding: 0 14px;
  border: 0;
  border-radius: 6px;
  color: #18241b;
  background: #fff;
  cursor: pointer;
  font-size: 14px;
}
.voice-bubble::before {
  content: '';
  position: absolute;
  left: -5px;
  top: 15px;
  width: 10px;
  height: 10px;
  background: inherit;
  transform: rotate(45deg);
}
.voice-bubble--mine {
  background: #9aee9c;
  flex-direction: row-reverse;
}
.voice-bubble--mine::before {
  left: auto;
  right: -5px;
}
.voice-bubble:hover {
  filter: brightness(0.97);
}
.voice-bubble:disabled {
  cursor: default;
  opacity: 0.65;
}
.voice-bubble--playing .voice-signal i:nth-child(2) {
  animation: voice-wave-inner 1.2s steps(1, end) infinite;
}
.voice-bubble--playing .voice-signal i:nth-child(3) {
  animation: voice-wave-outer 1.2s steps(1, end) infinite;
}
.voice-signal {
  position: relative;
  display: inline-block;
  width: 18px;
  height: 20px;
  flex: 0 0 18px;
}
.voice-signal i {
  position: absolute;
  top: 50%;
  left: 1px;
  border: 2px solid transparent;
  border-right-color: currentColor;
  border-radius: 50%;
  transform: translateY(-50%);
}
.voice-signal i:nth-child(1) {
  width: 3px;
  height: 3px;
  background: currentColor;
  border: 0;
  left: 7px;
}
.voice-signal i:nth-child(2) {
  width: 12px;
  height: 12px;
}
.voice-signal i:nth-child(3) {
  width: 19px;
  height: 19px;
  left: -1px;
}
.voice-bubble--mine .voice-signal {
  transform: rotate(180deg);
}
.voice-error {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: #bb3939;
  overflow-wrap: anywhere;
}
@keyframes voice-wave-inner {
  0% {
    opacity: 0;
  }
  33.333%,
  100% {
    opacity: 1;
  }
}
@keyframes voice-wave-outer {
  0% {
    opacity: 0;
  }
  66.667%,
  100% {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  /* 仅保留用户要求的播放状态反馈，不解除其他组件的减少动画限制。 */
  .voice-bubble--playing .voice-signal i:nth-child(2) {
    animation: voice-wave-inner 1.2s steps(1, end) infinite !important;
  }
  .voice-bubble--playing .voice-signal i:nth-child(3) {
    animation: voice-wave-outer 1.2s steps(1, end) infinite !important;
  }
}
</style>
