<template>
  <div
    class="voice-recorder"
    :class="{ 'voice-recorder--active': state !== 'idle' }"
  >
    <button
      v-if="state === 'idle'"
      type="button"
      class="chat-small-button"
      title="录制语音"
      aria-label="录制语音"
      :disabled="disabled"
      @click="start"
    >
      <el-icon :size="21"><Microphone /></el-icon>
    </button>
    <template v-else>
      <button
        type="button"
        class="voice-recording-button voice-recording-cancel"
        title="取消录音"
        aria-label="取消录音"
        :disabled="state === 'uploading'"
        @click="cancel"
      >
        <el-icon :size="16"><Close /></el-icon>
      </button>
      <button
        type="button"
        class="voice-recording-pill"
        :title="canSend ? `发送语音 (${status})` : status"
        aria-label="发送语音"
        :disabled="!canSend"
        @click="finish"
      >
        <span class="voice-recording-countdown">
          <template
            v-if="state === 'recording' && elapsed >= MAX_VOICE_SECONDS - 10"
          >
            {{ MAX_VOICE_SECONDS - elapsed }}s
          </template>
        </span>
        <span
          v-if="state === 'recording'"
          class="voice-recording-waveform"
          role="img"
          :aria-label="`正在录音，已录制 ${elapsed} 秒`"
        >
          <span
            v-for="(level, index) in levels"
            :key="index"
            class="voice-recording-bar"
            :style="{ height: `${3 + level * 21}px` }"
          />
        </span>
        <span v-else class="voice-recording-status">{{ status }}</span>
        <span
          class="voice-recording-button voice-recording-send"
          aria-hidden="true"
        >
          <el-icon
            v-if="state === 'encoding' || state === 'uploading'"
            :size="16"
            class="is-loading"
            ><Loading
          /></el-icon>
          <el-icon v-else :size="18"><Top /></el-icon>
        </span>
        <span class="voice-recording-send-label" aria-hidden="true">
          <span class="voice-recording-waveform">
            <span
              v-for="(level, index) in levels.slice(0, 4)"
              :key="index"
              class="voice-recording-bar"
              :style="{ height: `${3 + level * 21}px` }"
            />
          </span>
          <span>发送</span>
          <span class="voice-recording-waveform">
            <span
              v-for="(level, index) in levels.slice(-4)"
              :key="index"
              class="voice-recording-bar"
              :style="{ height: `${3 + level * 21}px` }"
            />
          </span>
        </span>
      </button>
      <span class="voice-recording-announcement" role="status">
        {{ state === 'recording' ? '正在录音' : status }}
      </span>
    </template>
    <span v-if="error" class="voice-recording-error" role="alert">{{
      error
    }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { Close, Loading, Microphone, Top } from '@element-plus/icons-vue';
import {
  encodeVoiceWave,
  MAX_VOICE_SECONDS,
} from '../../../../shared/media/voice/voice';
import { describeVoiceRecordingError } from '../../../services/media/voice/voice-recording-error';
import type { VoiceRecordingStage } from '../../../services/media/voice/voice-recording-error';

const props = defineProps<{
  roomId: string;
  disabled: boolean;
  submit: (roomId: string, bytes: Uint8Array<ArrayBufferLike>) => Promise<void>;
}>();
const emit = defineEmits<{
  (event: 'activeChange', active: boolean): void;
}>();
const state = ref<
  'idle' | 'requesting' | 'recording' | 'encoding' | 'ready' | 'uploading'
>('idle');
const elapsed = ref(0);
const error = ref('');
const canSend = computed(
  (): boolean =>
    !props.disabled &&
    (state.value === 'ready' ||
      (state.value === 'recording' && elapsed.value >= 1)),
);
const WAVEFORM_BAR_COUNT = 9;
const WAVEFORM_NOISE_FLOOR = 0.006;
const levels = ref<number[]>(Array<number>(WAVEFORM_BAR_COUNT).fill(0));
let version = 0;
let recorder: MediaRecorder | undefined;
let stream: MediaStream | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let recordingRoom = '';
let recorded: Uint8Array<ArrayBufferLike> | undefined;
let analysisContext: AudioContext | undefined;
let analysisSource: MediaStreamAudioSourceNode | undefined;
let animationFrame: number | undefined;
const status = computed((): string => {
  switch (state.value) {
    case 'requesting':
      return '正在开启麦克风';
    case 'recording':
      return `${elapsed.value}" / ${MAX_VOICE_SECONDS}"`;
    case 'encoding':
      return '正在处理录音';
    case 'uploading':
      return '正在上传语音';
    case 'ready':
      return '录音待发送';
    default:
      return '';
  }
});

/** 从同一麦克风流采样真实振幅，静音归零并平滑更新各段波形。 */
const startWaveform = async (
  acquired: MediaStream,
  current: number,
): Promise<void> => {
  const context = new AudioContext();
  analysisContext = context;
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048;
  const source = context.createMediaStreamSource(acquired);
  analysisSource = source;
  // 仅分析输入，不连接扬声器，避免录音时回放麦克风。
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  await context.resume();
  if (current !== version || analysisContext !== context) return;
  let lastFrame = 0;

  /** 按固定刷新间隔计算分段 RMS，弱噪声保持为圆点。 */
  const updateWaveform = (now: number): void => {
    if (
      current !== version ||
      analysisContext !== context ||
      state.value !== 'recording'
    ) {
      return;
    }
    if (now - lastFrame >= 40) {
      lastFrame = now;
      analyser.getFloatTimeDomainData(samples);
      levels.value = levels.value.map((previous, index): number => {
        const begin = Math.floor((index * samples.length) / WAVEFORM_BAR_COUNT);
        const end = Math.floor(
          ((index + 1) * samples.length) / WAVEFORM_BAR_COUNT,
        );
        let energy = 0;
        for (let sample = begin; sample < end; sample++) {
          const amplitude = samples[sample] ?? 0;
          energy += amplitude * amplitude;
        }
        const rms = Math.sqrt(energy / (end - begin));
        const target =
          rms > WAVEFORM_NOISE_FLOOR
            ? Math.min(1, Math.log10(rms / WAVEFORM_NOISE_FLOOR) / 1.6)
            : 0;
        const smoothing = target > previous ? 0.65 : 0.25;
        const next = previous + (target - previous) * smoothing;
        return next < 0.01 ? 0 : next;
      });
    }
    animationFrame = requestAnimationFrame(updateWaveform);
  };

  animationFrame = requestAnimationFrame(updateWaveform);
};

/** 关闭麦克风、波形采样和计时，不保留原始录音到磁盘。 */
const release = (): void => {
  clearInterval(timer);
  timer = undefined;
  if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
  animationFrame = undefined;
  const source = analysisSource;
  if (source !== undefined) {
    source.disconnect();
  }
  analysisSource = undefined;
  const context = analysisContext;
  analysisContext = undefined;
  if (context && context.state !== 'closed') {
    void context.close().catch((): void => {
      // 已断开输入且停止采样，关闭失败不影响录音数据处理。
    });
  }
  levels.value = Array<number>(WAVEFORM_BAR_COUNT).fill(0);
  stream?.getTracks().forEach((track) => track.stop());
  stream = undefined;
};

/** 切换会话、失效或取消时丢弃所有迟到录音结果。 */
const cancel = (): void => {
  version++;
  if (recorder?.state === 'recording') recorder.stop();
  recorder = undefined;
  release();
  recorded = undefined;
  state.value = 'idle';
  error.value = '';
};

/** 上传成功后由工作区创建消息；失败保留内存 WAV，允许重试。 */
const submit = async (): Promise<void> => {
  if (!recorded || props.disabled) return;
  const current = version;
  state.value = 'uploading';
  error.value = '';
  try {
    await props.submit(recordingRoom, recorded);
    if (current === version) cancel();
  } catch (reason) {
    if (current !== version) return;
    state.value = 'ready';
    error.value = reason instanceof Error ? reason.message : '语音发送失败';
  }
};

/** 停止录音等待最后一段数据，已编码录音则直接重试发送。 */
const finish = (): void => {
  if (state.value === 'ready') {
    void submit();
    return;
  }
  if (state.value !== 'recording' || !recorder) return;
  state.value = 'encoding';
  recorder.stop();
  release();
};

/** 用户点击后请求真实麦克风，通过浏览器媒体解码和重采样生成固定 WAV。 */
const start = async (): Promise<void> => {
  if (props.disabled || state.value !== 'idle') return;
  const current = ++version;
  recordingRoom = props.roomId;
  error.value = '';
  elapsed.value = 0;
  state.value = 'requesting';
  let stage: VoiceRecordingStage = 'microphone';
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new DOMException(
        'Audio capture is unavailable',
        'NotSupportedError',
      );
    }
    const acquired = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    });
    if (current !== version || props.disabled) {
      acquired.getTracks().forEach((track) => track.stop());
      if (current === version) cancel();
      return;
    }
    stream = acquired;
    stage = 'waveform';
    await startWaveform(acquired, current);
    if (current !== version || props.disabled) {
      if (current === version) cancel();
      return;
    }
    stage = 'recorder';
    if (typeof MediaRecorder === 'undefined') {
      throw new DOMException(
        'Audio recording is unavailable',
        'NotSupportedError',
      );
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm'].find((mime) =>
      MediaRecorder.isTypeSupported(mime),
    );
    if (!type) {
      throw new DOMException(
        'WebM audio recording is unavailable',
        'NotSupportedError',
      );
    }
    const active = new MediaRecorder(acquired, {
      mimeType: type,
      audioBitsPerSecond: 64000,
    });
    recorder = active;
    const chunks: Blob[] = [];
    let total = 0;
    active.ondataavailable = (event): void => {
      if (current !== version) return;
      total += event.data.size;
      if (total > 4 * 1024 * 1024) {
        cancel();
        error.value = '录音超过大小限制';
        return;
      }
      chunks.push(event.data);
    };
    active.onerror = (): void => {
      if (current !== version) return;
      cancel();
      error.value = '麦克风录音失败，请重试';
    };
    active.onstop = async (): Promise<void> => {
      if (current !== version) return;
      release();
      if (state.value !== 'encoding') {
        cancel();
        error.value = '录音意外中断，请重新录制';
        return;
      }
      try {
        const encoded = await new Blob(chunks, { type }).arrayBuffer();
        const decoder = new OfflineAudioContext(1, 1, 16000);
        const decoded = await decoder.decodeAudioData(encoded);
        if (decoded.duration < 1) throw new Error('录音不能少于 1 秒');
        const count = Math.min(
          Math.floor(decoded.duration * 16000),
          MAX_VOICE_SECONDS * 16000,
        );
        const renderer = new OfflineAudioContext(1, count, 16000);
        const source = renderer.createBufferSource();
        source.buffer = decoded;
        source.connect(renderer.destination);
        source.start();
        const audio = await renderer.startRendering();
        if (current !== version) return;
        recorded = encodeVoiceWave(audio.getChannelData(0));
        state.value = 'ready';
        await submit();
      } catch (reason) {
        if (current !== version) return;
        cancel();
        error.value = reason instanceof Error ? reason.message : '录音处理失败';
      }
    };
    active.start(250);
    elapsed.value = 0;
    const began = performance.now();
    state.value = 'recording';
    timer = setInterval(() => {
      elapsed.value = Math.min(
        MAX_VOICE_SECONDS,
        Math.floor((performance.now() - began) / 1000),
      );
      if (elapsed.value >= MAX_VOICE_SECONDS) finish();
    }, 100);
  } catch (reason) {
    if (current !== version) return;
    const message = describeVoiceRecordingError(reason, stage);
    cancel();
    error.value = message;
  }
};

