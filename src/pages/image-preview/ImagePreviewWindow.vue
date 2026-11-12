<template>
  <main class="image-preview-window" aria-label="图片预览窗口">
    <header class="preview-titlebar" @dblclick="control('maximize')">
      <div class="preview-pin-action" @dblclick.stop>
        <button
          class="preview-button"
          :class="{ active: windowState.pinned }"
          :aria-pressed="windowState.pinned"
          :title="windowState.pinned ? '取消置顶' : '置顶'"
          :aria-label="windowState.pinned ? '取消置顶' : '置顶'"
          @click="control('pin')"
        >
          <el-icon><PinIcon /></el-icon>
        </button>
      </div>
      <nav
        class="preview-top-navigation"
        aria-label="顶部图片切换"
        @dblclick.stop
      >
        <button
          class="preview-button"
          title="上一张"
          aria-label="上一张"
          :disabled="loadingContext || !context?.hasPrevious"
          @click="navigate('previous')"
        >
          <el-icon><Back /></el-icon>
        </button>
        <button
          class="preview-button"
          title="下一张"
          aria-label="下一张"
          :disabled="loadingContext || !context?.hasNext"
          @click="navigate('next')"
        >
          <el-icon><Right /></el-icon>
        </button>
      </nav>
      <nav class="preview-toolbar" aria-label="图片操作" @dblclick.stop>
        <div class="preview-tool-group">
          <button
            class="preview-button"
            title="缩小"
            aria-label="缩小"
            :disabled="!ready || scale <= minimumScale"
            @click="zoom(scale / 1.25)"
          >
            <el-icon><ZoomOut /></el-icon>
          </button>
          <span class="preview-scale" aria-label="缩放比例">{{
            ready ? scaleLabel : '--'
          }}</span>
          <button
            class="preview-button"
            title="放大"
            aria-label="放大"
            :disabled="!ready || scale >= maximumScale"
            @click="zoom(scale * 1.25)"
          >
            <el-icon><ZoomIn /></el-icon>
          </button>
        </div>
        <div class="preview-tool-group">
          <button
            class="preview-button"
            :class="{ active: ready && !fitMode && scale === 1 }"
            :aria-pressed="ready && !fitMode && scale === 1"
            title="图片原始大小"
            aria-label="图片原始大小"
            :disabled="!ready"
            @click="originalSize"
          >
            <span
              class="preview-asset-icon"
              :style="{
                maskImage: `url('${publicAssetUrl('image/1_1.svg')}')`,
              }"
              aria-hidden="true"
            ></span>
          </button>
          <button
            class="preview-button"
            title="顺时针旋转"
            aria-label="顺时针旋转"
            :disabled="!ready"
            @click="rotate"
          >
            <el-icon><RefreshRight /></el-icon>
          </button>
          <button
            class="preview-button"
            :class="{ active: windowState.fullscreen }"
            :title="windowState.fullscreen ? '退出全屏' : '全屏'"
            aria-label="切换全屏"
            @click="control('fullscreen')"
          >
            <span
              class="preview-asset-icon"
              :style="{
                maskImage: `url('${publicAssetUrl('image/全屏.svg')}')`,
              }"
              aria-hidden="true"
            ></span>
          </button>
        </div>
        <div v-if="ocrAvailable || ocrOpened" class="preview-tool-group">
          <button
            class="preview-button preview-text-tool"
            :class="{ active: ocrOpened }"
            :aria-pressed="ocrOpened"
            :disabled="!ocrOpened && !ready"
            title="提取图片文字"
            @click="ocr.toggle"
          >
            提取文字
          </button>
        </div>
      </nav>
      <div class="preview-window-actions" @dblclick.stop>
        <button
          class="preview-button"
          title="最小化"
          aria-label="最小化"
          @click="control('minimize')"
        >
          <el-icon><Minus /></el-icon>
        </button>
        <button
          class="preview-button"
          :title="windowState.maximized ? '还原窗口' : '最大化'"
          aria-label="最大化或还原窗口"
          @click="control('maximize')"
        >
          <el-icon
            ><CopyDocument v-if="windowState.maximized" /><FullScreen v-else
          /></el-icon>
        </button>
        <button
          class="preview-button preview-close"
          title="关闭"
          aria-label="关闭图片预览"
          @click="control('close')"
        >
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </header>
    <div class="preview-body" :class="{ 'with-ocr': ocrOpened }">
      <section
        ref="viewport"
        class="preview-viewport"
        :class="{ 'is-pannable': ready && pannable, 'is-dragging': dragging }"
        :aria-busy="loadingContext || imageStatus === 'loading'"
        @wheel.prevent="onWheel"
        @pointerdown="startPan"
        @pointermove="movePan"
        @pointerup="endPan"
        @pointercancel="endPan"
        @lostpointercapture="endPan"
        @dblclick="toggleSize"
      >
        <img
          v-if="context && fileSource.source.value && !loadingContext"
          :key="`${context.messageId}:${attempt}`"
          ref="imageElement"
          class="preview-image"
          :class="{ visible: ready }"
          :src="fileSource.source.value"
          :alt="context.image.fileName"
          :style="imageStyle"
          draggable="false"
          referrerpolicy="no-referrer"
          @dragstart.prevent
          @load="imageLoaded"
          @error="imageFailed"
        />
        <ImageOcrLayer
          v-if="ready && ocrOpened && ocrResult"
          :result="ocrResult"
          :image-style="imageStyle"
          @select="selectOcrText"
        />
        <div
          v-if="loadingContext || imageStatus === 'loading'"
          class="preview-status"
          role="status"
        >
          <el-icon class="is-loading" :size="24"><Loading /></el-icon>
          <span>正在加载图片...</span>
        </div>
        <div
          v-else-if="error || imageStatus === 'error'"
          class="preview-status"
          role="alert"
        >
          <el-icon :size="32"><Picture /></el-icon>
          <span>{{ error || '图片加载失败' }}</span>
          <button class="preview-retry" @click.stop="reload">重新加载</button>
        </div>
        <nav
          v-if="context?.hasPrevious || context?.hasNext"
          class="preview-navigation"
          aria-label="图片切换"
          @pointerdown.stop
          @dblclick.stop
          @wheel.stop
        >
          <div class="preview-navigation-zone">
            <button
              class="preview-button"
              title="上一张"
              aria-label="上一张"
              :disabled="loadingContext || !context?.hasPrevious"
              @click.stop="navigate('previous')"
            >
              <el-icon><Back /></el-icon>
            </button>
          </div>
          <div class="preview-navigation-zone">
            <button
              class="preview-button"
              title="下一张"
              aria-label="下一张"
              :disabled="loadingContext || !context?.hasNext"
              @click.stop="navigate('next')"
            >
              <el-icon><Right /></el-icon>
            </button>
          </div>
        </nav>
      </section>
      <ImageOcrEditor
        v-if="ocrOpened"
        :key="`${context?.messageId ?? ''}:${attempt}`"
        ref="ocrEditor"
        v-model:text="ocrText"
        :loading="ocrLoading"
        :preparing="
          loadingContext ||
          imageStatus === 'loading' ||
          (ready && !ocrAvailable && !ocrError)
        "
        :image-error="imageStatus === 'error' ? error : ''"
        :error="ocrError"
        :has-result="Boolean(ocrResult)"
        @close="ocr.close"
        @cancel="ocr.cancel"
        @retry="ocr.recognize"
      />
    </div>
    <footer class="preview-footer">
      <span class="preview-conversation" :title="context?.conversationTitle">{{
        context?.conversationTitle ?? ''
      }}</span>
      <span v-if="ready"
        >{{ naturalSize.width }} × {{ naturalSize.height }}</span
      >
      <span v-if="context?.image.fileSize">{{ fileSizeLabel }}</span>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import ImageOcrLayer from './ImageOcrLayer.vue';
