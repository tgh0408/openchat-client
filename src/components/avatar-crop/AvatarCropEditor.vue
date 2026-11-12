<template>
  <section class="avatar-crop-editor" aria-label="裁剪头像">
    <h2 v-if="showHeading !== false">裁剪头像</h2>
    <div
      ref="viewport"
      class="avatar-crop-viewport"
      @pointermove="moveDrag"
      @pointerup="stopDrag"
      @pointercancel="stopDrag"
      @lostpointercapture="stopDrag"
    >
      <div
        v-if="image"
        ref="imageFrame"
        class="avatar-crop-image"
        :style="frameStyle"
      >
        <canvas ref="canvas" aria-label="原图预览" />
        <div class="avatar-crop-shade" aria-hidden="true">
          <div :style="selectionStyle" />
        </div>
        <div
          class="avatar-crop-selection"
          :style="selectionStyle"
          tabindex="0"
          aria-label="移动正方形裁剪框"
          @pointerdown="startDrag($event, 'move')"
          @keydown="moveByKeyboard"
        >
          <div class="avatar-crop-grid" aria-hidden="true" />
          <button
            v-for="corner in corners"
            :key="corner.value"
            type="button"
            class="avatar-crop-handle"
            :class="`handle-${corner.value}`"
            :title="corner.label"
            :aria-label="corner.label"
            :disabled="busy"
            @pointerdown.stop="startDrag($event, corner.value)"
            @keydown.stop="resizeByKeyboard($event, corner.value)"
          />
        </div>
      </div>
      <span v-else class="avatar-crop-loading">{{ error || '正在加载' }}</span>
    </div>
    <div class="avatar-crop-controls">
      <label for="avatar-crop-size">边长</label>
      <el-input-number
        id="avatar-crop-size"
        :model-value="region.size"
        :min="1"
        :max="maximumSize"
        :precision="0"
        :step="1"
        size="small"
        controls-position="right"
        aria-label="裁剪边长（像素）"
        :disabled="!image || busy"
        @change="changeSize"
      />
      <span class="avatar-crop-dimensions"
        >{{ region.size }} × {{ region.size }} px</span
      >
      <el-button
        :icon="RefreshLeft"
        text
        title="重置"
        aria-label="重置裁剪"
        :disabled="!image || busy"
        @click="reset"
      />
    </div>
    <p class="avatar-crop-error" role="alert">{{ error }}</p>
    <footer>
      <el-button @click="emit('cancel')">取消</el-button>
      <el-button
        type="primary"
        :icon="Check"
        :loading="busy"
        :disabled="!image || busy"
        @click="confirm"
        >确定</el-button
      >
    </footer>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue';
import type { CSSProperties } from 'vue';
import { ElButton, ElInputNumber } from 'element-plus';
import { Check, RefreshLeft } from '@element-plus/icons-vue';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/input-number/style/css';
import {
  MAX_CROPPED_AVATAR_PIXELS,
  clampAvatarCrop,
  initialAvatarCrop,
  moveAvatarCrop,
  parseCroppedAvatar,
  resizeAvatarCrop,
} from '../../../shared/media/image/avatar-crop';
import type {
  AvatarCropCorner,
  AvatarCropRegion,
} from '../../../shared/media/image/avatar-crop';
import {
  MAX_REGISTRATION_AVATAR_BYTES,
  parseRegistrationAvatar,
  registrationAvatarMime,
} from '../../../shared/auth/registration-avatar';

const props = defineProps<{
  bytes: Uint8Array<ArrayBufferLike>;
  save: (bytes: Uint8Array<ArrayBufferLike>) => Promise<void>;
  showHeading?: boolean;
}>();
const emit = defineEmits<{ cancel: [] }>();
const canvas = ref<HTMLCanvasElement>();
const viewport = ref<HTMLElement>();
const imageFrame = ref<HTMLElement>();
const image = shallowRef<ImageBitmap | null>(null);
const region = ref<AvatarCropRegion>({ x: 0, y: 0, size: 1 });
const busy = ref(false);
const error = ref('');
const corners: { value: AvatarCropCorner; label: string }[] = [
  { value: 'nw', label: '调整左上角' },
  { value: 'ne', label: '调整右上角' },
  { value: 'sw', label: '调整左下角' },
  { value: 'se', label: '调整右下角' },
];
let disposed = false;
let dragging:
  | {
      id: number;
      x: number;
      y: number;
      scale: number;
      mode: AvatarCropCorner | 'move';
      region: AvatarCropRegion;
    }
  | undefined;

/** 原图只在预览中等比适配，画布容器的尺寸不改变导出像素。 */
const frameStyle = computed((): CSSProperties => {
  const source = image.value;
  if (!source) return {};
  const longest = Math.max(source.width, source.height);
  return {
    width: `${(source.width / longest) * 100}%`,
    height: `${(source.height / longest) * 100}%`,
  };
});

