<template>
  <main class="rtc-call-window">
    <RtcAudioCallPanel
      v-if="rtcCall?.mediaMode === RtcMediaMode.AUDIO && !isGroupCall"
      :call="rtcCall"
      :current-user-id="currentUserId"
      :peer-name="peerName"
      :peer-avatar="peerAvatar"
      :terminal-message="terminalMessage"
      :connected="rtcConnected"
      :busy="rtcBusy || rtcEnding"
      :ending="rtcEnding"
      :error="rtcError || rtcMenuError || rtcCameraError"
      :microphone-enabled="rtcMicrophoneEnabled"
      :microphone-busy="rtcMicrophoneBusy"
      :microphone-menu-visible="rtcMicrophoneMenuVisible"
      :speaker-enabled="rtcSpeakerEnabled"
      :speaker-busy="rtcSpeakerBusy"
      :speaker-menu-visible="rtcSpeakerMenuVisible"
      :speaker-output="rtcSpeakerOutput"
      :call-duration="rtcCallDuration"
      :remote-tracks="rtcRemoteMediaTracks"
      :pinned="rtcPinned"
      :maximized="rtcMaximized"
      :compact="rtcCompact"
      @accept="acceptRtcCall"
      @close="closeRtcCall"
      @toggle-microphone="toggleRtcMicrophone"
      @show-microphone-menu="showRtcMicrophoneMenu"
      @leave-microphone-menu="leaveRtcMicrophoneMenu"
      @hide-microphone-menu="hideRtcMicrophoneMenu"
      @toggle-speaker="toggleRtcSpeaker"
      @show-speaker-menu="showRtcSpeakerMenu"
      @leave-speaker-menu="leaveRtcSpeakerMenu"
      @hide-speaker-menu="hideRtcSpeakerMenu"
      @playback-error="rtcError = $event"
      @toggle-pin="toggleRtcPin"
      @minimize="minimizeRtcWindow"
      @maximize="toggleRtcMaximize"
    />
    <RtcGroupCallPanel
      v-else-if="rtcCall && isGroupCall"
      :call="rtcCall"
      :current-user-id="currentUserId"
      :local-track="rtcLocalTrack"
      :remote-tracks="rtcRemoteTracks"
      :participants="rtcParticipants"
      :camera-states="rtcCameraStates"
      :profiles="rtcParticipantProfiles"
      :connected="rtcConnected"
      :busy="rtcBusy"
      :error="rtcError || rtcMenuError || rtcCameraError"
      :microphone-enabled="rtcMicrophoneEnabled"
      :microphone-busy="rtcMicrophoneBusy"
      :microphone-menu-visible="rtcMicrophoneMenuVisible"
      :camera-enabled="rtcCameraEnabled"
      :camera-busy="rtcCameraBusy"
      :camera-menu-visible="rtcCameraMenuVisible"
      :speaker-enabled="rtcSpeakerEnabled"
      :speaker-busy="rtcSpeakerBusy"
      :speaker-menu-visible="rtcSpeakerMenuVisible"
      :speaker-output="rtcSpeakerOutput"
      :call-duration="rtcCallDuration"
      :pinned="rtcPinned"
      :maximized="rtcMaximized"
      @accept="acceptRtcCall"
      @reject="rejectRtcCall"
      @cancel="cancelRtcCall"
      @hangup="hangupRtcCall"
      @toggle-microphone="toggleRtcMicrophone"
      @show-microphone-menu="showRtcMicrophoneMenu"
      @leave-microphone-menu="leaveRtcMicrophoneMenu"
      @hide-microphone-menu="hideRtcMicrophoneMenu"
      @toggle-camera="toggleRtcCamera"
      @show-camera-menu="showRtcCameraMenu"
      @leave-camera-menu="leaveRtcCameraMenu"
      @hide-camera-menu="hideRtcCameraMenu"
      @toggle-speaker="toggleRtcSpeaker"
      @show-speaker-menu="showRtcSpeakerMenu"
      @leave-speaker-menu="leaveRtcSpeakerMenu"
      @hide-speaker-menu="hideRtcSpeakerMenu"
      @toggle-pin="toggleRtcPin"
      @minimize="minimizeRtcWindow"
      @maximize="toggleRtcMaximize"
      @close="closeRtcCall"
    />
    <RtcCallPanel
      v-else-if="rtcCall"
      ref="callPanel"
      :call="rtcCall"
      :current-user-id="currentUserId"
      :peer-name="peerName"
      :peer-avatar="peerAvatar"
      :terminal-message="terminalMessage"
      :local-track="rtcLocalTrack"
      :remote-tracks="rtcRemoteMediaTracks"
      :remote-camera-enabled="rtcRemoteCameraEnabled"
      :connected="rtcConnected"
      :busy="rtcBusy || rtcEnding"
      :ending="rtcEnding"
      :error="rtcError || rtcMenuError || rtcCameraError"
      :microphone-enabled="rtcMicrophoneEnabled"
      :microphone-busy="rtcMicrophoneBusy"
      :microphone-menu-visible="rtcMicrophoneMenuVisible"
      :camera-enabled="rtcCameraEnabled"
      :camera-busy="rtcCameraBusy"
      :camera-menu-visible="rtcCameraMenuVisible"
      :speaker-enabled="rtcSpeakerEnabled"
      :speaker-busy="rtcSpeakerBusy"
      :speaker-menu-visible="rtcSpeakerMenuVisible"
      :speaker-output="rtcSpeakerOutput"
      :call-duration="rtcCallDuration"
      :pinned="rtcPinned"
      :maximized="rtcMaximized"
      standalone
      @accept="acceptRtcCall"
      @reject="rejectRtcCall"
      @cancel="cancelRtcCall"
      @hangup="hangupRtcCall"
      @toggle-microphone="toggleRtcMicrophone"
      @show-microphone-menu="showRtcMicrophoneMenu"
      @leave-microphone-menu="leaveRtcMicrophoneMenu"
      @hide-microphone-menu="hideRtcMicrophoneMenu"
      @toggle-camera="toggleRtcCamera"
      @show-camera-menu="showRtcCameraMenu"
      @leave-camera-menu="leaveRtcCameraMenu"
      @hide-camera-menu="hideRtcCameraMenu"
      @toggle-speaker="toggleRtcSpeaker"
      @show-speaker-menu="showRtcSpeakerMenu"
      @leave-speaker-menu="leaveRtcSpeakerMenu"
      @hide-speaker-menu="hideRtcSpeakerMenu"
      @dismiss="dismissRtcCall"
      @toggle-pin="toggleRtcPin"
      @invite="inviteRtcMember"
      @minimize="minimizeRtcWindow"
      @maximize="toggleRtcMaximize"
      @close="closeRtcCall"
    />
    <p v-else class="rtc-call-loading" role="status">
      {{ rtcError || '正在读取通话' }}
    </p>
  </main>
</template>

