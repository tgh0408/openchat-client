import { readRtcError } from './rtc-error';

export interface RtcSpeakerOutput {
  bind: (element: HTMLMediaElement) => () => void;
  selectDevice: (deviceId: string) => Promise<void>;
  setEnabled: (enabled: boolean) => void;
  setVolume: (volume: number) => void;
  close: () => void;
}

interface OutputBinding {
  element: HTMLMediaElement;
  ready: boolean;
}

/** 将输出设备权限、断开及切换失败转换成明确提示。 */
export const readRtcSpeakerError = (cause: unknown): string => {
  return readRtcError(cause, '扬声器切换失败，请重试', 'speaker');
};

/** 本次通话统一路由实际播放元素，切换不重建媒体流或修改系统音量。 */
export const createRtcSpeakerOutput = (options: {
  onDeviceChanged: (deviceId: string) => void;
  onError: (error: unknown) => void;
  createElement?: () => HTMLMediaElement;
}): RtcSpeakerOutput => {
  const bindings = new Map<HTMLMediaElement, OutputBinding>();
  // 尚未接通时用不播放的元素验证设备，不能提前把未验证选择标为成功。
  const probe = options.createElement?.() ?? new Audio();
  probe.muted = true;
  probe.volume = 0;
  let deviceId = 'default';
  let enabled = true;
  let volume = 100;
  let closed = false;
  let queue = Promise.resolve();

  /** 元素重建及设备切换串行执行，防止旧切换覆盖后来的输出选择。 */
  const enqueue = (action: () => Promise<void>): Promise<void> => {
    const next = queue.then(action);
    queue = next.catch(() => {});
    return next;
  };

  /** 默认设备使用空 sinkId；不支持定向输出时明确拒绝而非假成功。 */
  const route = async (
    element: HTMLMediaElement,
    nextDevice: string,
  ): Promise<void> => {
    const sinkId = nextDevice === 'default' ? '' : nextDevice;
    if (element.sinkId === sinkId) return;
    if (typeof element.setSinkId !== 'function') {
      if (!sinkId) return;
      throw new Error('当前环境不支持切换扬声器');
    }
    await element.setSinkId(sinkId);
  };

  /** 未完成路由的元素保持静音，音量修改不会解除用户的静音选择。 */
  const applyLevel = (binding: OutputBinding): void => {
    binding.element.volume = volume / 100;
    binding.element.muted = closed || !enabled || !binding.ready;
  };

  /** 更新所有仍属于本次通话的播放元素。 */
  const updateLevels = (): void => {
    for (const binding of bindings.values()) applyLevel(binding);
  };

  return {
    /** 新媒体元素先静音，继承已确认的输出设备后才允许播放声音。 */
    bind: (element: HTMLMediaElement): (() => void) => {
      element.muted = true;
      if (closed) return (): void => {};
      const binding: OutputBinding = { element, ready: false };
      bindings.set(element, binding);
      applyLevel(binding);
      void enqueue(async (): Promise<void> => {
        if (closed || bindings.get(element) !== binding) return;
        await route(element, deviceId);
        if (closed || bindings.get(element) !== binding) return;
        binding.ready = true;
        applyLevel(binding);
      }).catch((error: unknown): void => {
        if (!closed && bindings.get(element) === binding)
          options.onError(error);
      });
      return (): void => {
        if (bindings.get(element) !== binding) return;
        element.muted = true;
        bindings.delete(element);
      };
    },
    /** 实际切换全部当前输出，失败回退原设备，全部成功后才更新菜单勾选。 */
    selectDevice: (nextDevice: string): Promise<void> =>
      enqueue(async (): Promise<void> => {
        if (closed) throw new Error('通话已结束');
        if (!nextDevice.trim()) throw new Error('请选择扬声器');
        const previous = deviceId;
        const changed: HTMLMediaElement[] = [];
        const routed = new Set<OutputBinding>();
        try {
          for (const element of [probe, ...bindings.keys()]) {
            if (closed) throw new Error('通话已结束');
            if (element !== probe && !bindings.has(element)) continue;
            const binding = bindings.get(element);
            await route(element, nextDevice);
            changed.push(element);
            if (binding && bindings.get(element) === binding)
              routed.add(binding);
          }
          if (closed) throw new Error('通话已结束');
        } catch (cause: unknown) {
          let rollbackFailed = false;
          for (const element of changed) {
            if (closed) break;
            if (element !== probe && !bindings.has(element)) continue;
            try {
              await route(element, previous);
            } catch {
              rollbackFailed = true;
              element.muted = true;
              const binding = bindings.get(element);
              if (binding) binding.ready = false;
            }
          }
          if (rollbackFailed)
            throw new Error(
              '无法恢复原扬声器，受影响的播放已静音，请重新选择设备',
            );
          throw cause;
        }
        deviceId = nextDevice;
        for (const binding of routed)
          if (bindings.get(binding.element) === binding) binding.ready = true;
        updateLevels();
        options.onDeviceChanged(deviceId);
      }),
    /** 开关只控制本通话播放，不重置音量或输出设备。 */
    setEnabled: (next: boolean): void => {
      if (closed) return;
      enabled = next;
      updateLevels();
    },
    /** 使用媒体元素音量控制本次通话的接收音频。 */
    setVolume: (next: number): void => {
      if (!Number.isFinite(next) || next < 0 || next > 100)
        throw new Error('扬声器音量无效');
      if (closed) return;
      volume = next;
      updateLevels();
    },
    /** 挂断立即静音并撤销绑定，迟到切换不得恢复播放或更新勾选。 */
    close: (): void => {
      if (closed) return;
      closed = true;
      updateLevels();
      bindings.clear();
      probe.pause();
      probe.srcObject = null;
    },
  };
};
