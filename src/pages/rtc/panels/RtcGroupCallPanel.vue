<template>
  <section class="rtc-group-call" aria-label="群通话">
    <header class="rtc-group-call-header">
      <div class="rtc-group-call-actions">
        <button
          type="button"
          class="rtc-group-call-icon-button"
          :class="{ 'is-active': pinned }"
          :disabled="isTerminal"
          title="置顶"
          aria-label="置顶"
          @click="emit('togglePin')"
        >
          <el-icon :size="17"><PinIcon /></el-icon>
        </button>
        <button
          type="button"
          class="rtc-group-call-icon-button"
          disabled
          title="添加成员暂未接入"
          aria-label="添加成员暂未接入"
        >
          <el-icon :size="19"><Plus /></el-icon>
        </button>
      </div>
      <span class="rtc-group-call-title">
        {{ isConnected ? callDuration : '群通话' }}
      </span>
      <div class="rtc-group-call-actions">
        <button
          type="button"
          class="rtc-group-call-icon-button"
          title="最小化"
          aria-label="最小化群通话窗口"
          @click="emit('minimize')"
        >
          <el-icon :size="17"><Minus /></el-icon>
        </button>
        <button
          type="button"
          class="rtc-group-call-icon-button"
          :title="maximized ? '还原' : '最大化'"
          :aria-label="maximized ? '还原' : '最大化'"
          @click="emit('maximize')"
        >
          <el-icon :size="15"><FullScreen /></el-icon>
        </button>
        <button
          type="button"
          class="rtc-group-call-icon-button rtc-group-call-icon-button--close"
          :disabled="busy || isTerminal"
          title="关闭通话窗口"
          aria-label="关闭通话窗口"
          @click="emit('close')"
        >
          <el-icon :size="17"><Close /></el-icon>
        </button>
      </div>
    </header>

    <div class="rtc-group-call-stage">
      <div class="rtc-group-call-scroll" tabindex="0" aria-label="通话成员">
        <div class="rtc-group-call-grid">
          <article
            v-for="tile in tiles"
            :key="tile.identity"
            class="rtc-group-call-tile"
            :class="{
              'rtc-group-call-tile--waiting': tile.waiting || tile.expired,
            }"
            :aria-label="tile.name"
            :title="tile.name"
          >
            <img
              class="rtc-group-call-avatar"
              :src="tile.avatar || DEFAULT_AVATAR_URL"
              :alt="`${tile.name}头像`"
              @error="replaceAvatar"
            />
            <video
              v-if="tile.video"
              v-show="tile.cameraEnabled"
              :ref="(element) => bindVideo(tile.identity, element)"
              autoplay
              muted
              playsinline
            />
            <div
              v-if="tile.waiting || tile.expired"
              class="rtc-group-call-waiting"
              :aria-label="tile.expired ? '对方无响应' : '等待加入'"
            >
              <span v-if="tile.expired" class="rtc-group-call-unanswered"
                >对方无响应</span
              >
              <span
                v-else
                class="rtc-group-call-waiting-dots"
                aria-hidden="true"
                >{{ dots }}</span
              >
            </div>
            <span
              v-if="tile.speaking"
              class="rtc-group-call-speaking"
              aria-label="正在说话"
            >
              <RtcSpeakerIcon :enabled="true" />
            </span>
          </article>
        </div>
      </div>
      <audio
        v-for="item in audioTracks"
        :key="item.participantIdentity"
        :ref="(element) => bindAudio(item.participantIdentity, element)"
        autoplay
        class="rtc-group-call-audio"
      />
    </div>

    <div class="rtc-group-call-feedback" aria-live="polite">
      <span v-if="isTerminal">{{ terminalText }}</span>
      <span v-else-if="error" class="rtc-group-call-error" role="alert">{{
        error
      }}</span>
      <span v-else-if="!isConnected">
        {{ isIncoming ? '邀请你加入群通话' : '等待群成员接听'
        }}<span class="rtc-group-call-dots">{{ dots }}</span>
      </span>
    </div>

    <footer class="rtc-group-call-footer">
      <button
        ref="microphoneButton"
        data-rtc-microphone-button
        type="button"
        class="rtc-group-call-control"
        :class="{ 'is-off': !microphoneEnabled }"
        :disabled="busy || microphoneBusy || isTerminal"
        :aria-pressed="microphoneEnabled"
        :aria-expanded="microphoneMenuVisible"
        title="麦克风"
        aria-label="麦克风"
        @mouseenter="showMicrophoneMenu(false)"
        @mouseleave="emit('leaveMicrophoneMenu')"
        @blur="emit('leaveMicrophoneMenu')"
        @keydown.down.prevent.stop="showMicrophoneMenu(true)"
        @keydown.up.prevent.stop="showMicrophoneMenu(true)"
        @keydown.esc.stop="emit('hideMicrophoneMenu')"
        @click="emit('toggleMicrophone')"
      >
        <span class="rtc-group-call-control-icon">
          <el-icon :size="21"
            ><Microphone v-if="microphoneEnabled" /><Mute v-else
          /></el-icon>
        </span>
        <span>{{ microphoneEnabled ? '麦克风已开' : '麦克风已关' }}</span>
      </button>
      <button
        ref="speakerButton"
        data-rtc-speaker-button
        type="button"
        class="rtc-group-call-control"
        :class="{ 'is-off': !speakerEnabled }"
        :disabled="busy || speakerBusy || isTerminal"
        :aria-pressed="speakerEnabled"
        :aria-expanded="speakerMenuVisible"
        title="扬声器"
        aria-label="扬声器"
        @mouseenter="showSpeakerMenu(false)"
        @mouseleave="emit('leaveSpeakerMenu')"
        @blur="emit('leaveSpeakerMenu')"
        @keydown.down.prevent.stop="showSpeakerMenu(true)"
        @keydown.up.prevent.stop="showSpeakerMenu(true)"
        @keydown.esc.stop="emit('hideSpeakerMenu')"
        @click="emit('toggleSpeaker')"
      >
        <span class="rtc-group-call-control-icon"
          ><RtcSpeakerIcon :enabled="speakerEnabled"
        /></span>
        <span>{{ speakerEnabled ? '扬声器已开' : '扬声器已关' }}</span>
      </button>
      <button
        ref="cameraButton"
        data-rtc-camera-button
        type="button"
        class="rtc-group-call-control"
        :class="{ 'is-off': !cameraEnabled }"
        :disabled="
          busy ||
          cameraBusy ||
          isTerminal ||
          call.mediaMode !== RtcMediaMode.VIDEO
        "
        :aria-pressed="cameraEnabled"
        :aria-expanded="cameraMenuVisible"
        aria-haspopup="dialog"
        title="摄像头"
        aria-label="摄像头"
        @mouseenter="showCameraMenu(false)"
        @mouseleave="emit('leaveCameraMenu')"
        @blur="emit('leaveCameraMenu')"
        @keydown.down.prevent.stop="showCameraMenu(true)"
        @keydown.up.prevent.stop="showCameraMenu(true)"
        @keydown.esc.stop="emit('hideCameraMenu')"
        @click="emit('toggleCamera')"
      >
        <span
          class="rtc-group-call-control-icon"
          :class="{ 'is-camera-off': !cameraEnabled }"
        >
          <el-icon :size="21"><VideoCamera /></el-icon>
        </span>
        <span>{{ cameraEnabled ? '摄像头已开' : '摄像头已关' }}</span>
      </button>
      <button
        type="button"
        class="rtc-group-call-control is-off"
        disabled
        title="共享屏幕暂未接入"
        aria-label="共享屏幕暂未接入"
      >
        <span class="rtc-group-call-control-icon"
          ><el-icon :size="21"><Monitor /></el-icon
        ></span>
        <span>共享屏幕</span>
      </button>
      <button
        v-if="isRinging && isIncoming"
        type="button"
        class="rtc-group-call-control rtc-group-call-control--accept"
        :disabled="busy"
        title="接听"
        aria-label="接听"
        @click="emit('accept')"
      >
        <span class="rtc-group-call-control-icon"
          ><img :src="publicAssetUrl('video/AnsweringCall.svg')" alt=""
        /></span>
        <span>接听</span>
      </button>
      <button
        type="button"
        class="rtc-group-call-control rtc-group-call-control--hangup"
        :disabled="busy || isTerminal"
        :title="hangupLabel"
        :aria-label="hangupLabel"
        @click="endCall"
      >
        <span class="rtc-group-call-control-icon"
          ><img :src="publicAssetUrl('video/HangUp.svg')" alt=""
        /></span>
        <span>{{ hangupLabel }}</span>
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import {
  DEFAULT_AVATAR_URL,
  publicAssetUrl,
} from '../../../services/runtime/public-assets';
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import {
  Close,
  FullScreen,
  Microphone,
  Minus,
  Monitor,
  Mute,
  Plus,
  VideoCamera,
} from '@element-plus/icons-vue';
import {
  type RtcCallPeer,
  type RtcCallView,
  RtcCallState,
  RtcMediaMode,
} from '../../../../shared/rtc/rtc';
import type { RtcMicrophoneAnchor } from '../../../../shared/rtc/rtc-microphone';
import type { RtcRemoteTrack, RtcRoomParticipant } from '../services';
import type { RtcSpeakerOutput } from '../services/rtc-speaker-output';
import { readRtcGroupMembers } from '../services/rtc-group-members';
import PinIcon from '../../../components/icons/PinIcon.vue';
import RtcSpeakerIcon from '../../../components/icons/RtcSpeakerIcon.vue';