<script setup lang="ts">
import { publicAssetUrl } from '../../services/runtime/public-assets';
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import {
  type RtcCallPeer,
  type RtcCallView,
  RtcCallState,
  RtcParticipantState,
  RtcMediaMode,
} from '../../../shared/rtc/rtc';
import {
  isRtcGroupCall,
  hasRtcPendingInvitations,
  readRtcInvitationDeadline,
} from '../../../shared/rtc/rtc';
import type { ResourceSseMessage } from '../../../shared/windows/desktop';
import type {
  RtcMicrophoneAnchor,
  RtcMicrophoneCommand,
  RtcAudioMenuCommand,
  RtcCameraCommand,
} from '../../../shared/rtc/rtc-microphone';
import type { RtcApi, RtcRemoteTrack, RtcRoomParticipant } from './services';
import { createRtcClient } from './services';
import { readRtcError } from './services/rtc-error';
import {
  createRtcSpeakerOutput,
  readRtcSpeakerError,
} from './services/rtc-speaker-output';
import RtcCallPanel from './panels/RtcCallPanel.vue';
import RtcAudioCallPanel from './panels/RtcAudioCallPanel.vue';
import RtcGroupCallPanel from './panels/RtcGroupCallPanel.vue';

const desktop = window.rtcCallDesktop;
const callPanel = ref<InstanceType<typeof RtcCallPanel>>();
const currentUserId = ref('');
const peerName = ref('对方');
const peerAvatar = ref<string>();
const terminalMessage = ref('');
const rtcCall = shallowRef<RtcCallView | null>(null);
const rtcLocalTrack = shallowRef<MediaStreamTrack | null>(null);
const rtcRemoteTracks = shallowRef<RtcRemoteTrack[]>([]);
const rtcParticipants = shallowRef<RtcRoomParticipant[]>([]);
const rtcParticipantProfiles = shallowRef<Record<string, RtcCallPeer>>({});
const rtcProfileRequests = new Set<string>();
const rtcGroupContext = ref(false);
const rtcRemoteMediaTracks = computed<MediaStreamTrack[]>(() =>
  rtcRemoteTracks.value.map((item) => item.track),
);
const isGroupCall = computed(
  () => rtcGroupContext.value || isRtcGroupCall(rtcCall.value),
);
const rtcConnected = ref(false);
const rtcBusy = ref(false);
const rtcEnding = ref(false);
const rtcError = ref('');
const rtcMicrophoneEnabled = ref(true);
const rtcMicrophones = shallowRef<
  Pick<MediaDeviceInfo, 'deviceId' | 'label'>[]
>([]);
const rtcMicrophoneDeviceId = ref('default');
const rtcMicrophoneVolume = ref(100);
const rtcMicrophoneBusy = ref(false);
const rtcMicrophonesLoading = ref(false);
const rtcMicrophoneListError = ref('');
const rtcMicrophoneError = ref('');
const rtcMenuError = ref('');
const rtcMicrophoneMenuVisible = ref(false);
let microphoneListRequest = 0;
let microphoneListLoaded = false;
let microphoneResourcesDisposed = false;
const rtcCameraEnabled = ref(true);
const rtcCameraStates = shallowRef<
  Record<string, { enabled: boolean; version: number }>
>({});
/** 单聊按远端真实 UID 读取状态，尚未上报时保留媒体自身的显示逻辑。 */
const rtcRemoteCameraEnabled = computed((): boolean | undefined => {
  const peer = rtcCall.value?.participants.find(
    (participant) => participant.uid !== currentUserId.value,
  );
  return peer ? rtcCameraStates.value[peer.uid]?.enabled : undefined;
});
const rtcCameras = shallowRef<Pick<MediaDeviceInfo, 'deviceId' | 'label'>[]>(
  [],
);
const rtcCameraDeviceId = ref('default');
const rtcCameraBusy = ref(false);
const rtcCameraMenuVisible = ref(false);
const rtcCameraError = ref('');
const rtcSpeakerEnabled = ref(true);
const rtcSpeakers = shallowRef<Pick<MediaDeviceInfo, 'deviceId' | 'label'>[]>(
  [],
);
const rtcSpeakerDeviceId = ref('default');
const rtcSpeakerVolume = ref(100);
const rtcSpeakerBusy = ref(false);
const rtcSpeakerError = ref('');
const rtcSpeakerMenuVisible = ref(false);
const rtcCallDuration = ref('00:00');
const rtcPinned = ref(false);
const rtcMaximized = ref(false);
const rtcCompact = ref(false);
let rtcExpandPromise: Promise<void> | undefined;
let rtcClient: ReturnType<typeof createRtcClient> | undefined;
let unsubscribeResourceMessage: (() => void) | undefined;
let unsubscribeClosing: (() => void) | undefined;
let unsubscribeMicrophoneCommand: (() => void) | undefined;
let unsubscribeMicrophoneMenuStatus: (() => void) | undefined;
let unsubscribeSpeakerCommand: (() => void) | undefined;
let unsubscribeSpeakerMenuStatus: (() => void) | undefined;
let unsubscribeCameraCommand: (() => void) | undefined;
let unsubscribeCameraMenuStatus: (() => void) | undefined;
let rtcDismissTimer: ReturnType<typeof setTimeout> | undefined;
let rtcDurationTimer: ReturnType<typeof setInterval> | undefined;
let rtcSnapshotTimer: ReturnType<typeof setInterval> | undefined;
let rtcSnapshotPending = false;
let rtcInvitationTimer: ReturnType<typeof setTimeout> | undefined;
let rtcConnectedAt = 0;
let localTerminationRequested = false;
let rtcHangupAudio: HTMLAudioElement | undefined;
let rtcHangupSoundPlayed = false;
let disposed = false;
let initializing = true;
const pendingMessages: ResourceSseMessage[] = [];
const RTC_CALL_DISMISS_DELAY_MS = 1500;
const RTC_HANGUP_SOUND = publicAssetUrl('sounds/语音挂断.wav');

/** 判断 RTC 呼叫是否已经进入终态。 */
const isRtcTerminal = (call: RtcCallView | null): boolean => {
  switch (call?.state) {
    case RtcCallState.REJECTED:
    case RtcCallState.CANCELED:
    case RtcCallState.ENDED:
    case RtcCallState.EXPIRED:
      return true;
    default:
      return false;
  }
};

/** 预加载通话结束音效，确保收到来电或主动发起通话后可以立即播放。 */
const preloadRtcHangupSound = (): void => {
  if (rtcHangupAudio) return;
  const audio = new Audio();
  audio.preload = 'auto';
  audio.src = RTC_HANGUP_SOUND;
  audio.load();
  rtcHangupAudio = audio;
};

/** 释放通话结束音效元素及其媒体资源。 */
const releaseRtcHangupSound = (): void => {
  const audio = rtcHangupAudio;
  rtcHangupAudio = undefined;
  if (!audio) return;
  audio.onended = null;
  audio.onerror = null;
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
};

/** 音效播放完后立即关闭对应的终态通话窗口。 */
const closeRtcTerminalWindow = (callId: string): void => {
  if (rtcDismissTimer !== undefined) {
    clearTimeout(rtcDismissTimer);
    rtcDismissTimer = undefined;
  }
  if (rtcCall.value?.callId !== callId || !isRtcTerminal(rtcCall.value)) return;
  void desktop?.controlWindow('close');
};

/** 播放一次通话结束音效，结束后释放资源并立即关闭终态页面。 */
const playRtcHangupSound = (callId: string): void => {
  const audio = rtcHangupAudio;
  if (!audio) return;
  const release = (): void => {
    if (rtcHangupAudio === audio) releaseRtcHangupSound();
  };
  audio.onended = (): void => {
    release();
    closeRtcTerminalWindow(callId);
  };
  audio.onerror = release;
  try {
    audio.currentTime = 0;
    void audio.play().catch(release);
  } catch {
    release();
  }
};

