import {
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  shallowRef,
} from 'vue';
import type { Ref } from 'vue';
import type { Message } from '../../../../shared/storage/database';
import type { MessageVirtualizer } from '../../../services/chat/messages/message-scroll-position';
import {
  evictMessageContents,
  isMessagePlaceholder,
  messageContentRange,
  selectMessageRefill,
} from '../../../services/chat/messages/message-window';
import type {
  MessageHeight,
  MessageWindowUpdate,
} from '../../../services/chat/messages/message-window';

interface MessageWindowOptions {
  roomId: string;
  messages: () => Message[];
  viewport: Ref<HTMLElement | null>;
  virtualizer: () => MessageVirtualizer | undefined;
  read: (roomId: string, ids: string[]) => Promise<Message[]>;
  replace: (updates: MessageWindowUpdate[]) => void;
  preserve: (update: () => void) => Promise<void>;
}

interface MessageWindow {
  errors: Ref<Map<string, string>>;
  schedule: () => void;
  retry: () => void;
  ensure: (messageId: string) => Promise<boolean>;
  invalidate: () => void;
}

/** 保留完整列表位置与行高，仅回读视口附近的正文并释放远处内容。 */
export const useMessageWindow = (
  options: MessageWindowOptions,
): MessageWindow => {
  const errors = shallowRef(new Map<string, string>());
  const heights = new Map<string, MessageHeight>();
  let frame: number | undefined;
  let generation = 0;
  let active = true;
  let disposed = false;
  let running = false;
  let dirty = false;
  let rowObserver: ResizeObserver | undefined;
  const observedRows = new Set<Element>();

  /** 使用虚拟器索引确定双向预读区域，不依赖是否到达列表端点。 */
  const visibleRange = (): { first: number; last: number } | null => {
    const viewport = options.viewport.value;
    const virtualizer = options.virtualizer();
    if (
      !active ||
      disposed ||
      !viewport?.isConnected ||
      !viewport.clientHeight ||
      !virtualizer ||
      !options.messages().length ||
      options.messages()[0]?.conversationId !== options.roomId
    )
      return null;
    return {
      first: Math.max(0, virtualizer.findItemIndex(viewport.scrollTop)),
      last: Math.max(
        0,
        virtualizer.findItemIndex(viewport.scrollTop + viewport.clientHeight),
      ),
    };
  };

  /** 缓存实际虚拟行的总高度，包含时间分隔、外层间距和媒体加载后的尺寸。 */
  const measureRows = (): void => {
    const viewport = options.viewport.value;
    if (!viewport) return;
    const rows = new Set<Element>();
    for (const row of viewport.querySelectorAll<HTMLElement>(
      '[data-message-row]',
    )) {
      if (row.classList.contains('chat-message-placeholder')) continue;
      const wrapper = row.closest<HTMLElement>(
        '.elx-bubble-list__virtual-item',
      );
      const id = row.dataset.messageRow;
      if (!wrapper || !id) continue;
      const height = wrapper.getBoundingClientRect().height;
      if (height > 0)
        heights.set(id, {
          height,
          width: viewport.clientWidth,
          measured: true,
        });
      rows.add(wrapper);
      if (!observedRows.has(wrapper)) rowObserver?.observe(wrapper);
    }
    for (const row of observedRows)
      if (!rows.has(row)) rowObserver?.unobserve(row);
    observedRows.clear();
    for (const row of rows) observedRows.add(row);
  };

  /** 优先保留已测量高度；未渲染位置沿用虚拟器估算，回读后再校准。 */
  const getHeight = (message: Message, index: number): MessageHeight => {
    const known = heights.get(message.id);
    if (known) return known;
    const virtualizer = options.virtualizer();
    const height = virtualizer?.getItemSize?.(index) ?? 100;
    return {
      height: Number.isFinite(height) && height > 0 ? height : 100,
      width: options.viewport.value?.clientWidth ?? 0,
      measured: false,
    };
  };

  /** 合并一帧内的滚动、数据及行高变化，异步请求期间仅记录后续需求。 */
  const schedule = (): void => {
    if (!active || disposed) return;
    if (running) {
      dirty = true;
      return;
    }
    if (frame === undefined)
      frame = requestAnimationFrame(() => {
        frame = undefined;
        void maintain();
      });
  };

  /** 原位恢复正文并校正可见锚点；迟到结果不能写入已切换的会话视图。 */
  const refill = async (targets: Message[], version: number): Promise<void> => {
    if (!targets.length) return;
    try {
      const result = await options.read(
        options.roomId,
        targets.map((message) => message.id),
      );
      if (disposed || !active || generation !== version) return;
      const current = options.messages();
      const visible = visibleRange();
      if (!visible) return;
      const range = messageContentRange(
        current.length,
        visible.first,
        visible.last,
      );
      const retained = new Set(current.slice(range.start, range.end));
      const received = new Map(
        result
          .filter((message) => message.conversationId === options.roomId)
          .map((message) => [message.id, message]),
      );
      const updates: MessageWindowUpdate[] = [];
      const failures = new Map(errors.value);
      for (const previous of targets) {
        if (!retained.has(previous)) continue;
        const next = received.get(previous.id);
        if (next && !next.deletedAt) updates.push({ previous, next });
        else failures.set(previous.id, '消息已移除或暂不可用');
      }
      errors.value = failures;
      if (updates.length)
        await options.preserve(() => options.replace(updates));
    } catch (cause) {
      if (disposed || !active || generation !== version) return;
      const failures = new Map(errors.value);
      const text = cause instanceof Error ? cause.message : '读取消息失败';
      for (const message of targets) failures.set(message.id, text);
      errors.value = failures;
    }
  };

  /** 每轮限制正文缓存后回读最近的一批占位，请求失败保留高度并等待显式重试。 */
  const maintain = async (): Promise<void> => {
    const visible = visibleRange();
    if (!visible || running) return;
    running = true;
    dirty = false;
    const version = generation;
    try {
      measureRows();
      const updates = evictMessageContents(
        options.messages(),
        visible.first,
        visible.last,
        getHeight,
      );
      if (updates.length) options.replace(updates);
      await nextTick();
      if (generation !== version || !active || disposed) return;
      const currentRange = visibleRange();
      if (!currentRange) return;
      const targets = selectMessageRefill(
        options.messages(),
        currentRange.first,
        currentRange.last,
        new Set(errors.value.keys()),
      );
      await refill(targets, version);
      if (targets.length) dirty = true;
    } finally {
      running = false;
      if (dirty) schedule();
    }
  };

  /** 失败占位显式重试，滚动事件不会反复触发同一个失败请求。 */
  const retry = (): void => {
    errors.value = new Map();
    schedule();
  };

  /** 授权状态改变后拒绝在途读取，避免旧正文在页面失效后重新出现。 */
  const invalidate = (): void => {
    generation++;
    errors.value = new Map();
  };

  /** 定位完成前恢复目标正文，避免把空占位误判为已展示的引用消息。 */
  const ensure = async (messageId: string): Promise<boolean> => {
    const target = options
      .messages()
      .find((message) => message.id === messageId);
    if (!target) return false;
    if (isMessagePlaceholder(target)) await refill([target], generation);
    const current = options
      .messages()
      .find((message) => message.id === messageId);
    return Boolean(current && !isMessagePlaceholder(current));
  };

  /** 暂停隐藏会话的测量和回读，拒绝跨激活周期的异步结果。 */
  const suspend = (): void => {
    active = false;
    generation++;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    rowObserver?.disconnect();
    observedRows.clear();
  };

  onActivated(() => {
    active = true;
    schedule();
  });
  onDeactivated(suspend);
  onBeforeUnmount(() => {
    disposed = true;
    suspend();
    heights.clear();
  });
  rowObserver = new ResizeObserver(schedule);
  return { errors, schedule, retry, ensure, invalidate };
};
