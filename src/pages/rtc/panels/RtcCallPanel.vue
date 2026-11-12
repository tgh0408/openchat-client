<template>
  <section
    v-if="call"
    ref="panel"
    class="rtc-call-panel"
    :class="{
      'rtc-call-panel--incoming': isIncoming,
      'rtc-call-panel--standalone': standalone,
    }"
    :style="panelStyle"
    aria-live="polite"
    aria-label="视频通话"
    @pointerdown.stop
  >
    <div class="rtc-call-stage">
      <!-- 未接通时使用本地视频作为背景，接通后主画面立即固定为远端视频 -->
      <video
        v-if="localTrack"
        v-show="cameraEnabled && (!isConnected || !mediaReadyForSwitch)"
        ref="localVideoBg"
        class="rtc-call-background-video"
        autoplay
        muted
        playsinline
        @canplay="markLocalVideoReady"
        @playing="markLocalVideoReady"
      />
      <video
        v-if="isConnected && hasRemoteMedia"
        ref="remoteVideo"
        class="rtc-call-remote"
        :class="{
          'rtc-call-remote--ready': mediaReadyForSwitch,
          'rtc-call-remote--pip': isVideoSwapped,
        }"
        :style="isVideoSwapped ? pipStyle : undefined"
        autoplay
        playsinline
        muted
        @canplay="markRemoteVideoReady"
        @playing="markRemoteVideoReady"
        @pointerdown.stop="beginPipDrag($event, 'remote')"
        @click.stop="toggleVideoLayout('remote')"
      />
      <div
        v-if="
          (isConnected && remoteCameraEnabled === false) ||
          (frozen && frozenRemoteCameraOff)
        "
        class="rtc-call-remote rtc-call-remote--ready rtc-call-remote-camera-off"
        :class="{ 'rtc-call-remote--pip': isVideoSwapped }"
        :style="isVideoSwapped ? pipStyle : undefined"
        @pointerdown.stop="beginPipDrag($event, 'remote')"
        @click.stop="toggleVideoLayout('remote')"
      >
        <img
          :src="publicAssetUrl('video/CameraTurnedOff.svg')"
          alt=""
          class="rtc-call-camera-off-icon"
        />
        <span>对方摄像头已关闭</span>
      </div>
      <div
        v-if="!cameraEnabled && (!isConnected || !mediaReadyForSwitch)"
        class="rtc-call-placeholder rtc-call-placeholder--camera-off"
      >
        <img
          :src="publicAssetUrl('video/CameraTurnedOff.svg')"
          alt="摄像头已关闭"
          class="rtc-call-camera-off-icon"
        />
      </div>
      <div
        v-if="
          cameraEnabled && !localTrack && (!isConnected || !mediaReadyForSwitch)
        "
        class="rtc-call-placeholder"
      >
        <el-icon :size="48"><VideoCamera /></el-icon>
      </div>

      <!-- 接通后的本地画中画小窗 -->
      <div
        v-if="isConnected && mediaReadyForSwitch && !cameraEnabled"
        class="rtc-call-local rtc-call-local--camera-off"
        :class="{ 'rtc-call-local--main': isVideoSwapped }"
        :style="isVideoSwapped ? undefined : pipStyle"
        @pointerdown.stop="beginPipDrag($event, 'local')"
        @click.stop="toggleVideoLayout('local')"
      >
        <img
          :src="publicAssetUrl('video/CameraTurnedOff.svg')"
          alt="摄像头已关闭"
          class="rtc-call-camera-off-icon"
        />
      </div>
      <video
        v-if="localTrack"
        v-show="cameraEnabled && isConnected && mediaReadyForSwitch"
        ref="localVideoPip"
        class="rtc-call-local"
        :class="{ 'rtc-call-local--main': isVideoSwapped }"
        :style="isVideoSwapped ? undefined : pipStyle"
        autoplay
        muted
        playsinline
        @canplay="markLocalVideoReady"
        @playing="markLocalVideoReady"
        @pointerdown.stop="beginPipDrag($event, 'local')"
        @click.stop="toggleVideoLayout('local')"
      />

      <div
        v-show="frozen"
        class="rtc-call-local rtc-call-frozen"
        :class="{
          'rtc-call-local--main': !frozenWithPip || isVideoSwapped,
          'rtc-call-local--camera-off': frozenCameraOff,
        }"
        :style="frozenWithPip && !isVideoSwapped ? pipStyle : undefined"
      >
        <canvas v-show="!frozenCameraOff" ref="localFrozenCanvas" />
        <img
          v-if="frozenCameraOff"
          :src="publicAssetUrl('video/CameraTurnedOff.svg')"
          alt="摄像头已关闭"
          class="rtc-call-camera-off-icon"
        />
      </div>
      <canvas
        v-show="frozen && frozenWithPip && !frozenRemoteCameraOff"
        ref="remoteFrozenCanvas"
        class="rtc-call-remote rtc-call-remote--ready rtc-call-frozen"
        :class="{ 'rtc-call-remote--pip': isVideoSwapped }"
        :style="isVideoSwapped ? pipStyle : undefined"
      />

      <!-- 顶部标题栏/窗口操作区 -->
      <div class="rtc-call-header" @pointerdown="beginDrag">
        <div v-if="standalone" class="rtc-call-titlebar-group">
          <button
            type="button"
            class="rtc-call-title-button rtc-call-title-button--pin"
            :class="{ 'rtc-call-title-button--active': pinned }"
            :disabled="isTerminal"
            :aria-label="pinned ? '取消置顶' : '置顶'"
            :title="pinned ? '取消置顶' : '置顶'"
            @click.stop="emit('togglePin')"
          >
            <el-icon :size="17"><PinIcon /></el-icon>
          </button>
          <button
            type="button"
            class="rtc-call-title-button"
            :disabled="isTerminal"
            aria-label="邀请通话成员"
            title="邀请成员"
            @click.stop="emit('invite')"
          >
            <el-icon :size="18"><Plus /></el-icon>
          </button>
        </div>
        <span v-if="standalone && isConnected" class="rtc-call-duration">
          {{ callDuration || '00:00' }}
        </span>
        <div
          v-if="standalone"
          class="rtc-call-titlebar-group rtc-call-titlebar-group--right"
        >
          <button
            type="button"
            class="rtc-call-title-button"
            :disabled="isTerminal"
            aria-label="最小化视频通话窗口"
            title="最小化"
            @click.stop="emit('minimize')"
          >
            <el-icon :size="17"><Minus /></el-icon>
          </button>
          <button
            type="button"
            class="rtc-call-title-button"
            :aria-label="maximized ? '还原视频通话窗口' : '最大化视频通话窗口'"
            :title="maximized ? '还原' : '最大化'"
            :disabled="isTerminal"
            @click.stop="emit('maximize')"
          >
            <el-icon :size="16"><FullScreen /></el-icon>
          </button>
          <button
            type="button"
            class="rtc-call-title-button rtc-call-title-button--close"
            :disabled="isTerminal"
            aria-label="挂断并关闭视频通话窗口"
            title="挂断并关闭"
            @click.stop="emit('close')"
          >
            <el-icon :size="17"><Close /></el-icon>
          </button>
        </div>
      </div>

      <!-- 呼叫中状态：对方头像、昵称与带动态点跳动的提示 -->
      <div v-if="!isConnected && !isTerminal" class="rtc-call-peer-info">
        <div class="rtc-call-avatar-wrapper">
          <img
            v-if="peerAvatar"
            :src="peerAvatar"
            :alt="peerName || '对方头像'"
            class="rtc-call-avatar"
          />
          <div v-else class="rtc-call-avatar-placeholder">
            {{ (peerName || '对方').slice(0, 1) }}
          </div>
        </div>
        <div class="rtc-call-peer-name">{{ peerName || '对方' }}</div>
        <div class="rtc-call-peer-status">
          <span>{{ statusText }}</span>
          <span v-if="!isTerminal" class="rtc-call-dots">{{ dots }}</span>
        </div>
      </div>

      <p v-if="error" class="rtc-call-error" role="alert">{{ error }}</p>

      <!-- 底部通话控制栏（麦克风、扬声器喇叭、摄像头） -->
      <p v-if="terminalMessage" class="rtc-call-terminal-message">
        {{ terminalMessage }}
      </p>

      <div v-if="call" class="rtc-call-controls">
        <!-- 麦克风 -->
        <button
          ref="microphoneButton"
          data-rtc-microphone-button
          type="button"
          class="rtc-call-control"
          :class="{ 'rtc-call-control--off': !microphoneEnabled }"
          :disabled="busy || microphoneBusy || isTerminal"
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
          <span class="rtc-call-control-icon">
            <el-icon v-if="microphoneEnabled" :size="26"
              ><Microphone
            /></el-icon>
            <img
              v-else
              :src="publicAssetUrl('video/MicrophoneTurnedOff.svg')"
              alt="麦克风已关闭"
              class="rtc-call-control-image rtc-call-control-image--microphone-off"
            />
          </span>
          <span>{{ microphoneEnabled ? '麦克风已开' : '麦克风已关' }}</span>
        </button>

        <!-- 扬声器：还原为图片中的小喇叭样式 -->
        <button
          ref="speakerButton"
          data-rtc-speaker-button
          type="button"
          class="rtc-call-control"
          :class="{ 'rtc-call-control--off': !speakerEnabled }"
          :disabled="busy || speakerBusy || isTerminal"
          :aria-pressed="speakerEnabled"
          :aria-expanded="speakerMenuVisible"
          aria-haspopup="dialog"
          :aria-label="speakerEnabled ? '关闭扬声器' : '打开扬声器'"
          @mouseenter="showSpeakerMenu(false)"
          @mouseleave="emit('leaveSpeakerMenu')"
          @blur="emit('leaveSpeakerMenu')"
          @keydown.down.prevent.stop="showSpeakerMenu(true)"
          @keydown.up.prevent.stop="showSpeakerMenu(true)"
          @keydown.esc.stop="emit('hideSpeakerMenu')"
          @click.stop="emit('toggleSpeaker')"
        >
          <span class="rtc-call-control-icon">
            <RtcSpeakerIcon class="custom-icon" :enabled="speakerEnabled" />
          </span>
          <span>{{ speakerEnabled ? '扬声器已开' : '扬声器已关' }}</span>
        </button>

        <!-- 摄像头 -->
        <button
          ref="cameraButton"
          data-rtc-camera-button
          type="button"
          class="rtc-call-control"
          :class="{ 'rtc-call-control--off': !cameraEnabled }"
          :disabled="busy || cameraBusy || isTerminal"
          :aria-pressed="cameraEnabled"
          :aria-expanded="cameraMenuVisible"
          aria-haspopup="dialog"
          :aria-label="cameraEnabled ? '关闭摄像头' : '打开摄像头'"
          @mouseenter="showCameraMenu(false)"
          @mouseleave="emit('leaveCameraMenu')"
          @blur="emit('leaveCameraMenu')"
          @keydown.down.prevent.stop="showCameraMenu(true)"
          @keydown.up.prevent.stop="showCameraMenu(true)"
          @keydown.esc.stop="emit('hideCameraMenu')"
          @click.stop="emit('toggleCamera')"
        >
          <span class="rtc-call-control-icon">
            <el-icon v-if="cameraEnabled" :size="26">
              <VideoCamera />
            </el-icon>
            <img
              v-else
              :src="publicAssetUrl('video/CameraTurnedOff.svg')"
              alt="Camera turned off"
              class="rtc-call-control-image rtc-call-control-image--camera-off"
            />
          </span>
          <span>{{ cameraEnabled ? '摄像头已开' : '摄像头已关' }}</span>
        </button>
      </div>

      <!-- 呼叫方振铃阶段：红色居中圆润挂断/取消按钮 -->
      <button
        v-if="isRinging"
        type="button"
        class="rtc-call-hangup"
        :disabled="ending"
        title="取消通话"
        @click.stop="emit('cancel')"
      >
        <img
          class="hangup-image"
          :src="publicAssetUrl('video/HangUp.svg')"
          alt=""
          aria-hidden="true"
        />
      </button>

      <!-- 已接通阶段：挂断按钮 -->
      <button
        v-else-if="isConnected"
        type="button"
        class="rtc-call-hangup"
        :disabled="ending"
        title="挂断通话"
        @click.stop="emit('hangup')"
      >
        <img
          class="hangup-image"
          :src="publicAssetUrl('video/HangUp.svg')"
          alt=""
          aria-hidden="true"
        />
      </button>

      <!-- 被叫方来电状态：接听 / 拒绝 -->
      <div v-else-if="isIncoming" class="rtc-call-actions">
        <button
          type="button"
          class="rtc-call-action rtc-call-action--reject"
          :disabled="ending"
          title="拒绝视频通话"
          aria-label="拒绝视频通话"
          @click.stop="emit('reject')"
        >
          <img
            class="rtc-call-action-image"
            :src="publicAssetUrl('video/HangUp.svg')"
            alt=""
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          class="rtc-call-action rtc-call-action--accept"
          :disabled="busy"
          title="接听视频通话"
          aria-label="接听视频通话"
          @click.stop="emit('accept')"
        >
          <img
            class="rtc-call-action-image"
            :src="publicAssetUrl('video/AnsweringCall.svg')"
            alt=""
            aria-hidden="true"
          />
        </button>
      </div>
    </div>

    <button
      v-if="!standalone"
      type="button"
      class="rtc-call-resize"
      aria-label="调整视频通话窗口大小"
      title="调整窗口大小"
      @pointerdown.stop="beginResize"
    />
  </section>