const rtcSpeakerOutput = createRtcSpeakerOutput({
  onDeviceChanged: (deviceId): void => {
    if (disposed || microphoneResourcesDisposed || isRtcTerminal(rtcCall.value))
      return;
    rtcSpeakerDeviceId.value = deviceId;
    rtcSpeakerError.value = '';
  },
  onError: (cause): void => {
    if (
      !disposed &&
      !microphoneResourcesDisposed &&
      !isRtcTerminal(rtcCall.value)
    )
      rtcSpeakerError.value = readRtcSpeakerError(cause);
  },
});

/** 清理终态呼叫自动关闭计时器。 */
/** 将通话持续时间格式化为分钟和秒，避免窗口标题栏出现跳动的宽度。 */
const formatRtcDuration = (elapsedMs: number): string => {
  const totalSeconds = Math.min(
    99 * 60 + 59,
    Math.max(0, Math.floor(elapsedMs / 1000)),
  );
  const minutes = Math.floor(totalSeconds / 60)
    .toString()
    .padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
};

/** 刷新独立通话窗口标题栏中的通话计时。 */
const updateRtcDuration = (): void => {
  const call = rtcCall.value;
  if (!call || call.state === RtcCallState.RINGING || isRtcTerminal(call)) {
    rtcCallDuration.value = '00:00';
    return;
  }
  if (rtcConnectedAt === 0) {
    const updatedAt = Date.parse(call.acceptedAt ?? call.updatedAt);
    rtcConnectedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
  }
  rtcCallDuration.value = formatRtcDuration(Date.now() - rtcConnectedAt);
};

const clearRtcDismissTimer = (): void => {
  if (rtcDismissTimer === undefined) return;
  clearTimeout(rtcDismissTimer);
  rtcDismissTimer = undefined;
};

/** 终态后停止资源事件和通话计时，保留终态画面等待窗口关闭。 */
const cleanupTerminalCallbacks = (): void => {
  clearInterval(rtcSnapshotTimer);
  rtcSnapshotTimer = undefined;
  clearTimeout(rtcInvitationTimer);
  rtcInvitationTimer = undefined;
  cleanupRtcMicrophoneMenu();
  unsubscribeResourceMessage?.();
  unsubscribeResourceMessage = undefined;
  if (rtcDurationTimer !== undefined) {
    clearInterval(rtcDurationTimer);
    rtcDurationTimer = undefined;
  }
};

/** 根据终止来源生成对方挂断提示，本端主动结束时保持安静退出。 */
const getTerminalMessage = (call: RtcCallView | null): string => {
  if (call?.state === RtcCallState.EXPIRED) return '对方无响应';
  if (
    localTerminationRequested ||
    !call ||
    (call.state !== RtcCallState.REJECTED &&
      call.state !== RtcCallState.CANCELED &&
      call.state !== RtcCallState.ENDED)
  )
    return '';
  return '对方已挂断';
};

/** 本窗口绑定的通话只启动一次结束音效与兜底关闭，重复终态不重播或延后关闭。 */
const scheduleRtcDismiss = (callId: string): void => {
  if (
    disposed ||
    rtcHangupSoundPlayed ||
    rtcCall.value?.callId !== callId ||
    !isRtcTerminal(rtcCall.value)
  )
    return;
  rtcHangupSoundPlayed = true;
  clearRtcDismissTimer();
  rtcDismissTimer = setTimeout(
    (): void => {
      rtcDismissTimer = undefined;
      closeRtcTerminalWindow(callId);
    },
    rtcCall.value?.state === RtcCallState.EXPIRED
      ? 3000
      : RTC_CALL_DISMISS_DELAY_MS,
  );
  playRtcHangupSound(callId);
};

/** 发起端到一分钟主动请求断开；被叫稍后只读确认，后台兜底且不结束已接通成员。 */
const scheduleInvitationDeadline = (): void => {
  clearTimeout(rtcInvitationTimer);
  rtcInvitationTimer = undefined;
  const call = rtcCall.value;
  if (disposed || !call || !hasRtcPendingInvitations(call)) return;
  const caller = call.callerUid === currentUserId.value;
  const confirmDelay = caller ? 0 : 5000;
  const delay = Math.max(
    1000,
    readRtcInvitationDeadline(call) + confirmDelay - Date.now(),
  );
  rtcInvitationTimer = setTimeout((): void => {
    rtcInvitationTimer = undefined;
    if (disposed || rtcCall.value?.callId !== call.callId || !rtcClient) return;
    const request = caller
      ? rtcClient.expireInvitations()
      : rtcClient.refresh();
    void request
      .catch((cause: unknown): void => {
        if (!disposed && !isRtcTerminal(rtcCall.value))
          rtcError.value = readRtcError(cause, '通话状态同步失败，请重试');
      })
      .finally((): void => {
        if (!disposed && rtcCall.value?.callId === call.callId)
          scheduleInvitationDeadline();
      });
  }, delay);
};

/** 创建独立窗口使用的 RTC API 适配器。 */
const createRtcApi = (): RtcApi => {
  if (!desktop) throw new Error('通话窗口桥接不可用');
  if (!desktop.rtcGetMedia || !desktop.rtcSignalMedia)
    throw new Error('请重启桌面程序以启用直连通话');
  return {
    media: { get: desktop.rtcGetMedia, signal: desktop.rtcSignalMedia },
    createCall: async (): Promise<RtcCallView> => {
      throw new Error('独立通话窗口不能创建呼叫');
    },
    getCall: desktop.rtcGetCall,
    issueToken: desktop.rtcIssueToken,
    acceptCall: desktop.rtcAcceptCall,
    rejectCall: desktop.rtcRejectCall,
    cancelCall: desktop.rtcCancelCall,
    expireCall: desktop.rtcExpireCall,
    hangupCall: desktop.rtcHangupCall,
    leaveCall: desktop.rtcLeaveCall,
    setVideoEnabled: desktop.rtcSetVideoEnabled,
  };
};

/** 接听确认后同步原生窗口和面板布局，不重建 RTC 控制器或媒体元素。 */
const expandRtcAudioWindow = (callId: string): void => {
  if (!desktop || !rtcCompact.value || rtcExpandPromise) return;
  rtcExpandPromise = desktop
    .controlWindow('expand')
    .then((expanded): void => {
      if (disposed || rtcCall.value?.callId !== callId || !expanded) return;
      rtcCompact.value = false;
      rtcPinned.value = false;
      rtcMaximized.value = false;
    })
    .catch((cause: unknown): void => {
      if (disposed || rtcCall.value?.callId !== callId) return;
      rtcError.value = readRtcError(cause, '通话窗口展开失败，请重试');
    })
    .finally(() => {
      rtcExpandPromise = undefined;
    });
};

