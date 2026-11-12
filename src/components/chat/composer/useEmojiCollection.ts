import { onBeforeUnmount, ref, watch } from 'vue';
import type { Ref } from 'vue';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';

interface EmojiCollectionState {
  addingEmoji: Ref<boolean>;
  emojiFeedback: Ref<string>;
  emojiFailed: Ref<boolean>;
  finishEmojiFeedback: (message: string, failed: boolean) => void;
  addEmoji: (request: ImagePreviewRequest) => Promise<void>;
}

/** 图片和表情共用收藏反馈，异步操作始终绑定原消息和授权状态。 */
export const useEmojiCollection = (
  getTarget: () => ImagePreviewRequest | null,
): EmojiCollectionState => {
  const addingEmoji = ref(false);
  const emojiFeedback = ref('');
  const emojiFailed = ref(false);
  let version = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** 关闭旧计时器，避免覆盖新操作的反馈。 */
  const clearTimer = (): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  /** 成功停留 1.5 秒，错误保留五秒，不占用消息布局。 */
  const finishEmojiFeedback = (message: string, failed: boolean): void => {
    clearTimer();
    emojiFeedback.value = message;
    emojiFailed.value = failed;
    timer = setTimeout(
      () => {
        emojiFeedback.value = '';
        timer = undefined;
      },
      failed ? 5000 : 1500,
    );
  };

  /** 提交主进程收藏，待真实响应及本地缓存更新完成后显示成功。 */
  const addEmoji = async (request: ImagePreviewRequest): Promise<void> => {
    const target = getTarget();
    if (
      disposed ||
      addingEmoji.value ||
      !window.desktop ||
      window.historyDesktop ||
      target?.conversationId !== request.conversationId ||
      target.messageId !== request.messageId
    )
      return;
    const current = ++version;
    clearTimer();
    addingEmoji.value = true;
    emojiFailed.value = false;
    emojiFeedback.value = '正在添加';
    try {
      if (typeof window.desktop.addImageEmoji !== 'function')
        throw new Error('请重启程序以加载添加表情接口');
      await window.desktop.addImageEmoji(request);
      if (!disposed && current === version)
        finishEmojiFeedback('已添加', false);
    } catch (error) {
      if (!disposed && current === version)
        finishEmojiFeedback(
          error instanceof Error ? error.message : '添加到表情失败',
          true,
        );
    } finally {
      if (!disposed && current === version) addingEmoji.value = false;
    }
  };

  watch(
    () => {
      const target = getTarget();
      return target ? `${target.conversationId}:${target.messageId}` : null;
    },
    () => {
      version++;
      clearTimer();
      addingEmoji.value = false;
      emojiFeedback.value = '';
      emojiFailed.value = false;
    },
    { flush: 'sync' },
  );
  onBeforeUnmount(() => {
    disposed = true;
    version++;
    clearTimer();
  });
  return {
    addingEmoji,
    emojiFeedback,
    emojiFailed,
    finishEmojiFeedback,
    addEmoji,
  };
};