</template>

<script setup lang="ts">
import { publicAssetUrl } from '../../../services/runtime/public-assets';
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
  Minus,
  Microphone,
  Plus,
  VideoCamera,
} from '@element-plus/icons-vue';
import { type RtcCallView, RtcCallState } from '../../../../shared/rtc/rtc';
import type { RtcMicrophoneAnchor } from '../../../../shared/rtc/rtc-microphone';
import type { RtcSpeakerOutput } from '../services/rtc-speaker-output';
import PinIcon from '../../../components/icons/PinIcon.vue';
import RtcSpeakerIcon from '../../../components/icons/RtcSpeakerIcon.vue';

const DEFAULT_PANEL_WIDTH = 340;
const MIN_PANEL_WIDTH = 240;
const PANEL_ASPECT_RATIO = 9 / 16;
const PIP_WIDTH = 90;
const PIP_HEIGHT = 135;
const PIP_WIDTH_RATIO = PIP_WIDTH / DEFAULT_PANEL_WIDTH;
const PIP_ASPECT_RATIO = PIP_WIDTH / PIP_HEIGHT;
const PIP_MARGIN = 12;
const PIP_TOP = 54;

type PanelInteractionMode = 'drag' | 'resize' | 'pip-drag';
type VideoPipSource = 'local' | 'remote';

