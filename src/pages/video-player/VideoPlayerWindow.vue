<template>
  <main class="video-player-window">
    <div ref="container" class="video-player-container"></div>
    <Teleport
      v-if="restartVisible && playerTarget && !error"
      :to="playerTarget"
    >
      <button
        class="video-restart-button"
        type="button"
        @click.stop="restartPlayback"
        @dblclick.stop
      >
        <RefreshLeft aria-hidden="true" />
        <span>从头开始播放</span>
      </button>
    </Teleport>
    <p
      v-if="progressError && !error"
      class="video-progress-error"
      role="status"
    >
      {{ progressError }}
    </p>
    <div v-if="error" class="video-player-error" role="alert">
      <span>{{ error }}</span>
      <button type="button" @click="load">重试</button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
import { RefreshLeft } from '@element-plus/icons-vue';
import type Artplayer from 'artplayer';
import { resumeVideoPosition } from '../../../shared/media/video/video';
import type { VideoPlaybackProgress } from '../../../shared/media/video/video';

const container = ref<HTMLDivElement>();
const playerTarget = ref('');
const restartVisible = ref(false);
const error = ref('');
const progressError = ref('');
let player: Artplayer | undefined;
let disposed = false;
let generation = 0;
let resumeApplied = false;
let lastReportedAt = 0;
let stopClosing: (() => void) | undefined;
let restartTimer: ReturnType<typeof setTimeout> | undefined;

/** 清理短暂的重播入口，避免旧播放器的计时器影响重试后的页面。 */
const hideRestart = (): void => {
  clearTimeout(restartTimer);
  restartTimer = undefined;
  restartVisible.value = false;
};

/** 元数据和断点应用完成后才采样，避免加载时的零位置覆盖已有断点。 */
const playbackProgress = (): VideoPlaybackProgress | null => {
  if (!player || !resumeApplied || player.video.seeking) return null;
  const duration = player.video.duration;
  const position = player.video.currentTime;
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > 86400 ||
    !Number.isFinite(position) ||
    position < 0
  )
    return null;
  return {
    position: Math.min(position, duration),
    duration,
    ended: player.video.ended,
  };
};

/** 常规上报限制为每秒一次；暂停、拖动和关闭立即提交当前采样。 */
const reportProgress = async (flush: boolean): Promise<void> => {
  const api = window.videoPlayerDesktop;
  if (!api || disposed) return;
  const current = generation;
  const progress = playbackProgress();
  if (!flush && (!progress || Date.now() - lastReportedAt < 1000)) return;
  lastReportedAt = Date.now();
  try {
    if (flush) await api.saveProgress(progress);
    else if (progress) await api.updateProgress(progress);
    if (!disposed && generation === current) progressError.value = '';
  } catch (failure) {
    if (!disposed && generation === current)
      progressError.value =
        failure instanceof Error ? failure.message : '播放位置未能保存';
  }
};

/** 页面重载尽量提交最新位置，原生窗口关闭另由主进程握手确认。 */
const flushProgress = (): void => {
  void reportProgress(true);
};

/** 从零开始播放，跳转完成后沿用 seeked 事件立即保存新位置。 */
const restartPlayback = async (): Promise<void> => {
  const active = player;
  const current = generation;
  if (!active || disposed || !resumeApplied || !restartVisible.value) return;
  hideRestart();
  try {
    active.currentTime = 0;
    if (!active.video.seeking) flushProgress();
    await active.play();
  } catch {
    if (!disposed && current === generation)
      active.notice.show = '未能从头播放，请点击播放按钮重试';
  }
};

/** 独立窗口仅播放主进程绑定的本地视频，错误不会回退到远端 URL。 */
const load = async (): Promise<void> => {
  hideRestart();
  await reportProgress(true);
  if (disposed) return;
  const current = ++generation;
  error.value = '';
  resumeApplied = false;
  playerTarget.value = '';
  player?.destroy(false);
  player = undefined;
  try {
    const api = window.videoPlayerDesktop;
    if (!api || !container.value) throw new Error('请从聊天记录打开视频');
    const context = await api.getContext();
    const { default: Player } = await import('artplayer');
    if (disposed || current !== generation || !container.value) return;
    document.title = context.fileName;
    player = new Player({
      container: container.value,
      url: context.url,
      type: 'mp4',
      autoplay: true,
      volume: 0.7,
      playbackRate: true,
      fullscreen: true,
      fullscreenWeb: false,
      setting: true,
      hotkey: true,
      mutex: true,
      lang: 'zh-cn',
      theme: '#078b5d',
      moreVideoAttr: { preload: 'metadata' },
    });
    const active = player;
    const targetId = `video-player-${active.id}`;
    active.template.$player.id = targetId;
    playerTarget.value = `#${targetId}`;
    player.on('fullscreenError', () => {
      if (!disposed && current === generation)
        active.notice.show = '无法进入全屏，请关闭播放器后重试';
    });
    player.on('video:loadedmetadata', () => {
      if (disposed || current !== generation || resumeApplied) return;
      const position = resumeVideoPosition(
        context.position,
        active.video.duration,
      );
      active.currentTime = position;
      resumeApplied = true;
      if (position > 0) {
        restartVisible.value = true;
        restartTimer = setTimeout(hideRestart, 5000);
      }
    });
    player.on('video:timeupdate', () => {
      if (current === generation) void reportProgress(false);
    });
    player.on('video:pause', () => {
      if (current === generation) flushProgress();
    });
    player.on('video:seeked', () => {
      if (current === generation) flushProgress();
    });
    player.on('video:ended', () => {
      if (current === generation) flushProgress();
    });
    player.on('video:error', () => {
      if (disposed || current !== generation) return;
      hideRestart();
      error.value = '视频无法播放，文件可能损坏或编码不受支持';
    });
  } catch (failure) {
    if (!disposed)
      error.value = failure instanceof Error ? failure.message : '视频加载失败';
  }
};

onMounted(() => {
  stopClosing = window.videoPlayerDesktop?.onClosing(flushProgress);
  window.addEventListener('pagehide', flushProgress);
  void load();
});
onBeforeUnmount(() => {
  flushProgress();
  disposed = true;
  hideRestart();
  stopClosing?.();
  window.removeEventListener('pagehide', flushProgress);
  player?.destroy(false);
});
</script>

<style scoped>
.video-player-window {
  position: fixed;
  inset: 0;
  background: #141414;
  color: #fff;
}
.video-player-container {
  width: 100%;
  height: 100%;
}
.video-restart-button {
  position: absolute;
  left: 16px;
  bottom: 72px;
  z-index: 30;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 34px;
  max-width: calc(100% - 32px);
  padding: 6px 10px;
  border: 1px solid #666;
  border-radius: 4px;
  background: rgb(20 20 20 / 85%);
  color: #fff;
  font-size: 13px;
  line-height: 20px;
  cursor: pointer;
}
.video-restart-button:hover {
  background: #333;
  border-color: #aaa;
}
.video-restart-button:focus-visible {
  outline: 2px solid #fff;
  outline-offset: 2px;
}
.video-restart-button svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.video-progress-error {
  position: absolute;
  top: 12px;
  right: 12px;
  max-width: calc(100% - 24px);
  margin: 0;
  padding: 6px 10px;
  color: #fff;
  background: #842d2d;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.video-player-error {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  background: #181818;
  overflow-wrap: anywhere;
}
.video-player-error button {
  border: 1px solid #777;
  border-radius: 4px;
  padding: 8px 16px;
  background: #333;
  color: #fff;
  flex-shrink: 0;
  cursor: pointer;
}
</style>
