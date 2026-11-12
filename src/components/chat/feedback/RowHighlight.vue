<template>
  <component
    :is="tag ?? 'div'"
    ref="row"
    class="row-highlight"
    :class="{ 'row-highlight--active': active && !overlayTarget }"
  >
    <slot />
    <!-- Teleport 目标只接受字符串，这里按标记属性定位运行期的滚动视口父容器。 -->
    <Teleport v-if="active && overlayTarget" :to="overlayTargetSelector">
      <div
        class="row-highlight-viewport"
        :style="overlayStyle"
        aria-hidden="true"
      >
        <div class="row-highlight-backdrop" />
      </div>
    </Teleport>
  </component>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { ROW_HIGHLIGHT_DURATION_MS } from './row-highlight';

/** 定位父容器的标记属性：Teleport 目标只能是字符串，故用选择器指向运行期父容器。 */
const OVERLAY_HOST_ATTRIBUTE = 'data-row-highlight-host';
let overlayHostSequence = 0;

const props = withDefaults(
  defineProps<{
    active: boolean;
    tag?: 'div' | 'article';
    /** 滚动视口的父容器须建立定位及独立层叠上下文。 */
    viewport?: HTMLElement | null;
  }>(),
  { tag: 'div' },
);
const duration = `${ROW_HIGHLIGHT_DURATION_MS}ms`;
const row = ref<HTMLElement>();
const overlayTarget = computed(
  (): HTMLElement | null => props.viewport?.parentElement ?? null,
);
/** 返回父容器标记值，同一容器复用已有值，避免同一列表的多行互相覆盖。 */
const resolveOverlayHostKey = (host: HTMLElement): string => {
  const existing = host.getAttribute(OVERLAY_HOST_ATTRIBUTE);
  if (existing !== null) return existing;
  overlayHostSequence += 1;
  const key = String(overlayHostSequence);
  host.setAttribute(OVERLAY_HOST_ATTRIBUTE, key);
  return key;
};
/**
 * Teleport 目标选择器。取值时标记父容器，使目标在选择器求值后、挂载前已存在；
 * 标记写在父容器上，不改变高亮几何，容器移除后属性随之消失。
 */
const overlayTargetSelector = computed((): string => {
  const host = overlayTarget.value;
  if (host === null) return '';
  return `[${OVERLAY_HOST_ATTRIBUTE}="${resolveOverlayHostKey(host)}"]`;
});
const overlayStyle = shallowRef<Record<string, string>>({
  visibility: 'hidden',
});

watch(
  [() => props.active, () => props.viewport, row],
  ([active, viewport, element], _previous, onCleanup): void => {
    overlayStyle.value = { visibility: 'hidden' };
    const target = overlayTarget.value;
    if (!active || !viewport || !element || !target) return;
    let frame: number | undefined;

    /** 仅在高亮期间跟随滚动、虚拟行位移及媒体撑高，不修改列表几何。 */
    const updateOverlay = (): void => {
      if (
        !element.isConnected ||
        !viewport.contains(element) ||
        viewport.clientHeight === 0
      ) {
        overlayStyle.value = { visibility: 'hidden' };
      } else {
        const bounds = element.getBoundingClientRect();
        const visible = viewport.getBoundingClientRect();
        const parent = target.getBoundingClientRect();
        const nextStyle: Record<string, string> = {
          left: `${visible.left - parent.left - target.clientLeft + target.scrollLeft}px`,
          top: `${visible.top - parent.top - target.clientTop + target.scrollTop + viewport.clientTop}px`,
          width: `${viewport.offsetWidth}px`,
          height: `${viewport.clientHeight}px`,
          '--row-highlight-top': `${bounds.top - visible.top - viewport.clientTop}px`,
          '--row-highlight-height': `${bounds.height}px`,
          '--row-highlight-block-outset':
            getComputedStyle(element)
              .getPropertyValue('--row-highlight-block-outset')
              .trim() || '0px',
          visibility: 'visible',
        };
        if (
          Object.entries(nextStyle).some(
            ([key, value]) => overlayStyle.value[key] !== value,
          )
        )
          overlayStyle.value = nextStyle;
      }
      frame = requestAnimationFrame(updateOverlay);
    };

    updateOverlay();
    onCleanup((): void => {
      if (frame !== undefined) cancelAnimationFrame(frame);
    });
  },
  { immediate: true, flush: 'post' },
);
</script>

<style scoped>
.row-highlight {
  position: relative;
  isolation: isolate;
}
.row-highlight--active::before {
  content: '';
  position: absolute;
  inset: calc(0px - var(--row-highlight-block-outset, 0px)) 0;
  z-index: -1;
  pointer-events: none;
}
.row-highlight-viewport {
  /* 几何值由 :style 在运行时写入本元素，此处初值供静态解析及未写入时兜底。 */
  --row-highlight-top: 0px;
  --row-highlight-height: 0px;
  position: absolute;
  z-index: -1;
  overflow: hidden;
  pointer-events: none;
}
.row-highlight-backdrop {
  position: absolute;
  inset-inline: 0;
  top: calc(
    var(--row-highlight-top, 0px) - var(--row-highlight-block-outset, 0px)
  );
  height: calc(
    var(--row-highlight-height, 0px) + 2 *
      var(--row-highlight-block-outset, 0px)
  );
}
.row-highlight--active::before,
.row-highlight-backdrop {
  background-color: #d9efdf;
  animation: row-highlight-fade v-bind(duration) ease-out 1 forwards;
}
@keyframes row-highlight-fade {
  from {
    background-color: #d9efdf;
  }
  to {
    background-color: transparent;
  }
}
@media (prefers-reduced-motion: reduce) {
  /* 仅为定位高亮保留渐隐，不解除全局减少动画限制。 */
  .row-highlight--active::before,
  .row-highlight-backdrop {
    animation: row-highlight-fade v-bind(duration) ease-out 1 forwards !important;
  }
}
</style>
