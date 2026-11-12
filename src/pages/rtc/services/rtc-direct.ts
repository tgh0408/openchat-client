import { type RtcCallView, RtcMediaMode } from '../../../../shared/rtc/rtc';
import type {
  RtcMediaApi,
  RtcMediaSignal,
  RtcMediaView,
} from '../../../../shared/rtc/rtc-media';
import {
  createRtcQualityPolicy,
  createRtcStatsSampler,
  RTC_VIDEO_LEVELS,
} from './rtc-quality';

export interface RtcDirect {
  start: () => Promise<void>;
  refresh: () => Promise<void>;
  replaceVideo: (track: MediaStreamTrack | null) => Promise<void>;
  close: () => void;
}

interface RtcDirectOptions {
  call: RtcCallView;
  userId: string;
  api: RtcMediaApi;
  microphone: MediaStreamTrack;
  video: () => MediaStreamTrack | null;
  onConnected: (connected: boolean) => void;
  onTrack: (track: MediaStreamTrack, identity: string) => void;
  onTrackRemoved: (track: MediaStreamTrack, identity: string) => void;
  onFallback: () => Promise<void>;
  onError: (error: Error) => void;
}

/** 单通话的原生 WebRTC 引擎适配；固定主叫 Offer，非 trickle 协商避免乱序候选队列。 */
export const createRtcDirect = (options: RtcDirectOptions): RtcDirect => {
  const caller = options.userId === options.call.callerUid;
  const remoteUid = caller ? options.call.calleeUid : options.call.callerUid;
  if (options.call.calleeUid === null || remoteUid === null)
    throw new Error('群通话不能使用单聊直连');
  const offerRequestId = crypto.randomUUID().replace(/-/g, '');
  const quality = createRtcQualityPolicy();
  const sampler = createRtcStatsSampler();
  let pc: RTCPeerConnection | null = null;
  let videoSender: RTCRtpSender | null = null;
  let closed = false;
  let fallback = false;
  let switched = false;
  let startedAt = 0;
  let connected = false;
  let disconnectedAt = 0;
  let revision = 0;
  let pendingSignal: RtcMediaSignal | null = null;
  let synchronizing: Promise<void> | null = null;
  let sampling = false;
  let parameterTask: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let statsTimer: ReturnType<typeof setInterval> | undefined;
  let cancelIceWait: (() => void) | undefined;
  const remoteTracks = new Set<MediaStreamTrack>();

  /** 只关闭传输；本地采集由上层持有，服务器回退时继续使用相同设备和静音状态。 */
  const closePeer = (): void => {
    cancelIceWait?.();
    cancelIceWait = undefined;
    if (statsTimer) clearInterval(statsTimer);
    statsTimer = undefined;
    if (pc) {
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
      pc.close();
    }
    pc = null;
    videoSender = null;
    for (const track of remoteTracks) {
      options.onTrackRemoved(track, remoteUid);
      track.stop();
    }
    remoteTracks.clear();
    connected = false;
    options.onConnected(false);
  };

  /** 串行写发送参数，设备替换与质量采样不能并发提交过期 transactionId。 */
  const applyQuality = (): Promise<void> => {
    const sender = videoSender;
    parameterTask = parameterTask
      .catch(() => {})
      .then(async (): Promise<void> => {
        if (
          closed ||
          fallback ||
          !sender ||
          sender !== videoSender ||
          !sender.track
        )
          return;
        const parameters = sender.getParameters();
        if (!parameters.encodings.length) return;
        parameters.degradationPreference = 'balanced';
        for (const encoding of parameters.encodings)
          Object.assign(encoding, RTC_VIDEO_LEVELS[quality.level()]);
        await sender.setParameters(parameters);
      });
    return parameterTask;
  };

  /** ICE 短暂断开保留恢复窗口；失败、超时或持续严重劣化才提交服务端回退。 */
  const checkQuality = async (): Promise<void> => {
    if (closed || fallback || !pc || sampling) return;
    const current = pc;
    if (
      (!connected && Date.now() - startedAt > 18_000) ||
      (disconnectedAt > 0 && Date.now() - disconnectedAt > 6_000) ||
      current.connectionState === 'failed'
    ) {
      fallback = true;
      void refresh();
      return;
    }
    if (current.connectionState !== 'connected') return;
    sampling = true;
    try {
      const report = await current.getStats();
      if (closed || pc !== current || fallback) return;
      const sample = sampler.read(report);
      if (!sample) return;
      const previousLevel = quality.level();
      const decision = quality.sample(sample, !!videoSender?.track?.enabled);
      await applyQuality();
      if (closed || pc !== current) return;
      if (decision.level !== previousLevel)
        console.info(
          `RTC P2P video quality: callId=${options.call.callId}, level=${decision.level}`,
        );
      if (decision.fallback) {
        fallback = true;
        void refresh();
      }
    } catch {
      // 缺少统计或平台拒绝参数不冒充网络差；原生拥塞控制仍然工作。
    } finally {
      sampling = false;
    }
  };

  /** 收集候选至完成或有界超时，不把网络地址写入日志。 */
  const gather = (current: RTCPeerConnection): Promise<void> =>
    new Promise((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      /** 完成、关闭和超时共享清理，防止挂断后残留监听。 */
      const finish = (): void => {
        if (timeout) clearTimeout(timeout);
        current.removeEventListener('icegatheringstatechange', changed);
        if (cancelIceWait === finish) cancelIceWait = undefined;
        resolve();
      };
      /** 原生引擎完成 ICE 收集后提前交付完整 SDP。 */
      const changed = (): void => {
        if (current.iceGatheringState === 'complete') finish();
      };
      cancelIceWait = finish;
      current.addEventListener('icegatheringstatechange', changed);
      timeout = setTimeout(finish, 3_000);
      changed();
    });

  /** 异步协商完成后重新读取引擎快照，避免使用生成 Offer 时尚未收齐的候选。 */
  const readLocalSdp = (current: RTCPeerConnection): string => {
    const description = current.localDescription;
    if (!description?.sdp) throw new Error('媒体协商尚未完成');
    return description.sdp;
  };

  /** 主叫预留音视频通道；被叫等待 Offer 创建关联通道后再绑定本地轨道。 */
  const createPeer = (view: RtcMediaView): RTCPeerConnection => {
    const current = new RTCPeerConnection({
      iceServers: view.stunUrls.map((url) => ({ urls: url })),
      bundlePolicy: 'max-bundle',
    });
    pc = current;
    if (caller) {
      current.addTransceiver(options.microphone, { direction: 'sendrecv' });
      if (options.call.mediaMode === RtcMediaMode.VIDEO) {
        const track = options.video();
        videoSender = current.addTransceiver(track ?? 'video', {
          direction: 'sendrecv',
        }).sender;
      }
    }
    current.ontrack = (event): void => {
      if (closed || pc !== current || fallback) return;
      remoteTracks.add(event.track);
      options.onTrack(event.track, remoteUid);
    };
    current.onconnectionstatechange = (): void => {
      if (closed || pc !== current || fallback) return;
      switch (current.connectionState) {
        case 'connected':
          if (!connected)
            console.info(
              `RTC media connected: callId=${options.call.callId}, transport=P2P`,
            );
          connected = true;
          disconnectedAt = 0;
          options.onConnected(true);
          void applyQuality().catch(() => {});
          break;
        case 'disconnected':
          if (!disconnectedAt) disconnectedAt = Date.now();
          options.onConnected(false);
          break;
        case 'failed':
          fallback = true;
          void refresh();
          break;
        default:
          break;
      }
    };
    statsTimer = setInterval(() => {
      void checkQuality();
    }, 2_000);
    return current;
  };

  /** 被叫复用 Offer 的媒体段，避免新建的发送器未进入 Answer 而只收不发。 */
  const bindAnswerTracks = async (
    current: RTCPeerConnection,
  ): Promise<void> => {
    const kinds =
      options.call.mediaMode === RtcMediaMode.VIDEO
        ? ['audio', 'video']
        : ['audio'];
    for (const kind of kinds) {
      if (closed || fallback || pc !== current) return;
      const transceiver = current
        .getTransceivers()
        .find(
          (value) =>
            value.mid !== null &&
            value.receiver.track.readyState !== 'ended' &&
            value.receiver.track.kind === kind,
        );
      if (!transceiver) throw new Error('对方缺少所需的音视频协商通道');
      // 即使摄像头暂时关闭也保留双向视频，之后 replaceTrack 无需重新协商。
      transceiver.direction = 'sendrecv';
      if (kind === 'video') videoSender = transceiver.sender;
      await transceiver.sender.replaceTrack(
        kind === 'audio' ? options.microphone : options.video(),
      );
    }
  };

  /** 服务端已确认单向切换后才连接 LiveKit；失败保留 SFU 意图并由当前通话重试。 */
  const switchToServer = async (): Promise<void> => {
    if (closed || switched) return;
    fallback = true;
    if (pc) closePeer();
    await options.onFallback();
    if (!closed) switched = true;
  };

  /** 获取最新快照并推进一次协商，所有异步边界都拒绝已关闭的旧通话。 */
  const synchronize = async (): Promise<void> => {
    let view = await options.api.get(options.call.callId);
    if (closed) return;
    if (view.callId !== options.call.callId)
      throw new Error('媒体响应不属于当前通话');
    if (view.transport === 'SFU') {
      await switchToServer();
      return;
    }
    if (view.version < revision) return;
    revision = view.version;
    if (fallback || (Date.now() - startedAt > 18_000 && !connected)) {
      fallback = true;
      view = await options.api.signal(options.call.callId, {
        kind: 'FALLBACK',
        clientRequestId: offerRequestId,
      });
      if (
        !closed &&
        view.callId === options.call.callId &&
        view.transport === 'SFU'
      )
        await switchToServer();
      return;
    }
    const current = pc ?? createPeer(view);
    if (pendingSignal) {
      view = await options.api.signal(options.call.callId, pendingSignal);
      if (closed || pc !== current) return;
      pendingSignal = null;
      if (view.callId !== options.call.callId)
        throw new Error('媒体响应不属于当前通话');
      if (view.transport === 'SFU') {
        await switchToServer();
        return;
      }
      revision = Math.max(revision, view.version);
    }
    if (caller) {
      if (view.offerId && view.offerId !== offerRequestId) {
        fallback = true;
        return;
      }
      if (!view.offerId && !current.localDescription) {
        await current.setLocalDescription(await current.createOffer());
        if (closed || pc !== current) return;
        await gather(current);
        if (closed || pc !== current) return;
        pendingSignal = {
          kind: 'OFFER',
          clientRequestId: offerRequestId,
          sdp: readLocalSdp(current),
        };
      } else if (view.answerSdp && !current.remoteDescription) {
        await current.setRemoteDescription({
          type: 'answer',
          sdp: view.answerSdp,
        });
      }
    } else if (view.offerSdp && view.offerId && !current.remoteDescription) {
      if (view.answerSdp) {
        fallback = true;
        return;
      }
      await current.setRemoteDescription({ type: 'offer', sdp: view.offerSdp });
      if (closed || pc !== current) return;
      await bindAnswerTracks(current);
      if (closed || fallback || pc !== current) return;
      await current.setLocalDescription(await current.createAnswer());
      if (closed || pc !== current) return;
      await gather(current);
      if (closed || pc !== current) return;
      pendingSignal = {
        kind: 'ANSWER',
        clientRequestId: offerRequestId,
        offerId: view.offerId,
        sdp: readLocalSdp(current),
      };
    }
    if (pendingSignal && !closed) {
      const result = await options.api.signal(
        options.call.callId,
        pendingSignal,
      );
      if (closed || pc !== current) return;
      if (result.callId !== options.call.callId)
        throw new Error('媒体响应不属于当前通话');
      pendingSignal = null;
      if (result.transport === 'SFU') await switchToServer();
    }
  };

  /** SSE 只作唤醒；定向查询补偿丢失通知，最多一个在途请求，不轮询其他会话。 */
  const refresh = (): Promise<void> => {
    if (closed || switched) return Promise.resolve();
    if (synchronizing) return synchronizing;
    if (timer) clearTimeout(timer);
    const pending = synchronize()
      .catch((): void => {
        if (closed) return;
        // 不输出 SDP/ICE 或服务端响应。失败仍需服务端确认，不能单端偷偷切换。
        options.onError(new Error('通话网络连接不稳定，正在重试'));
        // 首次查询失败时还没有直连引擎，应继续重试而非误判协商失败。
        if (pc && pc.signalingState !== 'stable' && !pendingSignal)
          fallback = true;
      })
      .finally((): void => {
        if (synchronizing === pending) synchronizing = null;
        if (!closed && !switched)
          timer = setTimeout(
            () => {
              void refresh();
            },
            connected ? 5_000 : 2_000,
          );
      });
    synchronizing = pending;
    return pending;
  };

  return {
    start: (): Promise<void> => {
      startedAt = Date.now();
      return refresh();
    },
    refresh,
    replaceVideo: async (track): Promise<void> => {
      const sender = videoSender;
      if (closed || fallback || !sender) return;
      await sender.replaceTrack(track);
      if (!closed && sender === videoSender) await applyQuality();
    },
    close: (): void => {
      if (closed) return;
      closed = true;
      if (timer) clearTimeout(timer);
      closePeer();
    },
  };
};