watch<boolean>(
  (): boolean => state.value !== 'idle',
  (active: boolean): void => {
    emit('activeChange', active);
  },
);
watch(() => props.roomId, cancel);
watch(
  () => props.disabled,
  (disabled) => {
    if (disabled && state.value !== 'uploading') cancel();
  },
);
onBeforeUnmount(cancel);
</script>

<style scoped>
.voice-recorder {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 100%;
}
.voice-recorder--active {
  width: 232px;
  height: 36px;
}
.voice-recording-pill {
  position: relative;
  isolation: isolate;
  overflow: hidden;
  display: grid;
  grid-template-columns: 26px minmax(0, 1fr) 26px;
  align-items: center;
  flex: 1;
  min-width: 0;
  height: 36px;
  padding: 0 5px;
  border: 0;
  border-radius: 18px;
  background: #ededf0;
  font: inherit;
  cursor: pointer;
}
.voice-recording-pill::before {
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: #00b978;
  content: '';
  transform: scaleX(0);
  transform-origin: right center;
  transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
  pointer-events: none;
}
.voice-recording-pill
  > :is(
    .voice-recording-waveform,
    .voice-recording-status,
    .voice-recording-send
  ) {
  transition: opacity 120ms ease;
}
.voice-recording-pill:disabled {
  cursor: default;
}
.voice-recording-pill:disabled .voice-recording-send {
  opacity: 0.4;
}
.voice-recording-pill:enabled:is(:hover, :focus-visible)::before {
  transform: scaleX(1);
}
.voice-recording-pill:enabled:is(:hover, :focus-visible)
  > :is(
    .voice-recording-waveform,
    .voice-recording-status,
    .voice-recording-send
  ) {
  opacity: 0;
}
.voice-recording-pill:enabled:is(:hover, :focus-visible)
  .voice-recording-countdown {
  color: #fff;
}
.voice-recording-pill:enabled:is(:hover, :focus-visible)
  .voice-recording-send-label {
  opacity: 1;
  transition-delay: 80ms;
}
.voice-recording-send-label {
  position: absolute;
  inset: 0 31px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  opacity: 0;
  transition: opacity 120ms ease;
  color: #fff;
  font-size: 14px;
  white-space: nowrap;
  pointer-events: none;
}
.voice-recording-send-label .voice-recording-bar {
  background: currentColor;
}
.voice-recording-button {
  display: inline-grid;
  place-items: center;
  flex: 0 0 26px;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}
