import { h, onBeforeUnmount, ref } from 'vue';
import { DocumentCopy } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import 'element-plus/es/components/message/style/css';
import type { MenuItem } from '@imengyu/vue3-context-menu';
import type { MessageCopyRequest } from '../../../../shared/chat/messages/message-copy';

type CopyTarget = MessageCopyRequest | { kind: 'text'; text: string };

/** 统一复制菜单与反馈，虚拟列表复用后不执行旧消息的菜单操作。 */
export const useMessageCopy = (): {
  copyMenuItem: (target: CopyTarget, isCurrent: () => boolean) => MenuItem;
} => {
  const api = window.historyDesktop ?? window.desktop;
  const copying = ref(false);
  let disposed = false;
  onBeforeUnmount(() => {
    disposed = true;
  });

  /** 文本使用系统文本剪贴板，附件由受控主进程按消息读取真实文件。 */
  const copy = async (
    target: CopyTarget,
    isCurrent: () => boolean,
  ): Promise<void> => {
    if (disposed || copying.value || !isCurrent()) return;
    copying.value = true;
    const feedback = ElMessage({ message: '正在复制…', duration: 0 });
    try {
      if (target.kind === 'text') {
        await navigator.clipboard.writeText(target.text);
      } else {
        if (!api || typeof api.copyMessageAttachment !== 'function')
          throw new Error('请重启桌面客户端以启用附件复制');
        await api.copyMessageAttachment(target);
      }
      if (!disposed && isCurrent()) ElMessage.success('已复制');
    } catch (failure) {
      if (!disposed && isCurrent())
        ElMessage.error(
          failure instanceof Error ? failure.message : '复制失败，请重试',
        );
    } finally {
      feedback.close();
      copying.value = false;
    }
  };

  /** 捕获打开菜单时的目标，保留撤回等其他菜单项各自的权限。 */
  const copyMenuItem = (
    target: CopyTarget,
    isCurrent: () => boolean,
  ): MenuItem => ({
    label: '复制',
    icon: h(DocumentCopy, { style: { width: '16px', height: '16px' } }),
    disabled:
      copying.value ||
      !isCurrent() ||
      (target.kind === 'text' ? !navigator.clipboard : !api),
    onClick: (): void => {
      void copy(target, isCurrent);
    },
  });
  return { copyMenuItem };
};
