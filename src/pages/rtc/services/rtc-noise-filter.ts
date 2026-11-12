import { publicAssetUrl } from '../../../services/runtime/public-assets';
import { DeepFilterNoiseFilterProcessor } from 'deepfilternet3-noise-filter';

export interface RtcNoiseFilter {
  initialize: (track: MediaStreamTrack) => Promise<MediaStreamTrack>;
  replaceInput: (track: MediaStreamTrack) => void;
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  dispose: () => void;
}

/** 为一次通话创建本地降噪图；静音同时关闭采集和输出，不旁路降噪。 */
export const createRtcNoiseFilter = (): RtcNoiseFilter => {
  const processor = new DeepFilterNoiseFilterProcessor({
    sampleRate: 48000,
    noiseReductionLevel: 80,
    enabled: true,
    assetConfig: {
      cdnUrl: publicAssetUrl('rtc-noise'),
    },
  });
  let source: MediaStreamTrack | undefined;
  let gain: GainNode | undefined;
  let volume = 100;
  let enabled = true;
  let disposed = false;
  let initializing = false;

  /** 停止输出并销毁库持有的 AudioContext、音频节点和模型。 */
  const destroy = (): void => {
    gain?.disconnect();
    gain = undefined;
    processor.processedTrack?.stop();
    void processor.destroy().catch((error: unknown): void => {
      console.error('RTC 降噪资源释放失败', error);
    });
  };

  /** 立即停止采集；初始化尚未完成时在其结束后销毁图，避免库内部竞态。 */
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    source?.stop();
    processor.processedTrack?.stop();
    if (!initializing) destroy();
  };

  return {
    initialize: async (track: MediaStreamTrack): Promise<MediaStreamTrack> => {
      if (disposed || source) {
        track.stop();
        throw new Error('通话降噪已关闭或已经初始化');
      }
      source = track;
      source.enabled = enabled;
      initializing = true;
      try {
        if (
          !DeepFilterNoiseFilterProcessor.isSupported() ||
          typeof AudioWorkletNode === 'undefined'
        )
          throw new Error('当前环境不支持通话降噪');
        await processor.init({ track });
        if (disposed) throw new Error('通话降噪已关闭');
        const output = processor.processedTrack;
        const context = processor.audioContext;
        const worklet = processor.workletNode;
        const destination = processor.destination;
        if (!output || context?.state !== 'running' || !worklet || !destination)
          throw new Error('通话降噪启动失败，请检查音频设备后重试');
        // 在降噪和自动增益之后调节发送音量，保留同一条发布轨道。
        gain = context.createGain();
        gain.gain.value = volume / 100;
        worklet.disconnect(destination);
        worklet.connect(gain).connect(destination);
        output.enabled = enabled;
        return output;
      } catch (error: unknown) {
        dispose();
        throw error;
      } finally {
        initializing = false;
        if (disposed) destroy();
      }
    },
    /** 替换采集输入，不重建降噪模型或已经发布的输出。 */
    replaceInput: (track: MediaStreamTrack): void => {
      const context = processor.audioContext;
      const worklet = processor.workletNode;
      if (disposed || initializing || !source || !context || !worklet) {
        track.stop();
        throw new Error('通话麦克风尚未就绪或已经关闭');
      }
      if (track.kind !== 'audio' || track.readyState !== 'live') {
        track.stop();
        throw new Error('所选麦克风不可用，请选择其他设备');
      }
      let nextSource: MediaStreamAudioSourceNode | undefined;
      try {
        track.enabled = enabled;
        nextSource = context.createMediaStreamSource(new MediaStream([track]));
        nextSource.connect(worklet);
      } catch (error: unknown) {
        nextSource?.disconnect();
        track.stop();
        throw error;
      }
      // 库公开的输入节点可以原位替换；降噪模型、增益和发送轨道不变。
      processor.sourceNode?.disconnect();
      processor.sourceNode = nextSource;
      processor.originalTrack = track;
      const previous = source;
      source = track;
      previous.stop();
    },
    setEnabled: (value: boolean): void => {
      enabled = value;
      if (source) source.enabled = value && !disposed;
      if (processor.processedTrack)
        processor.processedTrack.enabled = value && !disposed;
    },
    /** 平滑调整降噪后的发送音量，避免拖动滑块产生突变噪声。 */
    setVolume: (value: number): void => {
      if (!Number.isFinite(value)) throw new Error('麦克风输入音量无效');
      volume = Math.min(100, Math.max(0, value));
      const context = processor.audioContext;
      if (!disposed && gain && context) {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.setTargetAtTime(volume / 100, context.currentTime, 0.01);
      }
    },
    dispose,
  };
};
