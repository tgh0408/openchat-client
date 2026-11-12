import {
  Room,
  RoomEvent,
  Track,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import type { ResourceSseMessage } from '../../../../shared/windows/desktop';
import { ApiResponseError } from '../../../../shared/api/api-error';
import {
  parseRtcEvent,
  isRtcGroupCall,
  rtcActionVersion,
  hasRtcPendingInvitations,
  readRtcInvitationDeadline,
  RtcCallState,
  RtcEventType,
  type RtcCallView,
  type RtcEvent,
  RtcMediaMode,
  RtcParticipantState,
  RtcDeviceOwnership,
  canUseRtcDevice,
} from '../../../../shared/rtc/rtc';
import { newRtcRequestId, type RtcApi } from './rtc-api';
import { createRtcNoiseFilter, type RtcNoiseFilter } from './rtc-noise-filter';
import { createRtcDirect, type RtcDirect } from './rtc-direct';
import {
  parseRtcCameraState,
  type RtcCameraState,
} from '../../../../shared/rtc/rtc-media';
import { RtcAuditEvent } from '../../../../shared/rtc/rtc-audit';

export interface RtcClientOptions {
  userId: string;
  api: RtcApi;
  groupCall?: boolean;
  onParticipantsChanged?: (participants: RtcRoomParticipant[]) => void;
  onCallChanged?: (call: RtcCallView | null) => void;
  onAnsweredElsewhere?: (callId: string) => void;
  onLocalTrack?: (track: MediaStreamTrack | null) => void;
  onRemoteTrack?: (
    track: MediaStreamTrack,
    participantIdentity: string,
  ) => void;
  onRemoteTrackUnsubscribed?: (
    track: MediaStreamTrack,
    participantIdentity: string,
  ) => void;
  onRoomChanged?: (room: Room | null) => void;
  onConnectionChanged?: (connected: boolean) => void;
  onMediaError?: (error: Error) => void;
  onMicrophoneDeviceChanged?: (deviceId: string) => void;
  onCameraDeviceChanged?: (deviceId: string) => void;
  onCameraEnabledChanged?: (enabled: boolean) => void;
  onCameraError?: (error: unknown) => void;
  onCameraStatesChanged?: (states: Record<string, RtcCameraState>) => void;
  onVideoCapabilityChanged?: (allowed: boolean) => void;
}

export interface RtcRemoteTrack {
  track: MediaStreamTrack;
  participantIdentity: string;
}

export interface RtcRoomParticipant {
  identity: string;
  name: string;
  joinedAt: number;
  speaking: boolean;
  cameraEnabled: boolean;
}

export interface RtcClient {
  readonly getCall: () => RtcCallView | null;
  readonly restore: (value: RtcCallView) => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly expireInvitations: () => Promise<void>;
  readonly prepareLocalVideo: () => Promise<MediaStreamTrack | null>;
  readonly startCall: (
    roomId: string,
    mediaMode: RtcMediaMode,
  ) => Promise<RtcCallView>;
  readonly accept: () => Promise<RtcCallView>;
  readonly reject: () => Promise<RtcCallView>;
  readonly cancel: () => Promise<RtcCallView>;
  readonly hangup: () => Promise<RtcCallView>;
  readonly leave: () => Promise<RtcCallView>;
  readonly setMicrophoneEnabled: (enabled: boolean) => Promise<boolean>;
  readonly setMicrophoneDevice: (deviceId: string) => Promise<void>;
  readonly setMicrophoneVolume: (volume: number) => void;
  readonly setCameraEnabled: (enabled: boolean) => Promise<boolean>;
  readonly setCameraDevice: (deviceId: string) => Promise<void>;
  readonly dismiss: () => void;
  readonly handleSse: (raw: ResourceSseMessage) => Promise<void>;
  readonly close: () => void;
}

const LOCAL_MICROPHONE_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: false,
  autoGainControl: true,
  channelCount: 1,
  sampleRate: 48000,
};

/** 仅提取信令服务 origin，避免诊断日志记录访问令牌或完整连接地址。 */
const readRtcServerOrigin = (serverUrl: string): string => {
  try {
    const parsed = new URL(serverUrl);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return '[invalid-url]';
  }
};

/** 读取并脱敏 LiveKit 连接错误，保留失败阶段和可诊断信息。 */
const readRtcConnectionError = (error: unknown): string => {
  if (error instanceof Error)
    return error.message.replace(/(access_token=)[^&\s]+/gi, '$1[redacted]');
  if (typeof error === 'object' && error !== null) {
    const record = error as {
      message?: unknown;
      reason?: unknown;
      code?: unknown;
      name?: unknown;
    };
    const details = [record.name, record.code, record.reason, record.message]
      .filter(
        (value): value is string | number =>
          typeof value === 'string' || typeof value === 'number',
      )
      .map(String)
      .join(': ');
    if (details) return details;
  }
  const message = String(error);
  return message.replace(/(access_token=)[^&\s]+/gi, '$1[redacted]');
};