import ImageOcrEditor from './ImageOcrEditor.vue';
import { useImageOcr } from './useImageOcr';
import type { OcrTextRange } from '../../../shared/media/image/image-ocr';
import type { CSSProperties } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import PinIcon from '../../components/icons/PinIcon.vue';
import { useImageFileSource } from '../../services/media/image/image-file-source';
import { publicAssetUrl } from '../../services/runtime/public-assets';
import {
  Back,
  Right,
  ZoomIn,
  ZoomOut,
  FullScreen,
  RefreshRight,
  Minus,
  Close,
  CopyDocument,
  Loading,
  Picture,
} from '@element-plus/icons-vue';
import type {
  ImagePreviewContext,
  ImagePreviewWindowAction,
  ImagePreviewWindowState,
} from '../../../shared/windows/image-preview';
import {
  clampImagePan,
  fitImageScale,
  rotatedImageSize,
  zoomImagePan,
} from '../../../shared/media/image/image-viewport';
import type {
  ImagePan,
  ImageViewportSize,
} from '../../../shared/media/image/image-viewport';

const api = window.imagePreviewDesktop;
const fileSource = useImageFileSource();
const context = ref<ImagePreviewContext>();
const windowState = ref<ImagePreviewWindowState>({
  pinned: false,
  maximized: false,
  fullscreen: false,
});
const viewport = ref<HTMLElement>();
const imageElement = ref<HTMLImageElement>();
const loadingContext = ref(true);
const imageStatus = ref<'loading' | 'ready' | 'error'>('loading');
const error = ref('');
const attempt = ref(0);
const naturalSize = ref<ImageViewportSize>({ width: 0, height: 0 });
const viewportSize = ref<ImageViewportSize>({ width: 1, height: 1 });
const scale = ref(1);
const rotation = ref(0);
const pan = ref<ImagePan>({ x: 0, y: 0 });
const fitMode = ref(true);
const dragging = ref(false);
let pointerOrigin:
  { id: number; clientX: number; clientY: number; pan: ImagePan } | undefined;
