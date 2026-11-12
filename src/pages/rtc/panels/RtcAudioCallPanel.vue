<template>
  <section
    class="rtc-audio-panel"
    :class="{ 'rtc-audio-panel--caller': !compact }"
    aria-label="语音通话"
  >
    <img
      v-if="!compact"
      class="rtc-audio-background"
      :src="avatarSource"
      alt=""
      aria-hidden="true"
    />
    <header v-if="!compact" class="rtc-audio-titlebar">
      <div class="rtc-audio-titlebar-group">
        <button
          type="button"
          class="rtc-audio-title-button"
          :class="{ 'rtc-audio-title-button--pinned': pinned }"
          :disabled="terminal"
          :aria-pressed="pinned"
          :aria-label="pinned ? '取消置顶' : '置顶'"
          :title="pinned ? '取消置顶' : '置顶'"
          @click="emit('togglePin')"
        >
          <el-icon :size="17"><PinIcon /></el-icon>
        </button>
        <button
          type="button"
          class="rtc-audio-title-button"
          disabled
          title="暂未支持添加通话成员"
          aria-label="添加通话成员"
        >
          <el-icon :size="18"><Plus /></el-icon>
        </button>
      </div>
      <div class="rtc-audio-titlebar-group">
        <button
          type="button"
          class="rtc-audio-title-button"
          :disabled="terminal"
          title="最小化"
          aria-label="最小化语音通话窗口"
          @click="emit('minimize')"
        >
          <el-icon :size="17"><Minus /></el-icon>
        </button>
        <button
          type="button"
          class="rtc-audio-title-button"
          :disabled="terminal"
          :title="maximized ? '还原' : '最大化'"
          :aria-label="maximized ? '还原语音通话窗口' : '最大化语音通话窗口'"
          @click="emit('maximize')"
        >
          <el-icon :size="16"><FullScreen /></el-icon>
        </button>
        <button
          type="button"
          class="rtc-audio-title-button rtc-audio-title-button--close"
          :disabled="ending || terminal"
          title="挂断并关闭"
          aria-label="挂断并关闭语音通话窗口"
          @click="emit('close')"
        >
          <el-icon :size="17"><Close /></el-icon>
        </button>
      </div>
    </header>
    <div class="rtc-audio-peer">
      <img
        class="rtc-audio-avatar"
        :src="avatarSource"
        alt=""
        @error="avatarFailed = true"
      />
      <div class="rtc-audio-copy">
        <div class="rtc-audio-name" :title="peerName">{{ peerName }}</div>
        <div
          v-if="compact || !terminalMessage"
          class="rtc-audio-status"
          :class="{ 'rtc-audio-status--terminal': terminalMessage }"
          aria-live="polite"
        >
          <span>{{ statusText }}</span>
          <span v-if="showDots" class="rtc-audio-dots" aria-hidden="true">
            {{ dots }}
          </span>
        </div>
      </div>
    </div>
    <div v-if="compact" class="rtc-audio-bottom">
      <p
        v-if="error && !terminalMessage"
        class="rtc-audio-error"
        role="alert"
        :title="error"
      >
        {{ error }}
      </p>
      <div v-else class="rtc-audio-settings">
        <template v-if="connected && !terminal">
          <button
            ref="microphoneButton"
            data-rtc-microphone-button
            type="button"
            class="rtc-audio-tool"
            :disabled="busy || microphoneBusy || terminal"
            :aria-pressed="microphoneEnabled"
            :aria-expanded="microphoneMenuVisible"
            aria-haspopup="dialog"
            :aria-label="microphoneEnabled ? '关闭麦克风' : '打开麦克风'"
            @mouseenter="showMicrophoneMenu(false)"
            @mouseleave="emit('leaveMicrophoneMenu')"
            @blur="emit('leaveMicrophoneMenu')"
            @keydown.down.prevent.stop="showMicrophoneMenu(true)"
            @keydown.up.prevent.stop="showMicrophoneMenu(true)"
            @keydown.esc.stop="emit('hideMicrophoneMenu')"
            @click.stop="emit('toggleMicrophone')"
          >
            <el-icon v-if="microphoneEnabled"><Microphone /></el-icon>
            <el-icon v-else><Mute /></el-icon>
          </button>
          <button
            ref="speakerButton"
            data-rtc-speaker-button
            type="button"
            class="rtc-audio-tool"
            :disabled="busy || speakerBusy || terminal"
            :aria-pressed="speakerEnabled"
            :aria-label="speakerEnabled ? '关闭扬声器' : '打开扬声器'"
            :aria-expanded="speakerMenuVisible"
            aria-haspopup="dialog"
            @mouseenter="showSpeakerMenu(false)"
            @mouseleave="emit('leaveSpeakerMenu')"
            @blur="emit('leaveSpeakerMenu')"
            @keydown.down.prevent.stop="showSpeakerMenu(true)"
            @keydown.up.prevent.stop="showSpeakerMenu(true)"
            @keydown.esc.stop="emit('hideSpeakerMenu')"
            @click.stop="emit('toggleSpeaker')"
          >
            <el-icon v-if="speakerEnabled"><Headset /></el-icon>
            <el-icon v-else><MuteNotification /></el-icon>
          </button>
        </template>
      </div>
      <div v-if="!terminal" class="rtc-audio-actions">
        <button
          type="button"
          class="rtc-audio-action"
          :disabled="ending"
          :title="endLabel"
          :aria-label="endLabel"
          @click="emit('close')"
        >
          <img :src="publicAssetUrl('video/HangUp.svg')" alt="" />
        </button>
        <button
          v-if="incoming"
          type="button"
          class="rtc-audio-action"
          :disabled="busy"
          title="接听语音通话"
          aria-label="接听语音通话"
          @click="emit('accept')"
        >
          <img :src="publicAssetUrl('video/AnsweringCall.svg')" alt="" />
        </button>
      </div>
    </div>
    <template v-else>
      <p
        v-if="terminalMessage"
        class="rtc-audio-terminal-message"
        role="status"
        aria-live="polite"
      >
        {{ terminalMessage }}
      </p>
      <p
        v-else-if="error"
        class="rtc-audio-error rtc-audio-error--caller"
        role="alert"
      >
        {{ error }}
      </p>
      <div class="rtc-audio-caller-controls">
        <button
          ref="microphoneButton"
          data-rtc-microphone-button
          type="button"
          class="rtc-audio-caller-control"
          :class="{ 'rtc-audio-caller-control--off': !microphoneEnabled }"
          :disabled="busy || microphoneBusy || terminal"
          :aria-pressed="microphoneEnabled"
          :aria-expanded="microphoneMenuVisible"
          aria-haspopup="dialog"
          :aria-label="microphoneEnabled ? '关闭麦克风' : '打开麦克风'"
          @mouseenter="showMicrophoneMenu(false)"
          @mouseleave="emit('leaveMicrophoneMenu')"
          @blur="emit('leaveMicrophoneMenu')"
          @keydown.down.prevent.stop="showMicrophoneMenu(true)"
          @keydown.up.prevent.stop="showMicrophoneMenu(true)"
          @keydown.esc.stop="emit('hideMicrophoneMenu')"
          @click.stop="emit('toggleMicrophone')"
        >
          <span class="rtc-audio-caller-icon">
            <el-icon v-if="microphoneEnabled" :size="26"
              ><Microphone
            /></el-icon>
            <img
              v-else
              :src="publicAssetUrl('video/MicrophoneTurnedOff.svg')"
              alt=""
            />
          </span>
          <span>{{ microphoneEnabled ? '麦克风已开' : '麦克风已关' }}</span>
        </button>
        <button
          type="button"
          class="rtc-audio-caller-control"
          :disabled="ending || terminal"
          :title="endLabel"
          @click="emit('close')"
        >
          <img
            class="rtc-audio-caller-hangup"
            :src="publicAssetUrl('video/HangUp.svg')"
            alt=""
          />
          <span>{{
            call.state === RtcCallState.RINGING ? '取消' : '挂断'
          }}</span>
        </button>
        <button
          ref="speakerButton"
          data-rtc-speaker-button
          type="button"
          class="rtc-audio-caller-control"
          :class="{ 'rtc-audio-caller-control--off': !speakerEnabled }"
          :disabled="busy || speakerBusy || terminal"
          :aria-pressed="speakerEnabled"
          :aria-label="speakerEnabled ? '关闭扬声器' : '打开扬声器'"
          :aria-expanded="speakerMenuVisible"
          aria-haspopup="dialog"
          @mouseenter="showSpeakerMenu(false)"
          @mouseleave="emit('leaveSpeakerMenu')"
          @blur="emit('leaveSpeakerMenu')"
          @keydown.down.prevent.stop="showSpeakerMenu(true)"
          @keydown.up.prevent.stop="showSpeakerMenu(true)"
          @keydown.esc.stop="emit('hideSpeakerMenu')"
          @click.stop="emit('toggleSpeaker')"
        >
          <span class="rtc-audio-caller-icon">
            <RtcSpeakerIcon :enabled="speakerEnabled" />
          </span>
          <span>{{ speakerEnabled ? '扬声器已开' : '扬声器已关' }}</span>
        </button>
      </div>
    </template>
    <audio ref="remoteAudio" autoplay muted />
  </section>