/** 创建 RTC 控制器并将媒体轨道绑定到独立窗口。 */
const createRtcController = (): ReturnType<typeof createRtcClient> =>
  createRtcClient({
    userId: currentUserId.value,
    groupCall: rtcGroupContext.value,
    api: createRtcApi(),
    onAnsweredElsewhere: (): void => {
      disposed = true;
      dismissRtcCall();
    },
    onConnectionChanged: (connected): void => {
      if (disposed || isRtcTerminal(rtcCall.value)) return;
      rtcConnected.value = connected;
      if (connected) rtcError.value = '';
    },
    onMediaError: (cause): void => {
      if (!disposed && !isRtcTerminal(rtcCall.value))
        rtcError.value = readRtcError(cause, '通话网络不稳定，正在重试');
    },
    onParticipantsChanged: (participants): void => {
      if (disposed || !rtcGroupContext.value) return;
      rtcParticipants.value = participants;
      for (const participant of participants)
        void loadRtcParticipant(participant.identity);
    },
    onCallChanged: (call): void => {
      if (disposed) return;
      if (call && isRtcTerminal(call)) callPanel.value?.freezeVideo();
      rtcCall.value = call;
      scheduleInvitationDeadline();
      if (call && rtcGroupContext.value && !isRtcTerminal(call)) {
        for (const participant of call.participants) {
          if (
            participant.state !== RtcParticipantState.REJECTED &&
            participant.state !== RtcParticipantState.LEFT
          )
            void loadRtcParticipant(participant.uid);
        }
      }
      if (
        call?.mediaMode === RtcMediaMode.AUDIO &&
        (call.state === RtcCallState.ACCEPTED ||
          call.state === RtcCallState.CONNECTED)
      )
        expandRtcAudioWindow(call.callId);
      if (!call || call.state === RtcCallState.RINGING) rtcConnectedAt = 0;
      else if (!isRtcTerminal(call) && rtcConnectedAt === 0) {
        const updatedAt = Date.parse(call.acceptedAt ?? call.updatedAt);
        rtcConnectedAt = Number.isFinite(updatedAt) ? updatedAt : Date.now();
      }
      updateRtcDuration();
      if (!call || isRtcTerminal(call)) {
        rtcConnected.value = false;
        rtcLocalTrack.value = null;
        rtcRemoteTracks.value = [];
      }
      terminalMessage.value = getTerminalMessage(call);
      if (!call) {
        rtcMicrophoneEnabled.value = true;
        rtcCameraEnabled.value = true;
        rtcSpeakerEnabled.value = true;
      }
      if (call && isRtcTerminal(call)) {
        publishRtcMicrophoneState();
        publishRtcSpeakerState();
        publishRtcCameraState();
        cleanupTerminalCallbacks();
        scheduleRtcDismiss(call.callId);
      } else clearRtcDismissTimer();
    },
    onLocalTrack: (track): void => {
      if (disposed) return;
      rtcLocalTrack.value = track;
      if (track?.readyState === 'live') rtcCameraError.value = '';
    },
    onMicrophoneDeviceChanged: (deviceId): void => {
      if (disposed || isRtcTerminal(rtcCall.value)) return;
      rtcMicrophoneDeviceId.value = deviceId;
      void refreshRtcAudioDevices();
    },
    onCameraDeviceChanged: (deviceId): void => {
      if (disposed || isRtcTerminal(rtcCall.value)) return;
      rtcCameraDeviceId.value = deviceId;
      void refreshRtcAudioDevices();
    },
    onCameraEnabledChanged: (enabled): void => {
      if (!disposed && !isRtcTerminal(rtcCall.value))
        rtcCameraEnabled.value = enabled;
    },
    onCameraStatesChanged: (states): void => {
      if (!disposed && !isRtcTerminal(rtcCall.value))
        rtcCameraStates.value = states;
    },
    onCameraError: (cause): void => {
      if (!disposed && !isRtcTerminal(rtcCall.value))
        rtcCameraError.value = readCameraError(cause);
    },
    onVideoCapabilityChanged: (allowed): void => {
      if (
        disposed ||
        allowed ||
        rtcCall.value?.mediaMode !== RtcMediaMode.VIDEO
      )
        return;
      rtcCameraEnabled.value = false;
      rtcError.value = '视频席位已满，当前以语音加入';
    },
    onRemoteTrack: (track, participantIdentity): void => {
      if (disposed) return;
      rtcRemoteTracks.value = [
        ...rtcRemoteTracks.value.filter(
          (item) =>
            !(
              item.participantIdentity === participantIdentity &&
              item.track.kind === track.kind
            ),
        ),
        { track, participantIdentity },
      ];
    },
    onRemoteTrackUnsubscribed: (track): void => {
      rtcRemoteTracks.value = rtcRemoteTracks.value.filter(
        (item) => item.track !== track,
      );
    },
    onRoomChanged: (room): void => {
      rtcConnected.value = room !== null;
      if (!room) {
        rtcLocalTrack.value = null;
        rtcRemoteTracks.value = [];
        rtcParticipants.value = [];
      }
    },
  });

/** 读取已邀请和已入会成员资料，占位也使用真实头像，结果绑定当前窗口。 */
const loadRtcParticipant = async (uid: string): Promise<void> => {
  if (
    !desktop ||
    disposed ||
    isRtcTerminal(rtcCall.value) ||
    rtcParticipantProfiles.value[uid] ||
    rtcProfileRequests.has(uid)
  )
    return;
  rtcProfileRequests.add(uid);
  try {
    const profile = await desktop.readParticipant(uid);
    if (disposed || isRtcTerminal(rtcCall.value)) return;
    rtcParticipantProfiles.value = {
      ...rtcParticipantProfiles.value,
      [uid]: profile,
    };
  } catch {
    // 资料失败保留媒体服务提供的名称和默认头像，不中断通话。
  }
};

/** 处理独立窗口收到的 RTC SSE 事件。 */
const handleResourceMessage = async (
  message: ResourceSseMessage,
): Promise<void> => {
  if (!rtcClient) return;
  try {
    await rtcClient.handleSse(message);
  } catch (cause) {
    rtcError.value = readRtcError(cause, '通话状态同步失败，请重试');
  }
};

/** 执行接听操作。 */
const acceptRtcCall = async (): Promise<void> => {
  if (rtcBusy.value || !rtcClient?.getCall()) return;
  rtcBusy.value = true;
  rtcError.value = '';
  try {
    await rtcClient?.accept();
  } catch (cause) {
    rtcError.value = readRtcError(cause, '通话接听失败，请重试');
  } finally {
    rtcBusy.value = false;
  }
};

/** 执行拒绝操作。 */
const rejectRtcCall = async (): Promise<void> => {
  if (!isGroupCall.value) {
    await hangupRtcCall();
    return;
  }
  if (rtcBusy.value || !rtcClient?.getCall()) return;
  localTerminationRequested = true;
  rtcBusy.value = true;
  try {
    await rtcClient?.reject();
  } catch (cause) {
    localTerminationRequested = false;
    rtcError.value = readRtcError(cause, '通话拒绝失败，请重试');
  } finally {
    rtcBusy.value = false;
  }
};

/** 执行取消操作。 */
const cancelRtcCall = async (): Promise<void> => {
  if (!isGroupCall.value) {
    await hangupRtcCall();
    return;
  }
  if (rtcBusy.value || !rtcClient?.getCall()) return;
  localTerminationRequested = true;
  rtcBusy.value = true;
  try {
    await rtcClient?.cancel();
  } catch (cause) {
    localTerminationRequested = false;
    rtcError.value = readRtcError(cause, '通话取消失败，请重试');
  } finally {
    rtcBusy.value = false;
  }
};

/** 执行挂断操作。 */
const hangupRtcCall = async (): Promise<void> => {
  if (
    rtcEnding.value ||
    (isGroupCall.value && rtcBusy.value) ||
    !rtcClient?.getCall()
  )
    return;
  localTerminationRequested = true;
  rtcEnding.value = true;
  rtcBusy.value = true;
  try {
    await rtcClient?.hangup();
  } catch (cause) {
    localTerminationRequested = false;
    rtcError.value = readRtcError(cause, '通话挂断失败，请重试');
  } finally {
    rtcEnding.value = false;
    rtcBusy.value = false;
  }
};