let observer: ResizeObserver | undefined;
let removeChanged: (() => void) | undefined;
let removeState: (() => void) | undefined;
let requestVersion = 0;
let disposed = false;
const ready = computed(
  (): boolean => !loadingContext.value && imageStatus.value === 'ready',
);
const fittedScale = computed((): number =>
  fitImageScale(naturalSize.value, viewportSize.value, rotation.value),
);
const minimumScale = computed((): number => Math.min(0.05, fittedScale.value));
const maximumScale = computed((): number => Math.max(8, fittedScale.value));
const scaleLabel = computed(
  (): string => `${(scale.value * 100).toFixed(scale.value < 0.1 ? 1 : 0)}%`,
);
const fileSizeLabel = computed((): string => {
  const bytes = context.value?.image.fileSize ?? 0;
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
    : `${Math.ceil(bytes / 1024)} KiB`;
});
const pannable = computed((): boolean => {
  const size = rotatedImageSize(naturalSize.value, rotation.value);
  return (
    size.width * scale.value > viewportSize.value.width ||
    size.height * scale.value > viewportSize.value.height
  );
});
const imageStyle = computed((): CSSProperties => ({
  width: `${naturalSize.value.width}px`,
  height: `${naturalSize.value.height}px`,
  transform: `translate(-50%, -50%) translate(${pan.value.x}px, ${pan.value.y}px) rotate(${rotation.value}deg) scale(${scale.value})`,
}));

const ocrEditor = ref<InstanceType<typeof ImageOcrEditor>>();
const ocr = useImageOcr(api, () =>
  ready.value && context.value
    ? {
        messageId: context.value.messageId,
        ...naturalSize.value,
      }
    : undefined,
);
const {
  opened: ocrOpened,
  available: ocrAvailable,
  loading: ocrLoading,
  result: ocrResult,
  text: ocrText,
  error: ocrError,
} = ocr;

/** 图片原文选区通过 diff 映射到修订后的编辑文本。 */
const selectOcrText = (range: OcrTextRange, finished: boolean): void => {
  void ocrEditor.value?.selectRange(ocr.mapSelection.value(range), finished);
};

/** 限制平移范围，防止旋转或缩放后图片移出视口。 */
const constrainPan = (): void => {
  pan.value = clampImagePan(
    pan.value,
    naturalSize.value,
    viewportSize.value,
    scale.value,
    rotation.value,
  );
};

/** 按可用区域等比缩放并居中，宽度或高度达到适配边界。 */
const fit = (): void => {
  fitMode.value = true;
  scale.value = fittedScale.value;
  pan.value = { x: 0, y: 0 };
};

/** 更新可视区域；适应模式跟随窗口大小，手动缩放模式保留倍率。 */
const measureViewport = (): void => {
  if (!viewport.value) return;
  viewportSize.value = {
    width: Math.max(1, viewport.value.clientWidth - 32),
    height: Math.max(1, viewport.value.clientHeight - 32),
  };
  if (fitMode.value) fit();
  else constrainPan();
};

