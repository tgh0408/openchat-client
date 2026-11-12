<template>
  <aside class="ocr-panel" aria-label="识别文字编辑区" :aria-busy="loading">
    <header class="ocr-panel-header">
      <strong>提取文字</strong>
      <button
        type="button"
        class="ocr-action"
        aria-label="收起文字编辑区"
        @click="emit('close')"
      >
        收起
      </button>
    </header>
    <p class="ocr-hint">
      在图片上拖选文字，编辑区会同步选中。可直接修改识别结果。
    </p>
    <div v-if="preparing" class="ocr-status" role="status">
      <span>正在加载图片...</span>
    </div>
    <div v-else-if="imageError" class="ocr-status" role="alert">
      <span>{{ imageError }}</span>
    </div>
    <div v-else-if="loading" class="ocr-status" role="status">
      <span>正在识别，可切换图片…</span>
      <button type="button" class="ocr-action" @click="emit('cancel')">
        取消识别
      </button>
    </div>
    <div v-else-if="error" class="ocr-status" role="alert">
      <span>{{ error }}</span>
      <button type="button" class="ocr-action" @click="emit('retry')">
        重新识别
      </button>
    </div>
    <div v-else-if="!hasResult" class="ocr-status">
      <span>识别已取消</span>
      <button type="button" class="ocr-action" @click="emit('retry')">
        开始识别
      </button>
    </div>
    <template v-else>
      <div class="ocr-editor-container">
        <textarea
          ref="editor"
          class="ocr-text"
          :value="text"
          :maxlength="MAX_OCR_TEXT_LENGTH"
          aria-label="可编辑的识别文字"
          placeholder="未识别到文字，可在这里输入。"
          spellcheck="false"
          @input="updateText"
        />
        <div ref="mirror" class="ocr-text ocr-mirror" aria-hidden="true">
          {{ text.slice(0, selected.start)
          }}<span ref="marker">{{
            text.slice(selected.start, selected.end) || '\u200b'
          }}</span
          >{{ text.slice(selected.end) }}
        </div>
      </div>
      <div class="ocr-panel-actions">
        <button
          type="button"
          class="ocr-action"
          :disabled="!text"
          @click="copyText(false)"
        >
          复制选中
        </button>
        <button
          type="button"
          class="ocr-action ocr-primary"
          :disabled="!text"
          @click="copyText(true)"
        >
          复制全部
        </button>
      </div>
    </template>
    <p class="ocr-feedback" role="status">{{ feedback }}</p>
  </aside>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { MAX_OCR_TEXT_LENGTH } from '../../../shared/media/image/image-ocr';
import type { OcrTextRange } from '../../../shared/media/image/image-ocr';

const props = defineProps<{
  text: string;
  loading: boolean;
  preparing: boolean;
  imageError: string;
  error: string;
  hasResult: boolean;
}>();
const emit = defineEmits<{
  'update:text': [value: string];
  close: [];
  cancel: [];
  retry: [];
}>();
const editor = ref<HTMLTextAreaElement>();
const mirror = ref<HTMLElement>();
const marker = ref<HTMLElement>();
const selected = ref<OcrTextRange>({ start: 0, end: 0 });
const feedback = ref('');
let selectionVersion = 0;

/** 保留原生 textarea 编辑、撤销及输入法行为，按文本版本重新计算 diff。 */
const updateText = (event: Event): void => {
  if (!(event.target instanceof HTMLTextAreaElement)) return;
  selectionVersion++;
  feedback.value = '';
  emit('update:text', event.target.value);
};

/** 将修订后的对应选区滚入视野；仅在图片拖选结束时转移焦点。 */
const selectRange = async (
  range: OcrTextRange,
  finished: boolean,
): Promise<void> => {
  const version = ++selectionVersion;
  selected.value = range;
  await nextTick();
  const target = editor.value;
  if (!target || version !== selectionVersion) return;
  if (finished) target.focus({ preventScroll: true });
  target.setSelectionRange(range.start, range.end);
  if (mirror.value && marker.value) {
    mirror.value.style.width = `${target.clientWidth}px`;
    target.scrollTop = Math.max(
      0,
      marker.value.offsetTop - target.clientHeight / 2,
    );
  }
  feedback.value =
    range.start === range.end
      ? '对应文字已在编辑区删除，光标已定位到原位置。'
      : '';
};

/** 复制当前编辑内容或选区，失败时保留草稿供快捷键复制。 */
const copyText = async (all: boolean): Promise<void> => {
  const target = editor.value;
  const value = all
    ? props.text
    : props.text.slice(target?.selectionStart ?? 0, target?.selectionEnd ?? 0);
  if (!value) {
    feedback.value = '请先选择要复制的文字';
    return;
  }
  try {
    await navigator.clipboard.writeText(value);
    feedback.value = '已复制';
  } catch {
    feedback.value = '复制失败，请选中文字后按 Ctrl+C';
  }
};

defineExpose({ selectRange });
</script>

<style scoped>
.ocr-panel {
  display: flex;
  flex-direction: column;
  overflow: auto;
  min-width: 0;
  min-height: 0;
  padding: 16px;
  border-left: 1px solid #dcdce1;
  background: #fafafa;
  font-size: 13px;
}
.ocr-panel-header,
.ocr-panel-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ocr-panel-header strong {
  font-size: 14px;
}
.ocr-hint {
  margin: 10px 0;
  color: #75757e;
  font-size: 12px;
  line-height: 1.6;
}
.ocr-footnote {
  margin-bottom: 0;
}
.ocr-status {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  overflow-wrap: anywhere;
  overflow: auto;
}
.ocr-editor-container {
  position: relative;
  flex: 1;
  min-height: 80px;
  overflow: hidden;
  margin-bottom: 12px;
}
.ocr-text {
  box-sizing: border-box;
  width: 100%;
  padding: 10px;
  border: 0;
  font: 14px/1.8 sans-serif;
  letter-spacing: normal;
  white-space: pre-wrap;
  overflow-wrap: break-word;
  tab-size: 8;
}
textarea.ocr-text {
  display: block;
  height: 100%;
  resize: none;
  outline: 1px solid #dcdce1;
  outline-offset: -1px;
  border-radius: 4px;
  color: #303038;
  background: #fff;
  user-select: text;
}
textarea.ocr-text:focus {
  outline-color: #078b5d;
}
.ocr-mirror {
  position: absolute;
  top: 0;
  left: 0;
  visibility: hidden;
  pointer-events: none;
}
.ocr-action {
  border: 1px solid #dcdce1;
  border-radius: 4px;
  padding: 5px 10px;
  background: #fff;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
.ocr-action:hover:not(:disabled) {
  border-color: #078b5d;
  color: #078b5d;
}
.ocr-action:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.ocr-primary {
  background: #078b5d;
  border-color: #078b5d;
  color: #fff;
}
.ocr-primary:hover:not(:disabled) {
  background: #067a52;
  color: #fff;
}
.ocr-feedback {
  min-height: 18px;
  margin: 8px 0 0;
  font-size: 12px;
  color: #067a52;
}
@media (max-width: 680px) {
  .ocr-panel {
    border-left: 0;
    border-top: 1px solid #dcdce1;
    padding: 10px;
  }
  .ocr-hint {
    margin: 4px 0;
  }
  .ocr-footnote {
    display: none;
  }
}
</style>