/** 同一次枚举按输入或输出分类，保留真实标签与系统默认项。 */
const readRtcDeviceList = (
  devices: MediaDeviceInfo[],
  kind: MediaDeviceKind,
): Pick<MediaDeviceInfo, 'deviceId' | 'label'>[] => {
  let label: string;
  switch (kind) {
    case 'audioinput':
      label = '麦克风';
      break;
    case 'audiooutput':
      label = '扬声器';
      break;
    case 'videoinput':
      label = '摄像头';
      break;
  }
  const available = devices.filter(
    (device) => device.kind === kind && device.deviceId !== 'communications',
  );
  const result = available
    .filter((device) => device.deviceId && device.deviceId !== 'default')
    .slice(0, 127)
    .map((device, index) => ({
      deviceId: device.deviceId,
      label: device.label.slice(0, 512) || `${label} ${index + 1}`,
    }));
  if (available.length) {
    const defaultDevice = available.find(
      (device) => device.deviceId === 'default',
    );
    result.unshift({
      deviceId: 'default',
      label: defaultDevice?.label.slice(0, 512) || `系统默认${label}`,
    });
  }
  return result;
};

/** 相同列表不重新渲染，避免隐藏菜单或悬浮菜单反复调整高度。 */
const sameRtcDevices = (
  current: Pick<MediaDeviceInfo, 'deviceId' | 'label'>[],
  next: Pick<MediaDeviceInfo, 'deviceId' | 'label'>[],
): boolean =>
  current.length === next.length &&
  next.every(
    (device, index) =>
      device.deviceId === current[index]?.deviceId &&
      device.label === current[index]?.label,
  );

/** 初始化及设备变化时一起刷新音视频设备缓存，悬浮不枚举或采集设备。 */
const refreshRtcAudioDevices = async (): Promise<void> => {
  const callId = rtcCall.value?.callId;
  if (
    disposed ||
    microphoneResourcesDisposed ||
    !callId ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  const request = ++microphoneListRequest;
  rtcMicrophonesLoading.value = !microphoneListLoaded;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    if (
      disposed ||
      request !== microphoneListRequest ||
      rtcCall.value?.callId !== callId ||
      isRtcTerminal(rtcCall.value)
    )
      return;
    const inputs = readRtcDeviceList(devices, 'audioinput');
    const outputs = readRtcDeviceList(devices, 'audiooutput');
    if (!sameRtcDevices(rtcMicrophones.value, inputs))
      rtcMicrophones.value = inputs;
    if (!sameRtcDevices(rtcSpeakers.value, outputs))
      rtcSpeakers.value = outputs;
    if (rtcCall.value?.mediaMode === RtcMediaMode.VIDEO) {
      const cameras = readRtcDeviceList(devices, 'videoinput');
      if (!sameRtcDevices(rtcCameras.value, cameras))
        rtcCameras.value = cameras;
    }
    microphoneListLoaded = true;
    rtcMicrophoneListError.value = '';
  } catch (cause: unknown) {
    if (
      !disposed &&
      request === microphoneListRequest &&
      !isRtcTerminal(rtcCall.value)
    )
      rtcMicrophoneListError.value = readRtcError(
        cause,
        '设备列表读取失败，请检查设备连接或权限',
      );
  } finally {
    if (!disposed && request === microphoneListRequest)
      rtcMicrophonesLoading.value = false;
  }
};

/** 将设备错误转换为可操作的通话提示。 */
const readMicrophoneError = (cause: unknown): string => {
  return readRtcError(cause, '麦克风操作失败，请重试', 'microphone');
};

