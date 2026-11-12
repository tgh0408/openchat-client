<template>
  <ContextMenu
    ref="menu"
    :show="visible"
    :options="options"
    :destroy-on-close="false"
    @close="dismiss"
  />
</template>

<script setup lang="ts">
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue';
import { ContextMenu } from '@imengyu/vue3-context-menu';
import type {
  ContextMenuInstance,
  MenuOptions,
} from '@imengyu/vue3-context-menu';
import '@imengyu/vue3-context-menu/lib/vue3-context-menu.css';
import type { ContextMenuSnapshot } from '../../../shared/windows/context-menu';
import { menuIcons } from '../../services/context-menu/icons';

const api = window.contextMenuDesktop;
const menu = ref<ContextMenuInstance>();
const snapshot = shallowRef<ContextMenuSnapshot | null>(null);
const visible = ref(false);
let unsubscribe: (() => void) | undefined;
let version = 0;
let disposed = false;

/** 将主进程白名单数据还原为原菜单库的图标和样式，不包含业务回调。 */
const options = computed<MenuOptions>(() => {
  const current = snapshot.value;
  return {
    x: 16,
    y: 16,
    theme: 'mac',
    customClass: 'chat-context-menu',
    adjustPosition: false,
    closeWhenScroll: false,
    mouseScroll: true,
    minWidth: current?.minWidth ?? 180,
    maxWidth: current?.maxWidth ?? 320,
    maxHeight: current?.maxHeight ?? 768,
    preserveIconWidth: current?.preserveIconWidth ?? true,
    items: (current?.items ?? []).map((item) => ({
      ...item,
      icon: item.icon
        ? h(menuIcons[item.icon], { style: { width: '16px', height: '16px' } })
        : undefined,
      // 主进程确认选择后隐藏窗口，避免库关闭事件抢先取消本次选择。
      clickClose: false,
      onClick: (): void => {
        if (current) void api?.select(current, item.id).catch(reportFailure);
      },
    })),
  };
});

/** IPC 失效只收起当前展示，不在菜单窗口中打开其他业务界面。 */
const reportFailure = (error: unknown): void => {
  console.warn('菜单操作未完成', error);
  visible.value = false;
  const current = snapshot.value;
  if (current) void api?.dismiss(current).catch(() => {});
};

/** Escape 或透明边缘点击交给主进程统一恢复来源焦点。 */
const dismiss = (): void => {
  const current = snapshot.value;
  if (current) void api?.dismiss(current).catch(reportFailure);
};

/** 内容渲染和布局完成后再回报尺寸，迟到测量不能显示旧菜单。 */
const receive = async (value: ContextMenuSnapshot | null): Promise<void> => {
  const ownVersion = ++version;
  snapshot.value = value;
  visible.value = value !== null;
  if (!value || !api) return;
  // 测量面按屏幕可用尺寸布局，不被上一次较小的原生窗口截短。
  document.documentElement.style.setProperty(
    '--menu-layout-width',
    `${value.maxWidth + 32}px`,
  );
  document.documentElement.style.setProperty(
    '--menu-layout-height',
    `${value.maxHeight + 32}px`,
  );
  await nextTick();
  requestAnimationFrame(async () => {
    if (disposed || ownVersion !== version || snapshot.value !== value) return;
    const root = menu.value?.getMenuRef();
    root?.setPosition(16, 16);
    root?.adjustPosition();
    // 菜单库分两次 nextTick 计算滚动高度，等待它完成再量取外框。
    await nextTick();
    await nextTick();
    if (disposed || ownVersion !== version || snapshot.value !== value) return;
    const size = menu.value?.getMenuDimensions();
    if (size && size.width > 0 && size.height > 0)
      void api.layout(value, size).catch(reportFailure);
  });
};

onMounted(async () => {
  if (!api) return;
  unsubscribe = api.onSnapshot((value) => void receive(value));
  const before = version;
  try {
    const value = await api.ready();
    if (!disposed && before === version) await receive(value);
  } catch (error: unknown) {
    reportFailure(error);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  version++;
  unsubscribe?.();
});
</script>

<style>
html,
body,
#app {
  width: var(--menu-layout-width, 640px);
  height: var(--menu-layout-height, 800px);
  min-height: 0;
  overflow: hidden;
  background: transparent;
}
html .mx-menu-ghost-host.fullscreen {
  width: var(--menu-layout-width, 640px);
  height: var(--menu-layout-height, 800px);
}
</style>
