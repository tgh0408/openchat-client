export type RtcAudioMenuKind = 'microphone' | 'speaker' | 'camera';

/** 根据主进程当前选中的设备模式显示名称。 */
export const readRtcDeviceLabel = (kind: RtcAudioMenuKind): string => {
  switch (kind) {
    case 'microphone':
      return '麦克风';
    case 'speaker':
      return '扬声器';
    case 'camera':
      return '摄像头';
  }
};

export interface RtcMicrophoneAnchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RtcMicrophoneState {
  devices: { deviceId: string; label: string }[];
  deviceId: string;
  volume: number;
  enabled: boolean;
  busy: boolean;
  deviceBusy: boolean;
  loading: boolean;
  terminal: boolean;
  error: string;
}

export interface RtcDeviceMenuBinding {
  kind: RtcAudioMenuKind;
  generation: number;
}

export interface RtcMicrophoneSnapshot extends RtcDeviceMenuBinding {
  revision: number;
  state: RtcMicrophoneState;
}

export type RtcMicrophoneCommand =
  | { type: 'toggle' }
  | { type: 'select'; deviceId: string }
  | { type: 'volume'; volume: number };

export type RtcMicrophonePointer =
  'enter' | 'leave' | 'drag-start' | 'drag-end';

export interface RtcMicrophoneMenuStatus {
  visible: boolean;
  error?: string;
}

export interface RtcMicrophoneMenuApi {
  read: () => Promise<RtcMicrophoneSnapshot>;
  ready: (binding: RtcDeviceMenuBinding, height: number) => Promise<void>;
  resize: (binding: RtcDeviceMenuBinding, height: number) => Promise<void>;
  pointer: (
    binding: RtcDeviceMenuBinding,
    action: RtcMicrophonePointer,
  ) => Promise<void>;
  command: (
    binding: RtcDeviceMenuBinding,
    command: RtcMicrophoneCommand,
  ) => Promise<void>;
  hide: (binding: RtcDeviceMenuBinding) => Promise<void>;
  onState: (callback: (snapshot: RtcMicrophoneSnapshot) => void) => () => void;
  onFocus: (callback: (binding: RtcDeviceMenuBinding) => void) => () => void;
}

export type RtcAudioMenuState = RtcMicrophoneState;
export type RtcAudioMenuCommand = RtcMicrophoneCommand;
export type RtcCameraCommand = Exclude<
  RtcMicrophoneCommand,
  { type: 'volume' }
>;

/** 设备菜单共用禁用初态，不提前采集设备。 */
export const createRtcMicrophoneState = (): RtcMicrophoneState => ({
  devices: [],
  deviceId: 'default',
  volume: 100,
  enabled: true,
  busy: true,
  deviceBusy: false,
  loading: true,
  terminal: false,
  error: '',
});

/** 读取有界对象，拒绝数组、空值及非结构化参数。 */
const readRecord = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('音频设备菜单参数无效');
  return value as Record<string, unknown>;
};

/** 菜单操作必须携带原显示类型和代次，不能自行选择其他设备模式。 */
export const parseRtcDeviceMenuBinding = (
  value: unknown,
): RtcDeviceMenuBinding => {
  const binding = readRecord(value);
  if (
    typeof binding.generation !== 'number' ||
    !Number.isSafeInteger(binding.generation) ||
    binding.generation < 0
  )
    throw new Error('设备菜单显示代次无效');
  switch (binding.kind) {
    case 'microphone':
    case 'speaker':
    case 'camera':
      return { kind: binding.kind, generation: binding.generation };
    default:
      throw new Error('设备菜单类型无效');
  }
};

/** 限制跨窗口字符串长度，不允许设备或错误文本无限占用内存。 */
const readText = (value: unknown, maximum: number): string => {
  if (typeof value !== 'string' || value.length > maximum)
    throw new Error('音频设备菜单文本无效');
  return value;
};

