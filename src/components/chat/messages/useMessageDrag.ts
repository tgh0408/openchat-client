import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { MessageDragRequest } from '../../../../shared/chat/messages/message-drag';

/** 聊天与历史附件只拖出真实文件，不把 Blob 地址或远端链接交给资源管理器。 */
export const useMessageDrag = (
  request: () => MessageDragRequest | null,
  content: () => string,
  onLocalMissing?: () => void,
): {
  draggable: Ref<boolean>;
  dragStatus: Ref<string>;
  prepareDrag: (event: PointerEvent) => void;
  startDrag: (event: DragEvent) => void;
  guardDragClick: (event: MouseEvent) => void;
} => {
  const api = window.historyDesktop ?? window.desktop;
  const draggable = computed((): boolean =>
    Boolean(
      api &&
      ['', '#workspace', '#history'].includes(window.location.hash) &&
      request(),
    ),
  );
  const dragStatus = ref('');
  let ticket: string | null = null;
  let task: Promise<string | null> | null = null;
  let generation = 0;
  let disposed = false;
  let suppressClick = false;

  /** 准备期间复用同一任务，虚拟列表复用后拒绝旧消息结果。 */
  const prepare = async (): Promise<string | null> => {
    const target = request();
    if (!api || !target || !draggable.value || disposed) return null;
    if (typeof api.prepareMessageDrag !== 'function')
      throw new Error('请重启客户端以启用文件拖拽');
    if (task) return task;
    const current = generation;
    const pending = api.prepareMessageDrag(target);
    task = pending;
    try {
      const result = await pending;
      if (disposed || current !== generation) return null;
      ticket = result;
      if (!result) onLocalMissing?.();
      return result;
    } finally {
      if (task === pending) task = null;
    }
  };

  /** 按下鼠标时仅预热已有本地文件，不隐式下载大附件。 */
  const prepareDrag = (event: PointerEvent): void => {
    if (event.button !== 0 || !draggable.value) return;
    suppressClick = false;
    void prepare().catch(() => {});
  };

  /** 仅准备已有本地文件，缺失时提示用户主动下载。 */
  const prepareLocalDrag = async (): Promise<void> => {
    const current = generation;
    dragStatus.value = '正在准备拖出文件…';
    try {
      const local = await prepare();
      if (disposed || current !== generation) return;
      dragStatus.value = local
        ? '文件已准备好，请再次拖动到目标文件夹'
        : '本地文件不存在，请先点击下载按钮';
    } catch (failure) {
      if (!disposed && current === generation)
        dragStatus.value =
          failure instanceof Error ? failure.message : '文件准备失败，请重试';
    }
  };

  /** 阻止浏览器默认链接拖动，并在原手势内立即提交原生文件拖拽。 */
  const startDrag = (event: DragEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!draggable.value || !api || disposed) return;
    suppressClick = true;
    if (!ticket) {
      void prepareLocalDrag();
      return;
    }
    const current = generation;
    dragStatus.value = '';
    void api.startMessageDrag(ticket).catch((failure: unknown) => {
      if (!disposed && current === generation) {
        ticket = null;
        dragStatus.value =
          failure instanceof Error ? failure.message : '拖出文件失败，请重试';
        onLocalMissing?.();
      }
    });
  };

  /** 拖出结束后不再触发图片预览或视频播放。 */
  const guardDragClick = (event: MouseEvent): void => {
    if (!suppressClick) return;
    suppressClick = false;
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  watch(
    [() => JSON.stringify(request()), content],
    () => {
      generation++;
      ticket = null;
      task = null;
      dragStatus.value = '';
      suppressClick = false;
    },
    { flush: 'sync' },
  );
  onBeforeUnmount(() => {
    disposed = true;
    generation++;
    ticket = null;
    task = null;
  });
  return { draggable, dragStatus, prepareDrag, startDrag, guardDragClick };
};