interface PanelInteraction {
  mode: PanelInteractionMode;
  pointerId: number;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startPipLeft: number;
  startPipTop: number;
  moved: boolean;
}

const props = defineProps<{
  call: RtcCallView | null;
  currentUserId: string;
  peerName?: string;
  peerAvatar?: string;
  terminalMessage?: string;
  localTrack: MediaStreamTrack | null;
  remoteTracks: MediaStreamTrack[];
  remoteCameraEnabled?: boolean;
  connected: boolean;
  busy: boolean;
  ending?: boolean;
  error: string;
  microphoneEnabled: boolean;
  microphoneBusy: boolean;
  microphoneMenuVisible: boolean;
  cameraEnabled: boolean;
  cameraBusy: boolean;
  cameraMenuVisible: boolean;
  speakerEnabled: boolean;
  speakerBusy: boolean;
  speakerMenuVisible: boolean;
  speakerOutput: RtcSpeakerOutput;
  standalone?: boolean;
  callDuration?: string;
  pinned?: boolean;
  maximized?: boolean;
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
  dismiss: [];
  togglePin: [];
  invite: [];
  minimize: [];
  maximize: [];
  close: [];
}>();

const panel = ref<HTMLElement>();
const microphoneButton = ref<HTMLButtonElement>();
const speakerButton = ref<HTMLButtonElement>();
const cameraButton = ref<HTMLButtonElement>();

/** 摄像头菜单复用音频按钮的悬浮和键盘定位方式。 */
const showCameraMenu = (focus: boolean): void => {
  if (props.busy || props.cameraBusy || isTerminal.value || !cameraButton.value)
    return;
  const { x, y, width, height } = cameraButton.value.getBoundingClientRect();
  emit('showCameraMenu', { x, y, width, height }, focus);
};

/** 按扬声器按钮的实际位置显示其独立预热菜单。 */
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

/** 只提交按钮的视口位置，主进程负责显示已预热的原生菜单。 */
const showMicrophoneMenu = (focus: boolean): void => {
  if (props.busy || isTerminal.value || !microphoneButton.value) return;
  const { x, y, width, height } =
    microphoneButton.value.getBoundingClientRect();
  emit('showMicrophoneMenu', { x, y, width, height }, focus);
};
const localVideoBg = ref<HTMLVideoElement>();
const localVideoPip = ref<HTMLVideoElement>();
const remoteVideo = ref<HTMLVideoElement>();
const localFrozenCanvas = ref<HTMLCanvasElement>();
const remoteFrozenCanvas = ref<HTMLCanvasElement>();
const frozen = ref(false);
const frozenWithPip = ref(false);
const frozenCameraOff = ref(false);
const frozenRemoteCameraOff = ref(false);
let lastLayoutWithPip = false;
let lastCameraOff = false;
const remoteVideoReady = ref(false);
const localVideoReady = ref(false);
const videoLayoutEstablished = ref(false);
let remoteVideoFramePending = false;
let localVideoFramePending = false;
let localVideoStream: MediaStream | null = null;
let localVideoStreamTrack: MediaStreamTrack | null = null;
let remoteVideoStream: MediaStream | null = null;
let remoteVideoStreamTracks: MediaStreamTrack[] = [];
const panelWidth = ref(DEFAULT_PANEL_WIDTH);
const panelLeft = ref(0);
const panelTop = ref(20);
const pipLeft = ref(0);
const pipTop = ref(PIP_TOP);
const pipWidth = ref(PIP_WIDTH);
const pipHeight = ref(PIP_HEIGHT);
const pipLeftRatio = ref(1);
const pipTopRatio = ref(0);
const isVideoSwapped = ref(false);
let panelInitialized = false;
let pipInitialized = false;
let interaction: PanelInteraction | undefined;
let suppressPipClick = false;
let lastPipWidth = 0;
let lastPipHeight = 0;
let panelObserver: ResizeObserver | undefined;

