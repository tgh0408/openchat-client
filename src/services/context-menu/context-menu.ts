import ContextMenu from '@imengyu/vue3-context-menu';
import type { MenuItem, MenuOptions } from '@imengyu/vue3-context-menu';
import { isVNode, unref, watchEffect } from 'vue';
import { ElMessage } from 'element-plus';
import 'element-plus/es/components/message/style/css';
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css';
import {
  contextMenuIcons,
  parseContextMenuRequest,
  type ContextMenuRequest,
  type ContextMenuResult,
} from '../../../shared/windows/context-menu';
import { menuIcons } from './icons';

export interface ContextMenuInstance {
  closeMenu: () => void;
  isClosed: () => boolean;
  getMenuRef: () => { adjustPosition: () => void } | undefined;
}

interface PendingMenu {
  id: string;
  close: () => void;
  complete: (result: ContextMenuResult) => void;
}

let pending: PendingMenu | undefined;
let subscribed = false;

/** 全页只订阅一次菜单结果，组件卸载由原有 closeMenu 入口撤销回调。 */
const subscribe = (): void => {
  if (subscribed || !window.contextMenuHost) return;
  subscribed = true;
  window.contextMenuHost.onResult((result) => {
    if (pending?.id === result.requestId) pending.complete(result);
  });
  window.addEventListener('pagehide', () => pending?.close());
  window.addEventListener('pointerdown', () => pending?.close(), true);
  window.addEventListener('scroll', () => pending?.close(), true);
  window.addEventListener('resize', () => pending?.close());
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') pending?.close();
  });
};

/** 复用原菜单声明，跨进程只发送展示数据，操作函数始终留在来源组件。 */
const showContextMenu = (options: MenuOptions): ContextMenuInstance => {
  const host = window.contextMenuHost;
  if (!host) return ContextMenu.showContextMenu(options);
  subscribe();
  pending?.close();
  const requestId = crypto.randomUUID();
  const itemIds = new WeakMap<MenuItem, string>();
  const callbacks = new Map<string, MenuItem>();
  let itemSequence = 0;
  let revision = 0;
  let closed = false;
  let stopWatching: (() => void) | undefined;
  let lastPayload = '';

  /** 结束本次回调绑定，保持菜单点击先执行业务、后触发 onClose 的原顺序。 */
  const complete = (result: ContextMenuResult): void => {
    if (closed) return;
    const item = result.itemId ? callbacks.get(result.itemId) : undefined;
    closed = true;
    stopWatching?.();
    if (pending?.id === requestId) pending = undefined;
    try {
      if (
        item &&
        !unref(item.disabled) &&
        !unref(item.hidden) &&
        item.divided !== 'self'
      )
        item.onClick?.();
      if (result.error) ElMessage.error(result.error);
    } finally {
      callbacks.clear();
      options.onClose?.(item);
    }
  };

  /** 主动关闭立即撤销本地回调，IPC 迟到也不能重新操作旧目标。 */
  const close = (): void => {
    if (closed) return;
    complete({ requestId });
    void host.hide(requestId).catch(() => {});
  };

  /** 按白名单映射原 Element Plus 图标，不序列化 VNode 或注入任意 HTML。 */
  const serialize = (): ContextMenuRequest => {
    callbacks.clear();
    const items = (options.items ?? []).map((item) => {
      let id = itemIds.get(item);
      if (!id) {
        id = `item-${++itemSequence}`;
        itemIds.set(item, id);
      }
      callbacks.set(id, item);
      const icon = item.icon;
      const iconName = isVNode(icon)
        ? contextMenuIcons.find((name) => menuIcons[name] === icon.type)
        : undefined;
      if (icon && !iconName) throw new Error('菜单图标尚未注册');
      if (item.children?.length || item.customRender)
        throw new Error('此菜单尚未接入独立窗口');
      return {
        id,
        label: item.label ?? '',
        icon: iconName,
        disabled: Boolean(unref(item.disabled)),
        hidden: Boolean(unref(item.hidden)),
        checked: Boolean(unref(item.checked)),
        divided: item.divided ?? false,
        customClass: item.customClass ?? '',
      };
    });
    const minWidth = options.minWidth ?? 180;
    return parseContextMenuRequest({
      requestId,
      revision: revision + 1,
      x: options.x,
      y: options.y,
      minWidth,
      maxWidth: Math.max(minWidth, Math.min(options.maxWidth ?? 320, 640)),
      preserveIconWidth: options.preserveIconWidth ?? true,
      items,
    });
  };

  /** 异步追加收藏项时更新当前菜单，已关闭或已替换的请求不再发布。 */
  const publish = (): void => {
    if (closed) return;
    try {
      const request = serialize();
      const payload = JSON.stringify({ ...request, revision: 0 });
      if (payload === lastPayload) return;
      lastPayload = payload;
      const first = revision === 0;
      revision = request.revision;
      const operation = first ? host.show(request) : host.update(request);
      void operation.catch((error: unknown) => {
        if (!closed)
          complete({
            requestId,
            error: error instanceof Error ? error.message : '菜单打开失败',
          });
      });
    } catch (error: unknown) {
      queueMicrotask(() =>
        complete({
          requestId,
          error: error instanceof Error ? error.message : '菜单打开失败',
        }),
      );
    }
  };

  pending = { id: requestId, close, complete };
  stopWatching = watchEffect(publish, { flush: 'sync' });
  return {
    closeMenu: close,
    isClosed: () => closed,
    getMenuRef: () => (closed ? undefined : { adjustPosition: publish }),
  };
};

export default { showContextMenu };