/** 切换采集设备时只锁定麦克风操作，挂断按钮仍然可用。 */
const selectRtcMicrophone = async (deviceId: string): Promise<void> => {
  const client = rtcClient;
  const callId = rtcCall.value?.callId;
  if (
    !client ||
    !callId ||
    disposed ||
    rtcBusy.value ||
    rtcMicrophoneBusy.value ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  rtcMicrophoneBusy.value = true;
  rtcMicrophoneError.value = '';
  try {
    await client.setMicrophoneDevice(deviceId);
  } catch (cause: unknown) {
    if (
      !disposed &&
      rtcCall.value?.callId === callId &&
      !isRtcTerminal(rtcCall.value)
    )
      rtcMicrophoneError.value = readMicrophoneError(cause);
  } finally {
    if (!disposed && rtcCall.value?.callId === callId)
      rtcMicrophoneBusy.value = false;
  }
};

/** 更新本次通话的发送增益，不改变系统音量或解除静音。 */
const changeRtcMicrophoneVolume = (volume: number): void => {
  if (
    !rtcClient ||
    disposed ||
    isRtcTerminal(rtcCall.value) ||
    !Number.isFinite(volume)
  )
    return;
  const next = Math.min(100, Math.max(0, volume));
  rtcClient.setMicrophoneVolume(next);
  rtcMicrophoneVolume.value = next;
};

/** 切换本地麦克风，设备操作不会阻塞取消或挂断。 */
const toggleRtcMicrophone = async (): Promise<void> => {
  if (
    rtcBusy.value ||
    rtcMicrophoneBusy.value ||
    !rtcClient?.getCall() ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  const callId = rtcCall.value?.callId;
  const previousEnabled = rtcMicrophoneEnabled.value;
  const nextEnabled = !previousEnabled;
  rtcMicrophoneEnabled.value = nextEnabled;
  rtcMicrophoneBusy.value = true;
  rtcMicrophoneError.value = '';
  try {
    const enabled = await rtcClient?.setMicrophoneEnabled(nextEnabled);
    if (
      !disposed &&
      rtcCall.value?.callId === callId &&
      !isRtcTerminal(rtcCall.value)
    )
      rtcMicrophoneEnabled.value = enabled;
  } catch (cause) {
    if (
      disposed ||
      rtcCall.value?.callId !== callId ||
      isRtcTerminal(rtcCall.value)
    )
      return;
    rtcMicrophoneEnabled.value = previousEnabled;
    rtcMicrophoneError.value = readMicrophoneError(cause);
    if (rtcCall.value?.mediaMode === RtcMediaMode.AUDIO)
      rtcError.value = rtcMicrophoneError.value;
  } finally {
    if (!disposed && rtcCall.value?.callId === callId)
      rtcMicrophoneBusy.value = false;
  }
};

/** 只同步界面状态，不向菜单窗口传递身份、凭据或媒体轨道。 */
const publishRtcMicrophoneState = (): void => {
  if (!desktop || disposed || microphoneResourcesDisposed || !rtcCall.value)
    return;
  const terminal = isRtcTerminal(rtcCall.value);
  if (terminal) rtcMicrophoneMenuVisible.value = false;
  if (typeof desktop.publishMicrophoneState !== 'function') {
    rtcMenuError.value = '请重启桌面程序以启用麦克风菜单';
    return;
  }
  void desktop
    .publishMicrophoneState({
      devices: rtcMicrophones.value.map((device) => ({ ...device })),
      deviceId: rtcMicrophoneDeviceId.value,
      volume: rtcMicrophoneVolume.value,
      enabled: rtcMicrophoneEnabled.value,
      busy: rtcBusy.value,
      deviceBusy: rtcMicrophoneBusy.value,
      loading: rtcMicrophonesLoading.value,
      terminal,
      error: (rtcMicrophoneError.value || rtcMicrophoneListError.value).slice(
        0,
        2048,
      ),
    })
    .catch((cause: unknown): void => {
      if (disposed || isRtcTerminal(rtcCall.value)) return;
      rtcMenuError.value = readRtcError(cause, '麦克风菜单同步失败，请重试');
    });
};

/** 悬浮只显示已预热菜单，复用初始化及设备变化时同步的缓存。 */
const showRtcMicrophoneMenu = async (
  anchor: RtcMicrophoneAnchor,
  focus: boolean,
): Promise<void> => {
  if (!desktop || disposed || rtcBusy.value || isRtcTerminal(rtcCall.value))
    return;
  rtcMenuError.value = '';
  try {
    await desktop.showMicrophoneMenu(anchor, focus);
  } catch (cause: unknown) {
    if (!disposed && !isRtcTerminal(rtcCall.value))
      rtcMenuError.value = readRtcError(cause, '麦克风菜单打开失败，请重试');
  }
};

/** 鼠标离开按钮时延迟隐藏，允许移动到原生菜单。 */
const leaveRtcMicrophoneMenu = (): void => {
  if (!disposed && !isRtcTerminal(rtcCall.value))
    void desktop?.leaveMicrophoneMenu?.().catch(() => {});
};

/** Escape 或点击通话其他区域时立即隐藏，保留预热窗口。 */
const hideRtcMicrophoneMenu = (): void => {
  if (!disposed && !isRtcTerminal(rtcCall.value))
    void desktop?.hideMicrophoneMenu?.().catch(() => {});
};

/** 白名单菜单命令在原通话执行，继续复用静音、切换和增益的并发保护。 */
const handleMicrophoneCommand = (command: RtcMicrophoneCommand): void => {
  if (disposed || rtcBusy.value || isRtcTerminal(rtcCall.value)) return;
  switch (command.type) {
    case 'toggle':
      void toggleRtcMicrophone();
      return;
    case 'select':
      void selectRtcMicrophone(command.deviceId);
      return;
    case 'volume':
      changeRtcMicrophoneVolume(command.volume);
      return;
  }
};

/** 点击设备按钮以外的通话内容时收起所有设备菜单。 */
const handleMenuOutsidePointer = (event: PointerEvent): void => {
  if (
    event.target instanceof Element &&
    !event.target.closest(
      '[data-rtc-microphone-button], [data-rtc-speaker-button], [data-rtc-camera-button]',
    )
  ) {
    hideRtcMicrophoneMenu();
    hideRtcSpeakerMenu();
    hideRtcCameraMenu();
  }
};

const stopMicrophoneStateWatch = watch(
  [
    rtcCall,
    rtcMicrophones,
    rtcMicrophoneDeviceId,
    rtcMicrophoneVolume,
    rtcMicrophoneEnabled,
    rtcBusy,
    rtcMicrophoneBusy,
    rtcMicrophonesLoading,
    rtcMicrophoneListError,
    rtcMicrophoneError,
  ],
  publishRtcMicrophoneState,
  { flush: 'post' },
);

/** 挂断或卸载时统一停止菜单同步、设备监听并释放本次通话缓存。 */
const cleanupRtcMicrophoneMenu = (): void => {
  if (microphoneResourcesDisposed) return;
  microphoneResourcesDisposed = true;
  microphoneListRequest += 1;
  stopMicrophoneStateWatch();
  stopSpeakerStateWatch();
  stopCameraStateWatch();
  stopSpeakerLevelWatch();
  rtcSpeakerOutput.close();
  window.removeEventListener('pointerdown', handleMenuOutsidePointer, true);
  navigator.mediaDevices?.removeEventListener(
    'devicechange',
    refreshRtcAudioDevices,
  );
  unsubscribeMicrophoneCommand?.();
  unsubscribeMicrophoneCommand = undefined;
  unsubscribeMicrophoneMenuStatus?.();
  unsubscribeMicrophoneMenuStatus = undefined;
  unsubscribeSpeakerCommand?.();
  unsubscribeSpeakerCommand = undefined;
  unsubscribeSpeakerMenuStatus?.();
  unsubscribeSpeakerMenuStatus = undefined;
  unsubscribeCameraCommand?.();
  unsubscribeCameraCommand = undefined;
  unsubscribeCameraMenuStatus?.();
  unsubscribeCameraMenuStatus = undefined;
  rtcMicrophoneMenuVisible.value = false;
  rtcMicrophones.value = [];
  rtcMicrophonesLoading.value = false;
  rtcMicrophoneListError.value = '';
  rtcMicrophoneError.value = '';
  rtcSpeakers.value = [];
  rtcSpeakerMenuVisible.value = false;
  rtcSpeakerError.value = '';
  rtcCameras.value = [];
  rtcCameraMenuVisible.value = false;
  rtcCameraError.value = '';
};

/** 区分摄像头权限、设备离线和占用错误。 */
const readCameraError = (cause: unknown): string => {
  return readRtcError(cause, '摄像头操作失败，请重试', 'camera');
};

/** 摄像头操作单独加锁，切换设备期间仍可挂断。 */
const updateRtcCamera = async (deviceId?: string): Promise<void> => {
  const client = rtcClient;
  const callId = rtcCall.value?.callId;
  if (
    !client ||
    !callId ||
    disposed ||
    microphoneResourcesDisposed ||
    rtcCall.value?.mediaMode !== RtcMediaMode.VIDEO ||
    rtcBusy.value ||
    rtcCameraBusy.value ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  rtcCameraBusy.value = true;
  rtcCameraError.value = '';
  try {
    if (deviceId !== undefined) {
      if (!rtcCameras.value.some((device) => device.deviceId === deviceId))
        throw new Error('所选摄像头不可用');
      await client.setCameraDevice(deviceId);
    } else {
      const enabled = await client.setCameraEnabled(!rtcCameraEnabled.value);
      if (
        !disposed &&
        rtcCall.value?.callId === callId &&
        !isRtcTerminal(rtcCall.value)
      )
        rtcCameraEnabled.value = enabled;
    }
  } catch (cause: unknown) {
    if (
      !disposed &&
      rtcCall.value?.callId === callId &&
      !isRtcTerminal(rtcCall.value)
    )
      rtcCameraError.value = readCameraError(cause);
  } finally {
    if (!disposed && rtcCall.value?.callId === callId)
      rtcCameraBusy.value = false;
  }
};

/** 点击按钮只改变摄像头开关，不改变已选择设备。 */
const toggleRtcCamera = (): Promise<void> => updateRtcCamera();

/** 摄像头窗口复用设备菜单快照，但不提供音量控制。 */
const publishRtcCameraState = (): void => {
  if (
    !desktop ||
    disposed ||
    microphoneResourcesDisposed ||
    rtcCall.value?.mediaMode !== RtcMediaMode.VIDEO
  )
    return;
  if (typeof desktop.publishCameraState !== 'function') {
    rtcMenuError.value = '请重启桌面程序以启用摄像头菜单';
    return;
  }
  const terminal = isRtcTerminal(rtcCall.value);
  if (terminal) rtcCameraMenuVisible.value = false;
  void desktop
    .publishCameraState({
      devices: rtcCameras.value.map((device) => ({ ...device })),
      deviceId: rtcCameraDeviceId.value,
      volume: 100,
      enabled: rtcCameraEnabled.value,
      busy: rtcBusy.value,
      deviceBusy: rtcCameraBusy.value,
      loading: rtcMicrophonesLoading.value,
      terminal,
      error: (rtcCameraError.value || rtcMicrophoneListError.value).slice(
        0,
        2048,
      ),
    })
    .catch((cause: unknown): void => {
      if (!disposed && !isRtcTerminal(rtcCall.value))
        rtcMenuError.value = readRtcError(cause, '摄像头菜单同步失败，请重试');
    });
};

/** 悬浮或键盘展开已经预热的摄像头设备菜单。 */
const showRtcCameraMenu = async (
  anchor: RtcMicrophoneAnchor,
  focus: boolean,
): Promise<void> => {
  if (
    !desktop ||
    disposed ||
    rtcBusy.value ||
    rtcCall.value?.mediaMode !== RtcMediaMode.VIDEO ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  rtcMenuError.value = '';
  try {
    await desktop.showCameraMenu(anchor, focus);
  } catch (cause: unknown) {
    if (!disposed && !isRtcTerminal(rtcCall.value))
      rtcMenuError.value = readRtcError(cause, '摄像头菜单打开失败，请重试');
  }
};

/** 离开按钮时保留与音频菜单相同的跨窗口缓冲。 */
const leaveRtcCameraMenu = (): void => {
  if (
    !disposed &&
    rtcCall.value?.mediaMode === RtcMediaMode.VIDEO &&
    !isRtcTerminal(rtcCall.value)
  )
    void desktop?.leaveCameraMenu?.().catch(() => {});
};

/** 隐藏菜单不停止视频或清空当前设备。 */
const hideRtcCameraMenu = (): void => {
  if (
    !disposed &&
    rtcCall.value?.mediaMode === RtcMediaMode.VIDEO &&
    !isRtcTerminal(rtcCall.value)
  )
    void desktop?.hideCameraMenu?.().catch(() => {});
};

/** 摄像头只接受开关与设备选择，不接收音频音量命令。 */
const handleCameraCommand = (command: RtcCameraCommand): void => {
  if (
    disposed ||
    rtcCall.value?.mediaMode !== RtcMediaMode.VIDEO ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  switch (command.type) {
    case 'toggle':
      void toggleRtcCamera();
      return;
    case 'select':
      void updateRtcCamera(command.deviceId);
      return;
  }
};

const stopCameraStateWatch = watch(
  [
    rtcCall,
    rtcCameras,
    rtcCameraDeviceId,
    rtcCameraEnabled,
    rtcCameraBusy,
    rtcBusy,
    rtcMicrophonesLoading,
    rtcMicrophoneListError,
    rtcCameraError,
  ],
  publishRtcCameraState,
  { flush: 'post' },
);

/** 切换远端扬声器输出。 */
const toggleRtcSpeaker = (): void => {
  if (
    !rtcCall.value ||
    rtcBusy.value ||
    rtcSpeakerBusy.value ||
    disposed ||
    microphoneResourcesDisposed ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  rtcSpeakerEnabled.value = !rtcSpeakerEnabled.value;
};

/** 设备切换成功后才确认勾选，失败保留原设备与音量。 */
const selectRtcSpeaker = async (deviceId: string): Promise<void> => {
  const callId = rtcCall.value?.callId;
  if (
    !callId ||
    disposed ||
    microphoneResourcesDisposed ||
    rtcBusy.value ||
    rtcSpeakerBusy.value ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  rtcSpeakerBusy.value = true;
  rtcSpeakerError.value = '';
  try {
    if (!rtcSpeakers.value.some((device) => device.deviceId === deviceId))
      throw new Error('所选扬声器不可用');
    await rtcSpeakerOutput.selectDevice(deviceId);
  } catch (cause: unknown) {
    if (
      !disposed &&
      !microphoneResourcesDisposed &&
      rtcCall.value?.callId === callId
    )
      rtcSpeakerError.value = readRtcSpeakerError(cause);
  } finally {
    if (
      !disposed &&
      !microphoneResourcesDisposed &&
      rtcCall.value?.callId === callId
    )
      rtcSpeakerBusy.value = false;
  }
};

/** 仅将扬声器展示数据同步给其专属窗口，不共享媒体或身份。 */
const publishRtcSpeakerState = (): void => {
  if (!desktop || disposed || microphoneResourcesDisposed || !rtcCall.value)
    return;
  if (typeof desktop.publishSpeakerState !== 'function') {
    rtcMenuError.value = '请重启桌面程序以启用扬声器菜单';
    return;
  }
  const terminal = isRtcTerminal(rtcCall.value);
  if (terminal) rtcSpeakerMenuVisible.value = false;
  void desktop
    .publishSpeakerState({
      devices: rtcSpeakers.value.map((device) => ({ ...device })),
      deviceId: rtcSpeakerDeviceId.value,
      volume: rtcSpeakerVolume.value,
      enabled: rtcSpeakerEnabled.value,
      busy: rtcBusy.value,
      deviceBusy: rtcSpeakerBusy.value,
      loading: rtcMicrophonesLoading.value,
      terminal,
      error: (rtcSpeakerError.value || rtcMicrophoneListError.value).slice(
        0,
        2048,
      ),
    })
    .catch((cause: unknown): void => {
      if (!disposed && !isRtcTerminal(rtcCall.value))
        rtcMenuError.value = readRtcError(cause, '扬声器菜单同步失败，请重试');
    });
};

/** 悬浮只显示预热的扬声器菜单，不读取设备或重新加载页面。 */
const showRtcSpeakerMenu = async (
  anchor: RtcMicrophoneAnchor,
  focus: boolean,
): Promise<void> => {
  if (!desktop || disposed || rtcBusy.value || isRtcTerminal(rtcCall.value))
    return;
  rtcMenuError.value = '';
  try {
    await desktop.showSpeakerMenu(anchor, focus);
  } catch (cause: unknown) {
    if (!disposed && !isRtcTerminal(rtcCall.value))
      rtcMenuError.value = readRtcError(cause, '扬声器菜单打开失败，请重试');
  }
};

/** 保留跨窗口移动缓冲，实际隐藏由主进程核对指针位置。 */
const leaveRtcSpeakerMenu = (): void => {
  if (!disposed && !isRtcTerminal(rtcCall.value))
    void desktop?.leaveSpeakerMenu?.().catch(() => {});
};

/** Escape、布局切换或点击其他区域时隐藏，但不释放预热状态。 */
const hideRtcSpeakerMenu = (): void => {
  if (!disposed && !isRtcTerminal(rtcCall.value))
    void desktop?.hideSpeakerMenu?.().catch(() => {});
};

/** 白名单输出操作与麦克风独立，不改变发送增益或系统音量。 */
const handleSpeakerCommand = (command: RtcAudioMenuCommand): void => {
  if (
    disposed ||
    microphoneResourcesDisposed ||
    rtcBusy.value ||
    isRtcTerminal(rtcCall.value)
  )
    return;
  switch (command.type) {
    case 'toggle':
      toggleRtcSpeaker();
      return;
    case 'select':
      void selectRtcSpeaker(command.deviceId);
      return;
    case 'volume':
      rtcSpeakerVolume.value = command.volume;
      return;
  }
};

const stopSpeakerStateWatch = watch(
  [
    rtcCall,
    rtcSpeakers,
    rtcSpeakerDeviceId,
    rtcSpeakerVolume,
    rtcSpeakerEnabled,
    rtcBusy,
    rtcSpeakerBusy,
    rtcMicrophonesLoading,
    rtcMicrophoneListError,
    rtcSpeakerError,
  ],
  publishRtcSpeakerState,
  { flush: 'post' },
);
const stopSpeakerLevelWatch = watch(
  [rtcSpeakerEnabled, rtcSpeakerVolume],
  ([enabled, volume]): void => {
    rtcSpeakerOutput.setEnabled(enabled);
    rtcSpeakerOutput.setVolume(volume);
  },
  { immediate: true },
);

/** 关闭终态呼叫并销毁独立窗口。 */
const dismissRtcCall = (): void => {
  clearRtcDismissTimer();
  cleanupTerminalCallbacks();
  void desktop?.controlWindow('close');
};

/** 处理标题栏中的置顶按钮，并同步当前窗口置顶状态。 */
const toggleRtcPin = async (): Promise<void> => {
  if (!desktop) return;
  try {
    rtcPinned.value = await desktop.controlWindow('pin');
  } catch (cause) {
    rtcError.value = readRtcError(cause, '窗口置顶操作失败，请重试');
  }
};

/** 处理标题栏中的最小化按钮。 */
const minimizeRtcWindow = async (): Promise<void> => {
  if (!desktop) return;
  try {
    await desktop.controlWindow('minimize');
  } catch (cause) {
    rtcError.value = readRtcError(cause, '窗口最小化失败，请重试');
  }
};

/** 处理标题栏中的最大化和还原按钮。 */
const toggleRtcMaximize = async (): Promise<void> => {
  if (!desktop) return;
  try {
    rtcMaximized.value = await desktop.controlWindow('maximize');
  } catch (cause) {
    rtcError.value = readRtcError(cause, '窗口尺寸调整失败，请重试');
  }
};

/** 显示多人通话入口状态，避免把未接入的邀请流程伪装成成功。 */
const inviteRtcMember = (): void => {
  rtcError.value = '暂未支持添加通话成员';
};

/** 根据当前通话状态执行标题栏关闭按钮对应的取消、拒绝或挂断。 */
const closeRtcCall = async (): Promise<void> => {
  const call = rtcClient?.getCall();
  if (!call) {
    dismissRtcCall();
    return;
  }
  switch (call.state) {
    case RtcCallState.RINGING:
      if (call.callerUid !== currentUserId.value) await rejectRtcCall();
      else await cancelRtcCall();
      return;
    case RtcCallState.ACCEPTED:
    case RtcCallState.CONNECTED:
      await hangupRtcCall();
      return;
    default:
      dismissRtcCall();
  }
};

onMounted(async () => {
  preloadRtcHangupSound();
  if (!desktop) {
    rtcError.value = '通话窗口桥接不可用';
    return;
  }
  rtcBusy.value = true;
  window.addEventListener('pointerdown', handleMenuOutsidePointer, true);
  unsubscribeMicrophoneCommand = desktop.onMicrophoneCommand?.(
    handleMicrophoneCommand,
  );
  unsubscribeMicrophoneMenuStatus = desktop.onMicrophoneMenuStatus?.(
    (status): void => {
      if (disposed || isRtcTerminal(rtcCall.value)) return;
      rtcMicrophoneMenuVisible.value = status.visible;
      if (status.error)
        rtcMenuError.value = readRtcError(
          status.error,
          '麦克风菜单操作失败，请重试',
        );
      else if (status.visible) rtcMenuError.value = '';
    },
  );
  unsubscribeSpeakerCommand = desktop.onSpeakerCommand?.(handleSpeakerCommand);
  unsubscribeSpeakerMenuStatus = desktop.onSpeakerMenuStatus?.(
    (status): void => {
      if (disposed || isRtcTerminal(rtcCall.value)) return;
      rtcSpeakerMenuVisible.value = status.visible;
      if (status.error)
        rtcMenuError.value = readRtcError(
          status.error,
          '扬声器菜单操作失败，请重试',
        );
      else if (status.visible) rtcMenuError.value = '';
    },
  );
  unsubscribeCameraCommand = desktop.onCameraCommand?.(handleCameraCommand);
  unsubscribeCameraMenuStatus = desktop.onCameraMenuStatus?.((status): void => {
    if (disposed || isRtcTerminal(rtcCall.value)) return;
    rtcCameraMenuVisible.value = status.visible;
    if (status.error)
      rtcMenuError.value = readRtcError(
        status.error,
        '摄像头菜单操作失败，请重试',
      );
    else if (status.visible) rtcMenuError.value = '';
  });
  try {
    // 先订阅再读取快照，避免资料读取期间丢失接听或取消事件。
    unsubscribeResourceMessage = desktop.onResourceMessage((message) => {
      if (initializing) {
        if (pendingMessages.length < 128) pendingMessages.push(message);
        return;
      }
      void handleResourceMessage(message);
    });
    const context = await desktop.context();
    if (disposed) return;
    currentUserId.value = context.user.id;
    peerName.value = context.peer.name;
    peerAvatar.value = context.peer.avatar ?? undefined;
    rtcCompact.value = context.compact;
    rtcGroupContext.value = context.group ?? isRtcGroupCall(context.call);
    rtcParticipantProfiles.value = {
      [context.user.id]: {
        name: context.user.nickname,
        avatar: context.user.avatar ?? null,
      },
    };
    rtcCameraEnabled.value =
      context.call.mediaMode === RtcMediaMode.VIDEO && !rtcGroupContext.value;
    rtcClient = createRtcController();
    navigator.mediaDevices.addEventListener(
      'devicechange',
      refreshRtcAudioDevices,
    );
    const restoring = rtcClient.restore(context.call);
    void refreshRtcAudioDevices();
    initializing = false;
    // 状态更新同步发生，连接异步等待；不能让入会阻塞后续挂断事件。
    await Promise.all([
      restoring,
      ...pendingMessages.splice(0).map(handleResourceMessage),
    ]);
    if (disposed) return;
    if (
      rtcClient.getCall()?.state === RtcCallState.RINGING &&
      context.call.mediaMode === RtcMediaMode.VIDEO &&
      !rtcGroupContext.value
    ) {
      try {
        await rtcClient.prepareLocalVideo();
      } catch (cause) {
        if (!disposed && !isRtcTerminal(rtcCall.value))
          rtcCameraError.value = readCameraError(cause);
      }
    }
    updateRtcDuration();
    if (!disposed && !isRtcTerminal(rtcCall.value)) {
      rtcDurationTimer = setInterval(updateRtcDuration, 1000);
      rtcSnapshotTimer = setInterval((): void => {
        if (disposed || rtcSnapshotPending || !rtcClient) return;
        rtcSnapshotPending = true;
        void rtcClient
          .refresh()
          .catch((): void => {})
          .finally((): void => {
            rtcSnapshotPending = false;
          });
      }, 5000);
    }
    unsubscribeClosing = desktop.onClosing(() => {
      const call = rtcClient?.getCall();
      if (!call || isRtcTerminal(call)) {
        void desktop.controlWindow('close');
        return;
      }
      void closeRtcCall();
    });
  } catch (cause) {
    rtcError.value = readRtcError(cause, '通话窗口初始化失败，请重试');
    initializing = false;
    pendingMessages.length = 0;
  } finally {
    rtcBusy.value = false;
  }
});

onBeforeUnmount(() => {
  disposed = true;
  cleanupTerminalCallbacks();
  clearRtcDismissTimer();
  unsubscribeClosing?.();
  unsubscribeClosing = undefined;
  pendingMessages.length = 0;
  rtcClient?.close();
  rtcClient = undefined;
  releaseRtcHangupSound();
});
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: #000;
}

.rtc-call-window {
  container-type: size;
  position: relative;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  overflow: hidden;
  border-radius: 8px;
  background: #000;
}
.rtc-call-loading {
  margin: 14px;
  color: #fff;
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
