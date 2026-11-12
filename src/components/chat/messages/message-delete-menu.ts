import { h, inject } from 'vue';
import type { InjectionKey } from 'vue';
import { Delete } from '@element-plus/icons-vue';
import type { MenuItem } from '@imengyu/vue3-context-menu';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';

export type MessageDeletionMenu = (target: ImagePreviewRequest) => MenuItem[];
export const messageDeletionMenuKey: InjectionKey<MessageDeletionMenu> = Symbol(
  'message-deletion-menu',
);

/** 媒体菜单复用所属聊天列表的删除权限，历史与引用预览不自行获得写入能力。 */
export const useMessageDeletionMenu = (): MessageDeletionMenu =>
  inject(messageDeletionMenuKey, (): MenuItem[] => []);

/** 删除项默认沿用普通菜单配色，悬浮时显示红底白字。 */
export const messageDeleteMenuItem = (
  disabled: boolean,
  remove: () => void,
): MenuItem => ({
  label: '删除',
  icon: h(Delete, { style: { width: '16px', height: '16px' } }),
  customClass: 'chat-message-delete',
  divided: 'up',
  disabled,
  onClick: remove,
});