.voice-recording-button:disabled {
  cursor: default;
  opacity: 0.4;
}
.voice-recording-cancel {
  color: #606064;
  background: #ededf0;
}
.voice-recording-cancel:hover:not(:disabled) {
  background: #e0e0e4;
}
.voice-recording-send {
  color: #fff;
  background: #00c681;
}
.voice-recording-button:focus-visible,
.voice-recording-pill:focus-visible {
  outline: 2px solid #008c5b;
  outline-offset: 2px;
}
.voice-recording-waveform {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 26px;
  min-width: 0;
}
.voice-recording-bar {
  flex: 0 0 3px;
  width: 3px;
  border-radius: 2px;
  background: #00c681;
  transition: height 40ms linear;
}
.voice-recording-countdown {
  color: #77777e;
  font-size: 10px;
  text-align: center;
  font-variant-numeric: tabular-nums;
  transition: color 240ms ease;
}
.voice-recording-status {
  font-size: 11px;
  color: #237d42;
  text-align: center;
  overflow-wrap: anywhere;
}
.voice-recording-announcement {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.voice-recording-error {
  position: absolute;
  right: 0;
  bottom: calc(100% + 8px);
  z-index: 1;
  width: max-content;
  max-width: min(260px, calc(100vw - 80px));
  padding: 6px 8px;
  border: 1px solid #efcccc;
  border-radius: 4px;
  background: #fff7f7;
  font-size: 12px;
  color: #c23d3d;
  overflow-wrap: anywhere;
}
@media (prefers-reduced-motion: reduce) {
  /* 保留用户要求的发送填充反馈，仅覆盖此按钮，不解除全局其他动画限制。 */
  .voice-recording-pill::before {
    transition: transform 240ms cubic-bezier(0.22, 1, 0.36, 1) !important;
  }
  .voice-recording-pill
    > :is(
      .voice-recording-waveform,
      .voice-recording-status,
      .voice-recording-send,
      .voice-recording-send-label
    ) {
    transition: opacity 120ms ease !important;
  }
  .voice-recording-pill:enabled:is(:hover, :focus-visible)
    .voice-recording-send-label {
    transition-delay: 80ms !important;
  }
  .voice-recording-pill .voice-recording-countdown {
    transition: color 240ms ease !important;
  }
}
</style>