/** 按鼠标所在位置缩放，不改变原始图片数据。 */
const zoom = (next: number, anchor: ImagePan = { x: 0, y: 0 }): void => {
  if (!ready.value) return;
  const value = Math.min(
    maximumScale.value,
    Math.max(minimumScale.value, next),
  );
  pan.value = zoomImagePan(pan.value, anchor, scale.value, value);
  scale.value = value;
  fitMode.value = false;
  constrainPan();
};

/** 以原始像素尺寸居中显示。 */
const originalSize = (): void => {
  if (!ready.value) return;
  fitMode.value = false;
  scale.value = 1;
  pan.value = { x: 0, y: 0 };
};

/** 双击在完整显示与原始尺寸之间切换。 */
const toggleSize = (): void => {
  if (!ready.value) return;
  if (fitMode.value) originalSize();
  else fit();
};

/** 按九十度步进旋转，GIF 仍直接展示原资源。 */
const rotate = (): void => {
  if (!ready.value) return;
  rotation.value = (rotation.value + 90) % 360;
  pan.value = { x: 0, y: 0 };
  if (fitMode.value) fit();
  else constrainPan();
};

/** 图片解码完成后读取真实尺寸，只响应当前图片节点。 */
const imageLoaded = (event: Event): void => {
  if (event.target !== imageElement.value || !imageElement.value) return;
  const image = imageElement.value;
  if (!image.naturalWidth || !image.naturalHeight) {
    imageFailed();
    return;
  }
  naturalSize.value = {
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
  imageStatus.value = 'ready';
  measureViewport();
  fit();
};

/** 加载失败仍保留相邻图片导航，不用失败资源冒充可见图片。 */
const imageFailed = (event?: Event): void => {
  if (event && event.target !== imageElement.value) return;
  ocr.reset(true);
  imageStatus.value = 'error';
  error.value = '图片加载失败';
};

/** 切换或刷新只读上下文，迟到结果不覆盖之后打开的图片。 */
const loadContext = async (direction?: 'previous' | 'next'): Promise<void> => {
  ocr.reset(true);
  const version = ++requestVersion;
  loadingContext.value = true;
  imageStatus.value = 'loading';
  error.value = '';
  fileSource.clear();
  endPan();
  naturalSize.value = { width: 0, height: 0 };
  rotation.value = 0;
  pan.value = { x: 0, y: 0 };
  fitMode.value = true;
  context.value = undefined;
  try {
    if (!api) throw new Error('请从 Electron 聊天图片打开预览');
    const result = direction
      ? await api.navigate(direction)
      : await api.getContext();
    if (disposed || version !== requestVersion) return;
    context.value = result;
    void ocr.refreshAvailability();
    document.title = result.image.fileName;
    attempt.value++;
    loadingContext.value = false;
    await fileSource.load(() => api.readImage(result.messageId));
  } catch (cause) {
    if (disposed || version !== requestVersion) return;
    imageStatus.value = 'error';
    error.value = cause instanceof Error ? cause.message : '读取图片失败';
  } finally {
    if (!disposed && version === requestVersion) loadingContext.value = false;
  }
};

/** 只在当前缓存范围内切换相邻普通图片。 */
const navigate = async (direction: 'previous' | 'next'): Promise<void> => {
  if (
    loadingContext.value ||
    (direction === 'previous'
      ? !context.value?.hasPrevious
      : !context.value?.hasNext)
  )
    return;
  await loadContext(direction);
};

/** 重新获取当前图片及失效状态，不向地址附加查询参数。 */
const reload = async (): Promise<void> => {
  if (!loadingContext.value) await loadContext();
};

/** 回到窗口时确认图片仍可读取，同一张图片不重置用户的缩放和旋转。 */
const refreshOnFocus = async (): Promise<void> => {
  if (!api || loadingContext.value || disposed) return;
  const version = requestVersion;
  try {
    const next = await api.getContext();
    if (disposed || version !== requestVersion) return;
    if (
      next.messageId !== context.value?.messageId ||
      next.image.url !== context.value?.image.url
    ) {
      await loadContext();
    } else {
      context.value = next;
      void ocr.refreshAvailability();
    }
  } catch (cause) {
    if (disposed || version !== requestVersion) return;
    imageStatus.value = 'error';
    error.value = cause instanceof Error ? cause.message : '图片已不可用';
    ocr.reset(true);
    context.value = undefined;
    fileSource.clear();
  }
};

/** 控制预览窗口本身，原生状态变化通过独立通知同步。 */
const control = async (action: ImagePreviewWindowAction): Promise<void> => {
  try {
    if (!api) {
      if (action === 'close') window.close();
      return;
    }
    await api.control(action);
    if (action !== 'close' && !disposed)
      windowState.value = await api.getWindowState();
  } catch {
    error.value = '窗口操作失败，请重试';
  }
};

/** 滚轮以鼠标位置为中心缩放，限制单次倍率变化。 */
const onWheel = (event: WheelEvent): void => {
  if (!ready.value || !viewport.value) return;
  const rect = viewport.value.getBoundingClientRect();
  zoom(
    scale.value *
      Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.0025),
    {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    },
  );
};

