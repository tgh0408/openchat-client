<template>
  <section
    v-if="scrollOverlay"
    class="screenshot-surface screenshot-scroll-overlay"
    aria-label="滚动截图遮罩"
    @click.stop.prevent="finishScrollCapture"
    @contextmenu.prevent
  >
    <div
      v-if="scrollOverlayRegion"
      class="screenshot-region"
      :style="regionStyle"
    ></div>
    <div v-else class="screenshot-shade"></div>
    <ScrollScreenshotPreview
      v-if="scrollOverlayRegion"
      :progress="scrollProgress"
      :region="scrollOverlayRegion"
      :viewport="viewport"
      :image-size="pixels"
      :ending="scrollEnding"
      :error="error"
    />
  </section>
  <section
    v-else
    ref="surface"
    class="screenshot-surface"
    :class="{ 'has-region': region }"
    aria-label="截图选区"
    @pointerdown="beginSelection"
    @pointermove="moveSelection"
    @pointerup="endSelection"
    @pointercancel="cancelSelection"
    @pointerleave="leaveSelection"
    @contextmenu.prevent="cancel"
    @dblclick="confirm"
  >
    <img
      v-if="source"
      class="screenshot-background"
      :src="source"
      alt=""
      draggable="false"
    />
    <div v-if="!displayedRegion" class="screenshot-shade"></div>
    <div
      v-if="region"
      class="screenshot-region"
      :style="regionStyle"
      @pointerdown.stop="beginRegionMove"
    >
      <span
        v-for="handle in resizeHandles"
        :key="handle"
        class="screenshot-handle"
        :class="handle"
        :aria-label="`调整选区${handleLabels[handle]}`"
        @pointerdown.stop="beginResize($event, handle)"
      ></span>
    </div>
    <div
      v-else-if="hoverRegion"
      class="screenshot-region screenshot-window-hover"
      :style="regionStyle"
    ></div>
    <span
      v-if="displayedRegion"
      class="screenshot-dimensions"
      :style="dimensionsStyle"
      >{{ dimensions }}</span
    >
    <div
      ref="toolbar"
      class="screenshot-toolbar"
      role="toolbar"
      aria-label="截图工具"
      :style="toolbarStyle"
      @pointerdown.stop
      @pointermove.stop
      @dblclick.stop
    >
      <div class="screenshot-tools">
        <div
          v-for="group in toolGroups"
          :key="group.label"
          class="screenshot-tool-group"
          role="group"
          :aria-label="group.label"
        >
          <el-tooltip
            v-for="tool in group.tools"
            :key="tool.label"
            :content="tool.label"
            placement="top"
            :show-after="300"
          >
            <template #content>
              <div
                v-if="tool.action === 'scroll'"
                class="screenshot-scroll-help"
              >
                <strong>滚动截图</strong>
                <p>
                  框选后点击此按钮，将鼠标移入选区即可直接滚动滚轮，程序自动计算并拼接，无需再次点击选区。
                </p>
                <p>
                  向上或向下连续滚动，匹配成功即更新长图；回滚不会重复追加。单击选区外遮罩或预览结束并生成图片草稿，Esc
                  取消，方向键可以滚动；回车不用于结束长截图。
                </p>
                <p>
                  支持部分固定顶栏和底栏，但仍应尽量避开视频、动画、大面积固定区域及重复内容，不要移动目标窗口。
                </p>
                <p>
                  旁边有空间时显示实时预览。匹配不可靠时保留已截内容，请回到已截内容附近再缓慢滚动。
                </p>
                <p>
                  鼠标移出选区暂停采集，移回继续。仅跟随你的手动滚动，不发送模拟滚轮，也不会自动认定到底。
                </p>
                <p>
                  仅支持 Windows 10 2004
                  及更新系统。选区内的点击和按键仍会传给原窗口；选区外遮罩会接住点击，不会触发底层窗口。
                </p>
                <p>
                  最长采集两分钟，长图高度上限 30000 像素、总计 4000 万像素。
                </p>
              </div>
              <template v-else>{{ tool.label }}</template>
            </template>
            <span class="screenshot-tool-placeholder">
              <button
                type="button"
                :aria-label="tool.label"
                :disabled="!tool.action || submitting"
                @click="selectTool(tool)"
              >
                <component v-if="tool.icon" :is="tool.icon" />
                <img
                  v-else-if="tool.symbol === 'emoji'"
                  class="screenshot-emoji-icon"
                  :src="emojiButtonIcon"
                  alt=""
                  width="22"
                  height="22"
                  draggable="false"
                />
                <span
                  v-else-if="tool.symbol === 'translate'"
                  class="screenshot-language-icon"
                  aria-hidden="true"
                >
                  <span class="language-source">文</span>
                  <span class="language-target">A</span>
                </span>
                <span
                  v-else-if="tool.symbol === 'recognize'"
                  class="screenshot-recognition-icon"
                  aria-hidden="true"
                >
                  <FullScreen />
                  <span>A</span>
                </span>
                <span
                  v-else
                  class="screenshot-tool-symbol"
                  :class="tool.symbol"
                  aria-hidden="true"
                  >{{ tool.symbol === 'text' ? 'T' : '' }}</span
                >
              </button>
            </span>
          </el-tooltip>
        </div>
      </div>
      <div class="screenshot-actions">
        <button
          type="button"
          class="screenshot-cancel"
          title="取消截图"
          aria-label="取消截图"
          @click="cancel"
        >
          <Close />
        </button>
        <button
          type="button"
          class="screenshot-confirm"
          title="完成截图"
          aria-label="完成截图"
          :disabled="!region || dragging || submitting"
          @click="confirm"
        >
          <Check />
        </button>
      </div>
    </div>
    <div v-if="error" class="screenshot-error" role="alert">{{ error }}</div>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import type { Component, CSSProperties, Ref } from 'vue';
