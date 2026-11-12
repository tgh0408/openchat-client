<template>
  <div
    ref="layer"
    class="image-ocr-layer"
    :style="imageStyle"
    aria-label="图片中的可选文字"
    @copy="copyOriginal"
  >
    <span
      v-for="(line, index) in result.lines"
      :key="line.start"
      class="image-ocr-line"
      :style="lineStyles[index]"
      @pointerdown.stop="startSelection"
      @dblclick.stop
      @dragstart.prevent
      v-text="line.text + (index < result.lines.length - 1 ? '\n' : '')"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { CSSProperties } from 'vue';
import type {
  ImageOcrLine,
  ImageOcrResult,
  OcrTextRange,
} from '../../../shared/media/image/image-ocr';

const props = defineProps<{
  result: ImageOcrResult;
  imageStyle: CSSProperties;
}>();
const emit = defineEmits<{
  select: [range: OcrTextRange, finished: boolean];
}>();
const layer = ref<HTMLElement>();
const measure = document.createElement('canvas').getContext('2d');
let selecting = false;
let frame = 0;
let lastSelection = '';

/** 文字与原图共享整体变换，按识别行宽调整透明文本的实际字符布局。 */
const lineStyle = (line: ImageOcrLine): CSSProperties => {
  const fontSize = Math.max(1, line.height);
  if (measure) measure.font = `${fontSize}px sans-serif`;
  const textWidth = Math.max(
    1,
    measure?.measureText(line.text).width ?? line.width,
  );
  return {
    left: `${line.x}px`,
    top: `${line.y}px`,
    width: `${textWidth}px`,
    height: `${line.height}px`,
    fontSize: `${fontSize}px`,
    lineHeight: `${line.height}px`,
    transform: `scaleX(${line.width / textWidth})`,
  };
};

const lineStyles = computed((): CSSProperties[] =>
  props.result.lines.map(lineStyle),
);

/** 把原生 DOM 选区裁到图片文字层，以 UTF-16 偏移对应识别原文及 textarea。 */
const readSelection = ():
  { offsets: OcrTextRange; range: Range } | undefined => {
  const root = layer.value;
  const selection = document.getSelection();
  if (!root || !selection?.rangeCount || selection.isCollapsed) return;
  const range = selection.getRangeAt(0).cloneRange();
  if (!range.intersectsNode(root)) return;
  const bounds = document.createRange();
  bounds.selectNodeContents(root);
  if (range.compareBoundaryPoints(Range.START_TO_START, bounds) < 0)
    range.setStart(root, 0);
  if (range.compareBoundaryPoints(Range.END_TO_END, bounds) > 0)
    range.setEnd(root, root.childNodes.length);
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  const start = prefix.toString().length;
  return { offsets: { start, end: start + range.toString().length }, range };
};

/** 保留图片高亮；完成拖选后由编辑区获得焦点，方便复制或继续修订。 */
const syncSelection = (finished: boolean): void => {
  const selected = readSelection();
  if (!selected) return;
  const key = `${selected.offsets.start}:${selected.offsets.end}`;
  if (!finished && key === lastSelection) return;
  lastSelection = key;
  CSS.highlights.set('image-ocr-selection', new Highlight(selected.range));
  emit('select', selected.offsets, finished);
};

/** 图片上重新按下时开始原生文字拖选，不捕获指针以免破坏浏览器选区。 */
const startSelection = (event: PointerEvent): void => {
  if (event.button !== 0) return;
  selecting = true;
  lastSelection = '';
  CSS.highlights.delete('image-ocr-selection');
};

/** 合并频繁的 selectionchange，编辑区仅跟随当前图片拖选。 */
const selectionChanged = (): void => {
  if (!selecting || frame) return;
  frame = requestAnimationFrame((): void => {
    frame = 0;
    syncSelection(false);
  });
};

/** 即使鼠标在图片外松开，也提交最后的图片选区。 */
const finishSelection = (): void => {
  if (!selecting) return;
  selecting = false;
  if (frame) {
    cancelAnimationFrame(frame);
    frame = 0;
  }
  syncSelection(true);
};

/** 图片直接复制保留原文换行，编辑区复制使用用户修订后的文字。 */
const copyOriginal = (event: ClipboardEvent): void => {
  const selected = readSelection();
  if (!selected || !event.clipboardData) return;
  event.clipboardData.setData('text/plain', selected.range.toString());
  event.preventDefault();
};

onMounted((): void => {
  document.addEventListener('selectionchange', selectionChanged);
  window.addEventListener('pointerup', finishSelection);
  window.addEventListener('pointercancel', finishSelection);
});
onBeforeUnmount((): void => {
  if (frame) cancelAnimationFrame(frame);
  CSS.highlights.delete('image-ocr-selection');
  document.removeEventListener('selectionchange', selectionChanged);
  window.removeEventListener('pointerup', finishSelection);
  window.removeEventListener('pointercancel', finishSelection);
});
</script>

<style scoped>
.image-ocr-layer {
  position: absolute;
  left: 50%;
  top: 50%;
  transform-origin: center;
  user-select: text;
  pointer-events: none;
}
.image-ocr-line {
  position: absolute;
  display: block;
  margin: 0;
  padding: 0;
  white-space: pre;
  font-family: sans-serif;
  font-weight: normal;
  color: transparent;
  transform-origin: top left;
  pointer-events: auto;
  cursor: text;
}
.image-ocr-line::selection,
.image-ocr-line::highlight(image-ocr-selection) {
  background: #078b5d55;
  color: transparent;
}
</style>