/** 校验主通话窗口提交的完整菜单快照，仅传递必要的公开设备信息。 */
export const parseRtcMicrophoneState = (value: unknown): RtcMicrophoneState => {
  const state = readRecord(value);
  if (!Array.isArray(state.devices) || state.devices.length > 128)
    throw new Error('音频设备列表无效');
  for (const key of ['enabled', 'busy', 'deviceBusy', 'loading', 'terminal']) {
    if (typeof state[key] !== 'boolean')
      throw new Error('音频设备菜单状态无效');
  }
  const devices = state.devices.map((value: unknown) => {
    const device = readRecord(value);
    const deviceId = readText(device.deviceId, 1024);
    if (!deviceId) throw new Error('音频设备标识无效');
    return { deviceId, label: readText(device.label, 512) };
  });
  if (new Set(devices.map((device) => device.deviceId)).size !== devices.length)
    throw new Error('音频设备列表重复');
  return {
    devices,
    deviceId: readText(state.deviceId, 1024),
    volume: parseRtcMicrophoneVolume(state.volume),
    enabled: state.enabled as boolean,
    busy: state.busy as boolean,
    deviceBusy: state.deviceBusy as boolean,
    loading: state.loading as boolean,
    terminal: state.terminal as boolean,
    error: readText(state.error, 2048),
  };
};

/** 校验百分比音量，不接受非有限数值或越界输入。 */
const parseRtcMicrophoneVolume = (value: unknown): number => {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > 100
  )
    throw new Error('音频设备音量无效');
  return value;
};

/** 音频菜单仅允许选择设备、切换开关和调整音量三种命令。 */
export const parseRtcMicrophoneCommand = (
  value: unknown,
): RtcMicrophoneCommand => {
  const command = readRecord(value);
  switch (command.type) {
    case 'toggle':
      return { type: 'toggle' };
    case 'select': {
      const deviceId = readText(command.deviceId, 1024);
      if (!deviceId) throw new Error('请选择音频设备');
      return { type: 'select', deviceId };
    }
    case 'volume':
      return {
        type: 'volume',
        volume: parseRtcMicrophoneVolume(command.volume),
      };
    default:
      throw new Error('无效的音频设备菜单操作');
  }
};

/** 只接受按钮的页面内坐标，实际屏幕坐标由主进程换算。 */
export const parseRtcMicrophoneAnchor = (
  value: unknown,
): RtcMicrophoneAnchor => {
  const anchor = readRecord(value);
  const values = [anchor.x, anchor.y, anchor.width, anchor.height];
  if (
    values.some(
      (item) =>
        typeof item !== 'number' ||
        !Number.isFinite(item) ||
        item < 0 ||
        item > 100000,
    )
  )
    throw new Error('音频设备按钮位置无效');
  const result = {
    x: anchor.x as number,
    y: anchor.y as number,
    width: anchor.width as number,
    height: anchor.height as number,
  };
  if (result.width < 1 || result.height < 1)
    throw new Error('音频设备按钮位置无效');
  return result;
};

/** 在按钮上方居中展开，空间不足时向下翻转，仅受屏幕工作区限制。 */
export const positionRtcMicrophoneMenu = (
  anchor: RtcMicrophoneAnchor,
  area: RtcMicrophoneAnchor,
  contentHeight: number,
): RtcMicrophoneAnchor => {
  const margin = 8;
  const width = Math.max(1, Math.min(208, area.width - margin * 2));
  const height = Math.max(
    1,
    Math.min(Math.ceil(contentHeight), 600, area.height - margin * 2),
  );
  const above = anchor.y - height - 8;
  const top = above >= area.y + margin ? above : anchor.y + anchor.height + 8;
  return {
    x: Math.round(
      Math.max(
        area.x + margin,
        Math.min(
          anchor.x + (anchor.width - width) / 2,
          area.x + area.width - width - margin,
        ),
      ),
    ),
    y: Math.round(
      Math.max(
        area.y + margin,
        Math.min(top, area.y + area.height - height - margin),
      ),
    ),
    width,
    height,
  };
};