import { ElTooltip } from 'element-plus';
import 'element-plus/es/components/tooltip/style/css';
import {
  Check,
  Close,
  Download,
  EditPen,
  FullScreen,
  Grid,
  Position,
  RefreshLeft,
  Sort,
  TopRight,
  Share,
} from '@element-plus/icons-vue';
import type {
  ScreenshotRegion,
  ScrollScreenshotOverlay,
  ScrollScreenshotProgress,
} from '../../../shared/media/screenshot/screenshot';
import { screenshotCrop } from '../../../shared/media/screenshot/screenshot';
import { findScreenshotWindow } from '../../../shared/media/screenshot/screenshot-window-snap';
import emojiButtonIcon from '../../assets/emoji-button.png';
import { waitForScreenshotPaint } from './screenshot-paint';
import ScrollScreenshotPreview from './ScrollScreenshotPreview.vue';

interface ScreenshotSize {
  width: number;
  height: number;
}

interface ScreenshotPoint {
  x: number;
  y: number;
}

const resizeHandles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const;
type ResizeHandle = (typeof resizeHandles)[number];
type InteractionMode = 'draw' | 'move' | 'resize';

const handleLabels: Record<ResizeHandle, string> = {
  nw: '左上角',
  n: '上边',
  ne: '右上角',
  e: '右边',
  se: '右下角',
  s: '下边',
  sw: '左下角',
  w: '左边',
};

const surface = ref<HTMLElement>();
const toolbar = ref<HTMLElement>();
const toolbarSize: Ref<ScreenshotSize> = ref({ width: 104, height: 56 });
const viewport: Ref<ScreenshotSize> = ref({
  width: window.innerWidth,
  height: window.innerHeight,
});
const source = ref('');
const error = ref('');
const region: Ref<ScreenshotRegion | null> = ref(null);
const hoverRegion = ref<ScreenshotRegion | null>(null);
const displayedRegion = computed(
  (): ScreenshotRegion | null => region.value ?? hoverRegion.value,
);
let candidateWindows: ScreenshotRegion[] = [];
let pendingWindow: ScreenshotRegion | null = null;
let selectionMoved = false;
const dragging = ref(false);
const submitting = ref(false);
const scrollCapturing = ref(false);
const scrollOverlay = ref(false);
const scrollOverlayRegion: Ref<ScreenshotRegion | null> = ref(null);
const scrollProgress = ref<ScrollScreenshotProgress | null>(null);
const scrollEnding = ref(false);
const pixels: Ref<ScreenshotSize> = ref({ width: 0, height: 0 });
let start: ScreenshotPoint | undefined;
let initialRegion: ScreenshotRegion | undefined;
let interactionMode: InteractionMode | undefined;
let resizeHandle: ResizeHandle | undefined;
let pointerId: number | undefined;
let disposed = false;
let requestId: string | null = null;
let unsubscribeRequest: (() => void) | undefined;
let unsubscribeOverlay: (() => void) | undefined;
let unsubscribeProgress: (() => void) | undefined;
let ignoreKeysUntil = 0;
let toolbarObserver: ResizeObserver | undefined;

