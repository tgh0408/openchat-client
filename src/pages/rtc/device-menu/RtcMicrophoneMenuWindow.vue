<template>
  <main
    ref="menu"
    class="rtc-microphone-menu"
    :aria-label="`${deviceLabel}设置`"
    @pointerenter="notifyPointer('enter')"
    @pointerleave="notifyPointer('leave')"
    @keydown.esc.stop.prevent="hideMenu"
  >
    <p class="rtc-microphone-heading">选择{{ deviceLabel }}</p>
    <div
      :key="binding.kind"
      class="rtc-microphone-devices"
      role="group"
      :aria-label="deviceLabel"
    >
      <button
        v-for="device in state.devices"
        :key="device.deviceId"
        type="button"
        class="rtc-microphone-item"
        :disabled="state.busy || state.deviceBusy || state.terminal"
        :aria-pressed="state.deviceId === device.deviceId"
        @click="sendCommand({ type: 'select', deviceId: device.deviceId })"
      >
        <span>{{ device.label }}</span>
        <el-icon
          v-if="state.deviceId === device.deviceId"
          class="rtc-microphone-check"
          :size="16"
          ><Check
        /></el-icon>
      </button>
    </div>
    <p v-if="state.loading" class="rtc-microphone-hint" role="status">
      正在读取设备…
    </p>
    <p v-else-if="!state.devices.length" class="rtc-microphone-hint">
      未找到{{ deviceLabel }}，请检查设备或权限
    </p>
    <p v-else-if="microphoneMissing" class="rtc-microphone-hint">
      所选{{ deviceLabel }}已断开，请选择其他设备
    </p>
    <button
      type="button"
      class="rtc-microphone-item"
      :disabled="state.busy || state.deviceBusy || state.terminal"
      @click="sendCommand({ type: 'toggle' })"
    >
      <span>{{ state.enabled ? '关闭' : '打开' }}{{ deviceLabel }}</span>
    </button>
    <p v-if="!isCamera" class="rtc-microphone-heading">音量</p>
    <div
      v-if="!isCamera"
      :key="binding.generation"
      class="rtc-microphone-volume"
    >
      <RtcSpeakerIcon
        class="rtc-microphone-volume-icon"
        :enabled="state.enabled && volume > 0"
        aria-hidden="true"
      />
      <input
        ref="volumeInput"
        class="rtc-microphone-slider"
        type="range"
        min="0"
        max="100"
        step="1"
        :value="volume"
        :style="{ '--microphone-volume': `${volume}%` }"
        :disabled="state.busy || state.terminal"
        :aria-label="volumeLabel"
        :aria-valuetext="`${volume}%`"
        :title="`${volumeLabel} ${volume}%`"
        @input="changeVolume"
        @pointerdown="beginVolumeDrag"
        @pointerup="endVolumeDrag"
        @pointercancel="endVolumeDrag"
        @lostpointercapture="endVolumeDrag"
      />
    </div>
    <p v-if="state.deviceBusy" class="rtc-microphone-hint" role="status">
      正在切换{{ deviceLabel }}…
    </p>
    <p
      v-if="localError || state.error"
      class="rtc-microphone-error"
      role="alert"
    >
      {{ localError || state.error }}
    </p>
  </main>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
} from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { Check } from '@element-plus/icons-vue';
import {
  createRtcMicrophoneState,
  readRtcDeviceLabel,
  type RtcMicrophoneCommand,
  type RtcMicrophonePointer,
  type RtcMicrophoneSnapshot,
  type RtcDeviceMenuBinding,
} from '../../../../shared/rtc/rtc-microphone';
import RtcSpeakerIcon from '../../../components/icons/RtcSpeakerIcon.vue';

const desktop = window.rtcMicrophoneDesktop;
const binding = shallowRef<RtcDeviceMenuBinding>({
  kind: 'microphone',
  generation: 0,
});
const isCamera = computed((): boolean => binding.value.kind === 'camera');
const deviceLabel = computed((): string =>
  readRtcDeviceLabel(binding.value.kind),
);
const volumeLabel = computed((): string =>
  binding.value.kind === 'speaker' ? '扬声器播放音量' : '麦克风输入音量',
);
const menu = ref<HTMLElement>();
const volumeInput = ref<HTMLInputElement>();
const state = shallowRef(createRtcMicrophoneState());
const volume = ref(100);
const localError = ref('');
let revision = -1;
let pendingVolume: number | undefined;
let disposed = false;
let dragging = false;
let dragPointer: { element: HTMLInputElement; id: number } | undefined;
let acknowledgedGeneration = -1;
let resizeFrame: number | undefined;
let measuredHeight = 0;
let observer: ResizeObserver | undefined;
let unsubscribeState: (() => void) | undefined;
let unsubscribeFocus: (() => void) | undefined;
const microphoneMissing = computed(
  (): boolean =>
    !state.value.devices.some(
      (device) => device.deviceId === state.value.deviceId,
    ),
);