// 动态三点跳动（. -> .. -> ... -> .）
const dots = ref('.');
let dotsInterval: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  dotsInterval = setInterval(() => {
    dots.value = dots.value.length >= 3 ? '.' : dots.value + '.';
  }, 480);
});

onBeforeUnmount(() => {
  if (dotsInterval) clearInterval(dotsInterval);
});

const isIncoming = computed(
  (): boolean =>
    props.call?.calleeUid === props.currentUserId &&
    props.call.state === RtcCallState.RINGING,
);

const isRinging = computed(
  (): boolean =>
    props.call?.callerUid === props.currentUserId &&
    props.call?.state === RtcCallState.RINGING,
);

const isConnected = computed(
  (): boolean =>
    props.connected ||
    props.call?.state === RtcCallState.ACCEPTED ||
    props.call?.state === RtcCallState.CONNECTED,
);

const hasRemoteMedia = computed((): boolean => props.remoteTracks.length > 0);

const localVideoReadyForSwitch = computed(
  (): boolean =>
    !props.cameraEnabled || !props.localTrack || localVideoReady.value,
);

const mediaReadyForSwitch = computed(
  (): boolean =>
    videoLayoutEstablished.value ||
    props.remoteCameraEnabled === false ||
    (remoteVideoReady.value && localVideoReadyForSwitch.value),
);

// 首次就绪后固定双画面布局；暂停输出、换轨及等待新帧不再切回本机全屏。
watch(
  [
    () => props.call?.callId,
    remoteVideoReady,
    localVideoReadyForSwitch,
    () => props.remoteCameraEnabled,
  ],
  ([_callId, remoteReady, localReady, cameraEnabled]): void => {
    if (cameraEnabled === false || (remoteReady && localReady))
      videoLayoutEstablished.value = true;
  },
  { immediate: true, flush: 'post' },
);

const isTerminal = computed((): boolean => {
  switch (props.call?.state) {
    case RtcCallState.REJECTED:
    case RtcCallState.CANCELED:
    case RtcCallState.ENDED:
    case RtcCallState.EXPIRED:
      return true;
    default:
      return false;
  }
});

const statusText = computed((): string => {
  if (props.call?.state === RtcCallState.EXPIRED) return '对方无响应';
  if (isTerminal.value) return '通话已结束';
  if (isIncoming.value) return '邀请你进行视频通话';
  return '等待对方接受邀请';
});

const panelStyle = computed<Record<string, string>>(() => ({
  width: props.standalone
    ? `min(100cqw, calc(100cqh * ${PANEL_ASPECT_RATIO}))`
    : `${panelWidth.value}px`,
  height: props.standalone
    ? `min(100cqh, calc(100cqw / ${PANEL_ASPECT_RATIO}))`
    : `${panelWidth.value / PANEL_ASPECT_RATIO}px`,
  left: props.standalone ? '50%' : `${panelLeft.value}px`,
  top: props.standalone ? '50%' : `${panelTop.value}px`,
  '--rtc-pip-width': `${pipWidth.value}px`,
  '--rtc-pip-height': `${pipHeight.value}px`,
}));

const pipStyle = computed<Record<string, string>>(() => ({
  left: `${pipLeft.value}px`,
  top: `${pipTop.value}px`,
}));

const getPanelHost = (): HTMLElement | null =>
  panel.value?.parentElement ?? null;

/** 小窗按视频区域缩放，独立窗口的拖动范围包含外围黑色留边。 */
const getPipMetrics = (): {
  width: number;
  height: number;
  minLeft: number;
  minTop: number;
  maxLeft: number;
  maxTop: number;
} | null => {
  const host = panel.value;
  if (!host || host.clientWidth <= 0 || host.clientHeight <= 0) return null;
  const width = Math.min(
    host.clientWidth * PIP_WIDTH_RATIO,
    host.clientHeight * PIP_ASPECT_RATIO,
  );
  const height = width / PIP_ASPECT_RATIO;
  const boundary = props.standalone ? (host.parentElement ?? host) : host;
  const hostRect = host.getBoundingClientRect();
  const boundaryRect = boundary.getBoundingClientRect();
  const minLeft = boundaryRect.left + boundary.clientLeft - hostRect.left;
  const minTop = boundaryRect.top + boundary.clientTop - hostRect.top;
  return {
    width,
    height,
    minLeft,
    minTop,
    maxLeft: minLeft + Math.max(0, boundary.clientWidth - width),
    maxTop: minTop + Math.max(0, boundary.clientHeight - height),
  };
};

/** 记录在整个可拖动范围中的相对位置，供窗口缩放后恢复。 */
const rememberPipPosition = (): void => {
  const metrics = getPipMetrics();
  if (!metrics) return;
  const horizontalRange = metrics.maxLeft - metrics.minLeft;
  const verticalRange = metrics.maxTop - metrics.minTop;
  pipLeftRatio.value =
    horizontalRange > 0
      ? (pipLeft.value - metrics.minLeft) / horizontalRange
      : 1;
  pipTopRatio.value =
    verticalRange > 0 ? (pipTop.value - metrics.minTop) / verticalRange : 0;
};

/** 将小窗完整限制在可见窗口内部。 */
const clampPipPosition = (): void => {
  const metrics = getPipMetrics();
  if (!metrics) return;
  pipLeft.value = Math.min(
    Math.max(pipLeft.value, metrics.minLeft),
    metrics.maxLeft,
  );
  pipTop.value = Math.min(
    Math.max(pipTop.value, metrics.minTop),
    metrics.maxTop,
  );
};