interface ScreenshotTool {
  label: string;
  action?: 'scroll';
  icon?: Component;
  symbol?:
    'rectangle' | 'ellipse' | 'text' | 'translate' | 'recognize' | 'emoji';
}

const toolGroups: { label: string; tools: ScreenshotTool[] }[] = [
  {
    label: '标注',
    tools: [
      { label: '矩形', symbol: 'rectangle' },
      { label: '圆形', symbol: 'ellipse' },
      { label: '贴纸', symbol: 'emoji' },
      { label: '箭头', icon: TopRight },
      { label: '画笔', icon: EditPen },
      { label: '马赛克', icon: Grid },
      { label: '文字', symbol: 'text' },
    ],
  },
  {
    label: '识别与捕获',
    tools: [
      { label: '翻译', symbol: 'translate' },
      { label: '文字识别', symbol: 'recognize' },
      { label: '滚动截图', icon: Sort, action: 'scroll' },
    ],
  },
  {
    label: '操作',
    tools: [
      { label: '撤销', icon: RefreshLeft },
      { label: '保存', icon: Download },
      { label: '贴图', icon: Position },
      { label: '分享', icon: Share },
    ],
  },
];

const regionStyle = computed<CSSProperties>((): CSSProperties => {
  const selected = scrollOverlay.value
    ? scrollOverlayRegion.value
    : displayedRegion.value;
  if (!selected) return {};
  return {
    left: `${selected.x * 100}%`,
    top: `${selected.y * 100}%`,
    width: `${selected.width * 100}%`,
    height: `${selected.height * 100}%`,
  };
});
const toolbarStyle = computed<CSSProperties>((): CSSProperties => {
  const selected: ScreenshotRegion | null = region.value;
  if (!selected || dragging.value) return { visibility: 'hidden' };
  const viewportWidth: number = viewport.value.width;
  const viewportHeight: number = viewport.value.height;
  const toolbarWidth: number = toolbarSize.value.width;
  const toolbarHeight: number = toolbarSize.value.height;
  const right = (selected.x + selected.width) * viewportWidth;
  const bottom = (selected.y + selected.height) * viewportHeight;
  const selectionTop = selected.y * viewportHeight;
  let top = bottom + 8;
  if (top + toolbarHeight > viewportHeight - 8) {
    top = selectionTop - toolbarHeight - 8;
    if (top < 8) top = viewportHeight - toolbarHeight - 8;
  }
  const left = Math.max(
    8,
    Math.min(viewportWidth - toolbarWidth - 8, right - toolbarWidth),
  );
  return {
    left: `${left}px`,
    top: `${Math.max(8, top)}px`,
  };
});
const dimensionsStyle = computed<CSSProperties>((): CSSProperties => {
  const selected: ScreenshotRegion | null = displayedRegion.value;
  if (!selected) return {};
  const viewportWidth: number = viewport.value.width;
  const viewportHeight: number = viewport.value.height;
  const left = selected.x * viewportWidth;
  const selectionTop = selected.y * viewportHeight;
  const labelHeight = 24;
  const labelGap = 8;
  const top =
    selectionTop >= labelHeight + labelGap
      ? selectionTop - labelHeight - labelGap
      : selectionTop + labelGap;
  return {
    left: `${Math.max(8, Math.min(viewportWidth - 144, left))}px`,
    top: `${Math.max(8, Math.min(viewportHeight - labelHeight, top))}px`,
  };
});
const dimensions = computed((): string => {
  if (!displayedRegion.value) return '';
  try {
    const size = screenshotCrop(displayedRegion.value, pixels.value);
    return `${size.width} x ${size.height}`;
  } catch {
    return '';
  }
});

