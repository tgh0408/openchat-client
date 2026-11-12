import { invokeIpc as invoke } from '../../services/ipc/invoke';
import { contextBridge, ipcRenderer } from 'electron';
import type {
  RtcCallWindowApi,
  RtcCallWindowContext,
} from '../../../shared/windows/rtc-call-window';
import type {
  RtcCallView,
  RtcJoinCredential,
  RtcMediaMode,
} from '../../../shared/rtc/rtc';
import type { ResourceSseMessage } from '../../../shared/windows/desktop';
import type {
  RtcMicrophoneAnchor,
  RtcMicrophoneCommand,
  RtcMicrophoneMenuStatus,
  RtcMicrophoneState,
  RtcAudioMenuState,
  RtcCameraCommand,
} from '../../../shared/rtc/rtc-microphone';

/** 读取主进程绑定的通话和账号上下文。 */
const context = (): Promise<RtcCallWindowContext> => invoke('rtc-call:context');

/** 订阅主进程转发的资源 SSE。 */
const onResourceMessage = (
  callback: (message: ResourceSseMessage) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    message: ResourceSseMessage,
  ): void => callback(message);
  ipcRenderer.on('rtc-call:message', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-call:message', listener);
  };
};

/** 在系统关闭通话窗口前通知渲染层主动挂断。 */
const onClosing = (callback: () => void): (() => void) => {
  const listener = (): void => callback();
  ipcRenderer.on('rtc-call:closing', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-call:closing', listener);
  };
};

/** 调整独立通话窗口。 */
const controlWindow = (
  action: 'close' | 'minimize' | 'maximize' | 'pin' | 'expand',
): Promise<boolean> => invoke('rtc-call:control', action);

/** 只接收主进程从本通话菜单转发的白名单音频操作。 */
const onMicrophoneCommand = (
  callback: (command: RtcMicrophoneCommand) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    command: RtcMicrophoneCommand,
  ): void => callback(command);
  ipcRenderer.on('rtc-microphone:command', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-microphone:command', listener);
  };
};

/** 同步原生菜单的显示状态和加载错误，不把请求受理视为已经显示。 */
const onMicrophoneMenuStatus = (
  callback: (status: RtcMicrophoneMenuStatus) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    status: RtcMicrophoneMenuStatus,
  ): void => callback(status);
  ipcRenderer.on('rtc-microphone:status', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-microphone:status', listener);
  };
};

/** 仅订阅本通话扬声器菜单的白名单操作，和麦克风通道相互隔离。 */
const onSpeakerCommand = (
  callback: (command: RtcMicrophoneCommand) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    command: RtcMicrophoneCommand,
  ): void => callback(command);
  ipcRenderer.on('rtc-speaker:command', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-speaker:command', listener);
  };
};

/** 同步扬声器菜单实际显隐及加载失败。 */
const onSpeakerMenuStatus = (
  callback: (status: RtcMicrophoneMenuStatus) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    status: RtcMicrophoneMenuStatus,
  ): void => callback(status);
  ipcRenderer.on('rtc-speaker:status', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-speaker:status', listener);
  };
};

/** 摄像头只订阅其独立通道的设备选择和开关命令。 */
const onCameraCommand = (
  callback: (command: RtcCameraCommand) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    command: RtcCameraCommand,
  ): void => callback(command);
  ipcRenderer.on('rtc-camera:command', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-camera:command', listener);
  };
};

/** 同步摄像头原生菜单实际显隐及加载错误。 */
const onCameraMenuStatus = (
  callback: (status: RtcMicrophoneMenuStatus) => void,
): (() => void) => {
  const listener = (
    _event: Electron.IpcRendererEvent,
    status: RtcMicrophoneMenuStatus,
  ): void => callback(status);
  ipcRenderer.on('rtc-camera:status', listener);
  return (): void => {
    ipcRenderer.removeListener('rtc-camera:status', listener);
  };
};

const api: RtcCallWindowApi = {
  rtcGetMedia: (callId) => invoke('rtc:media-read', callId),
  rtcSignalMedia: (callId, signal) =>
    invoke('rtc:media-signal', callId, signal),
  context,
  readParticipant: (uid: string) => invoke('rtc-call:participant', uid),
  rtcCreateCall: (
    roomId: string,
    mediaMode: RtcMediaMode,
    clientRequestId: string,
    participantUids?: string[],
    replaceCallIds?: string[],
  ): Promise<RtcCallView> =>
    invoke(
      'rtc:create',
      roomId,
      mediaMode,
      clientRequestId,
      participantUids,
      replaceCallIds,
    ),
  rtcGetCall: (callId: string): Promise<RtcCallView> =>
    invoke('rtc:get', callId),
  rtcIssueToken: (callId: string): Promise<RtcJoinCredential> =>
    invoke('rtc:token', callId),
  rtcAcceptCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    invoke('rtc:accept', callId, clientRequestId, expectedVersion),
  rtcRejectCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    invoke('rtc:reject', callId, clientRequestId, expectedVersion),
  rtcCancelCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    invoke('rtc:cancel', callId, clientRequestId, expectedVersion),
  rtcExpireCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    invoke('rtc:expire', callId, clientRequestId, expectedVersion),
  rtcHangupCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    invoke('rtc:hangup', callId, clientRequestId, expectedVersion),
  rtcLeaveCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ): Promise<RtcCallView> =>
    invoke('rtc:leave', callId, clientRequestId, expectedVersion),
  rtcSetVideoEnabled: (callId: string, enabled: boolean): Promise<boolean> =>
    invoke('rtc:video', callId, enabled),
  onResourceMessage,
  onClosing,
  controlWindow,
  publishMicrophoneState: (state: RtcMicrophoneState): Promise<void> =>
    invoke('rtc-microphone:publish', state),
  showMicrophoneMenu: (
    anchor: RtcMicrophoneAnchor,
    focus: boolean,
  ): Promise<void> => invoke('rtc-microphone:show', anchor, focus),
  leaveMicrophoneMenu: (): Promise<void> => invoke('rtc-microphone:leave'),
  hideMicrophoneMenu: (): Promise<void> => invoke('rtc-microphone:dismiss'),
  onMicrophoneCommand,
  onMicrophoneMenuStatus,
  publishSpeakerState: (state: RtcAudioMenuState): Promise<void> =>
    invoke('rtc-speaker:publish', state),
  showSpeakerMenu: (
    anchor: RtcMicrophoneAnchor,
    focus: boolean,
  ): Promise<void> => invoke('rtc-speaker:show', anchor, focus),
  leaveSpeakerMenu: (): Promise<void> => invoke('rtc-speaker:leave'),
  hideSpeakerMenu: (): Promise<void> => invoke('rtc-speaker:dismiss'),
  onSpeakerCommand,
  onSpeakerMenuStatus,
  publishCameraState: (state: RtcMicrophoneState): Promise<void> =>
    invoke('rtc-camera:publish', state),
  showCameraMenu: (
    anchor: RtcMicrophoneAnchor,
    focus: boolean,
  ): Promise<void> => invoke('rtc-camera:show', anchor, focus),
  leaveCameraMenu: (): Promise<void> => invoke('rtc-camera:leave'),
  hideCameraMenu: (): Promise<void> => invoke('rtc-camera:dismiss'),
  onCameraCommand,
  onCameraMenuStatus,
};

contextBridge.exposeInMainWorld('rtcCallDesktop', api);