interface GroupTile {
  identity: string;
  name: string;
  avatar: string | null;
  video: MediaStreamTrack | null;
  cameraEnabled: boolean;
  speaking: boolean;
  waiting: boolean;
  expired: boolean;
}

const props = defineProps<{
  call: RtcCallView;
  currentUserId: string;
  localTrack: MediaStreamTrack | null;
  remoteTracks: RtcRemoteTrack[];
  participants: RtcRoomParticipant[];
  profiles: Record<string, RtcCallPeer>;
  connected: boolean;
  busy: boolean;
  error: string;
  microphoneEnabled: boolean;
  microphoneBusy: boolean;
  microphoneMenuVisible: boolean;
  cameraEnabled: boolean;
  cameraStates: Record<string, { enabled: boolean; version: number }>;
  cameraBusy: boolean;
  cameraMenuVisible: boolean;
  speakerEnabled: boolean;
  speakerBusy: boolean;
  speakerMenuVisible: boolean;
  speakerOutput: RtcSpeakerOutput;
  callDuration: string;
  pinned: boolean;
  maximized: boolean;
}>();

const emit = defineEmits<{
  accept: [];
  reject: [];
  cancel: [];
  hangup: [];
  toggleMicrophone: [];
  showMicrophoneMenu: [anchor: RtcMicrophoneAnchor, focus: boolean];
  leaveMicrophoneMenu: [];
  hideMicrophoneMenu: [];
  toggleCamera: [];
  showCameraMenu: [anchor: RtcMicrophoneAnchor, focus: boolean];
  leaveCameraMenu: [];
  hideCameraMenu: [];
  toggleSpeaker: [];
  showSpeakerMenu: [anchor: RtcMicrophoneAnchor, focus: boolean];
  leaveSpeakerMenu: [];
  hideSpeakerMenu: [];
  togglePin: [];
  minimize: [];
  maximize: [];
  close: [];
}>();