/** 工具栏展开或视口变化时按实际尺寸避让屏幕边缘。 */
const measureToolbar = (): void => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
  const bounds = toolbar.value?.getBoundingClientRect();
  if (bounds)
    toolbarSize.value = { width: bounds.width, height: bounds.height };
};

/** 指针位置归一化，跨越窗口边缘时仍限定在当前屏幕内。 */
const point = (event: PointerEvent): ScreenshotPoint => ({
  x: Math.min(1, Math.max(0, event.clientX / window.innerWidth)),
  y: Math.min(1, Math.max(0, event.clientY / window.innerHeight)),
});

/** 限制数值范围，避免拖动控制点把选区带出屏幕。 */
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.min(maximum, Math.max(minimum, value));

/** 返回当前屏幕上选区的最小可操作尺寸。 */
const minimumRegionSize = (): ScreenshotSize => ({
  width: 2 / Math.max(1, window.innerWidth),
  height: 2 / Math.max(1, window.innerHeight),
});

/** 捕获当前指针，使选区拖动离开边界后仍能继续调整。 */
const capturePointer = (event: PointerEvent): void => {
  pointerId = event.pointerId;
  surface.value?.setPointerCapture(event.pointerId);
};

/** 按下时记住候选窗口，单击只锁定方框，超过位移阈值后自由框选。 */
const beginSelection = (event: PointerEvent): void => {
  if (event.button !== 0 || submitting.value || !source.value || region.value)
    return;
  error.value = '';
  start = point(event);
  pendingWindow = findScreenshotWindow(candidateWindows, start);
  hoverRegion.value = pendingWindow;
  selectionMoved = false;
  initialRegion = undefined;
  interactionMode = 'draw';
  resizeHandle = undefined;
  region.value = null;
  dragging.value = true;
  capturePointer(event);
};

/** 拖动选区内部移动整个方框，保持宽高和屏幕边界约束。 */
const beginRegionMove = (event: PointerEvent): void => {
  if (event.button !== 0 || submitting.value || !source.value || !region.value)
    return;
  error.value = '';
  start = point(event);
  initialRegion = { ...region.value };
  interactionMode = 'move';
  selectionMoved = false;
  resizeHandle = undefined;
  dragging.value = true;
  capturePointer(event);
};

/** 拖动八个控制点之一，调整选区对应的边或角。 */
const beginResize = (event: PointerEvent, handle: ResizeHandle): void => {
  if (event.button !== 0 || submitting.value || !source.value || !region.value)
    return;
  error.value = '';
  start = point(event);
  initialRegion = { ...region.value };
  interactionMode = 'resize';
  selectionMoved = false;
  resizeHandle = handle;
  dragging.value = true;
  capturePointer(event);
};

/** 根据指针位移移动选区，保持选区尺寸不变。 */
const moveRegion = (
  initial: ScreenshotRegion,
  origin: ScreenshotPoint,
  current: ScreenshotPoint,
): ScreenshotRegion => {
  const width = initial.width;
  const height = initial.height;
  return {
    x: clamp(initial.x + current.x - origin.x, 0, 1 - width),
    y: clamp(initial.y + current.y - origin.y, 0, 1 - height),
    width,
    height,
  };
};

