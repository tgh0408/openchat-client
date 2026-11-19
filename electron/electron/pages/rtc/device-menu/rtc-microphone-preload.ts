import { invokeIpc as invoke } from '../../../services/ipc/invoke';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  RtcMicrophoneCommand,
  RtcMicrophoneMenuApi,
  RtcMicrophonePointer,
  RtcMicrophoneSnapshot,
  RtcDeviceMenuBinding,
} from '../../../../shared/rtc/rtc-microphone';

const prefix = 'rtc-device-menu';

/** 订阅绑定通话的菜单快照，并返回成对的取消订阅。 */
const onState = (
  callback: (snapshot: RtcMicrophoneSnapshot) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    snapshot: RtcMicrophoneSnapshot,
  ): void => callback(snapshot);
  ipcRenderer.on(`${prefix}:state`, listener);
  return (): void => {
    ipcRenderer.removeListener(`${prefix}:state`, listener);
  };
};

/** 键盘展开后只向当前显示代次交付焦点。 */
const onFocus = (
  callback: (binding: RtcDeviceMenuBinding) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    binding: RtcDeviceMenuBinding,
  ): void => callback(binding);
  ipcRenderer.on(`${prefix}:focus`, listener);
  return (): void => {
    ipcRenderer.removeListener(`${prefix}:focus`, listener);
  };
};

const api: RtcMicrophoneMenuApi = {
  read: (): Promise<RtcMicrophoneSnapshot> => invoke(`${prefix}:read`),
  ready: (binding: RtcDeviceMenuBinding, height: number): Promise<void> =>
    invoke(`${prefix}:ready`, binding, height),
  resize: (binding: RtcDeviceMenuBinding, height: number): Promise<void> =>
    invoke(`${prefix}:resize`, binding, height),
  pointer: (
    binding: RtcDeviceMenuBinding,
    action: RtcMicrophonePointer,
  ): Promise<void> => invoke(`${prefix}:pointer`, binding, action),
  command: (
    binding: RtcDeviceMenuBinding,
    command: RtcMicrophoneCommand,
  ): Promise<void> => invoke(`${prefix}:command`, binding, command),
  hide: (binding: RtcDeviceMenuBinding): Promise<void> =>
    invoke(`${prefix}:hide`, binding),
  onState,
  onFocus,
};

contextBridge.exposeInMainWorld('rtcMicrophoneDesktop', api);
