import type { AuthUser } from '../auth/auth';
import type { RtcMediaSignal, RtcMediaView } from '../rtc/rtc-media';
import type { ResourceSseMessage } from './desktop';
import type {
  RtcMicrophoneAnchor,
  RtcMicrophoneCommand,
  RtcMicrophoneMenuStatus,
  RtcMicrophoneState,
  RtcAudioMenuState,
  RtcAudioMenuCommand,
  RtcCameraCommand,
} from '../rtc/rtc-microphone';
import type {
  RtcCallPeer,
  RtcCallView,
  RtcJoinCredential,
  RtcMediaMode,
} from '../rtc/rtc';

export interface RtcCallWindowContext {
  call: RtcCallView;
  user: AuthUser;
  peer: RtcCallPeer;
  compact: boolean;
  group?: boolean;
}

export interface RtcCallWindowApi {
  rtcGetMedia: (callId: string) => Promise<RtcMediaView>;
  rtcSignalMedia: (
    callId: string,
    signal: RtcMediaSignal,
  ) => Promise<RtcMediaView>;
  context: () => Promise<RtcCallWindowContext>;
  readParticipant: (uid: string) => Promise<RtcCallPeer>;
  rtcCreateCall: (
    roomId: string,
    mediaMode: RtcMediaMode,
    clientRequestId: string,
    participantUids?: string[],
    replaceCallIds?: string[],
  ) => Promise<RtcCallView>;
  rtcGetCall: (callId: string) => Promise<RtcCallView>;
  rtcIssueToken: (callId: string) => Promise<RtcJoinCredential>;
  rtcAcceptCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcRejectCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcCancelCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  /** 发起端请求断开到期邀请，不结束已接通的成员。 */
  rtcExpireCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcHangupCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcLeaveCall: (
    callId: string,
    clientRequestId: string,
    expectedVersion: number,
  ) => Promise<RtcCallView>;
  rtcSetVideoEnabled: (callId: string, enabled: boolean) => Promise<boolean>;
  onResourceMessage: (
    callback: (message: ResourceSseMessage) => void,
  ) => () => void;
  onClosing: (callback: () => void) => () => void;
  publishMicrophoneState: (state: RtcMicrophoneState) => Promise<void>;
  showMicrophoneMenu: (
    anchor: RtcMicrophoneAnchor,
    focus: boolean,
  ) => Promise<void>;
  leaveMicrophoneMenu: () => Promise<void>;
  hideMicrophoneMenu: () => Promise<void>;
  onMicrophoneCommand: (
    callback: (command: RtcMicrophoneCommand) => void,
  ) => () => void;
  onMicrophoneMenuStatus: (
    callback: (status: RtcMicrophoneMenuStatus) => void,
  ) => () => void;
  publishSpeakerState: (state: RtcAudioMenuState) => Promise<void>;
  showSpeakerMenu: (
    anchor: RtcMicrophoneAnchor,
    focus: boolean,
  ) => Promise<void>;
  leaveSpeakerMenu: () => Promise<void>;
  hideSpeakerMenu: () => Promise<void>;
  onSpeakerCommand: (
    callback: (command: RtcAudioMenuCommand) => void,
  ) => () => void;
  onSpeakerMenuStatus: (
    callback: (status: RtcMicrophoneMenuStatus) => void,
  ) => () => void;
  publishCameraState: (state: RtcMicrophoneState) => Promise<void>;
  showCameraMenu: (
    anchor: RtcMicrophoneAnchor,
    focus: boolean,
  ) => Promise<void>;
  leaveCameraMenu: () => Promise<void>;
  hideCameraMenu: () => Promise<void>;
  onCameraCommand: (
    callback: (command: RtcCameraCommand) => void,
  ) => () => void;
  onCameraMenuStatus: (
    callback: (status: RtcMicrophoneMenuStatus) => void,
  ) => () => void;
  controlWindow: (
    action: 'close' | 'minimize' | 'maximize' | 'pin' | 'expand',
  ) => Promise<boolean>;
}