/** 同步小窗的明确宽高，防止视频固有尺寸改变窗口比例。 */
const fitPipToHost = (): void => {
  const metrics = getPipMetrics();
  if (!metrics) return;
  pipWidth.value = metrics.width;
  pipHeight.value = metrics.height;
  if (!pipInitialized) {
    pipLeft.value = Math.max(
      0,
      (panel.value?.clientWidth ?? metrics.width) - metrics.width - PIP_MARGIN,
    );
    pipTop.value = Math.min(PIP_TOP, metrics.maxTop);
    pipInitialized = true;
  } else if (lastPipWidth > 0 && lastPipHeight > 0) {
    pipLeft.value =
      metrics.minLeft +
      pipLeftRatio.value * (metrics.maxLeft - metrics.minLeft);
    pipTop.value =
      metrics.minTop + pipTopRatio.value * (metrics.maxTop - metrics.minTop);
  }
  clampPipPosition();
  rememberPipPosition();
  lastPipWidth = metrics.width;
  lastPipHeight = metrics.height;
};

const clampPanelPosition = (): void => {
  const host = getPanelHost();
  if (!host) return;
  const panelHeight = panelWidth.value / PANEL_ASPECT_RATIO;
  const maxLeft = Math.max(0, host.clientWidth - panelWidth.value);
  const maxTop = Math.max(0, host.clientHeight - panelHeight);
  panelLeft.value = Math.min(Math.max(panelLeft.value, 0), maxLeft);
  panelTop.value = Math.min(Math.max(panelTop.value, 0), maxTop);
  clampPipPosition();
};

const getMaxPanelWidth = (): number => {
  const host = getPanelHost();
  if (!host) return DEFAULT_PANEL_WIDTH;
  const widthLimit = Math.max(MIN_PANEL_WIDTH, host.clientWidth - 24);
  const heightLimit = Math.max(
    MIN_PANEL_WIDTH,
    (host.clientHeight - 24) * PANEL_ASPECT_RATIO,
  );
  return Math.max(MIN_PANEL_WIDTH, Math.min(widthLimit, heightLimit));
};

const fitPanelToHost = (): void => {
  fitPipToHost();
  if (props.standalone) return;
  const maxWidth = getMaxPanelWidth();
  panelWidth.value = Math.min(panelWidth.value, maxWidth);
  if (!panelInitialized) {
    panelWidth.value = Math.min(DEFAULT_PANEL_WIDTH, maxWidth);
    const host = getPanelHost();
    panelLeft.value = Math.max(
      12,
      (host?.clientWidth ?? panelWidth.value) - panelWidth.value - 18,
    );
    panelTop.value = 20;
    panelInitialized = true;
  }
  clampPanelPosition();
};

const stopPanelInteraction = (): void => {
  const current = interaction;
  interaction = undefined;
  if (current?.mode === 'pip-drag') {
    rememberPipPosition();
    suppressPipClick = current.moved;
  }
  window.removeEventListener('pointermove', handlePanelPointerMove);
  window.removeEventListener('pointerup', stopPanelInteraction);
  window.removeEventListener('pointercancel', stopPanelInteraction);
};

const handlePanelPointerMove = (event: PointerEvent): void => {
  if (!interaction || event.pointerId !== interaction.pointerId) return;
  const current = interaction;
  if (current.mode === 'pip-drag') {
    const deltaX = event.clientX - current.startX;
    const deltaY = event.clientY - current.startY;
    if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) current.moved = true;
    pipLeft.value = current.startPipLeft + deltaX;
    pipTop.value = current.startPipTop + deltaY;
    clampPipPosition();
    rememberPipPosition();
    return;
  }
  if (current.mode === 'drag') {
    panelLeft.value = current.startLeft + event.clientX - current.startX;
    panelTop.value = current.startTop + event.clientY - current.startY;
    clampPanelPosition();
    return;
  }
  const requestedWidth = current.startWidth + event.clientX - current.startX;
  panelWidth.value = Math.min(
    Math.max(MIN_PANEL_WIDTH, requestedWidth),
    getMaxPanelWidth(),
  );
  clampPanelPosition();
};

const beginDrag = (event: PointerEvent): void => {
  if (props.standalone || event.button !== 0 || !panel.value) return;
  interaction = {
    mode: 'drag',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: panelLeft.value,
    startTop: panelTop.value,
    startWidth: panelWidth.value,
    startPipLeft: pipLeft.value,
    startPipTop: pipTop.value,
    moved: false,
  };
  window.addEventListener('pointermove', handlePanelPointerMove);
  window.addEventListener('pointerup', stopPanelInteraction);
  window.addEventListener('pointercancel', stopPanelInteraction);
  event.preventDefault();
};

const beginResize = (event: PointerEvent): void => {
  if (props.standalone || event.button !== 0 || !panel.value) return;
  interaction = {
    mode: 'resize',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: panelLeft.value,
    startTop: panelTop.value,
    startWidth: panelWidth.value,
    startPipLeft: pipLeft.value,
    startPipTop: pipTop.value,
    moved: false,
  };
  window.addEventListener('pointermove', handlePanelPointerMove);
  window.addEventListener('pointerup', stopPanelInteraction);
  window.addEventListener('pointercancel', stopPanelInteraction);
  event.preventDefault();
};

/** 在通话面板内部拖动画中画小窗口。 */
const beginPipDrag = (event: PointerEvent, source: VideoPipSource): void => {
  if (frozen.value || isTerminal.value) return;
  const sourceIsRemote = source === 'remote';
  if (
    event.button !== 0 ||
    !panel.value ||
    !isConnected.value ||
    !mediaReadyForSwitch.value ||
    sourceIsRemote !== isVideoSwapped.value
  )
    return;
  suppressPipClick = false;
  interaction = {
    mode: 'pip-drag',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: panelLeft.value,
    startTop: panelTop.value,
    startWidth: panelWidth.value,
    startPipLeft: pipLeft.value,
    startPipTop: pipTop.value,
    moved: false,
  };
  window.addEventListener('pointermove', handlePanelPointerMove);
  window.addEventListener('pointerup', stopPanelInteraction);
  window.addEventListener('pointercancel', stopPanelInteraction);
  event.preventDefault();
};