/** 选框坐标从原图整数像素换算成显示比例，不积累窗口缩放误差。 */
const selectionStyle = computed((): CSSProperties => {
  const source = image.value;
  if (!source) return {};
  return {
    left: `${(region.value.x / source.width) * 100}%`,
    top: `${(region.value.y / source.height) * 100}%`,
    width: `${(region.value.size / source.width) * 100}%`,
    height: `${(region.value.size / source.height) * 100}%`,
  };
});

/** 数字输入最大值由真实原图短边决定。 */
const maximumSize = computed((): number => {
  const source = image.value;
  return source ? Math.min(source.width, source.height) : 1;
});

/** 恢复居中选区，不改变原图大小。 */
const reset = (): void => {
  if (!image.value || busy.value) return;
  region.value = initialAvatarCrop(image.value);
  error.value = '';
};

/** 数字调整边长以原选区中心为基准，边缘处限制在原图内。 */
const changeSize = (value: number | undefined): void => {
  if (
    !image.value ||
    busy.value ||
    value === undefined ||
    !Number.isFinite(value)
  )
    return;
  const current = region.value;
  const size = Math.max(1, Math.min(Math.round(value), maximumSize.value));
  region.value = clampAvatarCrop(
    {
      x: current.x + (current.size - size) / 2,
      y: current.y + (current.size - size) / 2,
      size,
    },
    image.value,
  );
  error.value = '';
};

/** 捕获单个指针，四角拖动与选区移动共用原始像素坐标。 */
const startDrag = (
  event: PointerEvent,
  mode: AvatarCropCorner | 'move',
): void => {
  const source = image.value;
  const frame = imageFrame.value?.getBoundingClientRect();
  if (!source || !frame?.width || busy.value || event.button !== 0 || dragging)
    return;
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
  viewport.value?.setPointerCapture(event.pointerId);
  dragging = {
    id: event.pointerId,
    x: event.clientX,
    y: event.clientY,
    scale: source.width / frame.width,
    mode,
    region: { ...region.value },
  };
  error.value = '';
  event.preventDefault();
};

/** 始终从拖动开始位置计算选区，整数取整不会累积丢失细微位移。 */
const moveDrag = (event: PointerEvent): void => {
  const source = image.value;
  if (!source || !dragging || dragging.id !== event.pointerId || busy.value)
    return;
  const dx = (event.clientX - dragging.x) * dragging.scale;
  const dy = (event.clientY - dragging.y) * dragging.scale;
  if (dragging.mode === 'move') {
    region.value = moveAvatarCrop(dragging.region, dx, dy, source);
    return;
  }
  region.value = resizeAvatarCrop(
    dragging.region,
    dragging.mode,
    dx,
    dy,
    source,
  );
};

/** 松开或取消指针后释放捕获，不改变当前选区。 */
const stopDrag = (event: PointerEvent): void => {
  if (dragging?.id !== event.pointerId) return;
  dragging = undefined;
  if (viewport.value?.hasPointerCapture(event.pointerId))
    viewport.value?.releasePointerCapture(event.pointerId);
};

/** 方向键按原图像素微调，Shift 每次移动十个像素。 */
const keyboardDelta = (
  event: KeyboardEvent,
): { x: number; y: number } | null => {
  const step = event.shiftKey ? 10 : 1;
  switch (event.key) {
    case 'ArrowLeft':
      return { x: -step, y: 0 };
    case 'ArrowRight':
      return { x: step, y: 0 };
    case 'ArrowUp':
      return { x: 0, y: -step };
    case 'ArrowDown':
      return { x: 0, y: step };
    default:
      return null;
  }
};

/** 选区获得焦点时，方向键只移动位置。 */
const moveByKeyboard = (event: KeyboardEvent): void => {
  const delta = keyboardDelta(event);
  if (!delta || !image.value || busy.value) return;
  event.preventDefault();
  region.value = moveAvatarCrop(region.value, delta.x, delta.y, image.value);
};

/** 四角手柄也支持键盘调整，始终固定相应对角。 */
const resizeByKeyboard = (
  event: KeyboardEvent,
  corner: AvatarCropCorner,
): void => {
  const delta = keyboardDelta(event);
  if (!delta || !image.value || busy.value) return;
  event.preventDefault();
  region.value = resizeAvatarCrop(
    region.value,
    corner,
    delta.x,
    delta.y,
    image.value,
  );
};

/** 单独创建原选区尺寸的画布，一比一裁剪并无损编码，不缩放、不填白。 */
const confirm = async (): Promise<void> => {
  const source = image.value;
  if (!source || busy.value) return;
  busy.value = true;
  error.value = '';
  const target = document.createElement('canvas');
  try {
    const crop = clampAvatarCrop(region.value, source);
    if (crop.size * crop.size > MAX_CROPPED_AVATAR_PIXELS)
      throw new Error('裁剪头像不能超过 400 万像素，请缩小选区');
    target.width = crop.size;
    target.height = crop.size;
    const context = target.getContext('2d');
    if (!context) throw new Error('无法创建头像裁剪画布');
    context.imageSmoothingEnabled = false;
    context.drawImage(
      source,
      crop.x,
      crop.y,
      crop.size,
      crop.size,
      0,
      0,
      crop.size,
      crop.size,
    );
    const blob = await new Promise<Blob>((resolve, reject) => {
      target.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('头像裁剪失败，请重试'));
      }, 'image/png');
    });
    if (blob.size > MAX_REGISTRATION_AVATAR_BYTES)
      throw new Error('裁剪结果超过 10 MiB，请缩小选区');
    const bytes = parseCroppedAvatar(new Uint8Array(await blob.arrayBuffer()));
    if (!disposed) await props.save(bytes);
  } catch (cause) {
    if (!disposed)
      error.value =
        cause instanceof Error ? cause.message : '头像裁剪失败，请重试';
  } finally {
    target.width = 0;
    target.height = 0;
    if (!disposed) busy.value = false;
  }
};