</template>

<script setup lang="ts">
import {
  DEFAULT_AVATAR_URL,
  publicAssetUrl,
} from '../../../services/runtime/public-assets';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import {
  Close,
  FullScreen,
  Headset,
  Microphone,
  Minus,
  Mute,
  MuteNotification,
  Plus,
} from '@element-plus/icons-vue';
import { type RtcCallView, RtcCallState } from '../../../../shared/rtc/rtc';
import type { RtcMicrophoneAnchor } from '../../../../shared/rtc/rtc-microphone';
import type { RtcSpeakerOutput } from '../services/rtc-speaker-output';
import PinIcon from '../../../components/icons/PinIcon.vue';
import RtcSpeakerIcon from '../../../components/icons/RtcSpeakerIcon.vue';

const props = defineProps<{
  call: RtcCallView;
  currentUserId: string;
  peerName: string;
  peerAvatar?: string;
  terminalMessage: string;
  connected: boolean;
  busy: boolean;
  ending?: boolean;
  error: string;
  microphoneEnabled: boolean;
  microphoneBusy: boolean;
  microphoneMenuVisible: boolean;
  speakerEnabled: boolean;
  speakerBusy: boolean;
  speakerMenuVisible: boolean;
  speakerOutput: RtcSpeakerOutput;
  callDuration: string;
  remoteTracks: MediaStreamTrack[];
  pinned: boolean;
  maximized: boolean;
  compact: boolean;
}>();
const emit = defineEmits<{
  accept: [];
  close: [];
  toggleMicrophone: [];
  showMicrophoneMenu: [anchor: RtcMicrophoneAnchor, focus: boolean];
  leaveMicrophoneMenu: [];
  hideMicrophoneMenu: [];
  toggleSpeaker: [];
  showSpeakerMenu: [anchor: RtcMicrophoneAnchor, focus: boolean];
  leaveSpeakerMenu: [];
  hideSpeakerMenu: [];
  playbackError: [message: string];
  togglePin: [];
  minimize: [];
  maximize: [];
}>();
const remoteAudio = ref<HTMLAudioElement>();
const microphoneButton = ref<HTMLButtonElement>();
const speakerButton = ref<HTMLButtonElement>();
const avatarFailed = ref(false);
const dots = ref('.');
let dotsTimer: ReturnType<typeof setInterval> | undefined;
const avatarSource = computed((): string =>
  avatarFailed.value
    ? DEFAULT_AVATAR_URL
    : props.peerAvatar || DEFAULT_AVATAR_URL,
);
const incoming = computed(
  (): boolean =>
    props.call.state === RtcCallState.RINGING &&
    props.call.calleeUid === props.currentUserId,
);
const terminal = computed((): boolean => {
  switch (props.call.state) {
    case RtcCallState.REJECTED:
    case RtcCallState.CANCELED:
    case RtcCallState.ENDED:
    case RtcCallState.EXPIRED:
      return true;
    default:
      return false;
  }
});
const showDots = computed((): boolean => !terminal.value && !props.connected);
const statusText = computed((): string => {
  if (props.terminalMessage) return props.terminalMessage;
  switch (props.call.state) {
    case RtcCallState.RINGING:
      return incoming.value ? '邀请你语音通话' : '等待对方接受邀请';
    case RtcCallState.ACCEPTED:
    case RtcCallState.CONNECTED:
      return props.connected ? props.callDuration : '正在连接';
    case RtcCallState.EXPIRED:
      return '对方无响应';
    default:
      return '通话已结束';
  }
});
const endLabel = computed((): string => {
  if (incoming.value) return '拒绝语音通话';
  if (props.call.state === RtcCallState.RINGING) return '取消语音通话';
  return '挂断语音通话';
});