/** 捕获左键拖动，仅在图片大于视口时平移。 */
const startPan = (event: PointerEvent): void => {
  if (!ready.value || !pannable.value || event.button !== 0 || !viewport.value)
    return;
  event.preventDefault();
  pointerOrigin = {
    id: event.pointerId,
    clientX: event.clientX,
    clientY: event.clientY,
    pan: { ...pan.value },
  };
  dragging.value = true;
  viewport.value.setPointerCapture(event.pointerId);
};

/** 使用已捕获指针位移，不让拖动触发原生文件拖出。 */
const movePan = (event: PointerEvent): void => {
  if (!pointerOrigin || pointerOrigin.id !== event.pointerId) return;
  pan.value = {
    x: pointerOrigin.pan.x + event.clientX - pointerOrigin.clientX,
    y: pointerOrigin.pan.y + event.clientY - pointerOrigin.clientY,
  };
  constrainPan();
};

/** 放开指针后清理拖动状态。 */
const endPan = (): void => {
  const id = pointerOrigin?.id;
  pointerOrigin = undefined;
  dragging.value = false;
  if (id !== undefined && viewport.value?.hasPointerCapture(id))
    viewport.value.releasePointerCapture(id);
};

/** 保留常见图片查看键盘操作，不影响输入法组合事件。 */
const onKeydown = (event: KeyboardEvent): void => {
  if (
    event.target instanceof HTMLElement &&
    (event.target.isContentEditable ||
      event.target.closest('textarea, input, select'))
  )
    return;
  if (event.isComposing || event.ctrlKey || event.metaKey || event.altKey)
    return;
  switch (event.key) {
    case 'ArrowLeft':
      event.preventDefault();
      void navigate('previous');
      break;
    case 'ArrowRight':
      event.preventDefault();
      void navigate('next');
      break;
    case '+':
    case '=':
      event.preventDefault();
      zoom(scale.value * 1.25);
      break;
    case '-':
      event.preventDefault();
      zoom(scale.value / 1.25);
      break;
    case '0':
      if (ready.value) fit();
      break;
    case '1':
      originalSize();
      break;
    case 'r':
    case 'R':
      rotate();
      break;
    case 'Escape':
      void control(windowState.value.fullscreen ? 'fullscreen' : 'close');
      break;
  }
};

onMounted(() => {
  observer = new ResizeObserver(measureViewport);
  if (viewport.value) observer.observe(viewport.value);
  removeChanged = api?.onChanged(() => {
    void loadContext();
  });
  removeState = api?.onWindowState((state) => {
    windowState.value = state;
  });
  void api
    ?.getWindowState()
    .then((state) => {
      if (!disposed) windowState.value = state;
    })
    .catch(() => {});
  window.addEventListener('keydown', onKeydown);
  window.addEventListener('focus', refreshOnFocus);
  measureViewport();
  void loadContext();
});

onBeforeUnmount(() => {
  disposed = true;
  requestVersion++;
  endPan();
  observer?.disconnect();
  removeChanged?.();
  removeState?.();
  window.removeEventListener('keydown', onKeydown);
  window.removeEventListener('focus', refreshOnFocus);
});
</script>