/** 异步操作仅影响发起时的菜单模式和显示代次。 */
const isCurrentBinding = (value: RtcDeviceMenuBinding): boolean =>
  !disposed &&
  value.kind === binding.value.kind &&
  value.generation === binding.value.generation;

/** 切换类型时释放旧滑块捕获，后续旧指针事件不再影响新菜单。 */
const resetVolumeDrag = (): void => {
  const pointer = dragPointer;
  dragPointer = undefined;
  dragging = false;
  if (pointer?.element.hasPointerCapture(pointer.id))
    pointer.element.releasePointerCapture(pointer.id);
};

/** 菜单高度来自真实内容，滚动条隐藏但内容仍可滚动。 */
const measureHeight = (): number =>
  Math.ceil(
    Math.max(
      1,
      (menu.value?.scrollHeight ?? 200) + 2,
      menu.value?.getBoundingClientRect().height ?? 0,
    ),
  );

/** 一帧内合并尺寸变化，避免设备名称换行引起重复原生窗口调整。 */
const scheduleResize = (): void => {
  if (disposed || revision < 0 || resizeFrame !== undefined) return;
  resizeFrame = requestAnimationFrame((): void => {
    resizeFrame = undefined;
    if (disposed || !desktop) return;
    const current = binding.value;
    const height = measureHeight();
    const needsReady = acknowledgedGeneration !== current.generation;
    if (!needsReady && height === measuredHeight) return;
    measuredHeight = height;
    const pending = needsReady
      ? desktop.ready(current, height)
      : desktop.resize(current, height);
    void pending
      .then((): void => {
        if (isCurrentBinding(current))
          acknowledgedGeneration = current.generation;
      })
      .catch(() => {
        if (isCurrentBinding(current) && measuredHeight === height)
          measuredHeight = 0;
      });
  });
};

/** 按主进程版本接受真实状态，拖动期间忽略较早音量回显。 */
const receiveState = (snapshot: RtcMicrophoneSnapshot): void => {
  if (disposed || snapshot.revision <= revision) return;
  revision = snapshot.revision;
  if (!isCurrentBinding(snapshot)) {
    resetVolumeDrag();
    pendingVolume = undefined;
    localError.value = '';
    measuredHeight = 0;
    acknowledgedGeneration = -1;
    binding.value = { kind: snapshot.kind, generation: snapshot.generation };
    if (menu.value) menu.value.scrollTop = 0;
  }
  state.value = snapshot.state;
  if (pendingVolume === snapshot.state.volume) pendingVolume = undefined;
  if (!dragging && pendingVolume === undefined)
    volume.value = snapshot.state.volume;
  void nextTick(scheduleResize);
};

/** 发送白名单操作，设备勾选和开关状态仅由原通话窗口确认。 */
const sendCommand = async (command: RtcMicrophoneCommand): Promise<void> => {
  if (!desktop || disposed) return;
  const current = binding.value;
  localError.value = '';
  try {
    await desktop.command(current, command);
  } catch (cause: unknown) {
    if (!isCurrentBinding(current)) return;
    localError.value =
      cause instanceof Error
        ? cause.message
        : `${deviceLabel.value}操作失败，请重试`;
    if (command.type === 'volume' && pendingVolume === command.volume) {
      pendingVolume = undefined;
      volume.value = state.value.volume;
    }
  } finally {
    if (isCurrentBinding(current)) void nextTick(scheduleResize);
  }
};

/** 转发指针状态给主进程，两个窗口共享同一个延迟隐藏计时器。 */
const notifyPointer = (action: RtcMicrophonePointer): void => {
  if (!disposed) void desktop?.pointer(binding.value, action).catch(() => {});
};

/** 隐藏当前原生菜单，保留页面供下一次悬浮使用。 */
const hideMenu = (): void => {
  if (!disposed) void desktop?.hide(binding.value).catch(() => {});
};

/** 立即反馈滑块位置，并把增益调整交给原通话控制器。 */
const changeVolume = (event: Event): void => {
  if (
    isCamera.value ||
    event.target !== volumeInput.value ||
    !(event.target instanceof HTMLInputElement)
  )
    return;
  const next = event.target.valueAsNumber;
  if (!Number.isFinite(next)) return;
  volume.value = next;
  pendingVolume = next;
  void sendCommand({ type: 'volume', volume: next });
};