/** 根据控制点方向调整选区，防止边界反向或缩到不可裁剪的尺寸。 */
const resizeRegion = (
  initial: ScreenshotRegion,
  origin: ScreenshotPoint,
  current: ScreenshotPoint,
  handle: ResizeHandle,
): ScreenshotRegion => {
  const minimum = minimumRegionSize();
  let left = initial.x;
  let top = initial.y;
  let right = initial.x + initial.width;
  let bottom = initial.y + initial.height;
  const deltaX = current.x - origin.x;
  const deltaY = current.y - origin.y;

  switch (handle) {
    case 'nw':
      left = clamp(left + deltaX, 0, right - minimum.width);
      top = clamp(top + deltaY, 0, bottom - minimum.height);
      break;
    case 'n':
      top = clamp(top + deltaY, 0, bottom - minimum.height);
      break;
    case 'ne':
      right = clamp(right + deltaX, left + minimum.width, 1);
      top = clamp(top + deltaY, 0, bottom - minimum.height);
      break;
    case 'e':
      right = clamp(right + deltaX, left + minimum.width, 1);
      break;
    case 'se':
      right = clamp(right + deltaX, left + minimum.width, 1);
      bottom = clamp(bottom + deltaY, top + minimum.height, 1);
      break;
    case 's':
      bottom = clamp(bottom + deltaY, top + minimum.height, 1);
      break;
    case 'sw':
      left = clamp(left + deltaX, 0, right - minimum.width);
      bottom = clamp(bottom + deltaY, top + minimum.height, 1);
      break;
    case 'w':
      left = clamp(left + deltaX, 0, right - minimum.width);
      break;
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
};

/** 离开当前屏幕时清除悬停框，正在捕获指针的拖动保持原状态。 */
const leaveSelection = (): void => {
  if (!dragging.value) hoverRegion.value = null;
};

/** 未选中时预览鼠标下方窗口，拖动后更新新建、移动或缩放中的选区。 */
const moveSelection = (event: PointerEvent): void => {
  if (!dragging.value) {
    hoverRegion.value =
      !region.value && source.value && !submitting.value
        ? findScreenshotWindow(candidateWindows, point(event))
        : null;
    return;
  }
  if (
    !dragging.value ||
    !start ||
    !interactionMode ||
    pointerId !== event.pointerId
  )
    return;
  const current = point(event);
  if (
    !selectionMoved &&
    Math.abs(start.x - current.x) * window.innerWidth < 2 &&
    Math.abs(start.y - current.y) * window.innerHeight < 2
  )
    return;

  selectionMoved = true;
  switch (interactionMode) {
    case 'draw':
      pendingWindow = null;
      hoverRegion.value = null;
      region.value = {
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        width: Math.abs(start.x - current.x),
        height: Math.abs(start.y - current.y),
      };
      break;
    case 'move':
      if (initialRegion)
        region.value = moveRegion(initialRegion, start, current);
      break;
    case 'resize':
      if (initialRegion && resizeHandle)
        region.value = resizeRegion(
          initialRegion,
          start,
          current,
          resizeHandle,
        );
      break;
  }
};

/** 单击锁定窗口，拖动和缩放结束保留选区，等待工具操作或双击确认。 */
const endSelection = (event: PointerEvent): void => {
  if (event.button !== 0 || pointerId !== event.pointerId) return;
  moveSelection(event);
  dragging.value = false;
  const element: HTMLElement | undefined = surface.value;
  if (element && element.hasPointerCapture(event.pointerId))
    element.releasePointerCapture(event.pointerId);
  const mode = interactionMode;
  if (mode === 'draw' && !selectionMoved && pendingWindow)
    region.value = { ...pendingWindow };
  pendingWindow = null;
  hoverRegion.value = null;
  selectionMoved = false;
  start = undefined;
  initialRegion = undefined;
  interactionMode = undefined;
  resizeHandle = undefined;
  pointerId = undefined;
  try {
    screenshotCrop(region.value, pixels.value);
  } catch {
    if (mode === 'draw') region.value = null;
  }
};

/** 系统中断拖动时清除未完成的新选区，已存在的选区保持不变。 */
const cancelSelection = (): void => {
  pendingWindow = null;
  hoverRegion.value = null;
  selectionMoved = false;
  const mode = interactionMode;
  dragging.value = false;
  const element: HTMLElement | undefined = surface.value;
  if (
    element &&
    pointerId !== undefined &&
    element.hasPointerCapture(pointerId)
  )
    element.releasePointerCapture(pointerId);
  start = undefined;
  initialRegion = undefined;
  interactionMode = undefined;
  resizeHandle = undefined;
  pointerId = undefined;
  if (mode === 'draw') region.value = null;
};

/** 放弃本次截图，主进程恢复原聊天窗口。 */
const cancel = async (): Promise<void> => {
  if (requestId)
    await window.screenshotDesktop?.cancel(requestId).catch(() => {});
};

/** 主进程裁剪确认选区并返回原会话草稿，不直接提交消息。 */
const confirm = async (): Promise<void> => {
  if (scrollCapturing.value) return;
  const selected: ScreenshotRegion | null = region.value;
  const currentRequest = requestId;
  if (!selected || !currentRequest || dragging.value || submitting.value)
    return;
  submitting.value = true;
  try {
    const desktop = window.screenshotDesktop;
    if (!desktop) throw new Error('截图窗口连接已失效，请重新截图');
    // Vue 选区是响应式代理，跨隔离桥接只提交普通数值对象。
    await desktop.confirm(currentRequest, {
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
    });
  } catch (failure) {
    if (!disposed && requestId === currentRequest)
      error.value = failure instanceof Error ? failure.message : '截图失败';
  } finally {
    if (requestId === currentRequest) submitting.value = false;
  }
};

/** 提交选区后立即由主进程开启穿透和手动滚动采集，不再二次确认启动。 */
const startScroll = async (): Promise<void> => {
  const selected = region.value;
  const currentRequest = requestId;
  if (!selected || !currentRequest || submitting.value || dragging.value)
    return;
  submitting.value = true;
  scrollCapturing.value = true;
  error.value = '';
  try {
    const desktop = window.screenshotDesktop;
    if (!desktop) throw new Error('截图窗口连接已失效');
    await desktop.startScroll(currentRequest, {
      x: selected.x,
      y: selected.y,
      width: selected.width,
      height: selected.height,
    });
  } catch (failure) {
    if (!disposed && requestId === currentRequest) {
      scrollCapturing.value = false;
      error.value =
        failure instanceof Error ? failure.message : '无法开始滚动截图';
    }
  } finally {
    if (requestId === currentRequest) submitting.value = false;
  }
};

/** 遮罩消费完整单击后结束采集，不把点击传给原窗口或重复结束任务。 */
const finishScrollCapture = async (): Promise<void> => {
  const currentRequest = requestId;
  if (!currentRequest || !scrollOverlay.value || scrollEnding.value) return;
  scrollEnding.value = true;
  error.value = '';
  try {
    const desktop = window.screenshotDesktop;
    if (!desktop) throw new Error('截图窗口连接已失效');
    await desktop.finishScroll(currentRequest);
  } catch (failure) {
    if (!disposed && requestId === currentRequest && scrollOverlay.value) {
      scrollEnding.value = false;
      error.value =
        failure instanceof Error ? failure.message : '无法结束滚动截图，请重试';
    }
  }
};

/** 点击后直接开始手动滚动截图，其余尚未实现的标注工具继续保持禁用。 */
const selectTool = (tool: ScreenshotTool): void => {
  if (tool.action === 'scroll' && !submitting.value) void startScroll();
};

/** 同步捕获排除遮罩，选区保持透明并让滚轮直接传给原窗口。 */
const updateScrollOverlay = (overlay: ScrollScreenshotOverlay): void => {
  if (disposed || overlay.requestId !== requestId) return;
  scrollOverlay.value = overlay.active;
  scrollOverlayRegion.value = overlay.region;
  scrollCapturing.value = overlay.active;
  scrollEnding.value = false;
  if (!overlay.active) ignoreKeysUntil = Date.now() + 600;
};

/** 仅接受正在采集的当前任务进度，结束或清空后不恢复旧截图的像素。 */
const updateScrollProgress = (progress: ScrollScreenshotProgress): void => {
  if (disposed || progress.requestId !== requestId || !scrollOverlay.value)
    return;
  scrollProgress.value = progress;
};

/** 清除上次任务的图像、选区和指针状态，空窗口不保留屏幕内容。 */
const clearScreenshot = (): void => {
  candidateWindows = [];
  requestId = null;
  cancelSelection();
  region.value = null;
  submitting.value = false;
  scrollCapturing.value = false;
  scrollOverlay.value = false;
  scrollOverlayRegion.value = null;
  scrollEnding.value = false;
  scrollProgress.value = null;
  ignoreKeysUntil = 0;
  error.value = '';
  pixels.value = { width: 0, height: 0 };
  if (source.value) URL.revokeObjectURL(source.value);
  source.value = '';
};

/** 每次只读取当前任务，解码和绘制期间复核编号，拒绝取消后的迟到结果。 */
const loadScreenshot = async (id: string | null): Promise<void> => {
  clearScreenshot();
  if (!id || disposed) return;
  requestId = id;
  let url = '';
  try {
    const snapshot = await window.screenshotDesktop?.read(id);
    url = snapshot?.url ?? '';
    if (disposed || requestId !== id || !url) return;
    const decoded = new Image();
    decoded.src = url;
    await decoded.decode();
    if (disposed || requestId !== id) return;
    pixels.value = {
      width: decoded.naturalWidth,
      height: decoded.naturalHeight,
    };
    source.value = url;
    candidateWindows = snapshot?.windows ?? [];
    await nextTick();
    await waitForScreenshotPaint();
    if (disposed || requestId !== id) return;
    await window.screenshotDesktop?.ready(id, true);
  } catch {
    if (!disposed && requestId === id)
      await window.screenshotDesktop?.ready(id, false).catch(() => {});
  } finally {
    if (url && source.value !== url) URL.revokeObjectURL(url);
  }
};

/** 键盘确认或取消仅作用于当前截图窗口。 */
const onKeydown = (event: KeyboardEvent): void => {
  if (scrollCapturing.value || event.repeat || Date.now() < ignoreKeysUntil)
    return;
  switch (event.key) {
    case 'Escape':
      event.preventDefault();
      void cancel();
      break;
    case 'Enter':
      event.preventDefault();
      void confirm();
      break;
  }
};

watch(toolbar, (element, previous): void => {
  if (previous) toolbarObserver?.unobserve(previous);
  if (element) toolbarObserver?.observe(element);
  measureToolbar();
});

onMounted(async (): Promise<void> => {
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('resize', measureToolbar);
  toolbarObserver = new ResizeObserver(measureToolbar);
  if (toolbar.value) toolbarObserver.observe(toolbar.value);
  measureToolbar();
  unsubscribeRequest = window.screenshotDesktop?.onRequest((id) => {
    void loadScreenshot(id);
  });
  unsubscribeOverlay =
    window.screenshotDesktop?.onScrollOverlay(updateScrollOverlay);
  unsubscribeProgress =
    window.screenshotDesktop?.onScrollProgress(updateScrollProgress);
  await window.screenshotDesktop?.connect().catch(() => {});
});
onBeforeUnmount((): void => {
  disposed = true;
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('resize', measureToolbar);
  toolbarObserver?.disconnect();
  unsubscribeRequest?.();
  unsubscribeOverlay?.();
  unsubscribeProgress?.();
  clearScreenshot();
});
</script>

<style scoped>
.screenshot-scroll-help {
  max-width: min(340px, calc(100vw - 48px));
  font-size: 13px;
  line-height: 1.6;
}
.screenshot-scroll-help p {
  margin: 6px 0 0;
}
.screenshot-surface {
  position: fixed;
  inset: 0;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  touch-action: none;
}
.screenshot-surface.has-region {
  cursor: not-allowed;
}
.screenshot-background,
.screenshot-shade {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.screenshot-shade {
  background: #0006;
}
.screenshot-region {
  position: absolute;
  border: 2px solid #00c676;
  box-shadow: 0 0 0 10000px #0006;
  cursor: move;
  pointer-events: auto;
}
.screenshot-scroll-overlay .screenshot-region {
  border: 0;
  background: transparent;
  outline: 2px solid #00c676;
  cursor: default;
  pointer-events: none;
}
.screenshot-scroll-overlay {
  background: transparent;
  cursor: pointer;
}
.screenshot-window-hover {
  cursor: crosshair;
  pointer-events: none;
}
.screenshot-handle {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  width: 10px;
  height: 10px;
  border: 1px solid #fff;
  border-radius: 2px;
  background: #00c676;
  box-shadow: 0 0 0 1px #008b55;
}
.screenshot-handle.nw {
  top: 0;
  left: 0;
  margin: -5px;
  cursor: nwse-resize;
}
.screenshot-handle.n {
  top: 0;
  left: 50%;
  margin: -5px;
  cursor: ns-resize;
}
.screenshot-handle.ne {
  top: 0;
  right: 0;
  margin: -5px;
  cursor: nesw-resize;
}
.screenshot-handle.e {
  top: 50%;
  right: 0;
  margin: -5px;
  cursor: ew-resize;
}
.screenshot-handle.se {
  right: 0;
  bottom: 0;
  margin: -5px;
  cursor: nwse-resize;
}
.screenshot-handle.s {
  bottom: 0;
  left: 50%;
  margin: -5px;
  cursor: ns-resize;
}
.screenshot-handle.sw {
  bottom: 0;
  left: 0;
  margin: -5px;
  cursor: nesw-resize;
}
.screenshot-handle.w {
  top: 50%;
  left: 0;
  margin: -5px;
  cursor: ew-resize;
}
.screenshot-toolbar {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  box-sizing: border-box;
  width: max-content;
  max-width: calc(100vw - 16px);
  height: 56px;
  padding: 4px 8px;
  border: 1px solid #d4d4d4;
  border-radius: 8px;
  background: #fafafa;
  color: #333;
  box-shadow: 0 2px 10px #0003;
  cursor: default;
}
.screenshot-dimensions {
  position: absolute;
  box-sizing: border-box;
  max-width: calc(100vw - 16px);
  padding: 3px 6px;
  border-radius: 3px;
  background: #202020;
  color: #fff;
  font-size: 12px;
  line-height: 16px;
  white-space: nowrap;
  pointer-events: none;
}
.screenshot-tools {
  display: flex;
  gap: 12px;
  min-width: 0;
  height: 46px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
  scrollbar-color: #c6c6c6 transparent;
}
.screenshot-tool-group,
.screenshot-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.screenshot-tool-group + .screenshot-tool-group,
.screenshot-actions {
  padding-left: 12px;
  border-left: 1px solid #dedede;
}
.screenshot-tool-placeholder {
  display: inline-flex;
  flex: 0 0 40px;
  cursor: not-allowed;
}
.screenshot-toolbar button {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  flex-shrink: 0;
  border: 0;
  border-radius: 3px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.screenshot-toolbar button:not(:disabled):hover {
  background: #eee;
}
.screenshot-toolbar button:disabled {
  color: #a7a7a7;
  cursor: not-allowed;
}
.screenshot-tool-placeholder button:disabled {
  pointer-events: none;
}
.screenshot-tool-placeholder:has(button:not(:disabled)) {
  cursor: pointer;
}
.screenshot-toolbar button:focus-visible {
  outline: 2px solid #00ae68;
}
.screenshot-toolbar .screenshot-cancel {
  color: #ed4655;
}
.screenshot-toolbar .screenshot-confirm:not(:disabled) {
  color: #009e5f;
}
.screenshot-toolbar svg {
  width: 21px;
  height: 21px;
}
.screenshot-emoji-icon {
  display: block;
  width: 22px;
  height: 22px;
  opacity: 0.45;
}
.screenshot-tool-symbol {
  box-sizing: border-box;
  width: 18px;
  height: 18px;
  border: 1.5px solid currentColor;
  border-radius: 1px;
}
.screenshot-tool-symbol.ellipse {
  border-radius: 50%;
}
.screenshot-tool-symbol.text {
  font-size: 16px;
  font-weight: 600;
  line-height: 16px;
  text-align: center;
}
.screenshot-language-icon,
.screenshot-recognition-icon {
  position: relative;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  font-weight: 600;
}
.screenshot-language-icon span {
  position: absolute;
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 15px;
  height: 15px;
  border: 1px solid currentColor;
  border-radius: 2px;
  background: #fafafa;
  font-size: 11px;
  line-height: 1;
}
.language-source {
  top: 0;
  left: 0;
}
.language-target {
  right: 0;
  bottom: 0;
}
.screenshot-recognition-icon svg {
  position: absolute;
  inset: 0;
  width: 24px;
  height: 24px;
}
.screenshot-recognition-icon span {
  font-size: 14px;
  line-height: 1;
}
.screenshot-error {
  position: absolute;
  left: 16px;
  bottom: 16px;
  max-width: calc(100vw - 32px);
  padding: 8px 12px;
  background: #fff;
  color: #b42318;
  font-size: 13px;
  overflow-wrap: anywhere;
  cursor: default;
}
</style>
