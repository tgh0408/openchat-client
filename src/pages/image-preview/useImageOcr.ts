import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import type { ComputedRef, Ref, ShallowRef } from 'vue';
import type { ImagePreviewApi } from '../../../shared/windows/image-preview';
import type {
  ImageOcrResult,
  OcrTextRange,
} from '../../../shared/media/image/image-ocr';
import { createOcrSelectionMapper } from '../../../shared/media/image/ocr-selection';

interface OcrImage {
  messageId: string;
  width: number;
  height: number;
}

interface ImageOcrController {
  available: Ref<boolean>;
  opened: Ref<boolean>;
  loading: Ref<boolean>;
  result: ShallowRef<ImageOcrResult | undefined>;
  text: Ref<string>;
  error: Ref<string>;
  mapSelection: ComputedRef<(range: OcrTextRange) => OcrTextRange>;
  refreshAvailability: () => Promise<boolean>;
  recognize: () => Promise<void>;
  toggle: () => Promise<void>;
  close: () => void;
  cancel: () => void;
  reset: (keepOpened?: boolean) => void;
}

/** 隔离识别能力与图片加载，切图和卸载后丢弃旧任务与编辑草稿。 */
export const useImageOcr = (
  api:
    | Pick<
        ImagePreviewApi,
        'isRecognitionAvailable' | 'recognizeText' | 'cancelRecognition'
      >
    | undefined,
  getImage: () => OcrImage | undefined,
): ImageOcrController => {
  const available = ref(false);
  const opened = ref(false);
  const loading = ref(false);
  const result = shallowRef<ImageOcrResult>();
  const text = ref('');
  const error = ref('');
  const mapSelection = computed(() =>
    createOcrSelectionMapper(result.value?.text ?? '', text.value),
  );
  let jobId: string | undefined;
  let availabilityVersion = 0;
  let disposed = false;

  /** 切图和收起只解除显示等待，后台队列继续保存识别结果。 */
  const detach = (): void => {
    jobId = undefined;
    loading.value = false;
  };

  /** 仅用户显式取消时撤销后台任务，迟到结果不影响下一次识别。 */
  const cancel = (): void => {
    const previous = jobId;
    detach();
    error.value = '识别已取消';
    if (previous && api)
      void api.cancelRecognition(previous).catch((cause: unknown): void => {
        console.error('[OCR] 取消识别失败', cause);
      });
  };

  /** 切图可保留面板开关，但始终撤销旧查询、识别结果和编辑草稿。 */
  const reset = (keepOpened: boolean = false): void => {
    availabilityVersion++;
    available.value = false;
    detach();
    if (!keepOpened) opened.value = false;
    result.value = undefined;
    text.value = '';
    error.value = '';
  };

  /** 能力不可用时保留已打开面板并提示，不把切图变成收起操作。 */
  const refreshAvailability = async (): Promise<boolean> => {
    const version = ++availabilityVersion;
    let next = false;
    try {
      next = (await api?.isRecognitionAvailable()) === true;
    } catch (cause) {
      if (disposed || version !== availabilityVersion) return false;
      console.error('[OCR] 无法检查文字识别能力', cause);
    }
    if (disposed || version !== availabilityVersion) return false;
    available.value = next;
    if (!next) {
      detach();
      if (opened.value && !result.value && !error.value)
        error.value = '当前图片的文字识别不可用';
    }
    return next;
  };

  /** 只为当前图片发起任务，重试和失败不会改变聊天或图片加载状态。 */
  const recognize = async (): Promise<void> => {
    const image = getImage();
    if (disposed || !api || !image || loading.value) return;
    if (!available.value) {
      const version = availabilityVersion + 1;
      const wasOpened = opened.value;
      if (
        !(await refreshAvailability()) ||
        disposed ||
        version !== availabilityVersion ||
        wasOpened !== opened.value ||
        getImage()?.messageId !== image.messageId ||
        loading.value
      )
        return;
    }
    const id = crypto.randomUUID();
    jobId = id;
    opened.value = true;
    loading.value = true;
    result.value = undefined;
    text.value = '';
    error.value = '';
    try {
      const value = await api.recognizeText(image.messageId, id);
      if (disposed || jobId !== id || getImage()?.messageId !== image.messageId)
        return;
      if (!value) {
        error.value = '识别任务已结束，请重试';
        return;
      }
      result.value = value;
      text.value = value.text;
    } catch (cause) {
      if (disposed || jobId !== id) return;
      error.value = cause instanceof Error ? cause.message : '文字识别失败';
      console.error('[OCR] 文字识别失败', cause);
      void refreshAvailability();
    } finally {
      if (jobId === id) {
        jobId = undefined;
        loading.value = false;
      }
    }
  };

  /** 收起只解除显示等待，保留已完成结果和用户编辑内容。 */
  const close = (): void => {
    detach();
    opened.value = false;
  };

  /** 不可用时拒绝程序调用，重新展开已完成结果不重复识别。 */
  const toggle = async (): Promise<void> => {
    if (disposed) return;
    if (opened.value) {
      close();
      return;
    }
    if (!available.value) return;
    opened.value = true;
    if (!result.value) await recognize();
  };

  // 图片解码与能力查询可能先后完成，二者就绪后只为仍打开的面板发起一次识别。
  watch([() => getImage()?.messageId, available, opened], (): void => {
    if (
      opened.value &&
      available.value &&
      getImage() &&
      !result.value &&
      !loading.value &&
      !error.value
    )
      void recognize();
  });

  onScopeDispose(() => {
    disposed = true;
    reset();
  });
  return {
    available,
    opened,
    loading,
    result,
    text,
    error,
    mapSelection,
    refreshAvailability,
    recognize,
    toggle,
    close,
    cancel,
    reset,
  };
};