/** 捕获拖动指针，拖出菜单边界时也不提前隐藏。 */
const beginVolumeDrag = (event: PointerEvent): void => {
  if (
    event.button !== 0 ||
    isCamera.value ||
    event.currentTarget !== volumeInput.value ||
    !(event.currentTarget instanceof HTMLInputElement)
  )
    return;
  event.currentTarget.setPointerCapture(event.pointerId);
  dragPointer = { element: event.currentTarget, id: event.pointerId };
  dragging = true;
  notifyPointer('drag-start');
};

/** 松手或取消后恢复跨窗口离开检测。 */
const endVolumeDrag = (event: PointerEvent): void => {
  if (
    !dragging ||
    event.currentTarget !== dragPointer?.element ||
    event.pointerId !== dragPointer.id
  )
    return;
  resetVolumeDrag();
  notifyPointer('drag-end');
};

/** 键盘展开菜单后聚焦第一个可操作选项。 */
const focusFirstControl = (current: RtcDeviceMenuBinding): void => {
  if (!isCurrentBinding(current)) return;
  menu.value
    ?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')
    ?.focus();
};

onMounted(async (): Promise<void> => {
  if (!desktop) {
    localError.value = '请在桌面通话中打开设备菜单';
    return;
  }
  unsubscribeState = desktop.onState(receiveState);
  unsubscribeFocus = desktop.onFocus(focusFirstControl);
  observer = new ResizeObserver(scheduleResize);
  if (menu.value) observer.observe(menu.value);
  try {
    receiveState(await desktop.read());
    if (disposed) return;
    await nextTick();
    scheduleResize();
  } catch (cause: unknown) {
    if (!disposed)
      localError.value =
        cause instanceof Error ? cause.message : '设备菜单加载失败';
  }
});

onBeforeUnmount((): void => {
  disposed = true;
  resetVolumeDrag();
  observer?.disconnect();
  unsubscribeState?.();
  unsubscribeFocus?.();
  if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame);
});
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}
.rtc-microphone-menu {
  box-sizing: border-box;
  max-height: 100vh;
  overflow-y: auto;
  scrollbar-width: none;
  padding: 8px;
  border: 1px solid #555;
  border-radius: 8px;
  background: #4b4b4b;
  color: #f5f5f5;
  font-size: 14px;
  line-height: 1.4;
  letter-spacing: 0;
  user-select: none;
}
.rtc-microphone-heading {
  margin: 7px 7px 4px;
  color: #b3b3b3;
}
.rtc-microphone-devices {
  max-height: 180px;
  overflow-y: auto;
  scrollbar-width: none;
}
.rtc-microphone-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  width: 100%;
  padding: 8px 7px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.rtc-microphone-item > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.rtc-microphone-devices .rtc-microphone-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 16px;
}
.rtc-microphone-item:hover:not(:disabled),
.rtc-microphone-item:focus-visible {
  background: rgb(255 255 255 / 9%);
}
.rtc-microphone-item:focus-visible,
.rtc-microphone-slider:focus-visible {
  outline: 2px solid #07c160;
  outline-offset: 2px;
}
.rtc-microphone-item:disabled,
.rtc-microphone-slider:disabled {
  opacity: 0.55;
  cursor: default;
}
.rtc-microphone-check {
  flex: 0 0 16px;
  color: #07c160;
}
.rtc-microphone-volume {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 7px 7px;
}
.rtc-microphone-volume-icon {
  flex: 0 0 17px;
  width: 17px;
  height: 17px;
}
.rtc-microphone-slider {
  flex: 1;
  min-width: 0;
  height: 18px;
  margin: 0;
  appearance: none;
  background: transparent;
  cursor: pointer;
}
.rtc-microphone-slider::-webkit-slider-runnable-track {
  height: 2px;
  background: linear-gradient(
    to right,
    #07c160 0 var(--microphone-volume),
    #888 var(--microphone-volume) 100%
  );
}
.rtc-microphone-slider::-webkit-slider-thumb {
  width: 14px;
  height: 14px;
  margin-top: -6px;
  border: 0;
  border-radius: 50%;
  appearance: none;
  background: #fff;
}
.rtc-microphone-hint,
.rtc-microphone-error {
  margin: 6px 7px;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.rtc-microphone-hint {
  color: #ccc;
}
.rtc-microphone-error {
  color: #ffc4c4;
}
</style>