const microphoneButton = ref<HTMLButtonElement>();
const speakerButton = ref<HTMLButtonElement>();
const cameraButton = ref<HTMLButtonElement>();
const videoElements = new Map<string, HTMLVideoElement>();
const audioElements = new Map<string, HTMLAudioElement>();
const outputUnbinds = new Map<string, () => void>();
const dots = ref('.');
const previouslyJoined = new Set<string>();
let disposed = false;
let dotsTimer: ReturnType<typeof setInterval> | undefined;

const isTerminal = computed((): boolean => {
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
const isIncoming = computed(
  (): boolean => props.call.callerUid !== props.currentUserId,
);
const isRinging = computed(
  (): boolean => props.call.state === RtcCallState.RINGING,
);
const isConnected = computed(
  (): boolean =>
    props.connected ||
    props.call.state === RtcCallState.ACCEPTED ||
    props.call.state === RtcCallState.CONNECTED,
);
const hangupLabel = computed((): string => {
  if (!isRinging.value) return '挂断';
  return isIncoming.value ? '拒绝' : '取消';
});
const tiles = computed((): GroupTile[] => {
  const participants = readRtcGroupMembers(
    props.call,
    props.currentUserId,
    props.participants,
    previouslyJoined,
  );
  return participants.map((participant): GroupTile => {
    const profile = props.profiles[participant.identity];
    const local = participant.identity === props.currentUserId;
    let video: MediaStreamTrack | null = null;
    if (local) video = props.localTrack;
    if (!local)
      video =
        props.remoteTracks.find(
          (item) =>
            item.participantIdentity === participant.identity &&
            item.track.kind === 'video',
        )?.track ?? null;
    return {
      identity: participant.identity,
      name: profile?.name || participant.name,
      avatar: profile?.avatar ?? null,
      video,
      cameraEnabled: local
        ? props.cameraEnabled
        : (props.cameraStates[participant.identity]?.enabled ??
          participant.cameraEnabled),
      speaking: participant.speaking,
      waiting: participant.waiting,
      expired: participant.expired,
    };
  });
});
const audioTracks = computed((): RtcRemoteTrack[] =>
  props.remoteTracks.filter(
    (item) =>
      item.track.kind === 'audio' &&
      props.participants.some(
        (participant) => participant.identity === item.participantIdentity,
      ),
  ),
);
const terminalText = computed((): string => {
  switch (props.call.state) {
    case RtcCallState.REJECTED:
      return '你已拒绝群通话';
    case RtcCallState.CANCELED:
      return '群通话已取消';
    case RtcCallState.EXPIRED:
      return '对方无响应';
    default:
      return '群通话已结束';
  }
});

/** 根据振铃身份执行拒绝、取消或挂断。 */
const endCall = (): void => {
  if (!isRinging.value) emit('hangup');
  else if (isIncoming.value) emit('reject');
  else emit('cancel');
};

/** 将通话控制按钮的坐标交给已预热的原生菜单窗口。 */
const showMicrophoneMenu = (focus: boolean): void => {
  if (
    props.busy ||
    props.microphoneBusy ||
    isTerminal.value ||
    !microphoneButton.value
  )
    return;
  const { x, y, width, height } =
    microphoneButton.value.getBoundingClientRect();
  emit('showMicrophoneMenu', { x, y, width, height }, focus);
};

/** 将扬声器按钮的坐标交给输出设备菜单。 */
const showSpeakerMenu = (focus: boolean): void => {
  if (
    props.busy ||
    props.speakerBusy ||
    isTerminal.value ||
    !speakerButton.value
  )
    return;
  const { x, y, width, height } = speakerButton.value.getBoundingClientRect();
  emit('showSpeakerMenu', { x, y, width, height }, focus);
};

/** 摄像头菜单仅在允许视频的通话中展开，不主动采集。 */
const showCameraMenu = (focus: boolean): void => {
  if (
    props.call.mediaMode !== RtcMediaMode.VIDEO ||
    props.busy ||
    props.cameraBusy ||
    isTerminal.value ||
    !cameraButton.value
  )
    return;
  const { x, y, width, height } = cameraButton.value.getBoundingClientRect();
  emit('showCameraMenu', { x, y, width, height }, focus);
};

/** 头像加载失败时回退到应用资源，避免错误事件循环。 */
const replaceAvatar = (event: Event): void => {
  const image = event.currentTarget;
  if (
    image instanceof HTMLImageElement &&
    !image.src.endsWith(DEFAULT_AVATAR_URL)
  )
    image.src = DEFAULT_AVATAR_URL;
};

/** 只在轨道真正变化时替换媒体流，避免说话状态更新中断播放。 */
const attachTrack = (
  element: HTMLMediaElement,
  track: MediaStreamTrack | null,
): void => {
  const stream = element.srcObject;
  if (stream instanceof MediaStream && stream.getTracks()[0] === track) return;
  element.srcObject = track ? new MediaStream([track]) : null;
  if (track) void element.play().catch(() => {});
};

/** 视频元素始终静音，远端音频由独立元素播放，避免开视频丢失声音。 */
const bindVideo = (identity: string, element: unknown): void => {
  if (element instanceof HTMLVideoElement) {
    videoElements.set(identity, element);
    attachTrack(
      element,
      tiles.value.find((tile) => tile.identity === identity)?.video ?? null,
    );
    return;
  }
  const previous = videoElements.get(identity);
  if (previous) previous.srcObject = null;
  videoElements.delete(identity);
};

/** 每位远端成员独立绑定输出设备，不因头像或视频切换重新播放音轨。 */
const bindAudio = (identity: string, element: unknown): void => {
  if (element instanceof HTMLAudioElement) {
    if (audioElements.get(identity) !== element) {
      outputUnbinds.get(identity)?.();
      audioElements.set(identity, element);
      outputUnbinds.set(identity, props.speakerOutput.bind(element));
    }
    attachTrack(
      element,
      audioTracks.value.find((item) => item.participantIdentity === identity)
        ?.track ?? null,
    );
    return;
  }
  outputUnbinds.get(identity)?.();
  outputUnbinds.delete(identity);
  const previous = audioElements.get(identity);
  if (previous) {
    previous.pause();
    previous.srcObject = null;
  }
  audioElements.delete(identity);
};

/** 更新已存在的媒体元素，保持音频与视频的独立生命周期。 */
const refreshMedia = async (): Promise<void> => {
  await nextTick();
  if (disposed) return;
  for (const tile of tiles.value) {
    const element = videoElements.get(tile.identity);
    if (element) attachTrack(element, tile.video);
  }
  for (const item of audioTracks.value) {
    const element = audioElements.get(item.participantIdentity);
    if (element) attachTrack(element, item.track);
  }
};

watch([tiles, audioTracks], () => void refreshMedia());
watch(
  () => props.participants,
  (participants): void => {
    for (const participant of participants)
      previouslyJoined.add(participant.identity);
  },
  { immediate: true, flush: 'sync' },
);
onMounted(() => {
  dotsTimer = setInterval(() => {
    dots.value = dots.value.length >= 3 ? '.' : `${dots.value}.`;
  }, 480);
});
onBeforeUnmount(() => {
  disposed = true;
  if (dotsTimer) clearInterval(dotsTimer);
  for (const unbind of outputUnbinds.values()) unbind();
  for (const element of [
    ...audioElements.values(),
    ...videoElements.values(),
  ]) {
    element.pause();
    element.srcObject = null;
  }
  outputUnbinds.clear();
  audioElements.clear();
  videoElements.clear();
});
</script>

<style scoped>
.rtc-group-call {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #1f1f1f;
  color: #fff;
  user-select: none;
}
.rtc-group-call-header {
  position: relative;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex: 0 0 40px;
  padding: 0 8px;
  -webkit-app-region: drag;
}
.rtc-group-call-title {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  font-size: 16px;
  font-variant-numeric: tabular-nums;
}
.rtc-group-call-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.rtc-group-call-icon-button {
  display: grid;
  place-items: center;
  width: 34px;
  height: 30px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  color: #fff;
  background: transparent;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.rtc-group-call-icon-button:hover:not(:disabled),
.rtc-group-call-icon-button.is-active {
  background: rgb(255 255 255 / 14%);
}
.rtc-group-call-icon-button--close:hover:not(:disabled) {
  background: #e83f43;
}
button:disabled {
  cursor: default;
  opacity: 0.45;
}
.rtc-group-call-stage {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  container-type: size;
}
.rtc-group-call-scroll {
  width: 100%;
  height: min(100%, calc(200cqw / 3));
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
  scrollbar-color: #686868 #1f1f1f;
}
.rtc-group-call-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-auto-rows: min(calc(100cqw / 3), 50cqh);
  align-content: start;
  width: 100%;
}
.rtc-group-call-tile {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #303234;
}
.rtc-group-call-avatar,
.rtc-group-call-tile video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rtc-group-call-tile--waiting .rtc-group-call-avatar {
  filter: brightness(0.65) grayscale(0.2);
}
.rtc-group-call-waiting {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 18%);
}
.rtc-group-call-waiting-dots {
  display: block;
  width: 54px;
  height: 40px;
  text-align: center;
  font-size: 32px;
  line-height: 24px;
  font-weight: 600;
}
.rtc-group-call-unanswered {
  padding: 4px;
  text-align: center;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.rtc-group-call-tile video {
  position: absolute;
  inset: 0;
}
.rtc-group-call-speaking {
  position: absolute;
  left: 9px;
  bottom: 9px;
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  color: #07c160;
  background: #fff;
}
.rtc-group-call-speaking :deep(svg) {
  width: 21px;
  height: 21px;
}
.rtc-group-call-audio {
  display: none;
}
.rtc-group-call-feedback {
  flex: 0 0 30px;
  min-height: 0;
  padding: 4px 12px;
  overflow: auto;
  text-align: center;
  font-size: 12px;
  line-height: 22px;
  overflow-wrap: anywhere;
}
.rtc-group-call-error {
  color: #ffcaca;
}
.rtc-group-call-dots {
  display: inline-block;
  width: 20px;
  text-align: left;
}
.rtc-group-call-footer {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 106px;
  gap: 12px;
  padding: 8px 12px 20px;
}
.rtc-group-call-control {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 76px;
  min-width: 0;
  height: 72px;
  padding: 0;
  border: 0;
  color: #fff;
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  white-space: nowrap;
  -webkit-app-region: no-drag;
}
.rtc-group-call-control-icon {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 38px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: #fff;
  color: #202020;
}
.rtc-group-call-control:hover:not(:disabled) .rtc-group-call-control-icon {
  filter: brightness(0.85);
}
.rtc-group-call-control.is-off .rtc-group-call-control-icon {
  color: #fff;
  background: #151515;
}
.rtc-group-call-control-icon :deep(svg),
.rtc-group-call-control-icon img {
  width: 22px;
  height: 22px;
}
.is-camera-off::after {
  position: absolute;
  width: 23px;
  height: 2px;
  background: currentColor;
  box-shadow: 0 1px #151515;
  transform: rotate(45deg);
  content: '';
}
.rtc-group-call-control--accept .rtc-group-call-control-icon {
  background: #07c160;
}
.rtc-group-call-control--hangup .rtc-group-call-control-icon {
  background: #fa5151;
}
button:focus-visible,
.rtc-group-call-scroll:focus-visible {
  outline: 2px solid #07c160;
  outline-offset: -2px;
}
@media (max-width: 520px) {
  .rtc-group-call-footer {
    gap: 2px;
    padding-inline: 4px;
  }
  .rtc-group-call-control {
    flex: 1;
    max-width: 76px;
    font-size: 11px;
  }
}
</style>