/** 点击当前画中画后交换本地与远端视频的位置。 */
const toggleVideoLayout = (source: VideoPipSource): void => {
  if (frozen.value || isTerminal.value) return;
  const sourceIsRemote = source === 'remote';
  if (sourceIsRemote !== isVideoSwapped.value) return;
  if (suppressPipClick) {
    suppressPipClick = false;
    return;
  }
  isVideoSwapped.value = !isVideoSwapped.value;
};

/** 在本地视频具备可显示帧后允许切换画面布局。*/
const markLocalVideoReady = (): void => {
  const video = localVideoBg.value ?? localVideoPip.value;
  if (
    !video ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    localVideoFramePending
  )
    return;
  const stream = video.srcObject;
  const finish = (): void => {
    localVideoFramePending = false;
    if (
      (localVideoBg.value === video || localVideoPip.value === video) &&
      video.srcObject === stream &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    )
      localVideoReady.value = true;
  };
  localVideoFramePending = true;
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => finish());
    return;
  }
  requestAnimationFrame(finish);
};

/** 在远端视频具备可显示帧后切换主画面。*/
const markRemoteVideoReady = (): void => {
  const video = remoteVideo.value;
  if (
    !video ||
    props.remoteCameraEnabled === false ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    remoteVideoFramePending
  )
    return;
  const stream = video.srcObject;
  const finish = (): void => {
    remoteVideoFramePending = false;
    if (
      remoteVideo.value === video &&
      props.remoteCameraEnabled !== false &&
      video.srcObject === stream &&
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    )
      remoteVideoReady.value = true;
  };
  remoteVideoFramePending = true;
  if (typeof video.requestVideoFrameCallback === 'function') {
    video.requestVideoFrameCallback(() => finish());
    return;
  }
  requestAnimationFrame(finish);
};

/** 缓存本地视频流，避免接通时重新创建并绑定媒体流。*/
const getLocalVideoStream = (): MediaStream | null => {
  const track = props.localTrack;
  if (!track) {
    localVideoStream = null;
    localVideoStreamTrack = null;
    return null;
  }
  if (localVideoStreamTrack !== track || !localVideoStream) {
    localVideoStream = new MediaStream([track]);
    localVideoStreamTrack = track;
  }
  return localVideoStream;
};

/** 缓存远端视频流，仅在远端轨道集合变化时重新创建。*/
const getRemoteVideoStream = (): MediaStream | null => {
  const tracks = props.remoteTracks;
  const tracksChanged =
    tracks.length !== remoteVideoStreamTracks.length ||
    tracks.some((track, index) => remoteVideoStreamTracks[index] !== track);
  if (tracksChanged) {
    remoteVideoStream = tracks.length ? new MediaStream(tracks) : null;
    remoteVideoStreamTracks = [...tracks];
  }
  return remoteVideoStream;
};

/** 将本地和远端媒体轨道绑定到当前视频元素。*/
const attachTracks = async (): Promise<void> => {
  await nextTick();
  const localStream = getLocalVideoStream();
  if (localVideoBg.value && localVideoBg.value.srcObject !== localStream) {
    localVideoBg.value.srcObject = localStream;
  }
  if (localVideoPip.value && localVideoPip.value.srcObject !== localStream) {
    localVideoPip.value.srcObject = localStream;
  }
  const remoteStream = getRemoteVideoStream();
  let remoteStreamChanged = false;
  if (remoteVideo.value && remoteVideo.value.srcObject !== remoteStream) {
    remoteVideo.value.srcObject = remoteStream;
    remoteStreamChanged = true;
    remoteVideoReady.value = false;
    remoteVideoFramePending = false;
  }
  if (!remoteStreamChanged) markRemoteVideoReady();
};

