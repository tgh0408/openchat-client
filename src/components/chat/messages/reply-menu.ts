import { h } from 'vue';
import { ChatLineSquare } from '@element-plus/icons-vue';
import type { MenuItem } from '@imengyu/vue3-context-menu';

/** 统一引用菜单样式，调用方负责复核当前消息和页面权限。 */
export const replyMenuItem = (onClick: () => void): MenuItem => ({
  label: '引用',
  icon: h(ChatLineSquare, { style: { width: '16px', height: '16px' } }),
  onClick,
});