/** 单聊优先直连，群聊和不可用的直连使用 LiveKit；采集设备生命周期独立于媒体传输。 */
export const createRtcClient = (options: RtcClientOptions): RtcClient => {
  let call: RtcCallView | null = null;
  let room: Room | null = null;
  let joiningRoom: Room | null = null;
  let direct: RtcDirect | null = null;
  let mediaGeneration = 0;
  let joinPromise: Promise<void> | null = null;
  let invitationExpiryPromise: Promise<void> | null = null;
  let disposed = false;
  let terminationRequested = false;
  let terminationPromise: Promise<RtcCallView> | null = null;
  let localPreviewTrack: MediaStreamTrack | null = null;
  let cameraOperation: Promise<void> | null = null;
  let cameraGeneration = 0;
  let cameraDeviceId = 'default';
  let activeCameraDeviceId: string | null = null;
  const pendingCameraTracks = new Set<MediaStreamTrack>();
  let localMicrophoneTrack: MediaStreamTrack | null = null;
  let localMicrophonePromise: Promise<MediaStreamTrack | null> | null = null;
  let localNoiseFilter: RtcNoiseFilter | null = null;
  let microphoneDeviceId = 'default';
  let microphoneVolume = 100;
  let microphoneSwitchPromise: Promise<void> | null = null;
  let microphoneGeneration = 0;
  let localVideoEnabled = true;
  let localMicrophoneEnabled = true;
  let localAccepted = false;
  let videoSeatHeld = false;
  let videoLeaseTimer: ReturnType<typeof setInterval> | undefined;
  let videoLeaseRenewing = false;
  const handledEvents = new Set<string>();
  let cameraStates: Record<string, RtcCameraState> = {};
  let cameraSync: Promise<void> | null = null;
  let cameraTimer: ReturnType<typeof setInterval> | undefined;

  /** 窗口绑定的群会话类型优先，避免两人群通话退回单聊界面。 */
  const isGroup = (value: RtcCallView | null): boolean =>
    value !== null && (options.groupCall ?? isRtcGroupCall(value));

  /** 判断服务端呼叫是否已经进入不可恢复的终态。*/
  const isTerminalCall = (value: RtcCallView | null): boolean => {
    switch (value?.state) {
      case RtcCallState.REJECTED:
      case RtcCallState.CANCELED:
      case RtcCallState.ENDED:
      case RtcCallState.EXPIRED:
        return true;
      default:
        return false;
    }
  };

  /** 将服务端终止事件转换为本地呼叫状态。*/
  const readTerminalState = (eventType: RtcEventType): RtcCallState => {
    switch (eventType) {
      case RtcEventType.RTC_CALL_REJECTED:
        return RtcCallState.REJECTED;
      case RtcEventType.RTC_CALL_CANCELED:
        return RtcCallState.CANCELED;
      case RtcEventType.RTC_CALL_EXPIRED:
        return RtcCallState.EXPIRED;
      default:
        return RtcCallState.ENDED;
    }
  };

  /** 更新当前呼叫状态并通知页面。 */
  const updateCall = (value: RtcCallView | null): void => {
    if (disposed && value) return;
    if (
      value &&
      call?.callId === value.callId &&
      (isTerminalCall(call) || value.version < call.version)
    )
      return;
    if (value && call?.callId !== value.callId) {
      cameraStates = {};
      options.onCameraStatesChanged?.({});
      localVideoEnabled =
        value.mediaMode === RtcMediaMode.VIDEO && !isGroup(value);
      options.onCameraEnabledChanged?.(localVideoEnabled);
    }
    call = value;
    options.onCallChanged?.(value);
  };

  /** 只合入本次通话成员的较新摄像头版本，重复及乱序推送不能倒退状态。 */
  const applyCameraStates = (states: Record<string, RtcCameraState>): void => {
    if (
      !call ||
      call.mediaMode !== RtcMediaMode.VIDEO ||
      isTerminalCall(call) ||
      disposed
    )
      return;
    let changed = false;
    for (const [uid, state] of Object.entries(states)) {
      if (
        !call.participants.some(
          (participant) =>
            participant.uid === uid &&
            (participant.state === undefined ||
              participant.state === RtcParticipantState.ACCEPTED),
        )
      )
        continue;
      if (state.version <= (cameraStates[uid]?.version ?? 0)) continue;
      cameraStates[uid] = state;
      changed = true;
    }
    if (changed) options.onCameraStatesChanged?.({ ...cameraStates });
  };

  /** 串行补查快照并上报实际开关；每轮只提交一次条件更新，失败留给下一轮同步。 */
  const syncCameraState = (): Promise<void> => {
    const current = call;
    const api = options.api.media;
    if (
      !current ||
      !api ||
      current.mediaMode !== RtcMediaMode.VIDEO ||
      (current.state !== RtcCallState.ACCEPTED &&
        current.state !== RtcCallState.CONNECTED) ||
      !localAccepted ||
      disposed
    )
      return Promise.resolve();
    const generation = cameraGeneration;
    /** 挂断、换通话或释放媒体后的旧结果不得继续读写。 */
    const stale = (): boolean =>
      disposed ||
      call?.callId !== current.callId ||
      isTerminalCall(call) ||
      generation !== cameraGeneration;
    const pending = (cameraSync ?? Promise.resolve())
      .catch(() => {})
      .then(async (): Promise<void> => {
        if (stale()) return;
        const snapshot = await api.get(current.callId);
        if (stale() || snapshot.callId !== current.callId) return;
        applyCameraStates(snapshot.cameraStates);
        const own = snapshot.cameraStates[options.userId];
        if (own?.enabled === localVideoEnabled) return;
        const updated = await api.signal(current.callId, {
          kind: 'CAMERA',
          clientRequestId: newRtcRequestId(),
          enabled: localVideoEnabled,
          expectedCameraVersion: own?.version ?? 0,
        });
        if (!stale() && updated.callId === current.callId)
          applyCameraStates(updated.cameraStates);
      })
      .finally((): void => {
        if (cameraSync === pending) cameraSync = null;
      });
    cameraSync = pending;
    return pending;
  };

  /** 上报失败不重新开启本地摄像头；明确提示，并由有界周期补同步实际状态。 */
  const notifyCameraState = (): void => {
    const callId = call?.callId;
    const generation = cameraGeneration;
    void syncCameraState().catch((error: unknown): void => {
      if (
        !disposed &&
        call?.callId === callId &&
        generation === cameraGeneration &&
        !isTerminalCall(call)
      )
        options.onCameraError?.(error);
    });
  };

  /** 已接听视频呼叫补偿丢失的 SSE；同时覆盖直连和中转。 */
  const startCameraSync = (): void => {
    if (cameraTimer || call?.mediaMode !== RtcMediaMode.VIDEO || !localAccepted)
      return;
    notifyCameraState();
    cameraTimer = setInterval((): void => {
      if (!cameraSync) notifyCameraState();
    }, 5000);
  };

  /** 判断当前呼叫是否需要共享群视频席位。 */
  const isGroupVideoCall = (value: RtcCallView | null): boolean =>
    value !== null &&
    value.mediaMode === RtcMediaMode.VIDEO &&
    isRtcGroupCall(value);

  /** 停止当前群视频席位租约续期。 */
  const stopVideoLease = (): void => {
    if (videoLeaseTimer) clearInterval(videoLeaseTimer);
    videoLeaseTimer = undefined;
    videoLeaseRenewing = false;
  };

  /** 释放群视频席位；网络失败时依靠服务端租约自动过期。 */
  const releaseVideoSeat = async (callId: string): Promise<void> => {
    stopVideoLease();
    if (!videoSeatHeld) return;
    videoSeatHeld = false;
    try {
      await options.api.setVideoEnabled(callId, false);
    } catch {
      // 服务端租约会在节点中断或客户端异常退出后自动过期。
    }
  };

  /** 为正在发送视频的群成员续租席位，避免长通话中租约失效。 */
  const startVideoLease = (callId: string): void => {
    stopVideoLease();
    if (!videoSeatHeld) return;
    videoLeaseTimer = setInterval(() => {
      if (
        videoLeaseRenewing ||
        !videoSeatHeld ||
        call?.callId !== callId ||
        !isGroupVideoCall(call)
      )
        return;
      videoLeaseRenewing = true;
      void options.api
        .setVideoEnabled(callId, true)
        .then((allowed) => {
          if (allowed) return;
          videoSeatHeld = false;
          localVideoEnabled = false;
          options.onVideoCapabilityChanged?.(false);
          stopVideoLease();
        })
        .catch(() => {})
        .finally(() => {
          videoLeaseRenewing = false;
        });
    }, 30_000);
  };

  /** 关闭 LiveKit 房间并释放本地媒体。 */
  const disconnectRoom = async (releaseSeat = true): Promise<void> => {
    stopVideoLease();
    if (cameraTimer) clearInterval(cameraTimer);
    cameraTimer = undefined;
    mediaGeneration += 1;
    direct?.close();
    direct = null;
    const currentCall = call;
    const current = room;
    const pending = joiningRoom;
    stopLocalPreview();
    room = null;
    joiningRoom = null;
    joinPromise = null;
    options.onRoomChanged?.(null);
    options.onConnectionChanged?.(false);
    options.onParticipantsChanged?.([]);
    if (releaseSeat && currentCall && isGroupVideoCall(currentCall))
      await releaseVideoSeat(currentCall.callId);
    if (pending && pending !== current) await pending.disconnect();
    if (current) await current.disconnect();
  };

  /** 停止本地音视频及降噪图，使未完成的麦克风初始化失效。 */
  const stopLocalPreview = (): void => {
    cameraGeneration += 1;
    cameraOperation = null;
    activeCameraDeviceId = null;
    pendingCameraTracks.forEach((track) => track.stop());
    pendingCameraTracks.clear();
    microphoneGeneration += 1;
    microphoneSwitchPromise = null;
    localMicrophonePromise = null;
    localNoiseFilter?.dispose();
    localNoiseFilter = null;
    const track = localPreviewTrack;
    localPreviewTrack = null;
    if (track && track.readyState !== 'ended') track.stop();
    const microphoneTrack = localMicrophoneTrack;
    localMicrophoneTrack = null;
    if (microphoneTrack && microphoneTrack.readyState !== 'ended')
      microphoneTrack.stop();
    options.onLocalTrack?.(null);
  };

  /** 串行处理预览、发布及设备切换，挂断后新通话不等待旧设备请求。 */
  const queueCameraOperation = (
    operation: (isStale: () => boolean) => Promise<void>,
  ): Promise<void> => {
    const generation = cameraGeneration;
    const callId = call?.callId;
    /** 每次异步返回后复核原通话及媒体生命周期。 */
    const isStale = (): boolean =>
      disposed ||
      terminationRequested ||
      !callId ||
      call?.callId !== callId ||
      isTerminalCall(call) ||
      generation !== cameraGeneration;
    const pending = (cameraOperation ?? Promise.resolve())
      .catch(() => {})
      .then(async (): Promise<void> => {
        if (!isStale()) await operation(isStale);
      })
      .finally(() => {
        if (cameraOperation === pending) cameraOperation = null;
      });
    cameraOperation = pending;
    return pending;
  };

  /** 按精确设备标识采集视频，不申请麦克风，迟到流立即释放。 */
  const captureCamera = async (
    deviceId: string,
    isStale: () => boolean,
  ): Promise<MediaStreamTrack | null> => {
    let video: boolean | MediaTrackConstraints =
      deviceId === 'default' ? true : { deviceId: { exact: deviceId } };
    if (!isGroup(call)) {
      video = {
        width: { ideal: 1280, max: 1280 },
        height: { ideal: 720, max: 720 },
        frameRate: { ideal: 30, max: 30 },
        ...(deviceId === 'default' ? {} : { deviceId: { exact: deviceId } }),
      };
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video,
    });
    if (isStale()) {
      stream.getTracks().forEach((track) => track.stop());
      return null;
    }
    const [track] = stream.getVideoTracks();
    stream.getTracks().forEach((item) => {
      if (item !== track) item.stop();
    });
    if (!track) throw new Error('未找到可用的摄像头轨道');
    pendingCameraTracks.add(track);
    return track;
  };

  /** 新设备准备成功后替换发布轨道，原设备在提交成功前保持可用。 */
  const replaceCamera = async (
    deviceId: string,
    isStale: () => boolean,
  ): Promise<MediaStreamTrack | null> => {
    const track = await captureCamera(deviceId, isStale);
    if (!track) return null;
    const previous = localPreviewTrack;
    const currentRoom = room ?? joiningRoom;
    const publication = currentRoom
      ? getLocalCameraPublication(currentRoom)
      : undefined;
    const publishedTrack = publication?.videoTrack;
    const currentDirect = direct;
    try {
      if (currentDirect) await currentDirect.replaceVideo(track);
      if (publishedTrack) await publishedTrack.replaceTrack(track, true);
      if (isStale()) {
        track.stop();
        return null;
      }
      track.enabled = localVideoEnabled;
      if (!localVideoEnabled && publication) await publication.pauseUpstream();
      if (isStale()) {
        track.stop();
        return null;
      }
      localPreviewTrack = track;
      activeCameraDeviceId = deviceId;
      if (previous && previous !== track) previous.stop();
      options.onLocalTrack?.(track);
      return track;
    } catch (error: unknown) {
      if (isStale()) return null;
      // SDK 可能在发送器切换之后才报错，恢复旧轨道以保持真实选择。
      if (currentDirect && previous?.readyState === 'live') {
        try {
          await currentDirect.replaceVideo(previous);
        } catch {
          previous.stop();
        }
      }
      if (publishedTrack && previous?.readyState === 'live') {
        try {
          await publishedTrack.replaceTrack(previous, true);
          if (isStale()) {
            previous.stop();
            return null;
          }
          previous.enabled = localVideoEnabled;
          if (!localVideoEnabled) await publication?.pauseUpstream();
        } catch {
          previous.stop();
          if (isStale()) return null;
          localPreviewTrack = null;
          activeCameraDeviceId = null;
          localVideoEnabled = false;
          options.onCameraEnabledChanged?.(false);
          options.onLocalTrack?.(null);
          throw new Error('摄像头切换和恢复失败，请关闭后重新打开摄像头');
        }
      }
      throw error;
    } finally {
      pendingCameraTracks.delete(track);
      if (localPreviewTrack !== track) track.stop();
    }
  };

  /** 获取本次选中的摄像头轨道，仅在串行摄像头操作内调用。 */
  const ensureLocalVideoTrack = async (
    isStale: () => boolean,
  ): Promise<MediaStreamTrack | null> => {
    if (isStale() || !localVideoEnabled) return null;
    if (
      localPreviewTrack?.readyState === 'live' &&
      activeCameraDeviceId === cameraDeviceId
    )
      return localPreviewTrack;
    const track = await replaceCamera(cameraDeviceId, isStale);
    if (track && !isStale()) options.onCameraDeviceChanged?.(cameraDeviceId);
    return track;
  };

  /** 获取可在振铃阶段复用的本地麦克风轨道。*/
  const ensureLocalMicrophoneTrack = async (
    deviceId: string = microphoneDeviceId,
  ): Promise<MediaStreamTrack | null> => {
    if (disposed || terminationRequested || !call || isTerminalCall(call))
      return null;
    if (localMicrophoneTrack?.readyState === 'live')
      return localMicrophoneTrack;
    if (localMicrophonePromise) return localMicrophonePromise;
    const callId = call.callId;
    const generation = microphoneGeneration;
    /** 采集和模型初始化结束后均核对原通话，拒绝迟到轨道。 */
    const isStale = (): boolean =>
      disposed ||
      terminationRequested ||
      call?.callId !== callId ||
      isTerminalCall(call) ||
      microphoneGeneration !== generation;
    const pending = navigator.mediaDevices
      .getUserMedia({
        video: false,
        audio: {
          ...LOCAL_MICROPHONE_CONSTRAINTS,
          ...(deviceId === 'default' ? {} : { deviceId: { exact: deviceId } }),
        },
      })
      .then(async (stream): Promise<MediaStreamTrack | null> => {
        if (isStale()) {
          stream.getTracks().forEach((track) => track.stop());
          return null;
        }
        const [track] = stream.getAudioTracks();
        if (!track) {
          stream.getTracks().forEach((item) => item.stop());
          throw new Error('未找到可用的麦克风轨道');
        }
        let filter: RtcNoiseFilter | null = null;
        try {
          filter = createRtcNoiseFilter();
          localNoiseFilter = filter;
          filter.setEnabled(localMicrophoneEnabled);
          filter.setVolume(microphoneVolume);
          const filteredTrack = await filter.initialize(track);
          if (isStale()) {
            filter.dispose();
            return null;
          }
          localMicrophoneTrack = filteredTrack;
          microphoneDeviceId = deviceId;
          options.onMicrophoneDeviceChanged?.(deviceId);
          return filteredTrack;
        } catch (error: unknown) {
          filter?.dispose();
          stream.getTracks().forEach((item) => item.stop());
          if (localNoiseFilter === filter) localNoiseFilter = null;
          if (isStale()) return null;
          throw error;
        }
      })
      .catch((error: unknown): null => {
        if (isStale()) return null;
        throw error;
      })
      .finally(() => {
        if (localMicrophonePromise === pending) localMicrophonePromise = null;
      });
    localMicrophonePromise = pending;
    return pending;
  };

  /** 新设备采集成功后原位切换降噪输入，失败继续使用原设备。 */
  const setMicrophoneDevice = (deviceId: string): Promise<void> => {
    if (disposed || !call || isTerminalCall(call))
      return Promise.reject(new Error('RTC 呼叫已关闭'));
    if (!deviceId.trim())
      return Promise.reject(new Error('请选择有效的麦克风'));
    if (microphoneSwitchPromise)
      return Promise.reject(new Error('正在切换麦克风，请稍候'));
    const callId = call.callId;
    const generation = microphoneGeneration;
    /** 挂断或换通话后拒绝迟到的设备授权结果。 */
    const isStale = (): boolean =>
      disposed ||
      call?.callId !== callId ||
      isTerminalCall(call) ||
      generation !== microphoneGeneration;
    /** 等待已有初始化，并在原通话内提交新输入设备。 */
    const switchInput = async (): Promise<void> => {
      if (localMicrophonePromise) {
        try {
          await localMicrophonePromise;
        } catch {
          // 默认设备初始化失败时，仍允许用户选择另一台设备。
        }
      }
      if (isStale()) return;
      const filter = localNoiseFilter;
      if (!filter || localMicrophoneTrack?.readyState !== 'live') {
        await ensureLocalMicrophoneTrack(deviceId);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: false,
        audio: {
          ...LOCAL_MICROPHONE_CONSTRAINTS,
          ...(deviceId === 'default' ? {} : { deviceId: { exact: deviceId } }),
        },
      });
      if (isStale() || localNoiseFilter !== filter) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const [track] = stream.getAudioTracks();
      if (!track) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error('未找到可用的麦克风轨道');
      }
      try {
        filter.replaceInput(track);
        microphoneDeviceId = deviceId;
        options.onMicrophoneDeviceChanged?.(deviceId);
      } catch (error: unknown) {
        stream.getTracks().forEach((item) => item.stop());
        throw error;
      }
    };
    const pending = switchInput().finally(() => {
      if (microphoneSwitchPromise === pending) microphoneSwitchPromise = null;
    });
    microphoneSwitchPromise = pending;
    return pending;
  };

  /** 查找当前 LiveKit 房间中复用的本地摄像头发布物。*/
  const getLocalCameraPublication = (
    currentRoom: Room,
  ): LocalTrackPublication | undefined =>
    [...currentRoom.localParticipant.videoTrackPublications.values()].find(
      (publication) => publication.source === Track.Source.Camera,
    );

  /** 摄像头故障只释放本地视频及群视频席位，不停止音频或远端订阅。 */
  const disableFailedCamera = async (isStale: () => boolean): Promise<void> => {
    if (isStale()) return;
    const currentCall = call;
    const currentRoom = room ?? joiningRoom;
    const publication = currentRoom
      ? getLocalCameraPublication(currentRoom)
      : undefined;
    const track = localPreviewTrack;
    try {
      await direct?.replaceVideo(null);
    } catch {
      // 停止本地轨道仍能阻止发送，不因发送器清理失败挂断语音。
    }
    if (isStale()) return;
    localPreviewTrack = null;
    activeCameraDeviceId = null;
    localVideoEnabled = false;
    if (track) track.stop();
    publication?.track?.mediaStreamTrack.stop();
    options.onCameraEnabledChanged?.(false);
    notifyCameraState();
    options.onLocalTrack?.(null);
    if (currentRoom && publication?.track) {
      try {
        await currentRoom.localParticipant.unpublishTrack(
          publication.track,
          true,
        );
      } catch (error: unknown) {
        // 已停止采集；清理发布物失败不能再升级为整个通话失败。
        console.warn(
          `RTC 摄像头发布清理失败: ${readRtcConnectionError(error)}`,
        );
      }
    }
    if (!isStale() && currentCall && isGroupVideoCall(currentCall))
      await releaseVideoSeat(currentCall.callId);
  };

  /** 查找当前 LiveKit 房间中复用的本地麦克风发布物。*/
  const getLocalMicrophonePublication = (
    currentRoom: Room,
  ): LocalTrackPublication | undefined =>
    [...currentRoom.localParticipant.audioTrackPublications.values()].find(
      (publication) => publication.source === Track.Source.Microphone,
    );

  /** 注册 LiveKit 事件并连接到服务端房间。 */
  const connectRoom = async (current: RtcCallView): Promise<void> => {
    const generation = mediaGeneration;
    const shouldAbortJoin = (): boolean =>
      disposed ||
      terminationRequested ||
      generation !== mediaGeneration ||
      call?.callId !== current.callId ||
      isTerminalCall(call);
    if (shouldAbortJoin()) return;
    const credential = await options.api.issueToken(current.callId);
    if (shouldAbortJoin()) return;
    if (isGroupVideoCall(current)) {
      videoSeatHeld = credential.videoAllowed;
      if (!localVideoEnabled) {
        await releaseVideoSeat(current.callId);
        if (shouldAbortJoin()) return;
      } else {
        localVideoEnabled = credential.videoAllowed;
        options.onVideoCapabilityChanged?.(credential.videoAllowed);
        if (videoSeatHeld) startVideoLease(current.callId);
      }
    }
    const nextRoom = new Room({
      dynacast: true,
      publishDefaults: {
        simulcast: true,
        videoCodec: 'vp8',
        videoEncoding: { maxBitrate: 1_800_000, maxFramerate: 30 },
        degradationPreference: 'balanced',
      },
    });
    joiningRoom = nextRoom;
    /** 入会顺序来自媒体服务，静音、订阅顺序及说话状态不改变排位。 */
    const publishParticipants = (): void => {
      if (
        shouldAbortJoin() ||
        !options.onParticipantsChanged ||
        (room !== nextRoom && joiningRoom !== nextRoom)
      )
        return;
      const allowed = new Set(
        current.participants.map((participant) => participant.uid),
      );
      const participants = [
        nextRoom.localParticipant,
        ...nextRoom.remoteParticipants.values(),
      ]
        .filter((participant) => allowed.has(participant.identity))
        .sort((left, right) => {
          const order =
            (left.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (right.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER);
          return order || left.sid.localeCompare(right.sid);
        })
        .map((participant): RtcRoomParticipant => ({
          identity: participant.identity,
          name: participant.name || `用户 ${participant.identity}`,
          joinedAt: participant.joinedAt?.getTime() ?? Number.MAX_SAFE_INTEGER,
          speaking: participant.isSpeaking,
          cameraEnabled: participant.isCameraEnabled,
        }));
      options.onParticipantsChanged(participants);
    };
    nextRoom.on(RoomEvent.ParticipantConnected, publishParticipants);
    nextRoom.on(RoomEvent.ParticipantDisconnected, publishParticipants);
    nextRoom.on(RoomEvent.ActiveSpeakersChanged, publishParticipants);
    nextRoom.on(RoomEvent.TrackMuted, publishParticipants);
    nextRoom.on(RoomEvent.TrackUnmuted, publishParticipants);
    nextRoom.on(RoomEvent.TrackPublished, publishParticipants);
    nextRoom.on(RoomEvent.TrackUnpublished, publishParticipants);
    nextRoom.on(RoomEvent.ParticipantNameChanged, publishParticipants);
    nextRoom.on(RoomEvent.Reconnected, publishParticipants);
    nextRoom.on(RoomEvent.Reconnecting, (): void => {
      if (!shouldAbortJoin()) options.onConnectionChanged?.(false);
    });
    nextRoom.on(RoomEvent.Reconnected, (): void => {
      if (!shouldAbortJoin()) options.onConnectionChanged?.(true);
    });
    nextRoom.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        if (shouldAbortJoin()) return;
        options.onRemoteTrack?.(track.mediaStreamTrack, participant.identity);
        publishParticipants();
      },
    );
    nextRoom.on(
      RoomEvent.TrackUnsubscribed,
      (
        track: RemoteTrack,
        _publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        options.onRemoteTrackUnsubscribed?.(
          track.mediaStreamTrack,
          participant.identity,
        );
        publishParticipants();
      },
    );
    nextRoom.on(RoomEvent.LocalTrackPublished, (publication) => {
      if (shouldAbortJoin()) return;
      if (publication.kind === Track.Kind.Video && publication.track)
        options.onLocalTrack?.(publication.track.mediaStreamTrack);
      publishParticipants();
    });
    nextRoom.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      if (shouldAbortJoin()) return;
      if (publication.kind === Track.Kind.Video) options.onLocalTrack?.(null);
      publishParticipants();
    });
    nextRoom.on(RoomEvent.Disconnected, (): void => {
      if (room === nextRoom) {
        room = null;
        stopLocalPreview();
        options.onRoomChanged?.(null);
        options.onConnectionChanged?.(false);
        options.onParticipantsChanged?.([]);
      }
    });
    try {
      await nextRoom.connect(credential.serverUrl, credential.token, {
        autoSubscribe: true,
      });
      if (shouldAbortJoin()) return;
      publishParticipants();
      const microphoneTrack = await ensureLocalMicrophoneTrack();
      if (microphoneTrack && !shouldAbortJoin()) {
        const publication = await nextRoom.localParticipant.publishTrack(
          microphoneTrack,
          {
            source: Track.Source.Microphone,
            forceStereo: false,
          },
        );
        if (!localMicrophoneEnabled) await publication.mute();
      }
      if (current.mediaMode === RtcMediaMode.VIDEO && localVideoEnabled) {
        await queueCameraOperation(async (isStale): Promise<void> => {
          try {
            const track = await ensureLocalVideoTrack(isStale);
            if (!track || isStale() || shouldAbortJoin()) return;
            await nextRoom.localParticipant.publishTrack(track, {
              source: Track.Source.Camera,
            });
            if (!isStale()) options.onLocalTrack?.(track);
          } catch (error: unknown) {
            if (isStale() || shouldAbortJoin()) return;
            await disableFailedCamera(isStale);
            if (!isStale()) options.onCameraError?.(error);
          }
        });
      }
      if (shouldAbortJoin()) return;
      for (const publication of nextRoom.localParticipant.videoTrackPublications.values()) {
        if (localVideoEnabled && publication.track)
          options.onLocalTrack?.(publication.track.mediaStreamTrack);
      }
      room = nextRoom;
      console.info(
        `RTC media connected: callId=${current.callId}, transport=SFU`,
      );
      options.onRoomChanged?.(nextRoom);
      options.onConnectionChanged?.(true);
      publishParticipants();
      startCameraSync();
    } catch (error: unknown) {
      if (shouldAbortJoin()) return;
      console.error(
        `RTC LiveKit connection or media failed: callId=${current.callId}, ` +
          `serverOrigin=${readRtcServerOrigin(credential.serverUrl)}, ` +
          `error=${readRtcConnectionError(error)}`,
      );
      stopLocalPreview();
      throw error;
    } finally {
      if (joiningRoom === nextRoom) joiningRoom = null;
      if (room !== nextRoom) {
        await nextRoom.disconnect();
        if (!shouldAbortJoin() && !room) options.onRoomChanged?.(null);
      }
    }
  };

  /** 单聊准备现有采集轨道后建立直连；只有服务端确认 SFU 才进入房间。 */
  const connectMedia = async (current: RtcCallView): Promise<void> => {
    const api = options.api.media;
    if (isGroup(current) || !api) {
      await connectRoom(current);
      return;
    }
    const generation = mediaGeneration;
    /** 拒绝挂断、卸载和设备生命周期变化后的迟到初始化。 */
    const stale = (): boolean =>
      disposed ||
      terminationRequested ||
      generation !== mediaGeneration ||
      call?.callId !== current.callId ||
      isTerminalCall(call);
    const microphone = await ensureLocalMicrophoneTrack();
    if (!microphone || stale()) return;
    if (localVideoEnabled) {
      await queueCameraOperation(async (isStale): Promise<void> => {
        try {
          await ensureLocalVideoTrack(isStale);
        } catch (error: unknown) {
          if (isStale()) return;
          await disableFailedCamera(isStale);
          if (!isStale()) options.onCameraError?.(error);
        }
      });
    }
    if (stale()) return;
    const controller = createRtcDirect({
      call: current,
      userId: options.userId,
      api,
      microphone,
      video: (): MediaStreamTrack | null => localPreviewTrack,
      onConnected: (connected): void => {
        if (!stale()) options.onConnectionChanged?.(connected);
      },
      onTrack: (track, identity): void => {
        if (!stale()) options.onRemoteTrack?.(track, identity);
      },
      onTrackRemoved: (track, identity): void => {
        if (!stale()) options.onRemoteTrackUnsubscribed?.(track, identity);
      },
      onFallback: async (): Promise<void> => {
        if (!stale() && !room) await connectRoom(current);
      },
      onError: (error): void => {
        if (stale()) return;
        options.onMediaError?.(error);
        // 媒体接口会拒绝终态；补读业务状态，避免丢失挂断 SSE 后保留旧直连。
        void refresh().catch(() => {});
      },
    });
    direct = controller;
    await controller.start();
    if (!stale()) startCameraSync();
  };

  /** HTTP 接听响应和 SSE 共享同一次入会，避免重复连接和采集麦克风。 */
  const joinRoom = (current: RtcCallView): Promise<void> => {
    if (
      current.deviceOwnership !== RtcDeviceOwnership.CURRENT_DEVICE ||
      disposed ||
      terminationRequested ||
      isTerminalCall(call) ||
      room ||
      direct
    )
      return Promise.resolve();
    if (joinPromise) return joinPromise;
    const pending = connectMedia(current).finally(() => {
      if (joinPromise === pending) joinPromise = null;
    });
    joinPromise = pending;
    return pending;
  };

  /** 确认当前存在可操作的呼叫。 */
  const requireCall = (): RtcCallView => {
    if (disposed || !call) throw new Error('RTC 呼叫已关闭');
    return call;
  };

  /** 丢失设备归属时只释放本机资源，禁止发送挂断或群视频席位释放。 */
  const dismissOtherDevice = (callId: string): void => {
    if (disposed) return;
    disposed = true;
    localAccepted = false;
    terminationRequested = true;
    console.info(RtcAuditEvent.POPUP_DISMISSED_ELSEWHERE, { callId });
    void disconnectRoom(false).catch((): void => {});
    options.onAnsweredElsewhere?.(callId);
  };

  /** 按本人响应投影窗口状态；其他成员接听不能替本人自动接听。 */
  const applySnapshot = async (next: RtcCallView): Promise<void> => {
    if (
      disposed ||
      (call &&
        (call.callId !== next.callId ||
          isTerminalCall(call) ||
          next.version < call.version))
    )
      return;
    if (isTerminalCall(next)) {
      updateCall(next);
      await disconnectRoom();
      return;
    }
    if (!canUseRtcDevice(next)) {
      dismissOtherDevice(next.callId);
      return;
    }
    const ownState = next.participants.find(
      (participant) => participant.uid === options.userId,
    )?.state;
    switch (ownState) {
      case RtcParticipantState.REJECTED:
        updateCall({ ...next, state: RtcCallState.REJECTED });
        await disconnectRoom();
        return;
      case RtcParticipantState.EXPIRED:
        updateCall({ ...next, state: RtcCallState.EXPIRED });
        await disconnectRoom();
        return;
      case RtcParticipantState.LEFT:
        updateCall({ ...next, state: RtcCallState.ENDED });
        await disconnectRoom();
        return;
      case RtcParticipantState.ACCEPTED:
        localAccepted = true;
        break;
      case RtcParticipantState.INVITED:
        localAccepted = false;
        break;
      default:
        break;
    }
    const shouldJoin = next.callerUid === options.userId || localAccepted;
    if (
      !shouldJoin &&
      (next.state === RtcCallState.ACCEPTED ||
        next.state === RtcCallState.CONNECTED)
    ) {
      updateCall({ ...next, state: RtcCallState.RINGING });
      return;
    }
    updateCall(next);
    if (
      shouldJoin &&
      (next.state === RtcCallState.ACCEPTED ||
        next.state === RtcCallState.CONNECTED)
    )
      await joinRoom(next);
  };

  /** 超时确认和断线恢复读取完整快照，版本较旧或其他通话的迟到响应不会覆盖当前状态。 */
  const refresh = async (): Promise<void> => {
    const current = requireCall();
    const next = await options.api.getCall(current.callId);
    if (disposed || call?.callId !== current.callId || isTerminalCall(call))
      return;
    await applySnapshot(next);
    if (cameraTimer) notifyCameraState();
  };

  /** 仅发起端在截止后提交断开请求；重复触发共用请求，接听及终态竞争由服务端裁决。 */
  const expireInvitations = (): Promise<void> => {
    const current = call;
    if (
      disposed ||
      !current ||
      current.callerUid !== options.userId ||
      !hasRtcPendingInvitations(current) ||
      readRtcInvitationDeadline(current) > Date.now()
    )
      return Promise.resolve();
    if (invitationExpiryPromise) return invitationExpiryPromise;
    const pending = options.api
      .expireCall(current.callId, newRtcRequestId(), current.version)
      .then(async (next): Promise<void> => {
        if (disposed || call?.callId !== current.callId || isTerminalCall(call))
          return;
        await applySnapshot(next);
      })
      .finally((): void => {
        if (invitationExpiryPromise === pending) invitationExpiryPromise = null;
      });
    invitationExpiryPromise = pending;
    return pending;
  };

  /** 处理呼叫事件并按需加入或退出 LiveKit 房间。 */
  const handleEvent = async (event: RtcEvent): Promise<void> => {
    if (disposed || handledEvents.has(event.eventId)) return;
    handledEvents.add(event.eventId);
    if (handledEvents.size > 512)
      handledEvents.delete(handledEvents.values().next().value as string);
    if (event.toUid !== options.userId) return;
    if (!call || call.callId !== event.callId) {
      if (event.eventType !== RtcEventType.RTC_CALL_CREATED) return;
      updateCall(await options.api.getCall(event.callId));
    }
    const current = requireCall();
    if (isTerminalCall(current)) return;
    if (event.roomId !== current.roomId) return;
    if (event.eventType === RtcEventType.RTC_CALL_ANSWERED_ELSEWHERE) {
      // 接听事件与普通状态事件可能同版本，仍须复核设备归属。
      if (event.fromUid === options.userId) await refresh();
      return;
    }
    if (event.eventType === RtcEventType.RTC_CAMERA_UPDATED) {
      if (!event.fromUid || !event.payload) return;
      const state = parseRtcCameraState(event.payload);
      if (event.signalSeq !== String(state.version)) return;
      applyCameraStates({ [event.fromUid]: state });
      return;
    }
    if (event.eventType === RtcEventType.RTC_MEDIA_UPDATED) {
      await direct?.refresh();
      return;
    }
    if (event.callVersion > current.version) {
      switch (event.eventType) {
        case RtcEventType.RTC_CALL_REJECTED:
        case RtcEventType.RTC_CALL_CANCELED:
        case RtcEventType.RTC_CALL_ENDED:
        case RtcEventType.RTC_CALL_EXPIRED:
          updateCall({
            ...current,
            state: readTerminalState(event.eventType),
            version: event.callVersion,
            participants: current.participants.map((participant) => {
              if (participant.state !== RtcParticipantState.INVITED)
                return participant;
              if (event.eventType === RtcEventType.RTC_CALL_EXPIRED)
                return { ...participant, state: RtcParticipantState.EXPIRED };
              if (event.eventType === RtcEventType.RTC_CALL_REJECTED)
                return { ...participant, state: RtcParticipantState.REJECTED };
              return participant;
            }),
          });
          await disconnectRoom();
          return;
        default:
          break;
      }
    }
    if (
      current.participants.some(
        (participant) => participant.state !== undefined,
      )
    ) {
      if (event.callVersion <= current.version) return;
      switch (event.eventType) {
        case RtcEventType.RTC_CALL_ACCEPTED:
        case RtcEventType.RTC_CALL_PARTICIPANT_ACCEPTED:
        case RtcEventType.RTC_CALL_PARTICIPANT_REJECTED:
        case RtcEventType.RTC_CALL_PARTICIPANT_LEFT:
        case RtcEventType.RTC_CALL_PARTICIPANTS_EXPIRED:
        case RtcEventType.RTC_CALL_REJECTED:
        case RtcEventType.RTC_CALL_CANCELED:
        case RtcEventType.RTC_CALL_ENDED:
        case RtcEventType.RTC_CALL_EXPIRED:
          await refresh();
          return;
        default:
          return;
      }
    }
    if (
      (event.eventType === RtcEventType.RTC_CALL_PARTICIPANT_REJECTED ||
        event.eventType === RtcEventType.RTC_CALL_PARTICIPANT_LEFT) &&
      event.fromUid === options.userId
    ) {
      updateCall({
        ...current,
        state:
          event.eventType === RtcEventType.RTC_CALL_PARTICIPANT_REJECTED
            ? RtcCallState.REJECTED
            : RtcCallState.ENDED,
      });
      await disconnectRoom();
      return;
    }
    if (
      event.eventType === RtcEventType.RTC_CALL_PARTICIPANT_ACCEPTED &&
      event.fromUid === options.userId
    ) {
      localAccepted = true;
      const next: RtcCallView = {
        ...current,
        state: RtcCallState.ACCEPTED,
        version: Math.max(current.version, event.callVersion),
      };
      updateCall(next);
      await joinRoom(next);
      return;
    }
    if (event.callVersion <= current.version) return;
    switch (event.eventType) {
      case RtcEventType.RTC_CALL_ACCEPTED: {
        const shouldJoin =
          !isGroup(current) ||
          current.callerUid === options.userId ||
          localAccepted;
        const next: RtcCallView = {
          ...current,
          state: shouldJoin ? RtcCallState.ACCEPTED : RtcCallState.RINGING,
          version: event.callVersion,
        };
        updateCall(next);
        if (shouldJoin) await joinRoom(next);
        break;
      }
      case RtcEventType.RTC_CALL_REJECTED:
      case RtcEventType.RTC_CALL_CANCELED:
      case RtcEventType.RTC_CALL_ENDED:
      case RtcEventType.RTC_CALL_EXPIRED:
        updateCall({
          ...current,
          state: readTerminalState(event.eventType),
          version: event.callVersion,
        });
        await disconnectRoom();
        break;
      default:
        break;
    }
  };

  /** 接听呼叫并加入对应的 LiveKit 房间。 */
  const accept = async (): Promise<RtcCallView> => {
    const current = requireCall();
    let next: RtcCallView;
    try {
      next = await options.api.acceptCall(
        current.callId,
        newRtcRequestId(),
        rtcActionVersion(current, options.userId),
      );
    } catch (cause) {
      if (cause instanceof ApiResponseError && cause.errCode === 46001) {
        dismissOtherDevice(current.callId);
        throw cause;
      }
      // Electron 会丢弃异常自定义属性；以权威快照收敛，不匹配错误文案。
      if (!disposed) await refresh().catch((): void => {});
      throw cause;
    }
    if (disposed || call?.callId !== current.callId || isTerminalCall(call))
      return next;
    if (
      !next.participants.some((participant) => participant.state !== undefined)
    )
      localAccepted = true;
    await applySnapshot(next);
    return next;
  };

  /** 调用群成员离开接口，并只结束当前客户端的媒体会话。 */
  const apiLeave = async (current: RtcCallView): Promise<RtcCallView> => {
    const next = await options.api.leaveCall(
      current.callId,
      newRtcRequestId(),
      rtcActionVersion(current, options.userId),
    );
    if (
      next.participants.some((participant) => participant.state !== undefined)
    ) {
      await applySnapshot(next);
    } else {
      updateCall(
        isGroup(current) ? { ...current, state: RtcCallState.ENDED } : next,
      );
      await disconnectRoom();
    }
    return next;
  };

  /** 单聊结束立即停止本机媒体；晚到的接听或重连响应不能再次入会。 */
  const forceHangup = (): Promise<RtcCallView> => {
    if (terminationPromise) return terminationPromise;
    const current = requireCall();
    terminationRequested = true;
    void disconnectRoom().catch((cause: unknown): void => {
      options.onMediaError?.(
        cause instanceof Error ? cause : new Error('媒体资源释放失败'),
      );
    });
    const pending = options.api
      .hangupCall(current.callId, newRtcRequestId(), current.version)
      .then((next: RtcCallView): RtcCallView => {
        if (!isTerminalCall(next)) throw new Error('服务端尚未确认结束通话');
        updateCall(next);
        return next;
      })
      .finally((): void => {
        if (terminationPromise === pending) terminationPromise = null;
      });
    terminationPromise = pending;
    return pending;
  };

  return {
    getCall: (): RtcCallView | null => call,
    refresh,
    expireInvitations,
    prepareLocalVideo: async (): Promise<MediaStreamTrack | null> => {
      const current = requireCall();
      if (terminationRequested || current.mediaMode !== RtcMediaMode.VIDEO)
        return null;
      let track: MediaStreamTrack | null = null;
      await queueCameraOperation(async (isStale): Promise<void> => {
        try {
          track = await ensureLocalVideoTrack(isStale);
        } catch (error: unknown) {
          if (isStale()) return;
          await disableFailedCamera(isStale);
          if (!isStale()) throw error;
        }
      });
      return track;
    },
    restore: async (value: RtcCallView): Promise<void> => {
      if (disposed) return;
      localAccepted = !isGroup(value) || value.callerUid === options.userId;
      await applySnapshot(value);
    },
    startCall: async (
      roomId: string,
      mediaMode: RtcMediaMode,
    ): Promise<RtcCallView> => {
      if (disposed || call) throw new Error('已有活动 RTC 呼叫');
      const next = await options.api.createCall(
        roomId,
        mediaMode,
        newRtcRequestId(),
      );
      localAccepted = false;
      updateCall(next);
      return next;
    },
    accept,
    reject: async (): Promise<RtcCallView> => {
      const current = requireCall();
      if (!isGroup(current)) return forceHangup();
      const next = await options.api.rejectCall(
        current.callId,
        newRtcRequestId(),
        rtcActionVersion(current, options.userId),
      );
      if (
        next.participants.some((participant) => participant.state !== undefined)
      ) {
        await applySnapshot(next);
        return call ?? next;
      } else {
        updateCall(
          isGroup(current)
            ? { ...current, state: RtcCallState.REJECTED }
            : next,
        );
        await disconnectRoom();
      }
      return isGroup(current)
        ? { ...current, state: RtcCallState.REJECTED }
        : next;
    },
    cancel: async (): Promise<RtcCallView> => {
      const current = requireCall();
      if (!isGroup(current)) return forceHangup();
      const next = await options.api.cancelCall(
        current.callId,
        newRtcRequestId(),
        rtcActionVersion(current, options.userId),
      );
      await applySnapshot(next);
      return next;
    },
    hangup: async (): Promise<RtcCallView> => {
      const current = requireCall();
      if (!isGroup(current)) return forceHangup();
      return apiLeave(current);
    },
    leave: async (): Promise<RtcCallView> => {
      const current = requireCall();
      return apiLeave(current);
    },
    setMicrophoneEnabled: async (enabled: boolean): Promise<boolean> => {
      localMicrophoneEnabled = enabled;
      localNoiseFilter?.setEnabled(enabled);
      if (!room) {
        if (!enabled) return false;
        const track = await ensureLocalMicrophoneTrack();
        localNoiseFilter?.setEnabled(localMicrophoneEnabled);
        return track !== null && localMicrophoneEnabled;
      }
      const currentRoom = room;
      const publication = getLocalMicrophonePublication(currentRoom);
      if (!publication) {
        const track = await ensureLocalMicrophoneTrack();
        if (!track || room !== currentRoom || disposed || isTerminalCall(call))
          return false;
        const nextPublication = await currentRoom.localParticipant.publishTrack(
          track,
          {
            source: Track.Source.Microphone,
            forceStereo: false,
          },
        );
        if (enabled) await nextPublication.unmute();
        else await nextPublication.mute();
        return enabled;
      }
      if (enabled) await publication.unmute();
      else await publication.mute();
      return enabled;
    },
    setMicrophoneDevice,
    /** 保存当前通话输入音量，并同步已经初始化的发送增益。 */
    setMicrophoneVolume: (volume: number): void => {
      if (!Number.isFinite(volume)) throw new Error('麦克风输入音量无效');
      if (disposed || !call || isTerminalCall(call)) return;
      microphoneVolume = Math.min(100, Math.max(0, volume));
      localNoiseFilter?.setVolume(microphoneVolume);
    },
    setCameraDevice: async (deviceId: string): Promise<void> => {
      const current = requireCall();
      if (isTerminalCall(current) || current.mediaMode !== RtcMediaMode.VIDEO)
        throw new Error('当前通话不能切换摄像头');
      if (!deviceId.trim()) throw new Error('请选择有效的摄像头');
      await queueCameraOperation(async (isStale): Promise<void> => {
        if (
          cameraDeviceId === deviceId &&
          (!localVideoEnabled ||
            (activeCameraDeviceId === deviceId &&
              localPreviewTrack?.readyState === 'live'))
        )
          return;
        // 关闭时只记住下次启用的设备，不能因选择菜单暗中开启采集或发送。
        if (localVideoEnabled) {
          try {
            const track = await replaceCamera(deviceId, isStale);
            if (!track || isStale()) return;
          } catch (error: unknown) {
            if (isStale()) return;
            if (localPreviewTrack?.readyState !== 'live')
              await disableFailedCamera(isStale);
            if (!isStale()) throw error;
            return;
          }
        }
        cameraDeviceId = deviceId;
        options.onCameraDeviceChanged?.(deviceId);
      });
    },
    setCameraEnabled: async (enabled: boolean): Promise<boolean> => {
      const current = requireCall();
      if (isTerminalCall(current) || current.mediaMode !== RtcMediaMode.VIDEO)
        return false;
      if (isGroupVideoCall(current)) {
        const hadVideoSeat = videoSeatHeld;
        const allowed = await options.api.setVideoEnabled(
          current.callId,
          enabled,
        );
        if (disposed || call?.callId !== current.callId || isTerminalCall(call))
          return false;
        if (enabled && !allowed) {
          localVideoEnabled = false;
          videoSeatHeld = false;
          stopVideoLease();
          options.onVideoCapabilityChanged?.(false);
          return false;
        }
        videoSeatHeld = enabled;
        if (enabled) startVideoLease(current.callId);
        else stopVideoLease();
        if (enabled && !hadVideoSeat && room) {
          localVideoEnabled = true;
          await disconnectRoom(false);
          if (
            disposed ||
            call?.callId !== current.callId ||
            isTerminalCall(call)
          )
            return false;
          await joinRoom(current);
          return (
            !disposed &&
            call?.callId === current.callId &&
            !isTerminalCall(call) &&
            localVideoEnabled
          );
        }
      }
      let result = false;
      await queueCameraOperation(async (isStale): Promise<void> => {
        const previousEnabled = localVideoEnabled;
        localVideoEnabled = enabled;
        try {
          const currentRoom = room ?? joiningRoom;
          const publication = currentRoom
            ? getLocalCameraPublication(currentRoom)
            : undefined;
          if (!enabled) {
            if (localPreviewTrack) localPreviewTrack.enabled = false;
            if (publication) await publication.pauseUpstream();
            if (!isStale()) options.onCameraEnabledChanged?.(false);
            return;
          }
          const track = await ensureLocalVideoTrack(isStale);
          if (!track || isStale()) return;
          track.enabled = true;
          if (publication) await publication.resumeUpstream();
          else if (room) {
            await room.localParticipant.publishTrack(track, {
              source: Track.Source.Camera,
            });
          }
          if (isStale()) return;
          options.onLocalTrack?.(track);
          options.onCameraEnabledChanged?.(true);
          result = true;
        } catch (error: unknown) {
          if (isStale()) return;
          if (enabled) {
            await disableFailedCamera(isStale);
          } else {
            localVideoEnabled =
              previousEnabled && localPreviewTrack?.readyState === 'live';
            if (localPreviewTrack)
              localPreviewTrack.enabled = localVideoEnabled;
            options.onCameraEnabledChanged?.(localVideoEnabled);
          }
          if (!isStale()) throw error;
        } finally {
          if (!isStale()) notifyCameraState();
        }
      });
      return result;
    },
    dismiss: (): void => {
      if (!isTerminalCall(call)) return;
      invitationExpiryPromise = null;
      stopLocalPreview();
      localMicrophoneEnabled = true;
      microphoneDeviceId = 'default';
      microphoneVolume = 100;
      options.onMicrophoneDeviceChanged?.(microphoneDeviceId);
      localVideoEnabled = true;
      cameraDeviceId = 'default';
      options.onCameraDeviceChanged?.(cameraDeviceId);
      localAccepted = false;
      updateCall(null);
    },
    handleSse: async (raw: ResourceSseMessage): Promise<void> => {
      const event = parseRtcEvent(raw);
      if (event) await handleEvent(event);
    },
    close: (): void => {
      if (disposed) return;
      disposed = true;
      localAccepted = false;
      void disconnectRoom(
        call?.deviceOwnership === RtcDeviceOwnership.CURRENT_DEVICE,
      );
      updateCall(null);
    },
  };
};