/** 缓存最近一帧并限制内存尺寸，轨道提前断开时保留已绘制内容。 */
const cacheVideoFrame = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement | undefined,
): void => {
  if (
    !canvas ||
    frozen.value ||
    video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
    !video.videoWidth ||
    !video.videoHeight
  )
    return;
  if (
    !(video.srcObject instanceof MediaStream) ||
    !video.srcObject
      .getVideoTracks()
      .some((track) => track.readyState === 'live')
  )
    return;
  const scale = Math.min(
    1,
    1280 / Math.max(video.videoWidth, video.videoHeight),
  );
  const width = Math.max(1, Math.round(video.videoWidth * scale));
  const height = Math.max(1, Math.round(video.videoHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  try {
    context.drawImage(video, 0, 0, width, height);
  } catch {
    // 解码器可能正在释放；截帧失败不能阻断挂断和媒体清理。
  }
};

/** 在父页面清空轨道前同步冻结，画布不依赖即将释放的媒体流。 */
const freezeVideo = (): void => {
  if (frozen.value) return;
  const local = localVideoPip.value?.checkVisibility()
    ? localVideoPip.value
    : localVideoBg.value;
  if (local) cacheVideoFrame(local, localFrozenCanvas.value);
  if (remoteVideo.value)
    cacheVideoFrame(remoteVideo.value, remoteFrozenCanvas.value);
  frozenWithPip.value = lastLayoutWithPip;
  frozenCameraOff.value = lastCameraOff;
  frozenRemoteCameraOff.value = props.remoteCameraEnabled === false;
  frozen.value = true;
  stopPanelInteraction();
};

defineExpose({ freezeVideo });

watch(
  () => props.call?.callId,
  () => {
    frozen.value = false;
    remoteVideoReady.value = false;
    localVideoReady.value = false;
    videoLayoutEstablished.value = false;
    lastLayoutWithPip = false;
    lastCameraOff = !props.cameraEnabled;
    for (const canvas of [localFrozenCanvas.value, remoteFrozenCanvas.value]) {
      if (canvas) canvas.width = 0;
    }
  },
);

watch(
  [localVideoBg, localVideoPip, remoteVideo],
  (videos, _previous, onCleanup) => {
    const callbacks = new Map<HTMLVideoElement, number>();
    /** 按实际呈现帧更新缓存，不编码图片或保存视频历史。 */
    const sample = (video: HTMLVideoElement): void => {
      if (frozen.value) return;
      if (video.checkVisibility()) {
        cacheVideoFrame(
          video,
          video === remoteVideo.value
            ? remoteFrozenCanvas.value
            : localFrozenCanvas.value,
        );
      }
      callbacks.set(
        video,
        video.requestVideoFrameCallback(() => sample(video)),
      );
    };
    for (const video of videos) {
      if (video) sample(video);
    }
    onCleanup(() => {
      for (const [video, id] of callbacks) video.cancelVideoFrameCallback(id);
    });
  },
  { flush: 'post' },
);

watch(
  [mediaReadyForSwitch, isConnected, () => props.cameraEnabled],
  () => {
    if (frozen.value || isTerminal.value) return;
    if (isConnected.value && mediaReadyForSwitch.value)
      lastLayoutWithPip = true;
    lastCameraOff = !props.cameraEnabled;
  },
  { flush: 'post' },
);

const handleWindowResize = (): void => {
  if (props.call) fitPanelToHost();
};

watch(
  () => [
    props.localTrack,
    props.remoteTracks,
    props.call?.mediaMode,
    props.cameraEnabled,
    isConnected.value,
  ],
  () => {
    void attachTracks();
  },
  { immediate: true },
);

watch(
  [remoteVideo, () => props.speakerOutput],
  ([element, output], _previous, onCleanup) => {
    if (element) onCleanup(output.bind(element));
  },
  { flush: 'post' },
);

watch(
  () => isConnected.value,
  () => {
    remoteVideoReady.value = false;
  },
);

watch(
  () => props.localTrack,
  (track) => {
    localVideoReady.value = track === null;
    localVideoFramePending = false;
  },
  { immediate: true },
);

watch(
  () => props.remoteTracks,
  () => {
    remoteVideoReady.value = false;
  },
);

watch(
  () => panelWidth.value,
  () => {
    void nextTick(fitPipToHost);
  },
);

watch(
  () => props.call,
  (call) => {
    if (!call) {
      isVideoSwapped.value = false;
      pipInitialized = false;
      pipLeftRatio.value = 1;
      pipTopRatio.value = 0;
      lastPipWidth = 0;
      lastPipHeight = 0;
      return;
    }
    void nextTick(fitPanelToHost);
  },
  { immediate: true },
);

watch(
  panel,
  (element) => {
    panelObserver?.disconnect();
    if (!element) return;
    panelObserver = new ResizeObserver(() => fitPipToHost());
    panelObserver.observe(element);
    if (props.standalone && element.parentElement)
      panelObserver.observe(element.parentElement);
    fitPipToHost();
  },
  { flush: 'post' },
);

onMounted(() => window.addEventListener('resize', handleWindowResize));
onBeforeUnmount(() => {
  panelObserver?.disconnect();
  stopPanelInteraction();
  window.removeEventListener('resize', handleWindowResize);
});
</script>

<style scoped>
.rtc-call-panel {
  /* 小窗尺寸由 panelStyle 按视频区域实时计算并以内联样式覆盖，此处提供默认声明 */
  --rtc-pip-width: 90px;
  --rtc-pip-height: 135px;
  position: absolute;
  z-index: 12;
  box-sizing: border-box;
  min-width: 240px;
  min-height: 426px;
  overflow: hidden;
  border-radius: 8px;
  background: #000;
  box-shadow: 0 16px 40px rgb(0 0 0 / 40%);
  color: #fff;
  user-select: none;
  touch-action: none;
}
.rtc-call-panel--standalone {
  overflow: visible;
  transform: translate(-50%, -50%);
  min-width: 0;
  min-height: 0;
  border-radius: 0;
  box-shadow: none;
}
.rtc-call-stage {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #000;
}
.rtc-call-panel--standalone .rtc-call-stage {
  overflow: visible;
}

/* 背景摄像头画面 */
.rtc-call-background-video {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
  transform: scaleX(-1);
}

/* 接通后的远端画面 */
.rtc-call-remote {
  position: absolute;
  z-index: 1;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  background: #000;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}
.rtc-call-remote--pip {
  inset: auto;
  z-index: 4;
  width: var(--rtc-pip-width);
  height: var(--rtc-pip-height);
  box-sizing: border-box;
  aspect-ratio: 2 / 3;
  background: #000;
  object-fit: cover;
  opacity: 1;
  border: 1px solid rgb(255 255 255 / 20%);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgb(0 0 0 / 40%);
  cursor: grab;
  pointer-events: auto;
}
.rtc-call-remote--pip:active {
  cursor: grabbing;
}
.rtc-call-remote--ready {
  opacity: 1;
}

.rtc-call-placeholder {
  display: grid;
  place-items: center;
  align-content: center;
  width: 100%;
  height: 100%;
  color: #636773;
  background: #1c1d22;
}
.rtc-call-camera-off-icon {
  display: block;
  width: 48px;
  height: 48px;
  filter: invert(1);
  opacity: 0.8;
}
.rtc-call-remote-camera-off {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 12px;
  box-sizing: border-box;
  color: #e4e7ed;
  background: #1c1d22;
  font-size: 14px;
  text-align: center;
}
.rtc-call-remote-camera-off.rtc-call-remote--pip {
  gap: 8px;
  font-size: 12px;
}

/* 顶部操作栏 */
.rtc-call-header {
  position: absolute;
  z-index: 5;
  inset: 0 0 auto;
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 44px;
  padding: 0 12px;
  background: linear-gradient(rgb(0 0 0 / 40%), transparent);
  cursor: grab;
  -webkit-app-region: drag;
}
.rtc-call-header:active {
  cursor: grabbing;
}
.rtc-call-panel--standalone .rtc-call-header {
  cursor: default;
}
.rtc-call-titlebar-group {
  display: flex;
  align-items: center;
  gap: 4px;
}
.rtc-call-title-button {
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
.rtc-call-title-button:hover {
  background: rgb(255 255 255 / 20%);
}
.rtc-call-title-button:disabled {
  opacity: 0.45;
  cursor: default;
  pointer-events: none;
}
.rtc-call-title-button--pin.rtc-call-title-button--active {
  color: #07c160;
}
.rtc-call-title-button--close:hover {
  background: #e83f43;
}
.rtc-call-duration {
  font-size: 13px;
  font-weight: 500;
  text-shadow: 0 1px 4px rgb(0 0 0 / 70%);
}

/* 居中对方头像与名称展示 */
.rtc-call-peer-info {
  position: absolute;
  z-index: 4;
  top: 15%;
  left: 0;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  pointer-events: none;
}
.rtc-call-avatar-wrapper {
  width: 72px;
  height: 72px;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 18px rgb(0 0 0 / 35%);
  background: #2b2d33;
}
.rtc-call-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.rtc-call-avatar-placeholder {
  display: grid;
  place-items: center;
  width: 100%;
  height: 100%;
  color: #fff;
  font-size: 28px;
  font-weight: 600;
  background: #474a54;
}
.rtc-call-peer-name {
  margin-top: 14px;
  font-size: 16px;
  font-weight: 500;
  color: #ffffff;
  text-shadow: 0 1px 4px rgb(0 0 0 / 80%);
}
.rtc-call-peer-status {
  display: inline-flex;
  align-items: center;
  margin-top: 6px;
  font-size: 13px;
  color: #e4e7ed;
  text-shadow: 0 1px 3px rgb(0 0 0 / 80%);
}
.rtc-call-dots {
  display: inline-block;
  min-width: 16px;
  text-align: left;
}

.rtc-call-terminal-message {
  position: absolute;
  z-index: 5;
  right: 16px;
  bottom: 210px;
  left: 16px;
  margin: 0;
  color: #e4e7ed;
  font-size: 14px;
  font-weight: 500;
  text-align: center;
  text-shadow: 0 1px 4px rgb(0 0 0 / 80%);
}

/* 画中画小窗 */
.rtc-call-local {
  position: absolute;
  z-index: 4;
  top: auto;
  right: auto;
  width: var(--rtc-pip-width);
  height: var(--rtc-pip-height);
  box-sizing: border-box;
  aspect-ratio: 2 / 3;
  border-radius: 6px;
  border: 1px solid rgb(255 255 255 / 20%);
  box-shadow: 0 4px 12px rgb(0 0 0 / 40%);
  object-fit: cover;
  background: #000;
  transform: scaleX(-1);
  cursor: grab;
}
.rtc-call-local:active {
  cursor: grabbing;
}
.rtc-call-local--main {
  z-index: 1;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 0;
  box-shadow: none;
  cursor: default;
  object-fit: cover;
}
.rtc-call-local--camera-off {
  display: grid;
  place-items: center;
  background: #2b2d33;
  transform: none;
}
.rtc-call-local--camera-off .rtc-call-camera-off-icon {
  width: 42px;
  height: 42px;
}

/* 底部圆形功能按钮栏 */
.rtc-call-controls {
  position: absolute;
  z-index: 5;
  right: 16px;
  bottom: 110px;
  left: 16px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
}
.rtc-call-control {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-self: center;
  gap: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  font-size: 12px;
  text-shadow: 0 1px 4px rgb(0 0 0 / 80%);
}
.rtc-call-control-icon {
  display: grid;
  place-items: center;
  width: 56px;
  height: 56px;
  border-radius: 50%;
  background: #ffffff;
  color: #1a1a1e;
  box-shadow: 0 4px 14px rgb(0 0 0 / 25%);
  transition:
    transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    background-color 0.15s ease;
}
.rtc-call-control:active:not(:disabled) .rtc-call-control-icon {
  transform: scale(0.92);
}
.rtc-call-control--off .rtc-call-control-icon {
  background: #474a52;
  color: #ffffff;
}
.rtc-call-control:disabled {
  cursor: default;
  opacity: 0.55;
}
.custom-icon {
  display: block;
}
.rtc-call-control-image {
  display: block;
  width: 26px;
  height: 26px;
}
.rtc-call-control-image--microphone-off {
  filter: invert(1);
}
.rtc-call-control-image--camera-off {
  filter: invert(1);
}

/* 红色挂断 / 取消按钮 */
.rtc-call-hangup {
  position: absolute;
  z-index: 5;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #ffffff;
  cursor: pointer;
  box-shadow: none;
  transition:
    transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    background-color 0.15s ease;
  will-change: transform;
}
.rtc-call-hangup:hover:not(:disabled) {
  background: transparent;
}
.rtc-call-hangup:active:not(:disabled) {
  transform: translateX(-50%) scale(0.92);
}
.hangup-image {
  display: block;
  width: 60px;
  height: 60px;
}

/* 接听与拒绝 */
.rtc-call-actions {
  position: absolute;
  z-index: 5;
  right: 24px;
  bottom: 28px;
  left: 24px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  align-items: center;
}
.rtc-call-action {
  display: grid;
  place-items: center;
  width: 60px;
  height: 60px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition:
    transform 0.15s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.15s ease;
}
.rtc-call-action:hover:not(:disabled) {
  opacity: 0.88;
}
.rtc-call-action:active:not(:disabled) {
  transform: scale(0.92);
}
.rtc-call-action:disabled {
  cursor: default;
  opacity: 0.55;
}
.rtc-call-action-image {
  display: block;
  width: 60px;
  height: 60px;
}
.rtc-call-action--reject {
  grid-column: 1;
  justify-self: center;
}
.rtc-call-action--accept {
  grid-column: 3;
  justify-self: center;
}

.rtc-call-error {
  position: absolute;
  z-index: 6;
  top: 50px;
  left: 14px;
  right: 14px;
  margin: 0;
  padding: 6px 10px;
  border-radius: 4px;
  background: rgb(180 30 30 / 85%);
  color: #fff;
  font-size: 12px;
  text-align: center;
}
.rtc-call-frozen {
  pointer-events: none;
}
.rtc-call-frozen canvas {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
}
.rtc-call-resize {
  position: absolute;
  z-index: 8;
  right: 0;
  bottom: 0;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 0;
  background: transparent;
  cursor: nwse-resize;
}
</style>
