/// <reference types="vite/client" />

import type { DesktopApi, HistoryWindowApi } from '../shared/windows/desktop';
import type { TrayPreviewApi } from '../shared/windows/tray-preview';
import type { ImagePreviewApi } from '../shared/windows/image-preview';
import type { VideoPlayerApi } from '../shared/media/video/video';
import type { RtcCallWindowApi } from '../shared/windows/rtc-call-window';
import type { RtcMicrophoneMenuApi } from '../shared/rtc/rtc-microphone';
import type { ScreenshotApi } from '../shared/media/screenshot/screenshot';
import type { AvatarCropApi } from '../shared/media/image/avatar-crop';
import type { AddFriendWindowApi } from '../shared/windows/add-friend-window';
import type { FriendProfileApi } from '../shared/contacts/friend-profile';
import type { FriendRemarkApi } from '../shared/contacts/friend-remark';
import type { SettingsWindowApi } from '../shared/windows/settings-window';
import type { UpdateWindowApi } from '../shared/windows/update-window';
import type { UpdateConfirmApi } from '../shared/windows/update-confirm';
import type {
  FriendApplicationApi,
  FriendVerificationApi,
} from '../shared/contacts/friend-application';

declare global {
  interface ImportMetaEnv {
    readonly VITE_AUTH_API_BASE?: string;
    readonly VITE_CLIENT_ID_PC?: string;
    readonly VITE_CLIENT_ID_PHONE?: string;
    readonly VITE_CLIENT_ID_WEB?: string;
  }

  interface Window {
    contextMenuHost?: import('../shared/windows/context-menu').ContextMenuHostApi;
    contextMenuDesktop?: import('../shared/windows/context-menu').ContextMenuWindowApi;
    trayPreviewDesktop?: TrayPreviewApi;
    conversationDesktop?: import('../shared/windows/conversation-window').ConversationWindowApi;
    desktop?: DesktopApi;
    rtcCallDesktop?: RtcCallWindowApi;
    rtcMicrophoneDesktop?: RtcMicrophoneMenuApi;
    historyDesktop?: HistoryWindowApi;
    imagePreviewDesktop?: ImagePreviewApi;
    videoPlayerDesktop?: VideoPlayerApi;
    screenshotDesktop?: ScreenshotApi;
    avatarCropDesktop?: AvatarCropApi;
    addFriendDesktop?: AddFriendWindowApi;
    friendProfileDesktop?: FriendProfileApi;
    friendRemarkDesktop?: FriendRemarkApi;
    settingsDesktop?: SettingsWindowApi;
    updateDesktop?: UpdateWindowApi;
    updateConfirmDesktop?: UpdateConfirmApi;
    friendApplicationDesktop?: FriendApplicationApi;
    friendVerificationDesktop?: FriendVerificationApi;
  }
}