<style scoped>
.image-preview-window {
  display: grid;
  grid-template-rows: 42px minmax(0, 1fr) 28px;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  background: #eeeef0;
  color: #45454b;
  user-select: none;
}
.preview-titlebar {
  display: flex;
  min-width: 0;
  align-items: center;
  border-bottom: 1px solid #dcdce1;
  background: #e5e5e8;
  -webkit-app-region: drag;
}
.preview-pin-action,
.preview-top-navigation,
.preview-window-actions,
.preview-tool-group {
  display: flex;
  flex-shrink: 0;
  align-items: center;
}
.preview-tool-group {
  -webkit-app-region: no-drag;
}
.preview-button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 36px;
  height: 32px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font-size: 18px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.preview-button:hover:not(:disabled) {
  background: #d9d9de;
}
.preview-button:focus-visible {
  outline: 2px solid #078b5d;
  outline-offset: -2px;
}
.preview-button:disabled {
  color: #a4a4ad;
  cursor: not-allowed;
}
.preview-button.active {
  color: #067a52;
  background: #deeee7;
}
.preview-asset-icon {
  width: 18px;
  height: 18px;
  background: currentColor;
  mask-position: center;
  mask-repeat: no-repeat;
  mask-size: contain;
}
.preview-window-actions .preview-button,
.preview-pin-action .preview-button {
  width: 44px;
  height: 42px;
  border-radius: 0;
  font-size: 16px;
}
.preview-window-actions .preview-close:hover {
  background: #d9363e;
  color: #fff;
}
.preview-toolbar {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: safe center;
  min-width: 0;
  gap: 12px;
  margin: 0 16px;
  overflow-x: auto;
  scrollbar-width: none;
  -webkit-app-region: drag;
}
.preview-toolbar::-webkit-scrollbar {
  display: none;
}
.preview-tool-group + .preview-tool-group {
  border-left: 1px solid #d0d0d7;
  padding-left: 12px;
}
.preview-scale {
  width: 56px;
  text-align: center;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.preview-text-tool {
  width: auto;
  min-width: 64px;
  padding: 0 8px;
  font-size: 12px;
  white-space: nowrap;
}
.preview-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}
.preview-body.with-ocr {
  grid-template-columns: minmax(0, 1fr) clamp(250px, 32vw, 360px);
}
@media (max-width: 680px) {
  .preview-body.with-ocr {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: minmax(64px, 1fr) minmax(0, 55%);
  }
}
.preview-viewport {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  touch-action: none;
}
.preview-viewport.is-pannable {
  cursor: grab;
}
.preview-viewport.is-dragging {
  cursor: grabbing;
}
.preview-navigation {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  pointer-events: none;
}
.preview-navigation-zone {
  display: grid;
  place-items: center;
  flex: 0 0 72px;
  height: 112px;
  pointer-events: auto;
}
.preview-navigation .preview-button {
  width: 40px;
  height: 56px;
  border-radius: 6px;
  background: #fffffff0;
  box-shadow: 0 2px 8px #00000014;
  font-size: 22px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;
}
.preview-navigation-zone:hover .preview-button,
.preview-navigation .preview-button:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
.preview-navigation .preview-button:hover:not(:disabled) {
  background: #fff;
}
.preview-navigation .preview-button:disabled {
  background: #ffffff80;
  box-shadow: none;
}
.preview-image {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  max-height: none;
  transform-origin: center;
  visibility: hidden;
  pointer-events: none;
}
.preview-image.visible {
  visibility: visible;
}
.preview-status {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px 72px;
  color: #75757e;
  font-size: 13px;
  text-align: center;
  overflow-wrap: anywhere;
}
.preview-retry {
  padding: 6px 12px;
  border: 1px solid #c9c9d1;
  border-radius: 4px;
  background: #fff;
  color: #45454b;
  cursor: pointer;
}
.preview-footer {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
  padding: 0 14px;
  border-top: 1px solid #dedee3;
  color: #75757e;
  font-size: 11px;
}
.preview-footer > span {
  white-space: nowrap;
}
.preview-conversation {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 480px) {
  .preview-toolbar {
    gap: 4px;
    justify-content: flex-start;
  }
  .preview-tool-group + .preview-tool-group {
    padding-left: 4px;
  }
  .preview-button {
    width: 32px;
  }
  .preview-scale {
    width: 46px;
  }
}
</style>