/** 复用预热菜单，主进程按当前语音布局中的按钮坐标定位。 */
const showMicrophoneMenu = (focus: boolean): void => {
  if (
    props.busy ||
    props.microphoneBusy ||
    terminal.value ||
    !microphoneButton.value
  )
    return;
  const { x, y, width, height } =
    microphoneButton.value.getBoundingClientRect();
  emit('showMicrophoneMenu', { x, y, width, height }, focus);
};

/** 语音完整面板和紧凑面板共用扬声器菜单及当前位置。 */
const showSpeakerMenu = (focus: boolean): void => {
  if (props.busy || props.speakerBusy || terminal.value || !speakerButton.value)
    return;
  const { x, y, width, height } = speakerButton.value.getBoundingClientRect();
  emit('showSpeakerMenu', { x, y, width, height }, focus);
};

watch(
  () => props.compact,
  () => {
    emit('hideMicrophoneMenu');
    emit('hideSpeakerMenu');
  },
);
watch(
  [remoteAudio, () => props.speakerOutput],
  ([element, output], _previous, onCleanup) => {
    if (element) onCleanup(output.bind(element));
  },
  { flush: 'post' },
);
watch(
  [remoteAudio, () => props.remoteTracks],
  ([element, tracks], _previous, onCleanup) => {
    if (!element) return;
    const audioTracks = tracks.filter((track) => track.kind === 'audio');
    const stream = audioTracks.length ? new MediaStream(audioTracks) : null;
    element.srcObject = stream;
    if (stream) {
      void element.play().catch(() => {
        if (element.srcObject === stream)
          emit('playbackError', '无法播放对方语音，请检查音频输出');
      });
    }
    onCleanup(() => {
      element.pause();
      element.srcObject = null;
    });
  },
  { flush: 'post' },
);
watch(
  () => props.peerAvatar,
  () => {
    avatarFailed.value = false;
  },
);
onMounted(() => {
  dotsTimer = setInterval(() => {
    dots.value = dots.value.length === 3 ? '.' : `${dots.value}.`;
  }, 480);
});
onBeforeUnmount(() => clearInterval(dotsTimer));
</script>