/** 解码后只绘制轻量原图预览；导出始终使用完整的原始 ImageBitmap。 */
const load = async (): Promise<void> => {
  try {
    const bytes = parseRegistrationAvatar(props.bytes);
    const decoded = await createImageBitmap(
      new Blob([new Uint8Array(bytes)], {
        type: registrationAvatarMime(bytes),
      }),
    );
    if (disposed) {
      decoded.close();
      return;
    }
    image.value = decoded;
    reset();
    await nextTick();
    if (disposed || !canvas.value) return;
    const target = canvas.value;
    const scale = Math.min(1, 1024 / Math.max(decoded.width, decoded.height));
    target.width = Math.max(1, Math.round(decoded.width * scale));
    target.height = Math.max(1, Math.round(decoded.height * scale));
    const context = target.getContext('2d');
    if (!context) throw new Error('无法创建头像预览');
    context.drawImage(decoded, 0, 0, target.width, target.height);
  } catch {
    if (!disposed) {
      image.value?.close();
      image.value = null;
      error.value = '头像图片无法读取，请重新选择 JPG 或 PNG';
    }
  }
};

/** Escape 只取消本次裁剪，不改变注册表单原头像。 */
const handleEscape = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('cancel');
  }
};

onMounted((): void => {
  window.addEventListener('keydown', handleEscape);
  void load();
});
onBeforeUnmount((): void => {
  disposed = true;
  image.value?.close();
  image.value = null;
  window.removeEventListener('keydown', handleEscape);
});
</script>

<style scoped>
.avatar-crop-editor {
  width: 100%;
  padding: 20px;
  background: #f9f9f9;
  color: #252525;
}
h2 {
  margin: 0 0 18px;
  font-size: 18px;
  font-weight: 500;
}
.avatar-crop-viewport {
  position: relative;
  display: grid;
  place-items: center;
  width: min(100%, 340px);
  aspect-ratio: 1;
  margin: 0 auto;
  background: #e8e8e8;
  touch-action: none;
  user-select: none;
}
.avatar-crop-image {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
.avatar-crop-shade {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
}
.avatar-crop-shade > div {
  position: absolute;
  box-shadow: 0 0 0 100vmax #0007;
}
.avatar-crop-loading {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  font-size: 13px;
  text-align: center;
}
.avatar-crop-selection {
  position: absolute;
  cursor: move;
  outline: 1px solid #fff;
}
.avatar-crop-selection:focus-visible {
  outline: 2px solid #00ae68;
}
.avatar-crop-grid {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image:
    linear-gradient(
      to right,
      transparent calc(100% / 3 - 0.5px),
      #ffffff99 calc(100% / 3),
      transparent calc(100% / 3 + 0.5px),
      transparent calc(200% / 3 - 0.5px),
      #ffffff99 calc(200% / 3),
      transparent calc(200% / 3 + 0.5px)
    ),
    linear-gradient(
      to bottom,
      transparent calc(100% / 3 - 0.5px),
      #ffffff99 calc(100% / 3),
      transparent calc(100% / 3 + 0.5px),
      transparent calc(200% / 3 - 0.5px),
      #ffffff99 calc(200% / 3),
      transparent calc(200% / 3 + 0.5px)
    );
}
.avatar-crop-handle {
  position: absolute;
  width: 14px;
  height: 14px;
  padding: 0;
  border: 1px solid #fff;
  border-radius: 0;
  background: #00ae68;
}
.handle-nw {
  left: -7px;
  top: -7px;
  cursor: nwse-resize;
}
.handle-ne {
  right: -7px;
  top: -7px;
  cursor: nesw-resize;
}
.handle-sw {
  left: -7px;
  bottom: -7px;
  cursor: nesw-resize;
}
.handle-se {
  right: -7px;
  bottom: -7px;
  cursor: nwse-resize;
}
.avatar-crop-controls {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 18px 0 0;
  font-size: 12px;
}
.avatar-crop-controls .el-input-number {
  width: 106px;
}
.avatar-crop-dimensions {
  margin-left: auto;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.avatar-crop-controls .el-button {
  width: 30px;
  height: 30px;
  padding: 0;
  margin: 0;
  flex-shrink: 0;
}
.avatar-crop-error {
  min-height: 18px;
  margin: 8px 0 12px;
  color: #bf3434;
  font-size: 12px;
  overflow-wrap: anywhere;
}
footer {
  display: flex;
  justify-content: flex-end;
}
</style>
