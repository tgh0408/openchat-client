import { onScopeDispose, readonly, ref } from 'vue';
import type { Ref } from 'vue';

export const ROW_HIGHLIGHT_DURATION_MS = 1800;

/** 统一定位高亮的时长及清理，计时不受虚拟行卸载或复用影响。 */
export const useRowHighlight = (): {
  highlightedId: Readonly<Ref<string>>;
  highlight: (id: string) => void;
  clear: () => void;
} => {
  const highlightedId = ref('');
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** 取消当前高亮及旧计时器，避免迟到清理影响下一次定位。 */
  const clear = (): void => {
    clearTimeout(timer);
    timer = undefined;
    highlightedId.value = '';
  };

  /** 定位完成后标记目标，调用前先清理并等待渲染以支持重复定位。 */
  const highlight = (id: string): void => {
    clear();
    highlightedId.value = id;
    timer = setTimeout(clear, ROW_HIGHLIGHT_DURATION_MS);
  };

  onScopeDispose(clear);
  return { highlightedId: readonly(highlightedId), highlight, clear };
};