<style scoped>
.rtc-audio-panel {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  height: 100%;
  padding: 14px;
  overflow: hidden;
  border-radius: 8px;
  background: #505050;
  color: #fff;
  user-select: none;
}
.rtc-audio-peer {
  display: flex;
  gap: 12px;
  min-width: 0;
  -webkit-app-region: drag;
}
.rtc-audio-avatar {
  flex: 0 0 36px;
  width: 36px;
  height: 36px;
  border-radius: 3px;
  object-fit: cover;
}
.rtc-audio-copy {
  min-width: 0;
}
.rtc-audio-name {
  overflow: hidden;
  font-size: 14px;
  line-height: 20px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rtc-audio-status {
  display: flex;
  color: #c5c5c5;
  font-size: 13px;
  line-height: 18px;
  white-space: nowrap;
}
.rtc-audio-dots {
  width: 16px;
}
.rtc-audio-status--terminal {
  color: #fff;
  font-weight: 500;
}
.rtc-audio-bottom {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: auto;
  min-height: 28px;
}
.rtc-audio-settings,
.rtc-audio-error {
  flex: 1;
  min-width: 0;
}
.rtc-audio-settings,
.rtc-audio-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}
.rtc-audio-actions {
  flex-shrink: 0;
}
.rtc-audio-tool,
.rtc-audio-action {
  display: grid;
  place-items: center;
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #fff;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.rtc-audio-tool {
  font-size: 18px;
}
.rtc-audio-action img {
  display: block;
  width: 28px;
  height: 28px;
}
.rtc-audio-tool:hover,
.rtc-audio-action:hover {
  opacity: 0.8;
}
.rtc-audio-tool:disabled,
.rtc-audio-action:disabled {
  cursor: default;
  opacity: 0.45;
}
.rtc-audio-tool:focus-visible,
.rtc-audio-action:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
.rtc-audio-error {
  margin: 0;
  overflow: auto;
  max-height: 32px;
  color: #ffd1d1;
  font-size: 11px;
  line-height: 16px;
  overflow-wrap: anywhere;
}
.rtc-audio-panel--caller {
  position: absolute;
  width: min(100cqw, calc(100cqh * 9 / 16));
  height: min(100cqh, calc(100cqw * 16 / 9));
  top: 50%;
  left: 50%;
  padding: 0;
  border-radius: 0;
  transform: translate(-50%, -50%);
  background: #414244;
}
.rtc-audio-background {
  position: absolute;
  inset: -40px;
  width: calc(100% + 80px);
  height: calc(100% + 80px);
  object-fit: cover;
  filter: blur(36px) grayscale(1) brightness(0.65);
  opacity: 0.35;
  pointer-events: none;
}
.rtc-audio-titlebar {
  position: absolute;
  z-index: 2;
  inset: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 8px;
  -webkit-app-region: drag;
}
.rtc-audio-titlebar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}
.rtc-audio-title-button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #fff;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.rtc-audio-title-button:hover {
  background: rgb(255 255 255 / 15%);
}
.rtc-audio-title-button--close:hover {
  background: #e83f43;
}
.rtc-audio-title-button--pinned {
  color: #07c160;
}
.rtc-audio-title-button:disabled {
  opacity: 0.45;
  cursor: default;
}
.rtc-audio-panel--caller .rtc-audio-peer {
  position: absolute;
  top: 23.5%;
  right: 20px;
  left: 20px;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}
