<template>
  <aside
    v-if="layout.panel"
    class="scroll-capture-preview"
    :style="panelStyle"
    aria-label="滚动截图预览"
  >
    <img
      v-if="progress?.preview"
      class="scroll-capture-thumbnail"
      :src="progress.preview"
      :style="imageStyle"
      alt="已拼接内容，绿色框表示当前画面"
      draggable="false"
    />
    <div
      v-if="progress?.preview"
      class="scroll-capture-frame"
      :style="frameStyle"
    ></div>
    <div
      v-if="clippedTop"
      class="scroll-capture-fade scroll-capture-fade--top"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16"><path d="m3 10 5-5 5 5" /></svg>
    </div>
    <div
      v-if="clippedBottom"
      class="scroll-capture-fade scroll-capture-fade--bottom"
      aria-hidden="true"
    >
      <svg viewBox="0 0 16 16"><path d="m3 6 5 5 5-5" /></svg>
    </div>
    <p v-if="warning" class="scroll-capture-warning" role="alert">
      {{ warning }}
    </p>
  </aside>
  <aside
    v-if="layout.toolbar"
    class="scroll-capture-toolbar"
    :style="toolbarStyle"
    aria-label="滚动截图状态"
  >
    <span class="scroll-capture-grip" aria-hidden="true">⠿</span>
    <strong>{{ dimensions }}</strong>
    <span class="scroll-capture-toolbar-divider" aria-hidden="true"></span>
    <span class="scroll-capture-status" role="status">{{
      ending ? '正在结束…' : progress?.message || '点击此处结束 · Esc 取消'
    }}</span>
  </aside>
</template>

<script setup lang="ts">
// PreviewPanel / positioning adapted from jietuba (MIT, Copyright (c) 2025 JYAARU).
// License: public/licenses/jietuba-MIT.txt.
import { computed } from 'vue';
import type { CSSProperties } from 'vue';
import type {
  ScreenshotRegion,
  ScrollScreenshotProgress,
} from '../../../shared/media/screenshot/screenshot';
import { getScrollPreviewLayout } from '../../../shared/media/screenshot/screenshot-preview';
import type {
  ScrollPreviewLayout,
  ScrollPreviewRect,
} from '../../../shared/media/screenshot/screenshot-preview';

const props = defineProps<{
  progress: ScrollScreenshotProgress | null;
  region: ScreenshotRegion;
  viewport: { width: number; height: number };
  imageSize: { width: number; height: number };
  ending: boolean;
  error: string;
}>();

/** 首帧前显示选区比例占位，收到进度后使用主进程实际裁剪尺寸及布局。 */
const layout = computed<ScrollPreviewLayout>(
  (): ScrollPreviewLayout =>
    props.progress?.layout ??
    getScrollPreviewLayout(
      {
        x: props.region.x * props.viewport.width,
        y: props.region.y * props.viewport.height,
        width: props.region.width * props.viewport.width,
        height: props.region.height * props.viewport.height,
      },
      props.viewport,
      {
        width: props.region.width * props.imageSize.width,
        height: props.region.height * props.imageSize.height,
      },
    ),
);

/** 将屏幕内 DIP 矩形用于浮层定位，不再从屏幕左上角摆放提示块。 */
const rectStyle = (rect: ScrollPreviewRect | null): CSSProperties =>
  rect
    ? {
        left: `${rect.x}px`,
        top: `${rect.y}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      }
    : {};

const panelStyle = computed<CSSProperties>((): CSSProperties =>
  rectStyle(layout.value.panel),
);
const toolbarStyle = computed<CSSProperties>((): CSSProperties =>
  rectStyle(layout.value.toolbar),
);
const scale = computed<number>(
  (): number =>
    (layout.value.panel?.width ?? 190) /
    Math.max(
      1,
      props.progress?.width ?? props.imageSize.width * props.region.width,
    ),
);
const total = computed<number>((): number =>
  Math.max(
    1,
    Math.round(
      (props.progress?.height ?? props.imageSize.height * props.region.height) *
        scale.value,
    ),
  ),
);
const panelHeight = computed<number>(
  (): number => layout.value.panel?.height ?? 190,
);
const lead = computed<number>((): number =>
  Math.max(0, (panelHeight.value - total.value) / 2),
);
const imageStyle = computed<CSSProperties>((): CSSProperties => ({
  top: `${lead.value}px`,
}));
const frameStyle = computed<CSSProperties>((): CSSProperties => ({
  top: `${(props.progress?.frameTop ?? 0) * scale.value - (props.progress?.previewOffset ?? 0) + lead.value}px`,
  height: `${(props.progress?.frameHeight ?? 0) * scale.value}px`,
}));
const clippedTop = computed<boolean>((): boolean =>
  Boolean(props.progress?.preview && props.progress.previewOffset > 0),
);
const clippedBottom = computed<boolean>((): boolean =>
  Boolean(
    props.progress?.preview &&
    props.progress.previewOffset + panelHeight.value < total.value,
  ),
);
const dimensions = computed<string>((): string => {
  const width =
    props.progress?.width ??
    Math.round(props.imageSize.width * props.region.width);
  const height =
    props.progress?.height ||
    Math.round(props.imageSize.height * props.region.height);
  return `${width} × ${height}`;
});
const warning = computed<string>(
  (): string =>
    props.error || (props.progress?.warning ? props.progress.message : ''),
);
</script>

<style scoped>
.scroll-capture-preview {
  position: fixed;
  z-index: 2;
  box-sizing: border-box;
  overflow: hidden;
  border-radius: 8px;
  background: rgb(0 0 0 / 25%);
  cursor: pointer;
  pointer-events: auto;
}
.scroll-capture-thumbnail {
  position: absolute;
  left: 0;
  display: block;
  width: 100%;
  height: auto;
  max-width: none;
  user-select: none;
}
.scroll-capture-frame {
  position: absolute;
  right: 0;
  left: 0;
  box-sizing: border-box;
  border: 2px solid #52c41a;
}
.scroll-capture-fade {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 1;
  display: flex;
  justify-content: center;
  height: 28px;
  color: white;
}
.scroll-capture-fade--top {
  top: 0;
  align-items: flex-start;
  background: linear-gradient(to bottom, rgb(0 0 0 / 65%), transparent);
}
.scroll-capture-fade--bottom {
  bottom: 0;
  align-items: flex-end;
  background: linear-gradient(to top, rgb(0 0 0 / 65%), transparent);
}
.scroll-capture-fade svg {
  width: 16px;
  height: 16px;
  margin: 3px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.scroll-capture-warning {
  position: absolute;
  top: 8px;
  right: 8px;
  left: 8px;
  z-index: 2;
  box-sizing: border-box;
  max-height: calc(100% - 16px);
  overflow: hidden;
  margin: 0;
  padding: 4px 8px;
  border-radius: 6px;
  background: rgb(255 77 79 / 92%);
  color: white;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.5;
  text-align: center;
}
.scroll-capture-toolbar {
  position: fixed;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  box-sizing: border-box;
  overflow: hidden;
  padding: 0 12px;
  border: 1px solid #d9d9d9;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 3px 12px rgb(0 0 0 / 15%);
  color: #555;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.scroll-capture-status {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.scroll-capture-toolbar strong {
  color: #333;
  font-size: 13px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.scroll-capture-grip {
  color: #aaa;
  font-size: 20px;
}
.scroll-capture-toolbar-divider {
  width: 1px;
  height: 18px;
  background: #e5e5e5;
}
</style>