.rtc-audio-panel--caller .rtc-audio-avatar {
  flex: 0 0 96px;
  width: 96px;
  height: 96px;
  border-radius: 6px;
}
.rtc-audio-panel--caller .rtc-audio-copy {
  max-width: 100%;
  text-align: center;
}
.rtc-audio-panel--caller .rtc-audio-name {
  font-size: 16px;
  line-height: 24px;
}
.rtc-audio-panel--caller .rtc-audio-status {
  justify-content: center;
  margin-top: 4px;
  color: #fff;
  font-size: 12px;
  line-height: 20px;
}
.rtc-audio-caller-controls {
  position: absolute;
  right: 20px;
  bottom: 30px;
  left: 20px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.rtc-audio-caller-control {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 0;
  border: 0;
  background: transparent;
  color: #fff;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.rtc-audio-caller-icon,
.rtc-audio-caller-hangup {
  display: grid;
  place-items: center;
  flex: 0 0 56px;
  width: 56px;
  height: 56px;
  border-radius: 50%;
}
.rtc-audio-caller-icon {
  background: #fff;
  color: #1a1a1e;
}
.rtc-audio-caller-icon img {
  width: 26px;
  height: 26px;
  filter: invert(1);
}
.rtc-audio-caller-control--off .rtc-audio-caller-icon {
  background: #5a5b5d;
  color: #fff;
}
.rtc-audio-caller-control:hover:not(:disabled) {
  opacity: 0.85;
}
.rtc-audio-caller-control:disabled {
  opacity: 0.45;
  cursor: default;
}
.rtc-audio-caller-control:focus-visible,
.rtc-audio-title-button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 3px;
}
.rtc-audio-error--caller {
  position: absolute;
  right: 20px;
  bottom: 130px;
  left: 20px;
  max-height: 42px;
  padding: 4px 8px;
  border-radius: 4px;
  background: rgb(95 20 20 / 80%);
  font-size: 12px;
  line-height: 17px;
}
.rtc-audio-terminal-message {
  position: absolute;
  z-index: 2;
  right: 20px;
  bottom: 142px;
  left: 20px;
  margin: 0;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  line-height: 22px;
  text-align: center;
  overflow-wrap: anywhere;
  text-shadow: 0 1px 4px rgb(0 0 0 / 60%);
}
@media (max-height: 480px) {
  .rtc-audio-panel--caller .rtc-audio-peer {
    top: 18%;
  }
  .rtc-audio-panel--caller .rtc-audio-avatar {
    flex-basis: 72px;
    width: 72px;
    height: 72px;
  }
  .rtc-audio-caller-controls {
    right: 12px;
    left: 12px;
    gap: 4px;
  }
  .rtc-audio-caller-control {
    font-size: 12px;
  }
}
</style>
