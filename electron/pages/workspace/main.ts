import { initializeImageOcrProvider } from '../../services/media/image/image-ocr';
import { ApiResponseError } from '../../../shared/api/api-error';
import { RtcAuditEvent } from '../../../shared/rtc/rtc-audit';
import { dialRtcCall, parseRtcReplaceCallIds } from '../rtc/rtc-dial';
import {
  closeReplacedRtcCallWindows,
  getRtcCallWindowIds,
} from '../rtc/rtc-call-window';
import { requestSessionLogout } from '../../../shared/auth/auth';
import { deleteLocalMessage } from '../../services/database/database';
import { validateReplyTarget } from '../../services/chat/message-reply';
import type { IpcMainInvokeEvent, NativeImage, Tray } from 'electron';
import { handleChatIpc } from '../../services/ipc/chat-ipc';
import { requestAddFriend } from '../../../shared/contacts/add-friend';
import type { FriendApplicationSubmission } from '../../../shared/contacts/friend-application';
import type { Friend, FriendDetail } from '../../../shared/contacts/friend';
import { createMessageDragController } from '../../services/chat/message-drag';
import { createMessageCopyController } from '../../services/chat/message-copy';
import { createContextMenuController } from '../context-menu/context-menu-window';
import type { ContextMenuOwner } from '../context-menu/context-menu-window';
import { resolveHistoryMenuOwner } from '../history/history-window';
import { resolveConversationMenuOwner } from '../conversation/conversation-window';
import { parseImageContent } from '../../../shared/media/image/image';
import { parseVideoContent } from '../../../shared/media/video/video';
import { parseFileContent } from '../../../shared/media/file/file-message';
import type { MessageDragRequest } from '../../../shared/chat/messages/message-drag';
import {
  canConversationRecord,
  closeConversationWindows,
  isConversationCall,
  notifyConversationStatus,
  notifyConversationHistorySync,
  notifyConversationMessage,
  notifyConversationGroupExited,
  notifyConversationRemark,
  registerConversationWindows,
} from '../conversation/conversation-window';
import {
  app,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  ipcMain,
  nativeImage,
  screen,
  session,
  shell,
} from 'electron';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { mkdir, stat } from 'node:fs/promises';
import { readResourceChatIdentity } from '../../../shared/chat/messages/resource-chat-identity';
import { parseRoomHistorySyncNotification } from '../../../shared/chat/messages/room-history-sync';
import { cleanupConversationFiles } from '../../services/chat/conversation-files';
import { createStartupController } from '../../services/runtime/startup';
import { getApplicationIcon as defaultWindowIcon } from '../../services/runtime/application-icon';
import { createApplicationTray } from '../../services/runtime/application-tray';
import { createTrayPreview } from '../tray-preview/tray-preview-window';
import { initializeElectronDeviceIdentity } from '../../services/auth/device-identity';
import type {
  Contact,
  Message,
  StoredFile,
} from '../../../shared/storage/database';
import {
  activateProfile,
  acknowledgeConversationFileCleanup,
  addStoredFiles,
  backupCurrentDatabase,
  clearConversation,
  closeDatabase,
  getContact,
  getFileMessage,
  getImagePreviewMessage,
  getVideoMessage,
  getLocalSettings,
  getRemoteConversation,
  getStoredLogLevel,
  getStorageOwner,
  getVideoUploadMessage,
  getVideoUploadSource,
  initializeDatabase,
  isClearedMessage,
  isConversationFileReferenced,
  listConversationFileCleanup,
  listCachedEmojis,
  listContacts,
  markVideoUploadCancelled,
  observeSavedMessages,
  requireRemoteConversation,
  saveRemoteMessages,
  saveContact,
  saveDebugMode,
  saveStoredLogLevel,
  setGroupRemoved,
} from '../../services/database/database';
import { registerDatabaseIpc } from '../../services/database/database-ipc';
import {
  cancelPendingLogin,
  clearAuthenticatedSession,
  consumeLoginSession,
  enrichSessionProfile,
  forgetSelectedSession,
  getActiveSession,
  getLoginState,
  getRetainedSession,
  getSessionAccess,
  getValidatedLoginState,
  loginWithBackend,
  registerWithBackend,
  requireAuthenticatedSession,
  requireLocalUser,
  restoreSavedSession,
  selectLoginAccount,
  setAuthenticatedSession,
  suspendAuthenticatedSession,
  validateRetainedSession,
} from '../../services/auth/auth';
import {
  parseBoolean,
  parseInteger,
  parseText,
} from '../../services/database/database-validation';
import type {
  AuthSession,
  SessionInvalidationReason,
} from '../../../shared/auth/auth';
import {
  IdTypeEnum,
  SessionExpiredError,
  withoutClientSqlPassword,
} from '../../../shared/auth/auth';
import { chooseRegistrationAvatar } from '../login/registration-avatar';
import { createAvatarCropController } from '../avatar-crop/avatar-crop-window';
import { createFriendFormController } from '../contacts/application/friend-application-window';
import { createFriendProfileController } from '../contacts/profile/friend-profile-window';
import { createFriendRemarkController } from '../contacts/remark/friend-remark-window';
import { requestFriendRemark } from '../../../shared/contacts/friend-remark';
import type { FriendRemarkSettings } from '../../../shared/contacts/friend-remark';
import {
  parseFriendProfileAnchor,
  requestFriendProfile,
} from '../../../shared/contacts/friend-profile';
import { parseFriendSettingsDraft } from '../../../shared/contacts/friend-application';
import type {
  FriendVerificationContext,
  FriendSettingsDraft,
} from '../../../shared/contacts/friend-application';
import { parseAddFriendResult } from '../../../shared/contacts/add-friend';
import {
  closeAddFriendWindow,
  openFriendApplicationWindow,
  registerAddFriendIpc,
  resolveAddFriendMenuOwner,
} from '../contacts/add-friend/add-friend-window';
import { applicationDirectory } from '../../services/runtime/runtime-paths';
import {
  closeConversationHistory,
  closeHistoryWindows,
  registerHistoryIpc,
  validateHistoryImageSender,
} from '../history/history-window';
import {
  closeSettingsWindow,
  registerSettingsIpc,
} from '../settings/settings-window';
import { getLogLevel, setLogLevel } from '../../services/logging/logger';
import {
  closeUpdateWindow,
  openUpdateWindow,
  registerUpdateIpc,
} from '../update/update-window';
import type { SettingsAccount } from '../../../shared/windows/settings-window';
import {
  closeImagePreviews,
  registerImagePreviewIpc,
  openTemporaryImagePreview,
} from '../image-preview/image-preview-window';
import {
  closeResourceSse,
  startResourceSse,
  stopResourceSse,
} from '../../services/network/resource-sse';
import {
  createChatHistory,
  fetchContactProfile,
  listUserEmojis,
  deleteUserEmoji,
  moveUserEmojiToFront,
  addUserImageEmoji,
  isUserImageEmojiCollected,
  sendChatMessage,
} from '../../services/chat/chat';
import { flushConversationDeletions } from '../../services/chat/conversation-sync';
import {
  finishConversationReads,
  flushConversationReads,
  stageConversationRead,
  startConversationReads,
  stopConversationReads,
} from '../../services/chat/conversation-reads';
import {
  fetchFriendDetail,
  listUserFriends,
} from './directory/friends/friend-service';
import {
  listUserGroups,
  listUserGroupMembers,
} from './directory/groups/group-service';
import { hydrateFriendApplicationPage } from './directory/applications/application-service';
import {
  setUserConversationTop,
  setUserConversationNotDisturb,
  hideUserConversation,
  refreshConversationInfo,
  removeUserConversation,
  syncRemoteContacts,
} from './conversations/conversation-service';
import { parseSendMessageRequest } from '../../../shared/chat/chat';
import {
  addRemoteGroupMembers,
  createRemoteGroup,
  exitRemoteGroup,
  dissolveRemoteGroup,
  parseExitGroupRoomId,
  parseCreateGroupRequest,
  parseAddGroupMembersRequest,
  removeRemoteGroupMembers,
  parseRemoveGroupMembersRequest,
  updateRemoteGroupInfo,
  parseUpdateGroupInfoRequest,
} from '../../../shared/contacts/group';
import type { GroupExitedNotification } from '../../../shared/contacts/group-notification';
import {
  parseRtcCallResponse,
  parseRtcActiveCallsResponse,
  parseRtcGroupActiveResponse,
  parseRtcOngoingCallsResponse,
  parseRtcJoinCredentialResponse,
  parseRtcVideoEnabledResponse,
  type RtcCallPeer,
  type RtcCallView,
  RtcMediaMode,
} from '../../../shared/rtc/rtc';
import {
  parseRtcMediaResponse,
  parseRtcMediaSignal,
} from '../../../shared/rtc/rtc-media';
import {
  parseFriendUid,
  requestRoomBlacklist,
  requestRoomUnblacklist,
  requestFriendDeletion,
} from '../../../shared/contacts/friend';
import {
  parseFriendApplicationPageNo,
  requestFriendUnread,
  requestFriendApplications,
  requestReadFriendApplication,
  requestApproveFriendApplication,
  requestReplyFriendApplication,
} from '../../../shared/contacts/friend-notification';
import { createAuthenticatedApiClient } from '../../services/network/api-client';
import type {
  ConversationReadState,
  ResourceSseStatus,
} from '../../../shared/windows/desktop';
import type { MessageHistorySynchronizer } from '../../services/chat/message-history';
import { sendWindowNotification } from '../../services/ipc/window-notifications';
import { uploadImageBytes } from '../../services/media/image/image-upload';
import { uploadVoice, readVoice } from '../../services/media/voice/voice';
import { getHistoryMessage } from '../../services/database/database';
import { createImageDraftStore } from '../../services/media/image/image-drafts';
import { createScreenshotController } from '../screenshot/screenshot-window';
import { getClientId } from '../../services/auth/client-identity';
import type {
  LocalImageData,
  StoredImageContent,
} from '../../../shared/media/image/image';
import type {
  ImageFileAccess,
  ImageFileStore,
} from '../../services/media/image/image-files';
import { createImageFileStore } from '../../services/media/image/image-files';
import { parseImagePreviewRequest } from '../image-preview/image-preview-data';
import { stageDroppedMedia } from '../../services/media/media-drafts';
import type { MediaDraftSelection } from '../../../shared/media/media-drafts';
import type { VideoFileStore } from '../../services/media/video/video-files';
import { createVideoFileStore } from '../../services/media/video/video-files';
import type { VideoDraftStore } from '../../services/media/video/video-drafts';
import { createVideoDraftStore } from '../../services/media/video/video-drafts';
import type { FileDraftStore } from '../../services/media/file/file-drafts';
import { createFileDraftStore } from '../../services/media/file/file-drafts';
import { createAttachmentFileStore } from '../../services/media/file/attachment-files';
import { createVideoProcessor } from '../../services/media/video/video-processor';
import { VIDEO_EXTENSIONS } from '../../../shared/media/video/video-formats';
import {
  closeVideoWindows,
  registerVideoWindow,
} from '../video-player/video-window';
import {
  closeRtcCallWindows,
  canRtcCallWindowRecord,
  canRtcCallWindowSelectSpeaker,
  isRtcCallWindow,
  notifyRtcCallWindow,
  reconcileRtcCallWindows,
  registerRtcCallWindow,
  validateRtcCallWindowCall,
  validateRtcCallWindowSender,
} from '../rtc/rtc-call-window';
import { notifyHistoryRecall } from '../history/history-window';
import { createUpdateService } from '../update/update-service';
import { toUpdateReleaseInfo } from '../../../shared/update/update';
import type { ImagePreviewRequest } from '../../../shared/windows/image-preview';
import {
  requestCancelTemporary,
  requestCompleteTemporary,
  requestCreateTemporary,
} from '../../../shared/chat/messages/temporary-message';
import {
  validateTemporaryVideo,
  validateVideo,
} from '../../../shared/media/video/video';
import type { VideoDraftProcessingProgress } from '../../../shared/media/video/video';
import { parseMessageDownloadResponse } from '../../../shared/chat/messages/message-download';
import type {
  AuthorizeMessageDownload,
  MessageDownloadAuthorization,
} from '../../../shared/chat/messages/message-download';

let mainWindow: BrowserWindow | undefined;
let applicationTray: Tray | undefined;
let trayPreview: ReturnType<typeof createTrayPreview> | undefined;
let mainWindowMode: 'login' | 'chat' = 'login';
interface WorkspaceHandoff {
  login: BrowserWindow;
  workspace: BrowserWindow;
  session: AuthSession;
  nativeReady: boolean;
  rendererReady: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
}
let workspaceHandoff: WorkspaceHandoff | undefined;
let loginNotice = '';
let workspaceStarted = false;
let quitting = false;
let gracefulQuitStarted = false;
let allowMainWindowClose = false;
let debugMode = false;
let documentGeneration = 0;
let nativeOperation = false;
let imageUploadInProgress = false;
let voiceUploading = false;
let voiceAbort = new AbortController();
let imageFiles: ImageFileStore | undefined;
let messageDrag: ReturnType<typeof createMessageDragController> | undefined;
let messageCopy: ReturnType<typeof createMessageCopyController> | undefined;
let videoFiles: VideoFileStore | undefined;
let videoDrafts: VideoDraftStore | undefined;
let fileDrafts: FileDraftStore | undefined;
let attachmentFiles: ReturnType<typeof createAttachmentFileStore> | undefined;
let screenshots: ReturnType<typeof createScreenshotController> | undefined;
let contextMenus: ReturnType<typeof createContextMenuController> | undefined;
let avatarCrop: ReturnType<typeof createAvatarCropController> | undefined;
let friendProfile: ReturnType<typeof createFriendProfileController> | undefined;
let friendRemark: ReturnType<typeof createFriendRemarkController> | undefined;
let friendVerification:
  | ReturnType<
      typeof createFriendFormController<
        FriendVerificationContext,
        FriendSettingsDraft
      >
    >
  | undefined;
const videoProcessor = createVideoProcessor();
const imageDrafts = createImageDraftStore(
  (bytes: Buffer, contentType: string): void => {
    if (
      (contentType === 'image/png' || contentType === 'image/jpeg') &&
      nativeImage.createFromBuffer(bytes).isEmpty()
    )
      throw new Error('图片无法解码');
  },
  (roomId: string, id: string): void => closeImagePreviews(roomId, id),
);
let resetAfterOperation = false;
let storageDirectory = applicationDirectory;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let resourceSseStatus: ResourceSseStatus = 'stopped';
let deletionRetryTimer: ReturnType<typeof setTimeout> | undefined;
let messageHistory: MessageHistorySynchronizer | undefined;
let updateService: ReturnType<typeof createUpdateService> | undefined;
const conversationInfoRequests = new Map<string, symbol>();
let emojiListRequest = 0;
const maxTaskbarIconBytes = 4 * 1024 * 1024;
let taskbarIconRequest = 0;

let markStartup: (stage: string) => void = (): void => {};

/** 只删除当前账号应用缓存目录内的普通文件，不跟随链接或接受外部路径。 */
const removeConversationFiles = async (
  localPaths: string[],
  owner: string,
): Promise<void> => {
  const session = requireAuthenticatedSession();
  const generation = documentGeneration;
  /** 文件 IO 返回后重新核对授权，不能消费新账号的清理记录。 */
  const validate = (): void => {
    if (
      requireAuthenticatedSession() !== session ||
      generation !== documentGeneration
    )
      throw new Error('页面或账号已切换');
  };
  await cleanupConversationFiles(storageDirectory, owner, localPaths, {
    validate,
    referenced: isConversationFileReferenced,
    acknowledge: acknowledgeConversationFileCleanup,
  });
};

/** 重连先消费本地删除操作，失败留库并限速重试，退出与重载使旧任务失效。 */
const retryConversationDeletions = async (): Promise<void> => {
  clearTimeout(deletionRetryTimer);
  if (resourceSseStatus !== 'connected') return;
  const session = getActiveSession();
  if (!session) return;
  const generation = documentGeneration;
  /** 同一 uid 重新授权仍视为新上下文。 */
  const validate = (): void => {
    if (getActiveSession() !== session || documentGeneration !== generation)
      throw new Error('页面或账号已切换');
    requireAuthenticatedSession();
  };
  try {
    await flushConversationDeletions(validate);
    validate();
    await removeConversationFiles(
      listConversationFileCleanup(),
      session.user.id,
    );
  } catch (cause) {
    if (getActiveSession() !== session || documentGeneration !== generation)
      return;
    if (cause instanceof SessionExpiredError) {
      expireAuthentication(session, cause);
      return;
    }
    console.warn('聊天记录删除尚未同步，保留本地操作等待重试。');
  }
  if (
    getActiveSession() === session &&
    documentGeneration === generation &&
    resourceSseStatus === 'connected'
  ) {
    deletionRetryTimer = setTimeout((): void => {
      void retryConversationDeletions();
    }, 30000);
  }
};

/** 由主进程携带当前 JWT 申请消息资源签名，签名地址不暴露给渲染层。 */
const authorizeMessageDownload: AuthorizeMessageDownload = async (
  messageId: string,
  roomId: string,
  validate: () => void,
): Promise<MessageDownloadAuthorization> => {
  validate();
  const api = createAuthenticatedApiClient(validate);
  const authorization = await api.request({
    path: '/capi/chat/msg/download/url',
    method: 'POST',
    body: { msgId: messageId, roomId },
    serviceName: '资源下载授权',
    timeoutMs: 10000,
    parse: (value: unknown): MessageDownloadAuthorization =>
      parseMessageDownloadResponse(value, messageId),
  });
  validate();
  return authorization;
};

/** 更新并广播资源 SSE 状态，页面重载后仍可通过 IPC 主动读取。 */
const setResourceSseStatus = (status: ResourceSseStatus): void => {
  const reconnected =
    status === 'connected' && resourceSseStatus !== 'connected';
  if (reconnected) messageHistory?.invalidate();
  resourceSseStatus = status;
  if (status !== 'connected') clearTimeout(deletionRetryTimer);
  if (reconnected) void retryConversationDeletions();
  if (reconnected) void flushConversationReads();
  if (reconnected) void reconcileRtcCallWindows();
  sendWindowNotification(mainWindow, 'resource:sse-status', status);
  notifyConversationStatus(status);
};

/** 预热原生拖拽图像，图片等比缩略，其余附件使用系统文件类型图标。 */
const loadMessageDragIcon = async (
  request: MessageDragRequest,
  filePath: string,
): Promise<NativeImage> => {
  if (request.kind === 'image') {
    try {
      const thumbnail = await nativeImage.createThumbnailFromPath(filePath, {
        width: 128,
        height: 128,
      });
      if (!thumbnail.isEmpty()) {
        const { width, height } = thumbnail.getSize();
        return thumbnail.resize(
          width >= height
            ? { width: Math.min(width, 128) }
            : { height: Math.min(height, 128) },
        );
      }
    } catch {}
  }
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    if (!icon.isEmpty()) return icon;
  } catch {}
  return defaultWindowIcon().resize({ width: 32, height: 32 });
};

/** 加载公开头像作为原生窗口图标，失败时使用应用图标。 */
const loadWindowIcon = async (avatarUrl?: string): Promise<NativeImage> => {
  let icon = nativeImage.createEmpty();
  if (avatarUrl) {
    try {
      const response = await fetch(avatarUrl, {
        signal: AbortSignal.timeout(10000),
      });
      const contentLength = Number(response.headers.get('content-length'));
      if (
        response.ok &&
        (!Number.isFinite(contentLength) ||
          contentLength <= maxTaskbarIconBytes)
      ) {
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.byteLength <= maxTaskbarIconBytes)
          icon = nativeImage.createFromBuffer(buffer);
      }
    } catch {
      // 头像网络异常时回退到应用图标。
    }
  }

  return icon.isEmpty() ? defaultWindowIcon() : icon;
};

/** 将当前登录用户头像设置为主窗口任务栏图标，头像加载失败时使用应用图标。 */
const updateTaskbarIcon = async (avatarUrl?: string): Promise<void> => {
  const window = mainWindow;
  if (!window || window.isDestroyed()) return;
  const request = ++taskbarIconRequest;
  const icon = await loadWindowIcon(avatarUrl);
  if (
    request === taskbarIconRequest &&
    !window.isDestroyed() &&
    !icon.isEmpty()
  )
    window.setIcon(icon);
};

/** 清空授权与子窗口，原生异步操作结束后再关闭其正在使用的数据库连接。 */
const resetAuthentication = (retainSession: boolean = false): void => {
  contextMenus?.clear();
  trayPreview?.reset();
  stopConversationReads();
  workspaceStarted = false;
  closeConversationWindows();
  friendProfile?.close();
  friendRemark?.close();
  friendVerification?.close();
  closeAddFriendWindow();
  voiceAbort.abort();
  voiceAbort = new AbortController();
  screenshots?.cancel();
  avatarCrop?.cancel();
  videoFiles?.cancel();
  videoDrafts?.clear();
  attachmentFiles?.cancel();
  fileDrafts?.clear();
  closeVideoWindows();
  closeRtcCallWindows();
  imageFiles?.cancel();
  messageDrag?.clear();
  messageCopy?.clear();
  closeImagePreviews();
  imageDrafts.clear();
  conversationInfoRequests.clear();
  messageHistory = undefined;
  clearTimeout(expiryTimer);
  stopResourceSse('authentication-reset');
  setResourceSseStatus('stopped');
  if (retainSession) suspendAuthenticatedSession();
  else {
    clearAuthenticatedSession();
    void updateTaskbarIcon();
  }
  closeHistoryWindows();
  closeSettingsWindow();
  closeUpdateWindow();
  if (nativeOperation) resetAfterOperation = true;
  else activateProfile(null);
  const retained = getRetainedSession();
  if (retained) scheduleExpiry(retained);
};

/** 主动退出或授权失效时，同时清除运行状态和数据库中的登录会话。 */
const invalidateAuthentication = (): void => {
  documentGeneration++;
  try {
    forgetSelectedSession();
  } finally {
    resetAuthentication();
  }
};

/** 令牌失效后关闭数据访问与子窗口，通知主页面重新登录。 */
const expireAuthentication = (
  session: AuthSession,
  reason?: SessionInvalidationReason | SessionExpiredError,
): void => {
  if (getActiveSession() !== session) return;
  emojiListRequest++;
  try {
    invalidateAuthentication();
  } catch {
    console.error(
      'Failed to remove the expired saved session; data access is disabled.',
    );
  } finally {
    const invalidationReason =
      reason instanceof SessionExpiredError ? undefined : reason;
    let message =
      invalidationReason === 'SESSION_REPLACED'
        ? '账号已在其他客户端登录，请重新登录'
        : '登录状态已失效，请重新登录';
    if (reason instanceof SessionExpiredError) message = reason.message;
    returnToLogin(message);
    sendWindowNotification(mainWindow, 'auth:expired', {
      userId: session.user.id,
      reason: invalidationReason,
    });
  }
};

/** 定时撤销过期令牌，长有效期分段等待避免定时器溢出。 */
const scheduleExpiry = (session: AuthSession): void => {
  clearTimeout(expiryTimer);
  if (session.expiresAt === null) return;
  const remaining = session.expiresAt * 1000 - Date.now();
  if (remaining <= 0) {
    if (getActiveSession() === session) expireAuthentication(session);
    else if (getRetainedSession() === null)
      sendWindowNotification(mainWindow, 'auth:expired', session.user.id);
    return;
  }
  expiryTimer = setTimeout(
    () => {
      scheduleExpiry(session);
    },
    Math.min(remaining, 2_147_000_000),
  );
};

/** 恢复可信会话的数据访问，并在数据库打开失败时清理授权。 */
const activateSession = (session: AuthSession): AuthSession => {
  resetAuthentication();
  setAuthenticatedSession(session);
  void updateTaskbarIcon(session.user.avatar);
  try {
    if (!session.clientSqlPassword?.trim())
      throw new Error('登录响应缺少本地数据库密钥');
    activateProfile({
      id: session.user.id,
      nickname: session.user.nickname,
      databasePassword: session.clientSqlPassword,
    });
  } catch (error) {
    resetAuthentication(true);
    throw error;
  }
  scheduleExpiry(session);
  requireAuthenticatedSession();
  messageHistory = createChatHistory();
  startConversationReads(
    session,
    notifyConversationUnread,
    expireAuthentication,
  );
  return session;
};

/** 登录进入工作台后检查新版本，丢弃页面或账号变化后的迟到结果。 */
const checkWorkspaceUpdate = async (session: AuthSession): Promise<void> => {
  const service = updateService;
  const workspace = mainWindow;
  const generation = documentGeneration;
  if (!service || !workspace || workspace.isDestroyed()) return;
  try {
    const release = await service.check();
    if (
      !release ||
      quitting ||
      allowMainWindowClose ||
      !workspaceStarted ||
      mainWindow !== workspace ||
      workspace.isDestroyed() ||
      documentGeneration !== generation ||
      getActiveSession() !== session
    )
      return;
    await openUpdateWindow(toUpdateReleaseInfo(release));
  } catch (error) {
    console.warn('登录后检查更新失败', error);
  }
};

/** 原生窗口和聊天页面均完成首帧后先显示工作台，再释放登录窗口。 */
const finishWorkspaceHandoff = (): void => {
  const handoff = workspaceHandoff;
  if (
    !handoff ||
    !handoff.nativeReady ||
    !handoff.rendererReady ||
    mainWindow !== handoff.workspace ||
    handoff.workspace.isDestroyed() ||
    quitting ||
    allowMainWindowClose
  )
    return;
  const session = requireAuthenticatedSession();
  if (session !== handoff.session) throw new Error('登录状态已变化，请重试');
  if (workspaceStarted) return;
  handoff.workspace.show();
  handoff.workspace.focus();
  screenshots?.warmup();
  startResourceSse(
    session,
    (message) => {
      if (getActiveSession() !== session) return;
      const historySync = parseRoomHistorySyncNotification(message.data);
      if (historySync) {
        messageHistory?.invalidate(historySync.roomId);
        notifyConversationHistorySync(historySync.roomId, message);
      }
      const identity = readResourceChatIdentity(message.data);
      if (identity && isClearedMessage(identity.roomId, identity.messageId))
        return;
      sendWindowNotification(mainWindow, 'resource:sse-message', message);
      notifyRtcCallWindow(message);
    },
    setResourceSseStatus,
    (reason) => {
      expireAuthentication(session, reason);
    },
  );
  workspaceStarted = true;
  trayPreview?.refresh();
  workspaceHandoff = undefined;
  handoff.resolve();
  if (!handoff.login.isDestroyed()) handoff.login.destroy();
  void checkWorkspaceUpdate(session);
  setTimeout((): void => {
    if (!quitting && workspaceStarted && getActiveSession() === session)
      trayPreview?.warmup();
  }, 0);
};

/** 页面完成会话初始化、订阅和首帧绘制后参与交接，重复握手不重建连接。 */
const startWorkspace = (event: IpcMainInvokeEvent): void => {
  validateWorkspaceSender(event);
  requireAuthenticatedSession();
  if (!workspaceHandoff) return;
  workspaceHandoff.rendererReady = true;
  finishWorkspaceHandoff();
};

/** 接收已经通过真实密码登录及 globalUid 校验的身份。 */
const authorizeSession = async (
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<AuthSession> => {
  validateLoginSender(event);
  validateDatabaseSender(event);
  const generation = documentGeneration;
  const session = consumeLoginSession(parseText(value, 16384));
  /** 资料补全和加密回写前复核原登录页面，禁止登出后的迟到令牌回填。 */
  const validateCurrent = (): void => {
    validateLoginSender(event);
    if (generation !== documentGeneration)
      throw new Error('页面已变化，请重试');
  };
  const enriched = await enrichSessionProfile(session, validateCurrent);
  validateDatabaseSender(event);
  if (generation !== documentGeneration) throw new Error('页面已重载，请重试');
  return withoutClientSqlPassword(activateSession(enriched));
};

/** 快捷进入前必须再次通过 globalUid 校验，等待期间不开放数据库。 */
const resumeSession = async (
  event: IpcMainInvokeEvent,
): Promise<AuthSession> => {
  validateLoginSender(event);
  validateDatabaseSender(event);
  const generation = documentGeneration;
  resetAuthentication(true);
  const result = await validateRetainedSession();
  validateDatabaseSender(event);
  if (generation !== documentGeneration) throw new Error('页面已重载，请重试');
  if (result.status !== 'valid') throw new Error(result.message);
  const session = getRetainedSession();
  if (!session) {
    invalidateAuthentication();
    throw new Error('登录状态已失效，请重新登录');
  }
  /** 快捷进入等待期间的退出或重载同样撤销资料持久化资格。 */
  const validateCurrent = (): void => {
    validateLoginSender(event);
    if (generation !== documentGeneration)
      throw new Error('页面已变化，请重试');
  };
  const enriched = await enrichSessionProfile(session, validateCurrent);
  validateDatabaseSender(event);
  if (generation !== documentGeneration) throw new Error('页面已重载，请重试');
  return withoutClientSqlPassword(activateSession(enriched));
};

/** 两个退出入口共用远端撤销与本地清理，迟到结果不能作用于新页面或账号。 */
const logoutCurrentSession = async (): Promise<void> => {
  const session = getActiveSession() ?? getRetainedSession();
  const generation = documentGeneration;
  await finishConversationReads();
  if (
    (getActiveSession() ?? getRetainedSession()) !== session ||
    generation !== documentGeneration
  )
    return;
  // 主动退出不再重连，也不将本次撤销的 SSE 通知当作异常踢下线。
  stopResourceSse('logout');
  setResourceSseStatus('stopped');
  const notice = session
    ? await requestSessionLogout(
        import.meta.env.VITE_AUTH_API_BASE?.trim(),
        session,
      )
    : '';
  if (
    (getActiveSession() ?? getRetainedSession()) !== session ||
    generation !== documentGeneration
  )
    return;
  try {
    invalidateAuthentication();
  } finally {
    returnToLogin(notice);
  }
};

/** 原生操作尚未结束时也允许退出，数据库关闭仍由现有清理流程延后。 */
const endSession = async (event: IpcMainInvokeEvent): Promise<void> => {
  validateSender(event);
  await logoutCurrentSession();
};

/** 结束异步原生操作；若期间页面重载，则清除旧的数据空间选择。 */
const finishNativeOperation = (): void => {
  nativeOperation = false;
  if (resetAfterOperation) {
    resetAfterOperation = false;
    activateProfile(null);
  }
};

/** 获取唯一受信任的渲染页面地址，用于 IPC 来源验证。 */
const getRendererUrl = (): string => {
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL) {
    return new URL(process.env.VITE_DEV_SERVER_URL).href;
  }
  return pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
};

/** 登录和工作台共用资源入口，但原生主框架必须匹配自己的页面角色。 */
const getPrimaryRendererUrl = (): string => {
  const url = new URL(getRendererUrl());
  if (mainWindowMode === 'chat') url.hash = 'workspace';
  return url.href;
};

/** 验证主窗口、主框架和页面 URL，阻止其他来源调用数据库。 */
const validateSender = (event: IpcMainInvokeEvent): void => {
  if (isConversationCall(event)) return;
  if (
    quitting ||
    allowMainWindowClose ||
    !mainWindow ||
    mainWindow.isDestroyed() ||
    mainWindow.webContents.isDestroyed() ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame ||
    event.senderFrame.url !== getPrimaryRendererUrl()
  ) {
    throw new Error('无效的窗口调用');
  }
};

/** 登录操作不能由工作台或独立会话窗口调用。 */
const validateLoginSender = (event: IpcMainInvokeEvent): void => {
  validateSender(event);
  if (mainWindowMode !== 'login' || event.sender !== mainWindow?.webContents)
    throw new Error('只允许登录窗口调用');
};

/** 工作台握手不能由登录窗口或子窗口触发。 */
const validateWorkspaceSender = (event: IpcMainInvokeEvent): void => {
  validateSender(event);
  if (mainWindowMode !== 'chat' || event.sender !== mainWindow?.webContents)
    throw new Error('只允许主聊天窗口调用');
};

/** 创建独立页面窗口；交接期间保留登录页可见，但不再接受它的业务调用。 */
const createWindow = async (
  existingWindow?: BrowserWindow,
  mode: 'login' | 'chat' = 'login',
): Promise<void> => {
  const previous = mainWindow;
  const chat = mode === 'chat';
  const session = chat ? requireAuthenticatedSession() : undefined;
  const workArea =
    previous && !previous.isDestroyed()
      ? screen.getDisplayMatching(previous.getBounds()).workArea
      : screen.getPrimaryDisplay().workArea;
  const width = chat ? Math.min(880, workArea.width) : 282;
  const height = chat ? Math.min(768, workArea.height) : 380;
  allowMainWindowClose = false;
  const window =
    existingWindow ??
    new BrowserWindow({
      width,
      height,
      minWidth: chat ? Math.min(420, workArea.width) : 282,
      minHeight: chat ? Math.min(520, workArea.height) : 380,
      x: workArea.x + Math.round((workArea.width - width) / 2),
      y: workArea.y + Math.round((workArea.height - height) / 2),
      useContentSize: true,
      resizable: chat,
      maximizable: chat,
      fullscreenable: false,
      frame: false,
      // 与启动窗口保持一致，保留系统边缘命中和四角缩放。
      transparent: false,
      backgroundColor: chat ? '#c4c4c8' : '#f9f9f9',
      show: false,
      title: 'OpenChat',
      icon: defaultWindowIcon(),
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
  mainWindow = window;
  mainWindowMode = mode;
  let handoffReady: Promise<void> | undefined;
  if (session && previous && previous !== window) {
    handoffReady = new Promise<void>((resolve, reject) => {
      workspaceHandoff = {
        login: previous,
        workspace: window,
        session,
        nativeReady: false,
        rendererReady: false,
        resolve,
        reject,
      };
    });
    window.once('ready-to-show', () => {
      if (workspaceHandoff?.workspace !== window) return;
      workspaceHandoff.nativeReady = true;
      try {
        finishWorkspaceHandoff();
      } catch {
        resetAuthentication(true);
        returnToLogin('无法显示聊天窗口，请重试');
      }
    });
  }
  if (previous && previous !== window) documentGeneration++;
  let initialNavigation = !existingWindow;
  const readyTimeout = setTimeout((): void => {
    if (mainWindow !== window || window.isDestroyed() || window.isVisible())
      return;
    if (chat) {
      resetAuthentication(true);
      returnToLogin('聊天窗口加载超时，请重试');
    } else {
      handleStartupError(new Error('登录窗口加载超时'));
    }
  }, 30000);
  window.once('show', () => clearTimeout(readyTimeout));
  window.webContents.on('preload-error', () => {
    if (mainWindow !== window) return;
    if (chat) {
      resetAuthentication(true);
      returnToLogin('聊天窗口加载失败，请重试');
    } else handleStartupError(new Error('登录窗口预加载失败'));
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key !== 'F12') return;
    event.preventDefault();
    if (
      !debugMode ||
      input.type !== 'keyDown' ||
      input.isAutoRepeat ||
      input.control ||
      input.alt ||
      input.meta ||
      input.shift
    )
      return;
    window.webContents.openDevTools({ mode: 'detach' });
  });
  window.webContents.on('devtools-opened', () => {
    if (!debugMode) window.webContents.closeDevTools();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  window.webContents.on(
    'did-start-navigation',
    (_event, _url, isInPlace, isMainFrame) => {
      if (workspaceHandoff?.login === window && isMainFrame && !isInPlace) {
        resetAuthentication(true);
        returnToLogin('登录页面已重载，请重新进入');
        return;
      }
      if (mainWindow !== window) return;
      if (isMainFrame && !isInPlace) {
        if (initialNavigation) {
          initialNavigation = false;
          return;
        }
        documentGeneration++;
        try {
          resetAuthentication(true);
          if (chat) returnToLogin();
        } catch (error) {
          handleStartupError(error);
        }
      }
    },
  );
  window.on('closed', () => {
    clearTimeout(readyTimeout);
    if (
      workspaceHandoff?.login === window ||
      workspaceHandoff?.workspace === window
    ) {
      resetAuthentication(true);
      returnToLogin('窗口已关闭，请重新进入');
      return;
    }
    if (mainWindow !== window) return;
    mainWindow = undefined;
    contextMenus?.destroy();
    documentGeneration++;
    resetAuthentication(true);
    if (startup.phase() !== 'ready') app.quit();
  });
  window.on('close', (event) => {
    if (
      workspaceHandoff &&
      (workspaceHandoff.login === window ||
        workspaceHandoff.workspace === window) &&
      !quitting
    ) {
      event.preventDefault();
      return;
    }
    if (mainWindow !== window) return;
    if (nativeOperation && !quitting) event.preventDefault();
    else if (
      chat &&
      workspaceStarted &&
      applicationTray &&
      !applicationTray.isDestroyed() &&
      !allowMainWindowClose &&
      !quitting
    ) {
      event.preventDefault();
      window.hide();
    } else if (!allowMainWindowClose && !quitting) {
      event.preventDefault();
      allowMainWindowClose = true;
      void finishConversationReads()
        .then(() => closeResourceSse('main-window-close'))
        .finally(() => {
          if (!window.isDestroyed()) window.close();
        });
    } else {
      friendProfile?.close();
      closeHistoryWindows();
      closeSettingsWindow();
      closeUpdateWindow();
      closeAddFriendWindow();
      closeImagePreviews();
      closeVideoWindows();
      videoFiles?.cancel();
      videoDrafts?.clear();
      attachmentFiles?.cancel();
      messageDrag?.clear();
      messageCopy?.clear();
      fileDrafts?.clear();
    }
  });
  window.webContents.on('render-process-gone', () => {
    if (workspaceHandoff?.login === window) {
      window.destroy();
      return;
    }
    if (mainWindow !== window) return;
    resetAuthentication(true);
    if (chat) returnToLogin('聊天页面已退出，请重新进入');
  });
  if (
    previous &&
    previous !== window &&
    !previous.isDestroyed() &&
    workspaceHandoff?.login !== previous
  )
    previous.destroy();
  if (existingWindow) {
    clearTimeout(readyTimeout);
    return;
  }
  void updateTaskbarIcon(
    (getActiveSession() ?? getRetainedSession())?.user.avatar,
  );
  const loading = window
    .loadURL(getPrimaryRendererUrl())
    .catch((error: unknown) => {
      if (mainWindow !== window || window.isDestroyed() || quitting) return;
      if (!chat) throw error;
      resetAuthentication(true);
      returnToLogin('聊天窗口加载失败，请重试');
    });
  // 聊天交接独立于 loadURL 结束，加载挂起时也能立即响应超时或强制登出。
  await (handoffReady ?? loading);
};

/** 交接失败复用仍可见的登录页；已完成交接时重新创建登录窗口。 */
const returnToLogin = (notice: string = ''): void => {
  if (quitting || allowMainWindowClose) return;
  loginNotice = notice;
  const handoff = workspaceHandoff;
  if (handoff) {
    workspaceHandoff = undefined;
    documentGeneration++;
    handoff.reject(new Error(notice || '进入聊天已取消，请重试'));
    if (!handoff.login.isDestroyed()) {
      mainWindow = handoff.login;
      mainWindowMode = 'login';
      if (!handoff.workspace.isDestroyed()) handoff.workspace.destroy();
      mainWindow.show();
      mainWindow.focus();
      return;
    }
    // 登录进程异常退出时先建替代窗口，避免销毁最后一个窗口触发应用退出。
    void createWindow().catch(handleStartupError);
    return;
  }
  if (mainWindowMode === 'login' && mainWindow && !mainWindow.isDestroyed())
    return;
  void createWindow().catch(handleStartupError);
};

/** 只移交当前有效授权，创建期间的失效由主进程统一回收新窗口。 */
const openWorkspace = (event: IpcMainInvokeEvent): Promise<void> => {
  validateLoginSender(event);
  validateDatabaseSender(event);
  const session = requireAuthenticatedSession();
  loginNotice = '';
  return createWindow(undefined, 'chat').catch((error: unknown): never => {
    if (getActiveSession() === session) {
      resetAuthentication(true);
      returnToLogin('无法创建聊天窗口，请重试');
    }
    throw error;
  });
};

/** 校验参数后执行最小化、最大化或置顶，不向页面暴露窗口实例。 */
const controlWindow = (event: IpcMainInvokeEvent, action: unknown): boolean => {
  validateSender(event);
  const window = mainWindow!;
  if (action === 'minimize') window.minimize();
  else if (action === 'maximize') {
    if (window.isMaximized()) window.unmaximize();
    else if (window.isMaximizable()) window.maximize();
    return window.isMaximized();
  } else if (action === 'pin') {
    window.setAlwaysOnTop(!window.isAlwaysOnTop());
    return window.isAlwaysOnTop();
  } else throw new Error('无效的窗口操作');
  return false;
};

/** 验证来源后关闭窗口；原生备份期间禁止强制关闭数据库。 */
const closeWindow = (event: IpcMainInvokeEvent): void => {
  validateSender(event);
  if (!nativeOperation) mainWindow?.close();
};

/** 校验主页面来源与布尔参数，保存成功后立即应用调试开关。 */
const setDebugMode = (event: IpcMainInvokeEvent, value: unknown): void => {
  validateSender(event);
  const enabled = parseBoolean(value);
  saveDebugMode(enabled);
  debugMode = enabled;
  if (!enabled) mainWindow!.webContents.closeDevTools();
};

/** 读取用户通过原生对话框授权选择的文件元数据。 */
const readFileInfo = async (
  filePath: string,
): Promise<{ name: string; size: number; path: string }> => {
  const info = await stat(filePath);
  if (!info.isFile() || !Number.isSafeInteger(info.size)) {
    throw new Error('选择的项目不是有效文件');
  }
  return {
    name: path.basename(filePath),
    size: info.size,
    path: path.resolve(filePath),
  };
};

/** 原生选择并事务保存文件，文件路径不允许由页面任意提交。 */
const chooseFiles = async (
  event: IpcMainInvokeEvent,
): Promise<StoredFile[]> => {
  validateSender(event);
  requireAuthenticatedSession();
  if (nativeOperation) throw new Error('请等待当前操作完成');
  nativeOperation = true;
  const owner = getStorageOwner();
  try {
    const result = await dialog.showOpenDialog(mainWindow!, {
      defaultPath: applicationDirectory,
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
    });
    if (result.canceled) return [];
    if (result.filePaths.length > 200)
      throw new Error('单次最多选择 200 个文件');
    const files = await Promise.all(result.filePaths.map(readFileInfo));
    validateSender(event);
    if (
      owner !== getStorageOwner() ||
      documentGeneration !== documentGeneration
    ) {
      throw new Error('登录状态已变化，请重新选择文件');
    }
    return addStoredFiles(files);
  } finally {
    finishNativeOperation();
  }
};

/** 捕获媒体操作的页面、账号和会话；后台任务不占用文件选择锁，仍逐阶段核对授权。 */
const imageDraftContext = (
  event: IpcMainInvokeEvent,
  value: unknown,
  background: boolean = false,
): { roomId: string; session: AuthSession; validateCurrent: () => void } => {
  if (background) validateMediaReadSender(event);
  else validateDatabaseSender(event);
  const roomId = parseText(value, 64);
  const session = requireAuthenticatedSession();
  const generation = documentGeneration;
  const owner = getStorageOwner();
  requireRemoteConversation(roomId);
  /** 每个异步阶段重新检查窗口、页面代次、授权对象和目标会话。 */
  const validateCurrent = (): void => {
    validateSender(event);
    if (
      generation !== documentGeneration ||
      owner !== getStorageOwner() ||
      requireAuthenticatedSession() !== session
    )
      throw new Error('页面或账号已变化，请重新选择图片');
    requireRemoteConversation(roomId);
  };
  return { roomId, session, validateCurrent };
};

/** 多选图片只创建草稿，不在选择结束时上传；路径仅由主进程原生窗口取得。 */
const chooseImages = async (
  event: IpcMainInvokeEvent,
  value: unknown,
): Promise<MediaDraftSelection> => {
  const { roomId, validateCurrent } = imageDraftContext(event, value);
  nativeOperation = true;
  try {
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender) ?? mainWindow!,
      {
        title: '选择图片',
        defaultPath: applicationDirectory,
        filters: [
          {
            name: 'JPG / JPEG / PNG / GIF / BMP',
            extensions: ['jpg', 'jpeg', 'png', 'gif', 'bmp'],
          },
        ],
        properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      },
    );
    validateCurrent();
    if (result.canceled) return { images: [], videos: [], files: [] };
    return await stageDroppedMedia(
      roomId,
      result.filePaths,
      validateCurrent,
      {
        images: imageDrafts,
        videos: videoDrafts!,
        files: fileDrafts!,
      },
      { deferVideoProcessing: true, deferFileProcessing: true },
    );
  } finally {
    finishNativeOperation();
  }
};

/** 仅供隔离 preload 的真实 drop 事件调用，页面桥接不暴露该路径参数接口。 */
const stageDroppedFiles = async (
  event: IpcMainInvokeEvent,
  value: unknown,
  paths: unknown,
): Promise<MediaDraftSelection> => {
  const { roomId, validateCurrent } = imageDraftContext(event, value);
  nativeOperation = true;
  try {
    if (!videoDrafts) throw new Error('视频草稿尚未初始化');
    return await stageDroppedMedia(
      roomId,
      paths,
      validateCurrent,
      {
        images: imageDrafts,
        videos: videoDrafts,
        files: fileDrafts!,
      },
      { deferVideoProcessing: true, deferFileProcessing: true },
    );
  } finally {
    finishNativeOperation();
  }
};

/** 发送时上传随机标识对应的原生文件，不占用 SSE 所需的数据库操作锁。 */
const uploadImageDraft = async (
  event: IpcMainInvokeEvent,
  value: unknown,
  draftId: unknown,
): Promise<StoredImageContent> => {
  const { roomId, session, validateCurrent } = imageDraftContext(event, value);
  const id = parseText(draftId, 64);
  if (imageUploadInProgress) throw new Error('请等待当前图片上传完成');
  imageUploadInProgress = true;
  try {
    return await imageDrafts.upload(
      roomId,
      id,
      validateCurrent,
      async (
        fileName: string,
        bytes: Uint8Array,
      ): Promise<StoredImageContent> => {
        const image = await uploadImageBytes(
          import.meta.env.VITE_AUTH_API_BASE?.trim(),
          session,
          getClientId(),
          fileName,
          bytes,
          validateCurrent,
        );
        if (!imageFiles) throw new Error('图片存储尚未初始化');
        await imageFiles.saveUploaded(image, bytes, validateCurrent);
        return image;
      },
    );
  } finally {
    imageUploadInProgress = false;
  }
};

/** 在线备份到应用目录下，不允许页面或目录选择器将产物写到外部位置。 */
const backupDatabase = async (event: IpcMainInvokeEvent): Promise<boolean> => {
  validateSender(event);
  requireAuthenticatedSession();
  if (nativeOperation) throw new Error('请等待当前操作完成');
  nativeOperation = true;
  const owner = getStorageOwner();
  try {
    const directory = path.join(storageDirectory, 'backups');
    await mkdir(directory, { recursive: true });
    validateSender(event);
    if (
      owner !== getStorageOwner() ||
      documentGeneration !== documentGeneration
    ) {
      throw new Error('登录状态已变化，请重新备份');
    }
    await backupCurrentDatabase(directory);
    return true;
  } finally {
    finishNativeOperation();
  }
};

/** 数据库操作复用来源验证，原生异步操作期间禁止切换或写入数据空间。 */
const validateDatabaseSender = (event: IpcMainInvokeEvent): void => {
  if (isRtcCallWindow(event)) {
    validateRtcCallWindowSender(event);
    return;
  }
  validateSender(event);
  if (nativeOperation) throw new Error('请等待文件选择或备份操作完成');
};

/** 媒体展示独立校验来源及内容库归属，不被原生操作锁阻塞；下载仍由存储层校验写入权。 */
const validateMediaReadSender = (event: IpcMainInvokeEvent): void => {
  validateSender(event);
  if (getStorageOwner() !== requireLocalUser().id)
    throw new Error('本地数据账号不匹配');
};

/** 统一识别远端明确失效；旧页面或旧授权请求不能撤销新授权。 */
const registerRemoteHandler = (
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown,
): void => {
  handleChatIpc(channel, async (event, ...args: unknown[]) => {
    validateDatabaseSender(event);
    const session = getActiveSession();
    try {
      requireAuthenticatedSession();
      return await handler(event, ...args);
    } catch (error) {
      if (
        error instanceof SessionExpiredError &&
        session &&
        documentGeneration === documentGeneration
      )
        expireAuthentication(session, error);
      if (
        channel === 'rtc:accept' &&
        error instanceof ApiResponseError &&
        error.errCode === 46001 &&
        session === getActiveSession() &&
        typeof args[0] === 'string'
      ) {
        console.info(RtcAuditEvent.ACCEPTED_ELSEWHERE, { callId: args[0] });
        closeReplacedRtcCallWindows([args[0]]);
      }
      throw error;
    }
  });
};

/** 未读增量和已读确认按主进程落库顺序通知列表，不使用迟到 IPC 响应覆盖计数。 */
const notifyConversationUnread = (
  roomId: string,
  unreadCount: number,
  newMessage: boolean = false,
): void => {
  trayPreview?.unread(roomId, unreadCount, newMessage);
  sendWindowNotification(mainWindow, 'conversation:read', {
    userId: requireAuthenticatedSession().user.id,
    conversationId: roomId,
    unreadCount,
    notDisturb: getRemoteConversation(roomId)?.notDisturb,
  } satisfies ConversationReadState);
};

/** 注册仅供受信任页面使用的原生与数据库接口。 */
const registerIpcHandlers = (): void => {
  contextMenus = createContextMenuController({
    getRendererUrl,
    getDefaultIcon: defaultWindowIcon,
    resolveOwner: (event): ContextMenuOwner => {
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      let owner =
        resolveConversationMenuOwner(event) ??
        resolveHistoryMenuOwner(event) ??
        resolveAddFriendMenuOwner(event) ??
        friendProfile?.resolveMenuOwner(event);
      if (!owner) {
        validateWorkspaceSender(event);
        const window = mainWindow!;
        owner = {
          window,
          validate: (): void => {
            validateWorkspaceSender(event);
            if (mainWindow !== window) throw new Error('工作台已变化');
          },
        };
      }
      const source = owner;
      return {
        ...source,
        validate: (): void => {
          if (
            requireAuthenticatedSession() !== session ||
            documentGeneration !== generation
          )
            throw new Error('菜单来源页面或账号已变化');
          source.validate();
        },
      };
    },
  });
  contextMenus.warmup();
  observeSavedMessages((message): void => {
    trayPreview?.refresh();
    notifyConversationMessage(message);
    sendWindowNotification(mainWindow, 'conversation:message', message);
  });
  registerConversationWindows({
    validateMain: validateDatabaseSender,
    getMain: (): BrowserWindow | undefined => mainWindow,
    rendererUrl: getRendererUrl,
    icon: defaultWindowIcon,
    openFriendProfile: async (
      parent,
      roomId,
      anchor,
      targetValue,
      validateSender,
    ): Promise<void> => {
      validateSender();
      const conversation = requireRemoteConversation(roomId);
      let targetUid: string;
      switch (conversation.type) {
        case 1:
          targetUid = parseFriendUid(targetValue);
          break;
        case 2:
          if (targetValue !== undefined || !conversation.participantId)
            throw new Error('当前会话没有好友资料');
          targetUid = parseFriendUid(conversation.participantId);
          break;
        default:
          throw new Error('当前会话没有好友资料');
      }
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const validate = (): void => {
        validateSender();
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换');
        const current = requireRemoteConversation(roomId);
        if (current.type !== conversation.type)
          throw new Error('聊天对象已变化');
        if (current.type === 2 && current.participantId !== targetUid)
          throw new Error('聊天对象已变化');
      };
      await friendProfile!.open(
        parent,
        roomId,
        {
          uid: targetUid,
          title: conversation.type === 1 ? '成员资料' : conversation.title,
          avatar: conversation.type === 1 ? null : conversation.avatar,
        },
        anchor,
        validate,
        conversation.type === 1,
      );
    },
    closeFriendProfile: (roomId): void => {
      friendProfile?.close(roomId);
    },
  });
  friendVerification = createFriendFormController<
    FriendVerificationContext,
    FriendSettingsDraft
  >(
    getRendererUrl,
    defaultWindowIcon,
    {
      channel: 'friend-verification',
      title: '通过朋友验证',
      parse: parseFriendSettingsDraft,
    },
    async (context, settings, validate): Promise<void> => {
      const session = requireAuthenticatedSession();
      try {
        await requestApproveFriendApplication(
          createAuthenticatedApiClient(validate),
          context.applyId,
          context.targetUid,
          settings,
        );
      } catch (cause) {
        if (cause instanceof SessionExpiredError)
          expireAuthentication(session, cause);
        throw cause;
      }
    },
  );
  registerRemoteHandler(
    'friend-verification:open',
    async (event, value, friendId): Promise<boolean> => {
      const applyId = parseFriendUid(value);
      const targetUid = parseFriendUid(friendId);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 绑定原主页面和原授权，资料查询与窗口关闭后均复核。 */
      const validate = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重新打开验证窗口');
      };
      const api = createAuthenticatedApiClient(validate);
      if (targetUid === api.userId) throw new Error('不能验证自己的申请');
      const profile = await api.request({
        path: '/capi/user/target/info',
        method: 'POST',
        body: { code: IdTypeEnum.ID, searchText: targetUid },
        serviceName: '朋友验证',
        parse: parseAddFriendResult,
      });
      validate();
      if (profile.uid !== targetUid) throw new Error('申请人资料不匹配');
      if (!mainWindow || !friendVerification) throw new Error('主窗口已关闭');
      return friendVerification.openAndWait(
        mainWindow,
        {
          applyId,
          targetUid,
          targetName: profile.name,
        },
        validate,
      );
    },
  );
  /** 好友资料和添加朋友窗口共用主工作台的通话发起流程。 */
  const requestFriendCall = (
    roomId: string,
    uid: string,
    mediaMode: RtcMediaMode,
  ): void => {
    requireAuthenticatedSession();
    if (!mainWindow || mainWindow.isDestroyed())
      throw new Error('主聊天窗口已关闭');
    sendWindowNotification(mainWindow, 'friend-profile:call-requested', {
      roomId,
      uid,
      mediaMode,
    });
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };
  registerRemoteHandler('voice:upload', async (event, roomId, bytes) => {
    const context = imageDraftContext(event, roomId);
    if (voiceUploading) throw new Error('请等待当前语音上传完成');
    voiceUploading = true;
    try {
      return await uploadVoice(
        import.meta.env.VITE_AUTH_API_BASE?.trim(),
        context.session,
        getClientId(),
        bytes,
        context.validateCurrent,
        voiceAbort.signal,
      );
    } finally {
      voiceUploading = false;
    }
  });
  const parseRtcMediaMode = (value: unknown): RtcMediaMode => {
    switch (value) {
      case RtcMediaMode.AUDIO:
      case RtcMediaMode.VIDEO:
        return value;
      default:
        throw new Error('不支持的 RTC 媒体类型');
    }
  };
  /** 创建绑定当前主进程授权的 RTC API 客户端。 */
  const createRtcRequestClient = (
    event: IpcMainInvokeEvent,
  ): ReturnType<typeof createAuthenticatedApiClient> =>
    createAuthenticatedApiClient((): void => {
      validateDatabaseSender(event);
    });
  /** 校验 RTC 请求使用当前通话窗口绑定的呼叫。 */
  const parseRtcCallId = (
    event: IpcMainInvokeEvent,
    value: unknown,
  ): string => {
    const callId = parseText(value, 128);
    if (isRtcCallWindow(event)) validateRtcCallWindowCall(event, callId);
    return callId;
  };
  /** 校验群通话发起方提交的被邀请成员 UID，避免页面绕过群成员选择器传入任意值。 */
  const parseRtcParticipantUids = (value: unknown): string[] | undefined => {
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length < 1 || value.length > 100000)
      throw new Error('RTC 通话成员列表无效');
    const result = value.map((item: unknown) => parseText(item, 64));
    if (new Set(result).size !== result.length)
      throw new Error('RTC 通话成员列表重复');
    return result;
  };
  const pendingRtcDials = new Set<
    ReturnType<typeof requireAuthenticatedSession>
  >();
  /** 提交渲染层确认的呼出，所有请求绑定原页面和授权，禁止重复创建。 */
  registerRemoteHandler(
    'rtc:create',
    async (
      event,
      roomId,
      mediaMode,
      clientRequestId,
      participantUids,
      replaceCallIds,
    ) => {
      const api = createRtcRequestClient(event);
      const session = requireAuthenticatedSession();
      if (pendingRtcDials.has(session)) throw new Error('正在发起通话，请稍候');
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) throw new Error('通话来源窗口已关闭');
      /** 请求及窗口回收前复核原账号和来源窗口。 */
      const validate = (): void => {
        api.validateCurrent();
        if (parent.isDestroyed() || getActiveSession() !== session)
          throw new Error('账号或授权状态已变化');
      };
      pendingRtcDials.add(session);
      try {
        return await dialRtcCall({
          api,
          request: {
            roomId: parseText(roomId, 64),
            mediaMode: parseRtcMediaMode(mediaMode),
            clientRequestId: parseText(clientRequestId, 128),
            participantUids: parseRtcParticipantUids(participantUids),
            replaceCallIds: parseRtcReplaceCallIds(replaceCallIds),
          },
          validate,
          windowCallIds: getRtcCallWindowIds(),
          closeWindows: closeReplacedRtcCallWindows,
        });
      } finally {
        pendingRtcDials.delete(session);
      }
    },
  );
  /** 工作台呼出前读取当前账号的活动通话，确认界面由渲染层负责。 */
  registerRemoteHandler('rtc:active', async (event) => {
    validateSender(event);
    const session = requireAuthenticatedSession();
    return createAuthenticatedApiClient((): void => {
      validateSender(event);
    }).request({
      path: '/capi/rtc/calls/active',
      method: 'GET',
      serviceName: '当前通话',
      parse: (value: unknown) =>
        parseRtcActiveCallsResponse(value, session.user.id),
    });
  });
  /** 群房间发现仅开放给工作台，后端校验当前群成员身份。 */
  registerRemoteHandler('rtc:group-active', async (event, value) => {
    validateSender(event);
    const roomId = parseText(value, 64);
    return createAuthenticatedApiClient((): void => {
      validateSender(event);
    }).request({
      path: `/capi/rtc/rooms/${encodeURIComponent(roomId)}/active`,
      method: 'GET',
      serviceName: '群当前通话',
      parse: (response: unknown) =>
        parseRtcGroupActiveResponse(response, roomId),
    });
  });
  /** 恢复发现仅开放给当前工作台，并绑定请求发起时的授权账号。 */
  registerRemoteHandler('rtc:ongoing', async (event) => {
    validateSender(event);
    const session = requireAuthenticatedSession();
    return createAuthenticatedApiClient((): void => {
      validateSender(event);
    }).request({
      path: '/capi/rtc/calls/ongoing',
      method: 'GET',
      serviceName: '未结束通话',
      parse: (value: unknown) =>
        parseRtcOngoingCallsResponse(value, session.user.id),
    });
  });
  /** 通过主进程读取 RTC 呼叫状态。 */
  registerRemoteHandler('rtc:get', async (event, callId) =>
    createRtcRequestClient(event).request({
      path: `/capi/rtc/calls/${encodeURIComponent(parseRtcCallId(event, callId))}`,
      method: 'GET',
      serviceName: 'RTC 呼叫',
      parse: parseRtcCallResponse,
    }),
  );
  /** 媒体协商只开放给绑定通话的子窗口，异步结果仍复核原授权和来源。 */
  registerRemoteHandler('rtc:media-read', async (event, callId) => {
    validateRtcCallWindowSender(event);
    return createRtcRequestClient(event).request({
      path: `/capi/rtc/calls/${encodeURIComponent(parseRtcCallId(event, callId))}/media`,
      method: 'GET',
      serviceName: 'RTC 媒体协商',
      parse: parseRtcMediaResponse,
    });
  });
  registerRemoteHandler('rtc:media-signal', async (event, callId, signal) => {
    validateRtcCallWindowSender(event);
    return createRtcRequestClient(event).request({
      path: `/capi/rtc/calls/${encodeURIComponent(parseRtcCallId(event, callId))}/media`,
      method: 'POST',
      body: { ...parseRtcMediaSignal(signal) },
      serviceName: 'RTC 媒体协商',
      parse: parseRtcMediaResponse,
    });
  });
  /** 通过主进程申请 LiveKit 房间凭证。 */
  registerRemoteHandler('rtc:token', async (event, callId) =>
    createRtcRequestClient(event).request({
      path: `/capi/rtc/calls/${encodeURIComponent(parseRtcCallId(event, callId))}/token`,
      method: 'POST',
      serviceName: 'LiveKit Token',
      parse: parseRtcJoinCredentialResponse,
    }),
  );
  /** 通过主进程领取或释放群视频席位。 */
  registerRemoteHandler('rtc:video', async (event, callId, enabled) =>
    createRtcRequestClient(event).request({
      path: `/capi/rtc/calls/${encodeURIComponent(parseRtcCallId(event, callId))}/video`,
      method: 'POST',
      body: { enabled: parseBoolean(enabled) },
      serviceName: '群视频席位',
      parse: parseRtcVideoEnabledResponse,
    }),
  );
  for (const [channel, action] of [
    ['rtc:accept', 'accept'],
    ['rtc:reject', 'reject'],
    ['rtc:cancel', 'cancel'],
    ['rtc:expire', 'expire'],
    ['rtc:hangup', 'hangup'],
    ['rtc:leave', 'leave'],
  ] as const) {
    registerRemoteHandler(
      channel,
      async (event, callId, clientRequestId, expectedVersion) => {
        const call = await createRtcRequestClient(event).request({
          path: `/capi/rtc/calls/${encodeURIComponent(parseRtcCallId(event, callId))}/${action}`,
          method: 'POST',
          body: {
            clientRequestId: parseText(clientRequestId, 128),
            expectedVersion: parseInteger(expectedVersion, 1, 2_147_483_647),
          },
          serviceName: 'RTC 呼叫',
          parse: parseRtcCallResponse,
        });
        // 工作台主动重入后回收仍在收尾的旧窗口，重新初始化同一通话的媒体。
        if (action === 'accept' && !isRtcCallWindow(event)) {
          validateSender(event);
          closeReplacedRtcCallWindows([call.callId]);
        }
        return call;
      },
    );
  }
  registerRtcCallWindow({
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    getDefaultIcon: defaultWindowIcon,
    validateMainSender: validateSender,
    reconnectCall: (callId, validate): Promise<RtcCallView> =>
      createAuthenticatedApiClient(validate).request({
        path: `/capi/rtc/calls/${encodeURIComponent(callId)}/reconnect`,
        method: 'POST',
        serviceName: '通话重连',
        parse: parseRtcCallResponse,
      }),
    isGroupCall: (call): boolean =>
      call.calleeUid === null || getRemoteConversation(call.roomId)?.type === 1,
    readParticipant: async (call, uid, validate): Promise<RtcCallPeer> => {
      validate();
      const session = requireAuthenticatedSession();
      if (uid === session.user.id)
        return {
          name: session.user.nickname,
          avatar: session.user.avatar ?? null,
        };
      const cached = getContact(uid);
      try {
        const contact = await fetchContactProfile(
          session,
          uid,
          false,
          validate,
          call.roomId,
        );
        validate();
        return {
          name:
            contact.remark?.trim() ||
            contact.groupNicknames?.[call.roomId]?.trim() ||
            contact.nickname.trim() ||
            `用户 ${uid}`,
          avatar: contact.avatar,
        };
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        validate();
        return {
          name:
            cached?.remark?.trim() ||
            cached?.groupNicknames?.[call.roomId]?.trim() ||
            cached?.nickname.trim() ||
            `用户 ${uid}`,
          avatar: cached?.avatar ?? null,
        };
      }
    },
    readCall: (callId, validate): Promise<RtcCallView> =>
      createAuthenticatedApiClient(validate).request({
        path: `/capi/rtc/calls/${encodeURIComponent(callId)}`,
        method: 'GET',
        serviceName: 'RTC 呼叫',
        parse: parseRtcCallResponse,
      }),
    readPeer: async (call, session, validate): Promise<RtcCallPeer> => {
      validate();
      const conversation = getRemoteConversation(call.roomId);
      if (call.calleeUid === null || conversation?.type === 1) {
        return {
          name: conversation?.title.trim() || '群通话',
          avatar: conversation?.avatar ?? null,
        };
      }
      const peerUid =
        call.callerUid === session.user.id ? call.calleeUid : call.callerUid;
      if (peerUid === null) throw new Error('单聊对方身份缺失');
      const conversationPeer =
        conversation?.type === 2 && conversation.participantId === peerUid
          ? conversation
          : null;
      const cached = getContact(peerUid);
      const cachedName =
        conversationPeer?.title.trim() ||
        cached?.remark?.trim() ||
        cached?.nickname.trim() ||
        '';
      const cachedAvatar = conversationPeer?.avatar ?? cached?.avatar ?? null;
      if (cachedName && cachedAvatar) {
        return { name: cachedName, avatar: cachedAvatar };
      }

      const generation = documentGeneration;
      const validateCurrent = (): void => {
        validate();
        if (generation !== documentGeneration || getActiveSession() !== session)
          throw new Error('账号或授权状态已变化');
      };
      try {
        const contact = await fetchContactProfile(
          session,
          peerUid,
          false,
          validateCurrent,
        );
        validateCurrent();
        return {
          name:
            conversationPeer?.title.trim() ||
            contact.remark?.trim() ||
            contact.nickname.trim() ||
            `用户 ${peerUid}`,
          avatar: conversationPeer?.avatar ?? contact.avatar,
        };
      } catch (error) {
        if (error instanceof SessionExpiredError) throw error;
        validate();
        return {
          name: cachedName || `用户 ${peerUid}`,
          avatar: cachedAvatar,
        };
      }
    },
  });
  handleChatIpc('voice:read', async (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    if (event.sender === mainWindow?.webContents || isConversationCall(event))
      validateMediaReadSender(event);
    else validateHistoryImageSender(event, request.conversationId);
    const generation = documentGeneration;
    const auth = requireAuthenticatedSession();
    const original = getHistoryMessage(
      request.conversationId,
      request.messageId,
    );
    /** 每次读流检查窗口、身份和消息正文，撤回或账号切换后不交付字节。 */
    const validate = (): void => {
      if (event.sender === mainWindow?.webContents || isConversationCall(event))
        validateMediaReadSender(event);
      else validateHistoryImageSender(event, request.conversationId);
      if (
        generation !== documentGeneration ||
        auth !== requireAuthenticatedSession()
      )
        throw new Error('语音所属账号或页面已变化');
      const current = getHistoryMessage(
        request.conversationId,
        request.messageId,
      );
      if (
        current.deletedAt ||
        current.messageType !== 'audio' ||
        current.content !== original.content
      )
        throw new Error('语音已移除或撤回');
    };
    validate();
    return readVoice(
      original,
      validate,
      voiceAbort.signal,
      fetch,
      authorizeMessageDownload,
    );
  });
  registerRemoteHandler(
    'video:cancel-placeholder',
    async (event, roomId, clientMsgId) => {
      const context = imageDraftContext(event, roomId, true);
      const client = parseText(clientMsgId, 64);
      markVideoUploadCancelled(context.roomId, client);
      const message = await requestCancelTemporary(
        import.meta.env.VITE_AUTH_API_BASE?.trim(),
        context.session,
        getClientId(),
        context.roomId,
        client,
      );
      context.validateCurrent();
      return saveRemoteMessages([message])[0]!;
    },
  );
  /** 子窗口按发送者读取公开资料，只读状态仅使用本地缓存。 */
  const readSenderContact = async (
    uid: string,
    validateSource: () => void,
    roomId?: string,
    force: boolean = false,
  ): Promise<Contact | null> => {
    validateSource();
    const user = requireLocalUser();
    if (uid === user.id)
      return {
        id: user.id,
        nickname: user.nickname,
        avatar: user.avatar ?? null,
        signature: user.signature ?? null,
        updatedAt: new Date().toISOString(),
      };
    const cached = getContact(uid);
    if (getSessionAccess().readOnly) return cached;
    if (!/^[1-9]\d{0,63}$/.test(uid)) return null;
    const authenticated = requireAuthenticatedSession();
    const generation = documentGeneration;
    /** 资料补全沿用真实接口，禁止迟到请求写入新账号或失效会话。 */
    const validateCurrent = (): void => {
      validateSource();
      if (
        generation !== documentGeneration ||
        requireLocalUser() !== user ||
        requireAuthenticatedSession() !== authenticated
      )
        throw new Error('发送者资料请求已失效');
    };
    try {
      return await fetchContactProfile(
        authenticated,
        uid,
        force,
        validateCurrent,
        roomId,
      );
    } catch (error) {
      if (
        error instanceof SessionExpiredError &&
        generation === documentGeneration &&
        getActiveSession() === authenticated
      )
        expireAuthentication(authenticated, error);
      if (!(error instanceof SessionExpiredError) && cached) {
        validateCurrent();
        return cached;
      }
      throw error;
    }
  };
  /** 主页面和历史分别核验来源，异步阶段仍限定原页面代次。 */
  const videoSource = (
    event: IpcMainInvokeEvent,
    request: ImagePreviewRequest,
  ): (() => void) => {
    const generation = documentGeneration;
    const owner = requireLocalUser();
    /** 每次媒体读取重新检查会话窗口及账号。 */
    const validate = (): void => {
      if (documentGeneration !== generation || requireLocalUser() !== owner)
        throw new Error('视频所属页面已变化');
      if (
        (mainWindow && event.sender === mainWindow.webContents) ||
        isConversationCall(event)
      )
        validateMediaReadSender(event);
      else validateHistoryImageSender(event, request.conversationId);
    };
    validate();
    return validate;
  };
  registerRemoteHandler('file:choose', async (event, value: unknown) => {
    const { roomId, validateCurrent } = imageDraftContext(event, value);
    nativeOperation = true;
    try {
      const result = await dialog.showOpenDialog(
        BrowserWindow.fromWebContents(event.sender) ?? mainWindow!,
        {
          title: '选择文件',
          defaultPath: applicationDirectory,
          properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
        },
      );
      validateCurrent();
      if (result.canceled) return { images: [], videos: [], files: [] };
      return await stageDroppedMedia(
        roomId,
        result.filePaths,
        validateCurrent,
        {
          images: imageDrafts,
          videos: videoDrafts!,
          files: fileDrafts!,
        },
        { deferVideoProcessing: true, deferFileProcessing: true },
      );
    } finally {
      finishNativeOperation();
    }
  });
  registerRemoteHandler('file:release', (event, roomId, id) => {
    const context = imageDraftContext(event, roomId, true);
    fileDrafts!.release(context.roomId, parseText(id, 64));
  });
  registerRemoteHandler('file:prepare-draft', async (event, value, id) => {
    const context = imageDraftContext(event, value, true);
    return fileDrafts!.prepare(
      context.roomId,
      parseText(id, 64),
      context.validateCurrent,
      (progress): void => {
        context.validateCurrent();
        sendWindowNotification(
          BrowserWindow.fromWebContents(event.sender) ?? undefined,
          'file:draft-processing-progress',
          progress,
        );
      },
    );
  });
  registerRemoteHandler('file:restore', (event, value) => {
    const request = parseImagePreviewRequest(value);
    const context = imageDraftContext(event, request.conversationId, true);
    return fileDrafts!.restore(
      context.roomId,
      request.messageId,
      context.validateCurrent,
    );
  });
  registerRemoteHandler(
    'file:send',
    async (event, roomId, clientMsgId, draftId) => {
      const context = imageDraftContext(event, roomId, true);
      await fileDrafts!.send(
        context.roomId,
        parseText(clientMsgId, 64),
        draftId == null ? undefined : parseText(draftId, 64),
        context.session,
        context.validateCurrent,
        (progress): void => {
          context.validateCurrent();
          sendWindowNotification(
            BrowserWindow.fromWebContents(event.sender) ?? undefined,
            'file:upload-progress',
            progress,
          );
        },
      );
    },
  );
  registerRemoteHandler('file:cancel', async (event, roomId, clientMsgId) => {
    const context = imageDraftContext(event, roomId, true);
    return fileDrafts!.cancel(
      context.roomId,
      parseText(clientMsgId, 64),
      context.session,
      context.validateCurrent,
    );
  });
  handleChatIpc('file:status', (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    return attachmentFiles!.status(request, videoSource(event, request));
  });
  handleChatIpc(
    'file:download',
    async (event, value: unknown): Promise<void> => {
      const request = parseImagePreviewRequest(value);
      const validate = videoSource(event, request);
      await attachmentFiles!.reveal(request, validate);
      validate();
    },
  );
  handleChatIpc('file:show-in-folder', async (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    const validate = videoSource(event, request);
    const filePath = await attachmentFiles!.local(request, validate);
    validate();
    if (!filePath) throw new Error('本地文件不存在，请先点击下载按钮');
    shell.showItemInFolder(filePath);
  });
  handleChatIpc('file:save-as', async (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    const validate = videoSource(event, request);
    validate();
    const parent = BrowserWindow.fromWebContents(event.sender);
    if (!parent || parent.isDestroyed()) throw new Error('文件所属窗口已关闭');
    if (nativeOperation) throw new Error('请等待当前操作完成');
    nativeOperation = true;
    try {
      return await attachmentFiles!.saveAs(
        request,
        validate,
        async (fileName: string): Promise<string | null> => {
          const result = await dialog.showSaveDialog(parent, {
            title: '文件另存为',
            defaultPath: path.join(applicationDirectory, fileName),
            buttonLabel: '保存',
            properties: ['showOverwriteConfirmation', 'dontAddToRecent'],
          });
          validate();
          return result.canceled || !result.filePath ? null : result.filePath;
        },
      );
    } finally {
      finishNativeOperation();
    }
  });
  registerRemoteHandler('video:choose', async (event, value: unknown) => {
    if (nativeOperation) throw new Error('请等待当前操作完成');
    const { roomId, validateCurrent } = imageDraftContext(event, value);
    nativeOperation = true;
    try {
      const result = await dialog.showOpenDialog(mainWindow!, {
        title: '选择视频',
        defaultPath: applicationDirectory,
        properties: ['openFile', 'dontAddToRecent'],
        filters: [{ name: '视频', extensions: VIDEO_EXTENSIONS }],
      });
      validateCurrent();
      if (result.canceled || !result.filePaths[0])
        return { images: [], videos: [], files: [] };
      return await stageDroppedMedia(
        roomId,
        result.filePaths,
        validateCurrent,
        {
          images: imageDrafts,
          videos: videoDrafts!,
          files: fileDrafts!,
        },
        { deferVideoProcessing: true, deferFileProcessing: true },
      );
    } finally {
      finishNativeOperation();
    }
  });
  registerRemoteHandler('video:prepare-draft', async (event, value, id) => {
    const context = imageDraftContext(event, value, true);
    return videoDrafts!.prepare(
      context.roomId,
      parseText(id, 64),
      context.validateCurrent,
      (progress: VideoDraftProcessingProgress): void => {
        context.validateCurrent();
        sendWindowNotification(
          BrowserWindow.fromWebContents(event.sender) ?? undefined,
          'video:draft-processing-progress',
          progress,
        );
      },
    );
  });
  registerRemoteHandler(
    'video:persist-draft',
    (event, value, id, clientMsgId, metadata) => {
      const context = imageDraftContext(event, value, true);
      videoDrafts!.persist(
        context.roomId,
        parseText(id, 64),
        parseText(clientMsgId, 64),
        metadata,
      );
    },
  );
  registerRemoteHandler('video:restore-draft', async (event, value) => {
    const request = parseImagePreviewRequest(value);
    const context = imageDraftContext(event, request.conversationId, true);
    return videoDrafts!.restore(
      context.roomId,
      request.messageId,
      context.validateCurrent,
    );
  });
  handleChatIpc('video:read-upload', (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    return videoDrafts!.readSaved(
      request.conversationId,
      request.messageId,
      videoSource(event, request),
    );
  });
  handleChatIpc(
    'video:show-in-folder',
    async (event, value: unknown): Promise<void> => {
      const request = parseImagePreviewRequest(value);
      const validate = videoSource(event, request);
      const message = getVideoUploadMessage(
        request.conversationId,
        request.messageId,
      );
      const filePath =
        message &&
        ['temporary', 'upload-cancelled'].includes(message.messageType)
          ? await videoDrafts!.reveal(
              request.conversationId,
              request.messageId,
              validate,
            )
          : await videoFiles!.reveal(request, validate);
      validate();
      shell.showItemInFolder(filePath);
    },
  );
  registerRemoteHandler(
    'video:upload',
    async (event, value: unknown, id: unknown, metadata: unknown) => {
      const context = imageDraftContext(event, value, true);
      return videoDrafts!.upload(
        context.roomId,
        parseText(id, 64),
        metadata,
        context.session,
        context.validateCurrent,
        (progress): void => {
          context.validateCurrent();
          sendWindowNotification(
            BrowserWindow.fromWebContents(event.sender) ?? undefined,
            'video:upload-progress',
            progress,
          );
        },
      );
    },
  );
  registerRemoteHandler(
    'video:create-placeholder',
    async (event, roomId, clientMsgId, content) => {
      const context = imageDraftContext(event, roomId, true);
      const client = parseText(clientMsgId, 64);
      const source = getVideoUploadSource(context.roomId, client);
      const local = getVideoUploadMessage(context.roomId, client);
      const metadata = validateTemporaryVideo(content);
      if (
        !source ||
        !local ||
        source.fileName !== metadata.fileName ||
        source.fileSize !== metadata.fileSize ||
        source.duration !== metadata.duration ||
        source.thumbWidth !== metadata.thumbWidth ||
        source.thumbHeight !== metadata.thumbHeight
      )
        throw new Error('仅首次发送的设备可以提交此视频占位');
      const message = await requestCreateTemporary(
        import.meta.env.VITE_AUTH_API_BASE?.trim(),
        context.session,
        getClientId(),
        context.roomId,
        client,
        metadata,
        validateReplyTarget(context.roomId, local.replyId),
      );
      context.validateCurrent();
      return saveRemoteMessages([message])[0]!;
    },
  );
  registerRemoteHandler(
    'video:complete-placeholder',
    async (event, roomId, msgId, clientMsgId, content) => {
      const context = imageDraftContext(event, roomId, true);
      const id = parseText(msgId, 64);
      if (!/^[1-9]\d{0,63}$/.test(id)) throw new Error('无效的视频占位 ID');
      const client = parseText(clientMsgId, 64);
      const source = getVideoUploadSource(context.roomId, client);
      const local = getVideoUploadMessage(context.roomId, id);
      if (!source || source.cancelRequested || local?.clientMsgId !== client)
        throw new Error('本机上传来源不存在或已取消');
      await requestCompleteTemporary(
        import.meta.env.VITE_AUTH_API_BASE?.trim(),
        context.session,
        getClientId(),
        context.roomId,
        id,
        client,
        validateVideo(content),
      );
      context.validateCurrent();
    },
  );
  registerRemoteHandler('video:stop', (event, value: unknown, id: unknown) => {
    const context = imageDraftContext(event, value, true);
    videoDrafts!.stop(context.roomId, parseText(id, 64));
  });
  registerRemoteHandler(
    'video:release',
    (event, value: unknown, id: unknown) => {
      const context = imageDraftContext(event, value, true);
      videoDrafts!.release(context.roomId, parseText(id, 64));
    },
  );
  handleChatIpc('video:status', (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    return videoFiles!.status(request, videoSource(event, request));
  });
  handleChatIpc('video:poster', (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    return videoFiles!.poster(request, videoSource(event, request));
  });
  handleChatIpc('video:download', (event, value: unknown) => {
    const request = parseImagePreviewRequest(value);
    return videoFiles!.download(request, videoSource(event, request));
  });
  registerVideoWindow({
    files: videoFiles!,
    getDefaultIcon: defaultWindowIcon,
    loadSenderIcon: async (uid, validate): Promise<NativeImage> => {
      const contact = await readSenderContact(uid, validate);
      validate();
      if (getSessionAccess().readOnly) return defaultWindowIcon();
      const icon = await loadWindowIcon(contact?.avatar ?? undefined);
      validate();
      return getSessionAccess().readOnly ? defaultWindowIcon() : icon;
    },
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    validateSource: (event, request): void => {
      videoSource(event, request)();
    },
  });
  handleChatIpc('auth:login', (event, credentials: unknown) => {
    validateLoginSender(event);
    validateDatabaseSender(event);
    loginNotice = '';
    return loginWithBackend(credentials).then(withoutClientSqlPassword);
  });
  handleChatIpc(
    'auth:register',
    async (event, registration: unknown): Promise<void> => {
      validateLoginSender(event);
      validateDatabaseSender(event);
      const generation = documentGeneration;
      if (getActiveSession()) throw new Error('请先退出当前账号');
      await registerWithBackend(registration);
      validateDatabaseSender(event);
      if (generation !== documentGeneration)
        throw new Error('页面已重载，请重试');
    },
  );
  let choosingRegistrationAvatar = false;
  let avatarSelectionGeneration = 0;
  handleChatIpc('auth:cancel-registration-avatar', (event): void => {
    validateLoginSender(event);
    validateDatabaseSender(event);
    avatarSelectionGeneration++;
    avatarCrop?.cancel();
  });
  handleChatIpc(
    'auth:choose-registration-avatar',
    async (event): Promise<Uint8Array | null> => {
      validateLoginSender(event);
      validateDatabaseSender(event);
      if (choosingRegistrationAvatar) throw new Error('请先完成当前头像选择');
      const generation = documentGeneration;
      const selectionGeneration = ++avatarSelectionGeneration;
      /** 异步读取前后复核主页面和未登录状态，不开放已授权内容库。 */
      const validate = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          selectionGeneration !== avatarSelectionGeneration ||
          getActiveSession()
        )
          throw new Error('页面或账号已变化，请重新选择头像');
      };
      choosingRegistrationAvatar = true;
      try {
        const bytes = await chooseRegistrationAvatar(mainWindow!, validate);
        validate();
        if (!bytes) return null;
        if (!avatarCrop) throw new Error('头像裁剪窗口尚未初始化');
        const cropped = await avatarCrop.open(mainWindow!, bytes, validate);
        validate();
        return cropped;
      } finally {
        choosingRegistrationAvatar = false;
      }
    },
  );
  handleChatIpc('auth:cancel-login', (event) => {
    validateLoginSender(event);
    cancelPendingLogin();
  });
  handleChatIpc('auth:authorize', authorizeSession);
  handleChatIpc(
    'auth:get-login-state',
    async (event, checkServer: unknown = true) => {
      validateLoginSender(event);
      validateDatabaseSender(event);
      if (typeof checkServer !== 'boolean') throw new Error('无效的校验参数');
      const generation = documentGeneration;
      resetAuthentication(true);
      const state = checkServer
        ? await getValidatedLoginState()
        : getLoginState();
      validateDatabaseSender(event);
      if (generation !== documentGeneration)
        throw new Error('页面已重载，请重试');
      void updateTaskbarIcon(state.session?.user.avatar);
      return loginNotice ? { ...state, validationError: loginNotice } : state;
    },
  );
  handleChatIpc('auth:select-account', async (event, value: unknown) => {
    validateLoginSender(event);
    validateDatabaseSender(event);
    loginNotice = '';
    const generation = documentGeneration;
    const id = value === null ? null : parseText(value, 64);
    stopResourceSse('account-switch');
    setResourceSseStatus('stopped');
    resetAuthentication(true);
    selectLoginAccount(id);
    void updateTaskbarIcon(getRetainedSession()?.user.avatar);
    clearTimeout(expiryTimer);
    const state = await getValidatedLoginState();
    validateDatabaseSender(event);
    if (generation !== documentGeneration)
      throw new Error('页面已重载，请重试');
    if (state.session) scheduleExpiry(state.session);
    void updateTaskbarIcon(state.session?.user.avatar);
    return state;
  });
  handleChatIpc('auth:resume', resumeSession);
  handleChatIpc('auth:end', endSession);
  handleChatIpc('auth:get-access', (event) => {
    validateSender(event);
    const session = getActiveSession();
    if (session && getSessionAccess().readOnly) expireAuthentication(session);
    return getSessionAccess();
  });
  handleChatIpc('resource:get-status', (event): ResourceSseStatus => {
    validateSender(event);
    return resourceSseStatus;
  });
  handleChatIpc('workspace:open', openWorkspace);
  handleChatIpc('workspace:session', (event): AuthSession => {
    validateWorkspaceSender(event);
    return withoutClientSqlPassword(requireAuthenticatedSession());
  });
  handleChatIpc('workspace:ready', startWorkspace);
  handleChatIpc('workspace:return-login', (event): void => {
    validateWorkspaceSender(event);
    resetAuthentication(true);
    returnToLogin();
  });
  handleChatIpc('window:control', controlWindow);
  handleChatIpc('window:debug-mode', setDebugMode);
  handleChatIpc('files:choose', chooseFiles);
  handleChatIpc('database:backup', backupDatabase);
  registerRemoteHandler('chat:sync-contacts', (event) => {
    validateDatabaseSender(event);
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    return syncRemoteContacts((): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    }).then((count): number => {
      trayPreview?.refresh();
      return count;
    });
  });
  registerRemoteHandler('chat:list-friends', (event) => {
    validateDatabaseSender(event);
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    const validateCurrent = (): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    };
    return listUserFriends(validateCurrent);
  });
  for (const channel of [
    'friend-application:unread',
    'friend-application:list',
    'friend-application:mark-read',
    'friend-application:reply',
  ] as const) {
    registerRemoteHandler(channel, (event, value: unknown) => {
      validateDatabaseSender(event);
      if (channel === 'friend-application:reply')
        validateWorkspaceSender(event);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 响应只交给原账号的已授权主页面。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (channel === 'friend-application:reply')
          validateWorkspaceSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      const api = createAuthenticatedApiClient(validateCurrent);
      switch (channel) {
        case 'friend-application:unread':
          if (value !== undefined) throw new Error('未读查询不接受参数');
          return requestFriendUnread(api);
        case 'friend-application:list':
          return requestFriendApplications(
            api,
            parseFriendApplicationPageNo(value),
          ).then((page) => hydrateFriendApplicationPage(page, validateCurrent));
        case 'friend-application:mark-read':
          return requestReadFriendApplication(api, parseFriendUid(value));
        case 'friend-application:reply':
          return requestReplyFriendApplication(api, value);
      }
    });
  }
  registerRemoteHandler('chat:list-groups', (event) => {
    validateDatabaseSender(event);
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    const validateCurrent = (): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    };
    return listUserGroups(validateCurrent).then((groups) => {
      validateCurrent();
      trayPreview?.setGroups(session, groups);
      return groups;
    });
  });
  registerRemoteHandler('chat:list-group-members', (event, value: unknown) => {
    validateDatabaseSender(event);
    const roomId = parseText(value, 64);
    if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('无效的群聊 ID');
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    const validateCurrent = (): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    };
    return listUserGroupMembers(roomId, validateCurrent);
  });
  const groupCreations = new Set<AuthSession>();
  registerRemoteHandler('chat:create-group', async (event, value: unknown) => {
    validateWorkspaceSender(event);
    const request = parseCreateGroupRequest(value);
    const session = requireAuthenticatedSession();
    if (request.uids.includes(session.user.id))
      throw new Error('受邀好友不能包含自己');
    if (groupCreations.has(session)) throw new Error('正在创建群聊，请稍候');
    const generation = documentGeneration;
    /** 创建结果只交回原授权主页面，不允许其他内容子窗口发起。 */
    const validateCurrent = (): void => {
      validateWorkspaceSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    };
    groupCreations.add(session);
    try {
      return await createRemoteGroup(
        createAuthenticatedApiClient(validateCurrent),
        request,
      );
    } finally {
      groupCreations.delete(session);
    }
  });
  registerRemoteHandler('chat:add-group-members', (event, value: unknown) => {
    validateDatabaseSender(event);
    const request = parseAddGroupMembersRequest(value);
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    /** 写请求及迟到响应只能作用于原授权主页面。 */
    const validateCurrent = (): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    };
    return addRemoteGroupMembers(
      createAuthenticatedApiClient(validateCurrent),
      request,
    );
  });
  registerRemoteHandler(
    'chat:remove-group-members',
    (event, value: unknown) => {
      validateDatabaseSender(event);
      const request = parseRemoveGroupMembersRequest(value);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 请求前后复核原主页面和授权，不把迟到结果交给新账号。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      return removeRemoteGroupMembers(
        createAuthenticatedApiClient(validateCurrent),
        request,
      );
    },
  );
  const groupDepartures = new Map<AuthSession, Set<string>>();
  for (const channel of ['chat:exit-group', 'chat:dissolve-group'] as const) {
    registerRemoteHandler(channel, async (event, value: unknown) => {
      validateWorkspaceSender(event);
      const roomId = parseExitGroupRoomId(value);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      if (getRemoteConversation(roomId)?.type !== 1)
        throw new Error('群聊会话不存在');
      const pending = groupDepartures.get(session) ?? new Set<string>();
      if (pending.has(roomId)) throw new Error('正在处理群聊，请稍候');
      /** 确认仅作用于原主页面和原授权，不把迟到结果写入新账号。 */
      const validateCurrent = (): void => {
        validateWorkspaceSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      pending.add(roomId);
      groupDepartures.set(session, pending);
      try {
        const api = createAuthenticatedApiClient(validateCurrent);
        switch (channel) {
          case 'chat:exit-group':
            await exitRemoteGroup(api, roomId);
            break;
          case 'chat:dissolve-group':
            await dissolveRemoteGroup(api, roomId);
            break;
        }
        validateCurrent();
        // 操作前的详情和历史响应不得重新恢复成员状态或继续写入消息。
        conversationInfoRequests.delete(roomId);
        setGroupRemoved(roomId, true);
        messageHistory?.forget(roomId);
        friendProfile?.close(roomId);
        const notification: GroupExitedNotification = {
          userId: session.user.id,
          roomId,
          action: channel === 'chat:dissolve-group' ? 'dissolve' : 'exit',
        };
        sendWindowNotification(mainWindow, 'chat:group-exited', notification);
        notifyConversationGroupExited(notification);
      } finally {
        pending.delete(roomId);
        if (!pending.size) groupDepartures.delete(session);
      }
    });
  }
  registerRemoteHandler('chat:update-group-info', (event, value: unknown) => {
    validateDatabaseSender(event);
    const request = parseUpdateGroupInfoRequest(value);
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    const validateCurrent = (): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    };
    return updateRemoteGroupInfo(
      createAuthenticatedApiClient(validateCurrent),
      request,
    );
  });
  registerRemoteHandler(
    'chat:set-conversation-not-disturb',
    async (event, value: unknown, status: unknown): Promise<void> => {
      validateDatabaseSender(event);
      const roomId = parseText(value, 64);
      if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('无效的会话 ID');
      if (status !== 0 && status !== 1) throw new Error('会话免打扰状态无效');
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 拒绝页面重载或账号切换后的迟到结果。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      await setUserConversationNotDisturb(roomId, status, validateCurrent);
      validateCurrent();
      const current = getRemoteConversation(roomId);
      if (current) notifyConversationUnread(roomId, current.unreadCount);
    },
  );
  registerRemoteHandler(
    'chat:set-conversation-top',
    (event, value: unknown, status: unknown) => {
      validateDatabaseSender(event);
      const roomId = parseText(value, 64);
      if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('无效的会话 ID');
      if (status !== 0 && status !== 1) throw new Error('会话置顶状态无效');
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      return setUserConversationTop(roomId, status, validateCurrent);
    },
  );
  registerRemoteHandler(
    'chat:remove-conversation',
    async (event, value: unknown): Promise<void> => {
      validateDatabaseSender(event);
      const roomId = parseText(value, 64);
      if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('无效的会话 ID');
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      await removeUserConversation(roomId, validateCurrent);
    },
  );
  registerRemoteHandler(
    'chat:hide-conversation',
    async (event, value: unknown): Promise<void> => {
      validateDatabaseSender(event);
      const roomId = parseText(value, 64);
      if (!/^[1-9]\d{0,18}$/.test(roomId)) throw new Error('无效的会话 ID');
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      await hideUserConversation(roomId, validateCurrent);
    },
  );
  registerRemoteHandler(
    'chat:friend-detail',
    (event, value: unknown, roomValue: unknown) => {
      validateDatabaseSender(event);
      const uid = parseFriendUid(value);
      const roomId = parseFriendUid(roomValue);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 只将资料交给发起请求时仍获授权的主页面。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      return fetchFriendDetail(uid, validateCurrent, roomId);
    },
  );
  /** 复用清空会话后的资源释放；资料窗发起删除时由自身成功回调关闭。 */
  const releaseDeletedConversation = async (
    id: string,
    localPaths: string[],
    closeProfile: boolean = true,
  ): Promise<void> => {
    const uid = requireLocalUser().id;
    trayPreview?.refresh();
    closeConversationWindows(id);
    screenshots?.cancel(id);
    closeImagePreviews(id);
    closeVideoWindows(id);
    videoDrafts?.clear(id);
    fileDrafts?.clear(id);
    imageDrafts.clearRoom(id);
    conversationInfoRequests.delete(id);
    messageHistory?.forget(id);
    closeConversationHistory(id);
    if (closeProfile) friendProfile?.close(id);
    try {
      await removeConversationFiles(localPaths, uid);
    } catch {
      console.warn('聊天记录已清空，部分缓存文件保留在清理队列中等待重试。');
    }
  };

  /** 服务端成功后按本次清空选项清理本地，再通知主页面移除好友及可选会话。 */
  const deleteFriend = async (
    roomId: string,
    clearHistory: boolean,
    validate: () => void,
  ): Promise<void> => {
    validate();
    const session = requireAuthenticatedSession();
    try {
      await requestFriendDeletion(
        createAuthenticatedApiClient(validate),
        roomId,
        clearHistory,
      );
      validate();
      if (clearHistory) {
        const paths = clearConversation(roomId, true);
        // 数据已同步提交；缓存文件失败留在已有清理队列，不重发好友删除。
        void releaseDeletedConversation(roomId, paths, false).catch(
          (cause: unknown) => console.error('删除会话资源释放失败', cause),
        );
      }
      if (mainWindow)
        sendWindowNotification(mainWindow, 'chat:friend-deleted', {
          roomId,
          clearHistory,
        });
    } catch (cause) {
      if (
        cause instanceof SessionExpiredError &&
        getActiveSession() === session
      )
        expireAuthentication(session, cause);
      throw cause;
    }
  };
  registerRemoteHandler(
    'chat:delete-friend',
    (event, value: unknown, clearValue: unknown): Promise<void> => {
      validateDatabaseSender(event);
      const roomId = parseFriendUid(value);
      const clearHistory = parseBoolean(clearValue);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 删除始终绑定发起请求的主页面和本次授权。 */
      const validate = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      return deleteFriend(roomId, clearHistory, validate);
    },
  );
  registerRemoteHandler(
    'chat:apply-conversation-friend',
    async (
      event,
      value: unknown,
    ): Promise<FriendApplicationSubmission | null> => {
      const roomId = parseFriendUid(value);
      const conversation = requireRemoteConversation(roomId);
      if (conversation.type !== 2 || !conversation.participantId)
        throw new Error('当前会话不能发送朋友验证');
      const targetUid = parseFriendUid(conversation.participantId);
      const session = requireAuthenticatedSession();
      if (targetUid === session.user.id) throw new Error('不能添加自己为好友');
      const generation = documentGeneration;
      const parent = BrowserWindow.fromWebContents(event.sender);
      if (!parent) throw new Error('聊天窗口已关闭');
      /** 申请始终绑定原窗口、授权和真实单聊对象，页面不能指定目标身份。 */
      const validate = (): void => {
        validateDatabaseSender(event);
        if (
          parent.isDestroyed() ||
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换');
        const current = requireRemoteConversation(roomId);
        if (current.type !== 2 || current.participantId !== targetUid)
          throw new Error('聊天对象已变化');
      };
      const profile = await requestAddFriend(
        createAuthenticatedApiClient(validate),
        targetUid,
      );
      validate();
      if (profile.uid !== targetUid)
        throw new Error('申请对象与当前聊天不匹配');
      // 对方单向删除时，本人的通讯录仍可能保留好友，不能据此阻止重新验证。
      return openFriendApplicationWindow(
        parent,
        {
          targetUid,
          targetName: profile.name,
          nickname: session.user.nickname,
          avatar: profile.avatar,
        },
        validate,
      );
    },
  );
  friendRemark = createFriendRemarkController(
    getRendererUrl,
    defaultWindowIcon,
    {
      submit: async (
        context,
        draft,
        validate,
      ): Promise<FriendRemarkSettings> => {
        validate();
        const session = requireAuthenticatedSession();
        try {
          const saved = await requestFriendRemark(
            createAuthenticatedApiClient(validate),
            context,
            draft,
          );
          validate();
          try {
            const cached = getContact(context.uid);
            const timestamp = new Date().toISOString();
            saveContact({
              ...cached,
              id: context.uid,
              nickname: context.name,
              avatar: cached?.avatar ?? null,
              signature: cached?.signature ?? null,
              updatedAt: timestamp,
              remark: saved.remark,
              nameUpdatedAt: timestamp,
            });
          } catch {
            console.warn(
              '好友备注已保存，本地名称缓存更新失败，后续资料读取将重新同步。',
            );
          }
          const notification = {
            userId: session.user.id,
            uid: context.uid,
            roomId: context.roomId,
            name: context.name,
            settings: saved,
          };
          sendWindowNotification(
            mainWindow,
            'friend-remark:updated',
            notification,
          );
          notifyConversationRemark(notification);
          return saved;
        } catch (cause) {
          if (
            cause instanceof SessionExpiredError &&
            getActiveSession() === session
          )
            expireAuthentication(session, cause);
          throw cause;
        }
      },
    },
  );
  registerRemoteHandler(
    'friend-remark:open',
    async (event, uidValue: unknown, roomValue: unknown): Promise<void> => {
      validateWorkspaceSender(event);
      const uid = parseFriendUid(uidValue);
      const roomId = parseFriendUid(roomValue);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const parent = mainWindow;
      if (!parent) throw new Error('主窗口已关闭');
      /** 读取真实资料和窗口存活期间均绑定原主页面及授权。 */
      const validate = (): void => {
        validateWorkspaceSender(event);
        validateDatabaseSender(event);
        if (
          parent.isDestroyed() ||
          parent !== mainWindow ||
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换');
      };
      const detail = await requestFriendProfile(
        createAuthenticatedApiClient(validate),
        uid,
        roomId,
      );
      validate();
      if (
        detail.uid !== uid ||
        detail.roomId !== roomId ||
        detail.relationship !== 'friend'
      )
        throw new Error('好友关系已变化，请重新打开资料');
      await friendRemark!.openAndWait(
        parent,
        {
          uid,
          roomId,
          name: detail.name,
          remark: detail.remark,
          settings: detail.remarkSettings,
        },
        validate,
      );
    },
  );
  /** 两类好友详情入口共用备注表单和保存通知，目标由各自控制器校验。 */
  const openFriendRemark = async (
    parent: BrowserWindow,
    detail: FriendDetail,
    validate: () => void,
  ): Promise<FriendRemarkSettings | null> => {
    validate();
    if (!detail.roomId) throw new Error('当前资料不可编辑');
    return friendRemark!.openAndWait(
      parent,
      {
        uid: detail.uid,
        roomId: detail.roomId,
        name: detail.name,
        remark: detail.remark,
        settings: detail.remarkSettings,
      },
      validate,
    );
  };
  /** 好友资料入口共用黑名单请求和认证失效处理。 */
  const setFriendBlacklisted = async (
    roomId: string,
    uid: string,
    blocked: boolean,
    validate: () => void,
  ): Promise<void> => {
    validate();
    const session = requireAuthenticatedSession();
    const request = blocked ? requestRoomBlacklist : requestRoomUnblacklist;
    try {
      await request(createAuthenticatedApiClient(validate), roomId, uid);
    } catch (cause) {
      if (
        cause instanceof SessionExpiredError &&
        getActiveSession() === session
      )
        expireAuthentication(session, cause);
      throw cause;
    }
  };
  registerAddFriendIpc({
    openRemark: openFriendRemark,
    setBlacklisted: setFriendBlacklisted,
    deleteFriend,
    requestCall: requestFriendCall,
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    getDefaultIcon: defaultWindowIcon,
    validateMainSender: validateDatabaseSender,
    expireSession: expireAuthentication,
    /** 本次提交已成功，直接保存现有资料并补入页面通讯录，不请求远端确认。 */
    onFriendAdded: (friend: Friend): Friend => {
      const session = requireAuthenticatedSession();
      const cached = getContact(friend.uid);
      const restored = {
        ...friend,
        avatar: friend.avatar ?? cached?.avatar ?? null,
      };
      const timestamp = new Date().toISOString();
      saveContact({
        ...cached,
        id: restored.uid,
        nickname: restored.name,
        avatar: restored.avatar,
        signature: cached?.signature ?? null,
        updatedAt: timestamp,
        remark: restored.remark,
        nameUpdatedAt: timestamp,
      });
      sendWindowNotification(mainWindow, 'chat:friend-added', {
        userId: session.user.id,
        friend: restored,
      });
      return restored;
    },
  });
  friendProfile = createFriendProfileController({
    isContextMenuOpen: (window): boolean =>
      contextMenus?.isOpenFor(window) ?? false,
    deleteFriend,
    getRendererUrl,
    getDefaultIcon: defaultWindowIcon,
    openRemark: async (
      parent,
      detail,
      validate,
    ): Promise<FriendRemarkSettings | null> => {
      if (detail.relationship !== 'friend') throw new Error('当前资料不可编辑');
      return openFriendRemark(parent, detail, validate);
    },
    readDetail: async (uid, roomId, groupMember, validate) => {
      validate();
      const session = requireAuthenticatedSession();
      try {
        return await requestFriendProfile(
          createAuthenticatedApiClient(validate),
          uid,
          roomId,
          groupMember,
        );
      } catch (cause) {
        if (
          cause instanceof SessionExpiredError &&
          getActiveSession() === session
        )
          expireAuthentication(session, cause);
        throw cause;
      }
    },
    openApplication: async (
      parent,
      detail,
      validate,
    ): Promise<FriendApplicationSubmission | null> => {
      validate();
      const session = requireAuthenticatedSession();
      if (detail.uid === session.user.id) throw new Error('不能添加自己为好友');
      return openFriendApplicationWindow(
        parent,
        {
          targetUid: detail.uid,
          targetName: detail.name,
          nickname: session.user.nickname,
          avatar: detail.avatar,
        },
        validate,
      );
    },
    setBlacklisted: setFriendBlacklisted,
    returnToChat: (parent, roomId, targetUid): void => {
      sendWindowNotification(
        parent,
        targetUid
          ? 'add-friend:chat-requested'
          : 'friend-profile:chat-requested',
        targetUid ?? roomId,
      );
    },
    requestCall: requestFriendCall,
  });
  handleChatIpc(
    'friend-profile:open',
    async (
      event,
      value: unknown,
      position: unknown,
      targetValue?: unknown,
    ): Promise<void> => {
      validateDatabaseSender(event);
      const roomId = parseFriendUid(value);
      const anchor = parseFriendProfileAnchor(position);
      const conversation = requireRemoteConversation(roomId);
      let targetUid: string;
      switch (conversation.type) {
        case 1:
          targetUid = parseFriendUid(targetValue);
          break;
        case 2:
          if (targetValue !== undefined || !conversation.participantId)
            throw new Error('当前会话没有好友资料');
          targetUid = parseFriendUid(conversation.participantId);
          break;
        default:
          throw new Error('当前会话没有好友资料');
      }
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const groupMember = conversation.type === 1;
      /** 请求与窗口始终绑定原页面、授权和原会话。 */
      const validate = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换');
        const current = requireRemoteConversation(roomId);
        if (current.type !== conversation.type)
          throw new Error('聊天对象已变化');
        if (current.type === 2 && current.participantId !== targetUid)
          throw new Error('聊天对象已变化');
      };
      await friendProfile!.open(
        mainWindow!,
        roomId,
        {
          uid: targetUid,
          title: groupMember ? '成员资料' : conversation.title,
          avatar: groupMember ? null : conversation.avatar,
        },
        anchor,
        validate,
        groupMember,
      );
    },
  );
  handleChatIpc('friend-profile:dismiss', (event): void => {
    validateSender(event);
    friendProfile?.close();
  });
  for (const [channel, request] of [
    ['chat:block-room-user', requestRoomBlacklist],
    ['chat:unblock-room-user', requestRoomUnblacklist],
  ] as const) {
    registerRemoteHandler(
      channel,
      (event, roomValue: unknown, uidValue: unknown): Promise<void> => {
        const roomId = parseFriendUid(roomValue);
        const uid = parseFriendUid(uidValue);
        const session = requireAuthenticatedSession();
        const generation = documentGeneration;
        /** 绑定原主框架、原页面和原授权，迟到响应不能作用于新账号。 */
        const validateCurrent = (): void => {
          validateDatabaseSender(event);
          if (
            generation !== documentGeneration ||
            requireAuthenticatedSession() !== session
          )
            throw new Error('页面或账号已切换，请重试');
        };
        return request(
          createAuthenticatedApiClient(validateCurrent),
          roomId,
          uid,
        );
      },
    );
  }
  registerRemoteHandler(
    'chat:image-emoji-status',
    async (event, value: unknown): Promise<boolean> => {
      const request = parseImagePreviewRequest(value);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 图片读取和本地缓存查询始终限定原页面、原会话与原授权。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      if (!imageFiles) throw new Error('图片存储尚未初始化');
      return isUserImageEmojiCollected(
        request,
        (target, validate) => imageFiles!.read(target, validate, true),
        validateCurrent,
      );
    },
  );
  registerRemoteHandler(
    'chat:add-image-emoji',
    async (event, value: unknown): Promise<void> => {
      const request = parseImagePreviewRequest(value);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 请求始终绑定原页面、原窗口和原授权，不向新账号交付迟到结果。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      await addUserImageEmoji(request, validateCurrent);
      validateCurrent();
      // 已发出的旧列表不能在收藏完成后继续回填；下次打开面板读取真实列表。
      emojiListRequest++;
    },
  );
  registerRemoteHandler(
    'chat:delete-emoji',
    async (event, value: unknown): Promise<void> => {
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 删除前后保持原窗口、页面及授权，不修改新账号缓存。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      await deleteUserEmoji(value, validateCurrent);
      validateCurrent();
      emojiListRequest++;
    },
  );
  registerRemoteHandler('chat:front-emoji', async (event, value: unknown) => {
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    /** 排序操作绑定原窗口与授权，页面切换后不保存或交付旧结果。 */
    const validateCurrent = (): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session
      )
        throw new Error('页面或账号已切换，请重试');
    };
    const list = await moveUserEmojiToFront(value, validateCurrent);
    validateCurrent();
    emojiListRequest++;
    return list;
  });
  registerRemoteHandler('chat:list-emojis', async (event) => {
    validateDatabaseSender(event);
    const session = requireAuthenticatedSession();
    const generation = documentGeneration;
    const request = ++emojiListRequest;
    /** 仅最新请求可落库，拒绝旧页面、旧账号和乱序响应。 */
    const validateCurrent = (): void => {
      validateDatabaseSender(event);
      if (
        generation !== documentGeneration ||
        requireAuthenticatedSession() !== session ||
        request !== emojiListRequest
      )
        throw new Error('表情包请求已失效，请重试');
    };
    return listUserEmojis(validateCurrent);
  });
  handleChatIpc('chat:cached-emojis', (event) => {
    validateDatabaseSender(event);
    requireLocalUser();
    return listCachedEmojis();
  });
  registerRemoteHandler(
    'chat:refresh-conversation',
    async (event, value: unknown) => {
      validateDatabaseSender(event);
      const roomId = parseText(value, 64);
      if (!/^[1-9]\d{0,63}$/.test(roomId)) throw new Error('无效的会话 ID');
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const request = Symbol();
      conversationInfoRequests.set(roomId, request);
      /** 旧页面、旧账号和同房间较早的响应均不能覆盖当前会话详情。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session ||
          conversationInfoRequests.get(roomId) !== request
        )
          throw new Error('会话请求已失效，请重试');
      };
      try {
        const refreshed = await refreshConversationInfo(
          roomId,
          validateCurrent,
        );
        validateCurrent();
        if (refreshed.groupRemoved) messageHistory?.forget(roomId);
        notifyConversationUnread(roomId, refreshed.unreadCount);
        return refreshed;
      } finally {
        if (conversationInfoRequests.get(roomId) === request)
          conversationInfoRequests.delete(roomId);
      }
    },
  );
  handleChatIpc(
    'chat:read-conversation',
    (event, roomValue: unknown, messageValue: unknown): boolean => {
      validateDatabaseSender(event);
      requireAuthenticatedSession();
      const window = BrowserWindow.fromWebContents(event.sender);
      if (
        !window ||
        !window.isFocused() ||
        !window.isVisible() ||
        window.isMinimized()
      )
        return false;
      const roomId = parseText(roomValue, 64);
      const messageId = parseText(messageValue, 64);
      notifyConversationUnread(
        roomId,
        stageConversationRead(roomId, messageId),
      );
      return true;
    },
  );
  registerRemoteHandler('chat:send-message', (event, value: unknown) => {
    validateDatabaseSender(event);
    return sendChatMessage(parseSendMessageRequest(value));
  });
  handleChatIpc('chat:delete-message', (event, value: unknown) => {
    validateDatabaseSender(event);
    requireAuthenticatedSession();
    const target = parseImagePreviewRequest(value);
    deleteLocalMessage(target.conversationId, target.messageId);
  });
  registerRemoteHandler('chat:choose-images', chooseImages);
  registerRemoteHandler(
    'chat:capture-screenshot',
    async (
      event,
      value: unknown,
      hideWindow: unknown = true,
    ): Promise<MediaDraftSelection> => {
      const { roomId, validateCurrent } = imageDraftContext(event, value);
      if (!screenshots) throw new Error('截图尚未初始化');
      if (typeof hideWindow !== 'boolean')
        throw new Error('无效的截图窗口选项');
      const bytes = await screenshots.capture(
        roomId,
        validateCurrent,
        hideWindow,
        BrowserWindow.fromWebContents(event.sender) ?? undefined,
      );
      validateCurrent();
      if (!bytes) return { images: [], videos: [], files: [] };
      const images = imageDrafts.stageClipboard(
        roomId,
        [{ contentType: 'image/png', bytes }],
        validateCurrent,
      );
      try {
        const item = new ClipboardItem({
          'image/png': new Blob([new Uint8Array(bytes)], { type: 'image/png' }),
        });
        validateCurrent();
        // 草稿校验成功后才写剪贴板，不暴露任意剪贴板 IPC。
        await clipboard.write([item]);
        validateCurrent();
        return { images, videos: [], files: [] };
      } catch (error) {
        imageDrafts.release(
          roomId,
          images.map((image) => image.id),
        );
        throw error;
      }
    },
  );
  registerRemoteHandler('chat:stage-dropped-media', stageDroppedFiles);
  registerRemoteHandler(
    'chat:stage-clipboard-images',
    (event, value: unknown, images: unknown): MediaDraftSelection => {
      const { roomId, validateCurrent } = imageDraftContext(event, value);
      return {
        images: imageDrafts.stageClipboard(roomId, images, validateCurrent),
        videos: [],
        files: [],
      };
    },
  );
  registerRemoteHandler('chat:upload-image-draft', uploadImageDraft);
  handleChatIpc(
    'image-preview:open-draft',
    async (event, value: unknown, draftId: unknown): Promise<void> => {
      const { roomId, validateCurrent } = imageDraftContext(event, value, true);
      const id = parseText(draftId, 64);
      const image = imageDrafts.describe(roomId, id);
      /** 预览整个生命周期都绑定原页面、会话和仍存在的草稿。 */
      const validate = (): void => {
        validateCurrent();
        imageDrafts.describe(roomId, id);
      };
      await openTemporaryImagePreview(
        {
          getMainWindow: (): BrowserWindow | undefined => mainWindow,
          getRendererUrl,
        },
        { conversationId: roomId, messageId: id },
        {
          context: {
            conversationTitle: '待发送图片',
            messageId: id,
            image,
            hasPrevious: false,
            hasNext: false,
          },
          source: event.sender,
          validate,
          read: (validatePreview): Promise<LocalImageData> =>
            imageDrafts.read(roomId, id, validatePreview),
        },
      );
    },
  );
  handleChatIpc(
    'chat:release-image-drafts',
    (event, value: unknown, ids: unknown): void => {
      validateSender(event);
      const roomId = parseText(value, 64);
      if (!Array.isArray(ids) || ids.length > 10)
        throw new Error('无效的图片草稿');
      imageDrafts.release(
        roomId,
        ids.map((id: unknown) => parseText(id, 64)),
      );
    },
  );
  registerRemoteHandler(
    'chat:sync-history',
    (event, roomId: unknown, mode: unknown) => {
      validateDatabaseSender(event);
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      const history = messageHistory;
      if (!history || (mode !== 'latest' && mode !== 'older'))
        throw new Error('无效的历史同步请求');
      /** 网络请求结束后重新检查页面代次与授权对象，拒绝旧账号结果。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session ||
          messageHistory !== history
        )
          throw new Error('页面或账号已切换，请重试');
      };
      return history.sync(parseText(roomId, 64), mode, validateCurrent);
    },
  );
  registerRemoteHandler(
    'contact:get-profile',
    async (
      event,
      value: unknown,
      force: unknown = false,
      room: unknown = undefined,
    ) => {
      validateDatabaseSender(event);
      const uid = parseText(value, 64);
      if (!/^[1-9]\d{0,63}$/.test(uid)) throw new Error('无效的用户 ID');
      const roomId = room === undefined ? undefined : parseText(room, 64);
      if (roomId !== undefined && !/^[1-9]\d{0,63}$/.test(roomId))
        throw new Error('无效的房间 ID');
      const session = requireAuthenticatedSession();
      const generation = documentGeneration;
      /** 请求完成后再次检查页面和授权对象，避免切换账号后的迟到写入。 */
      const validateCurrent = (): void => {
        validateDatabaseSender(event);
        if (
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== session
        )
          throw new Error('页面或账号已切换，请重试');
      };
      return fetchContactProfile(
        session,
        uid,
        parseBoolean(force),
        validateCurrent,
        roomId,
      );
    },
  );
  handleChatIpc('contact:list', (event) => {
    validateDatabaseSender(event);
    return listContacts();
  });
  registerDatabaseIpc(
    validateDatabaseSender,
    releaseDeletedConversation,
    (): boolean => getSessionAccess().readOnly,
    notifyConversationUnread,
  );
  registerHistoryIpc({
    getDefaultIcon: defaultWindowIcon,
    loadAvatarIcon: async (avatar, validate): Promise<NativeImage> => {
      validate();
      if (getSessionAccess().readOnly) return defaultWindowIcon();
      const icon = await loadWindowIcon(avatar ?? undefined);
      validate();
      return getSessionAccess().readOnly ? defaultWindowIcon() : icon;
    },
    readContact: readSenderContact,
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    validateMainSender: (event): void => {
      validateDatabaseSender(event);
      requireLocalUser();
    },
    revealImage: (request, validateSource): Promise<string> => {
      if (!imageFiles) throw new Error('图片存储尚未初始化');
      return imageFiles.reveal(request, validateSource);
    },
  });
  const service = createUpdateService({
    base: import.meta.env.VITE_AUTH_API_BASE?.trim(),
    currentVersion: app.getVersion(),
    directory: path.join(storageDirectory, 'updates'),
  });
  updateService = service;
  registerUpdateIpc({
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    getDefaultIcon: defaultWindowIcon,
    downloadUpdate: async (releaseId, report): Promise<string> => {
      return service.download(releaseId, report);
    },
    cancelUpdate: service.cancel,
  });
  registerSettingsIpc({
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    getDefaultIcon: defaultWindowIcon,
    validateMainSender: validateDatabaseSender,
    getAccount: (): SettingsAccount => {
      const user = requireAuthenticatedSession().user;
      return {
        id: user.id,
        account: user.account,
        nickname: user.nickname,
        avatar: user.avatar,
      };
    },
    logout: logoutCurrentSession,
    getLogLevel,
    setLogLevel: (level): void => {
      saveStoredLogLevel(level);
      setLogLevel(level);
    },
    checkForUpdate: async () => {
      const result = await service.check();
      return result ? toUpdateReleaseInfo(result) : null;
    },
    openUpdate: openUpdateWindow,
  });
  registerImagePreviewIpc({
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    readImage: (request, validateSource): Promise<LocalImageData> => {
      if (!imageFiles) throw new Error('图片存储尚未初始化');
      return imageFiles.read(request, validateSource);
    },
    validateSource: (event, request): void => {
      if (
        (mainWindow && event.sender === mainWindow.webContents) ||
        isConversationCall(event)
      ) {
        validateMediaReadSender(event);
      } else {
        validateHistoryImageSender(event, request.conversationId);
      }
    },
  });
  avatarCrop = createAvatarCropController(getRendererUrl, defaultWindowIcon);
  screenshots = createScreenshotController({
    getMainWindow: (): BrowserWindow | undefined => mainWindow,
    getRendererUrl,
    reportTiming: (timing): void => {
      if (process.env.OPENCHAT_SCREENSHOT_TIMING === '1')
        console.info('[screenshot:timing]', timing);
    },
  });
  handleChatIpc(
    'image:show-in-folder',
    async (event, value: unknown): Promise<void> => {
      validateDatabaseSender(event);
      const request = parseImagePreviewRequest(value);
      const user = requireLocalUser();
      const generation = documentGeneration;
      /** 主聊天窗口定位文件前后必须仍属于原页面和已验证账号。 */
      const validateSource = (): void => {
        validateDatabaseSender(event);
        if (generation !== documentGeneration || requireLocalUser() !== user)
          throw new Error('图片请求已失效');
      };
      if (!imageFiles) throw new Error('图片存储尚未初始化');
      const filePath = await imageFiles.reveal(request, validateSource);
      validateSource();
      shell.showItemInFolder(filePath);
    },
  );
  /** 图片卡片仅查询本地，显式下载才允许补齐远端正文。 */
  const readMessageImage = async (
    event: IpcMainInvokeEvent,
    value: unknown,
    localOnly: boolean,
  ): Promise<LocalImageData | null> => {
    const request = parseImagePreviewRequest(value);
    const generation = documentGeneration;
    /** 主页面与历史窗口分别校验来源；异步完成后仍限定原会话和页面。 */
    const validateSource = (): void => {
      if (generation !== documentGeneration) throw new Error('图片请求已失效');
      if (
        (mainWindow && event.sender === mainWindow.webContents) ||
        isConversationCall(event)
      ) {
        validateMediaReadSender(event);
      } else {
        validateHistoryImageSender(event, request.conversationId);
      }
    };
    validateSource();
    if (!imageFiles) throw new Error('图片存储尚未初始化');
    if (localOnly && !(await imageFiles.local(request, validateSource)))
      return null;
    return imageFiles.read(request, validateSource, localOnly);
  };
  handleChatIpc('image:read-message', (event, value: unknown) =>
    readMessageImage(event, value, false),
  );
  handleChatIpc('image:read-local-message', (event, value: unknown) =>
    readMessageImage(event, value, true),
  );
  messageCopy = createMessageCopyController({
    temporaryRoot: app.getPath('temp'),
    write: async (filePath, image, validate): Promise<void> => {
      const formats: Record<string, string | Blob> = {
        'text/uri-list': pathToFileURL(filePath).href,
      };
      if (image) {
        const bitmap = nativeImage.createFromPath(filePath);
        if (bitmap.isEmpty()) throw new Error('图片无法复制，请重新下载');
        formats['image/png'] = new Blob([new Uint8Array(bitmap.toPNG())], {
          type: 'image/png',
        });
      }
      validate();
      await clipboard.write([new ClipboardItem(formats)]);
    },
  });
  handleChatIpc('message:copy-attachment', (event, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('无效的附件复制参数');
    const { kind, ...identifiers } = value as Record<string, unknown>;
    const request = parseImagePreviewRequest(identifiers);
    if (kind !== 'image' && kind !== 'file' && kind !== 'video')
      throw new Error('无效的附件复制类型');
    const validateWindow = videoSource(event, request);
    const owner = requireAuthenticatedSession();
    const frame = event.senderFrame;
    /** 按真实消息读取类型与正文，撤回或删除后不能继续复制旧附件。 */
    const readMessage = (): Message => {
      const { conversationId, messageId } = request;
      if (kind === 'image')
        return getImagePreviewMessage(conversationId, messageId);
      if (kind === 'video') return getVideoMessage(conversationId, messageId);
      return getFileMessage(conversationId, messageId);
    };
    const original = readMessage();
    const metadata =
      kind === 'image'
        ? parseImageContent(original.content)
        : kind === 'video'
          ? parseVideoContent(original.content)
          : parseFileContent(original.content);
    if (!metadata) throw new Error('附件名称不可用');
    /** 所有异步步骤绑定原页面、原授权及原始消息正文。 */
    const validate = (): void => {
      validateWindow();
      if (
        event.sender.isDestroyed() ||
        event.sender.mainFrame !== frame ||
        requireAuthenticatedSession() !== owner ||
        readMessage().content !== original.content
      )
        throw new Error('复制消息或登录状态已变化');
    };
    return messageCopy!.copy(
      async (current) => {
        const files =
          kind === 'image'
            ? imageFiles
            : kind === 'video'
              ? videoFiles
              : attachmentFiles;
        if (!files) throw new Error('附件存储尚未初始化');
        // 文件和视频仅复制已下载的原件，不能通过复制触发远端下载。
        const filePath =
          kind === 'image'
            ? await imageFiles!.reveal(request, current)
            : kind === 'video'
              ? await videoFiles!.original(request, current)
              : await attachmentFiles!.local(request, current);
        current();
        if (!filePath) throw new Error('本地文件不存在，请先下载后再复制');
        return { filePath, fileName: metadata.fileName };
      },
      validate,
      kind === 'image',
    );
  });
  messageDrag = createMessageDragController({
    temporaryRoot: app.getPath('temp'),
    fileName: (request): string => {
      const { conversationId, messageId } = request;
      const metadata =
        request.kind === 'image'
          ? parseImageContent(
              getImagePreviewMessage(conversationId, messageId).content,
            )
          : request.kind === 'video'
            ? parseVideoContent(
                getVideoMessage(conversationId, messageId).content,
              )
            : parseFileContent(
                getFileMessage(conversationId, messageId).content,
              );
      if (!metadata) throw new Error('附件名称不可用');
      return metadata.fileName;
    },
    capture: (request): (() => void) => {
      const owner = requireAuthenticatedSession();
      const generation = documentGeneration;
      const source = mainWindow;
      /** 从当前内容库核对附件类型及会话归属，拒绝撤回或删除的消息。 */
      const readMessage = (): Message => {
        switch (request.kind) {
          case 'image':
            return getImagePreviewMessage(
              request.conversationId,
              request.messageId,
            );
          case 'file':
            return getFileMessage(request.conversationId, request.messageId);
          case 'video':
            return getVideoMessage(request.conversationId, request.messageId);
        }
      };
      const original = readMessage();
      /** 短期凭据绑定原页面、原授权和原消息，账号切换后不能继续导出。 */
      return (): void => {
        if (
          !source ||
          source !== mainWindow ||
          source.isDestroyed() ||
          source.webContents.isDestroyed() ||
          source.webContents.mainFrame.url !== getPrimaryRendererUrl() ||
          generation !== documentGeneration ||
          requireAuthenticatedSession() !== owner ||
          readMessage().content !== original.content
        )
          throw new Error('拖拽消息或登录状态已变化');
      };
    },
    prepare: async (request, validate): Promise<string | null> => {
      validate();
      if (request.kind === 'image') {
        if (!imageFiles) throw new Error('图片存储尚未初始化');
        return imageFiles.local(request, validate);
      }
      if (request.kind === 'file') {
        if (!attachmentFiles) throw new Error('文件存储尚未初始化');
        return attachmentFiles.local(request, validate);
      }
      if (!videoFiles) throw new Error('视频存储尚未初始化');
      return videoFiles.original(request, validate);
    },
    loadIcon: loadMessageDragIcon,
  });
  handleChatIpc('message-drag:prepare', (event, value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('无效的附件拖拽参数');
    const { kind, ...identifiers } = value as Record<string, unknown>;
    const request = parseImagePreviewRequest(identifiers);
    if (kind !== 'image' && kind !== 'file' && kind !== 'video')
      throw new Error('无效的附件拖拽参数');
    const frame = event.senderFrame;
    /** 每次准备和拖出均绑定原窗口主框架及其有权读取的会话。 */
    const validate = (): void => {
      if (event.sender.isDestroyed() || event.sender.mainFrame !== frame)
        throw new Error('拖拽来源窗口已变化');
      if (event.sender === mainWindow?.webContents)
        validateDatabaseSender(event);
      else validateHistoryImageSender(event, request.conversationId);
    };
    validate();
    return messageDrag!.prepare(
      { ...request, kind },
      {
        id: event.sender.id,
        validate,
        start: (filePath, icon): void => {
          event.sender.startDrag({ file: filePath, icon });
        },
      },
    );
  });
  handleChatIpc('message-drag:start', (event, ticket: unknown): void => {
    if (event.senderFrame !== event.sender.mainFrame)
      throw new Error('拖拽只能由窗口主框架发起');
    requireAuthenticatedSession();
    messageDrag!.start(ticket, event.sender.id);
  });
};

/** 启动失败时释放数据库连接并退出，不自动删除或重建用户数据。 */
const handleStartupError = (error: unknown): void => {
  startup.stop();
  console.error('Failed to start Electron:', error);
  closeDatabase();
  app.exit(1);
};

/** 托盘、重复启动和系统激活统一恢复当前窗口，交接时仍展示登录页。 */
const activateApplication = (): void => {
  if (quitting || allowMainWindowClose) return;
  trayPreview?.hide();
  const window = workspaceHandoff?.login ?? mainWindow;
  if (window && !window.isDestroyed()) {
    // 新登录页仍由首帧握手显示，托盘不能绕过启动就绪约束。
    if (
      mainWindowMode === 'login' &&
      !window.isVisible() &&
      !window.isMinimized()
    )
      return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  } else if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow().catch(handleStartupError);
  }
};

/** 非 macOS 平台关闭最后一个窗口后退出。 */
const quitWhenWindowsClosed = (): void => {
  if (process.platform !== 'darwin') app.quit();
};

/** 路径和权限策略就绪后先加载登录窗口，仅开放启动状态及关闭接口。 */
const initializeApplication = async (window: BrowserWindow): Promise<void> => {
  /** 麦克风和摄像头权限仅开放已登录主页面，不允许子框架或历史窗口请求。 */
  const canRecord = (
    contents: Electron.WebContents | null,
    url: string | undefined,
    main: boolean,
  ): boolean => {
    try {
      requireAuthenticatedSession();
      if (canRtcCallWindowRecord(contents, url ?? '', main)) return true;
      if (canConversationRecord(contents, url ?? '', main)) return true;
      return (
        !!mainWindow &&
        contents === mainWindow.webContents &&
        main &&
        mainWindowMode === 'chat' &&
        url === getPrimaryRendererUrl() &&
        contents.getURL() === getPrimaryRendererUrl()
      );
    } catch {
      return false;
    }
  };
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, _origin, details) => {
      if (permission === 'speaker-selection')
        return canRtcCallWindowSelectSpeaker(
          contents,
          details.requestingUrl ?? '',
          details.isMainFrame,
        );
      if (permission === 'media')
        return (
          (details.mediaType === 'audio' || details.mediaType === 'video') &&
          canRecord(contents, details.requestingUrl, details.isMainFrame)
        );
      return permission === 'clipboard-sanitized-write';
    },
  );
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) => {
      if (permission === 'speaker-selection') {
        callback(
          canRtcCallWindowSelectSpeaker(
            contents,
            details.requestingUrl ?? '',
            details.isMainFrame,
          ),
        );
        return;
      }
      if (permission === 'media') {
        const media = 'mediaTypes' in details ? details.mediaTypes : undefined;
        callback(
          !!media?.length &&
            media.every((type) => type === 'audio' || type === 'video') &&
            canRecord(contents, details.requestingUrl, details.isMainFrame),
        );
        return;
      }
      callback(permission === 'clipboard-sanitized-write');
    },
  );
  for (const channel of [
    'window:close',
    'startup:get-phase',
    'startup:rendered',
  ])
    ipcMain.removeHandler(channel);
  handleChatIpc('window:close', closeWindow);
  handleChatIpc('startup:get-phase', (event) => {
    validateSender(event);
    return startup.phase();
  });
  handleChatIpc('startup:rendered', (event) => {
    validateLoginSender(event);
    if (!mainWindow?.isVisible()) mainWindow?.show();
    void startup.start().catch(handleStartupError);
  });
  await createWindow(window);
  applicationTray = createApplicationTray({
    open: activateApplication,
    quit: (): void => app.quit(),
    menuVisibilityChanged: (visible): void =>
      trayPreview?.setMenuVisible(visible),
  });
  trayPreview = createTrayPreview({
    tray: applicationTray,
    getSession: (): AuthSession | null =>
      workspaceStarted && !quitting ? getActiveSession() : null,
    getRendererUrl,
    openConversation: (id): void => {
      requireAuthenticatedSession();
      requireRemoteConversation(id);
      if (
        !workspaceStarted ||
        workspaceHandoff ||
        quitting ||
        !mainWindow ||
        mainWindow.isDestroyed()
      )
        throw new Error('聊天窗口尚未就绪');
      activateApplication();
      sendWindowNotification(mainWindow, 'tray-preview:open-conversation', id);
    },
  });
  app.on('activate', activateApplication);
  void startup.start().catch(handleStartupError);
};

/** 首屏可见后初始化本地服务及设置库，不提前打开用户内容库。 */
const initializeLocalServices = async (): Promise<void> => {
  const databaseDirectory = path.join(storageDirectory, 'database');
  try {
    await mkdir(path.join(storageDirectory, 'file'), { recursive: true });
    if (quitting) return;
    /** 附件与视频共用账号和页面授权快照，缓存读取不等于下载授权。 */
    const captureMediaAccess = (): ImageFileAccess => {
      const user = requireLocalUser();
      const generation = documentGeneration;
      const authenticated = getActiveSession();
      /** 本地媒体只读权不因令牌过期而消失，退出和重载则立即撤销。 */
      const validateRead = (): void => {
        if (
          generation !== documentGeneration ||
          requireLocalUser() !== user ||
          getStorageOwner() !== user.id
        )
          throw new Error('视频所属页面或账号已变化');
      };
      /** 下载、上传及文件索引写入仍要求原有效 JWT。 */
      const validateWrite = (): void => {
        validateRead();
        if (!authenticated || requireAuthenticatedSession() !== authenticated)
          throw new Error('登录已过期，无法下载未保存的视频');
      };
      return {
        owner: user.id,
        writable: !getSessionAccess().readOnly,
        validateRead,
        validateWrite,
      };
    };
    attachmentFiles = createAttachmentFileStore(
      storageDirectory,
      captureMediaAccess,
      authorizeMessageDownload,
    );
    fileDrafts = createFileDraftStore(
      import.meta.env.VITE_AUTH_API_BASE?.trim(),
      getClientId(),
      attachmentFiles,
    );
    videoFiles = createVideoFileStore(
      storageDirectory,
      captureMediaAccess,
      fetch,
      videoProcessor,
      authorizeMessageDownload,
    );
    videoDrafts = createVideoDraftStore(
      import.meta.env.VITE_AUTH_API_BASE?.trim(),
      getClientId(),
      videoFiles,
      fetch,
      videoProcessor,
    );
    session.defaultSession.protocol.handle(
      'openchat-video',
      async (request): Promise<Response> => {
        try {
          const url = new URL(request.url);
          if (
            url.hostname !== 'draft' ||
            url.search ||
            url.hash ||
            !['GET', 'HEAD'].includes(request.method)
          )
            return new Response(null, { status: 403 });
          return await videoDrafts!.response(url.pathname.slice(1), request);
        } catch {
          return new Response(null, { status: 403 });
        }
      },
    );
    imageFiles = createImageFileStore(storageDirectory, {
      capture: () => {
        const user = requireLocalUser();
        const generation = documentGeneration;
        const authenticated = getActiveSession();
        /** 原页面、账号及内容库仍须匹配，过期后只允许已有本地文件读取。 */
        const validateRead = (): void => {
          if (
            documentGeneration !== generation ||
            requireLocalUser() !== user ||
            getStorageOwner() !== user.id
          )
            throw new Error('图片所属页面或账号已变化');
        };
        /** 下载和路径更新不能使用已过期或已替换的令牌。 */
        const validateWrite = (): void => {
          validateRead();
          if (!authenticated || requireAuthenticatedSession() !== authenticated)
            throw new Error('登录已过期，无法下载未保存的图片');
        };
        return {
          owner: user.id,
          writable: !getSessionAccess().readOnly,
          validateRead,
          validateWrite,
        };
      },
      authorizeDownload: authorizeMessageDownload,
    });
    initializeDatabase(
      databaseDirectory,
      (mode, owner): void => {
        const user = requireLocalUser();
        if (owner !== user.id) throw new Error('本地数据账号不匹配');
        if (mode === 'write') requireAuthenticatedSession();
      },
      (message): void => {
        imageFiles?.schedule(message);
      },
      (message): void => {
        closeImagePreviews(message.conversationId, message.id);
        closeVideoWindows(message.conversationId, message.id);
        if (message.clientMsgId) {
          if (message.senderId === requireLocalUser().id) {
            videoDrafts?.recall(message.conversationId, message.clientMsgId);
            fileDrafts?.recall(message.conversationId, message.clientMsgId);
          }
          closeImagePreviews(message.conversationId, message.clientMsgId);
          closeVideoWindows(message.conversationId, message.clientMsgId);
        }
        notifyHistoryRecall(message);
      },
    );
    initializeImageOcrProvider();
    setLogLevel(getStoredLogLevel());
    debugMode = getLocalSettings().debugMode;
  } catch (error) {
    if (!quitting)
      dialog.showErrorBox(
        '无法打开本地数据库',
        `数据库目录：${databaseDirectory}\n请确认程序所在目录可写且数据库文件可用。程序将退出，不会自动删除数据或切换存储位置。`,
      );
    throw error;
  }
};

/** 接管已绘制的登录窗口，复用启动入口已验证的目录和单实例锁。 */
export const startMainApplication = async (
  window: BrowserWindow,
  directory: string,
  mark: (stage: string) => void,
): Promise<void> => {
  if (window.isDestroyed()) return;
  storageDirectory = directory;
  markStartup = mark;
  try {
    await initializeElectronDeviceIdentity();
  } catch (error) {
    dialog.showErrorBox(
      '无法初始化设备标识',
      '请检查系统权限后重新启动，未读取任何账号或聊天记录。',
    );
    throw error;
  }
  if (window.isDestroyed()) return;
  app.on('second-instance', activateApplication);
  app.on('window-all-closed', quitWhenWindowsClosed);
  app.on('before-quit', (event) => {
    if (!gracefulQuitStarted) {
      event.preventDefault();
      gracefulQuitStarted = true;
      void finishConversationReads()
        .then(() => closeResourceSse('application-quit'))
        .finally(() => app.quit());
    }
    quitting = true;
    contextMenus?.destroy();
    trayPreview?.reset();
    const handoff = workspaceHandoff;
    workspaceHandoff = undefined;
    handoff?.reject(new Error('应用正在退出'));
    screenshots?.cancel();
    startup.stop();
  });
  app.on('will-quit', () => {
    trayPreview?.destroy();
    trayPreview = undefined;
    applicationTray?.destroy();
    applicationTray = undefined;
    startup.stop();
    videoProcessor.cancel();
    videoFiles?.cancel();
    videoDrafts?.clear();
    attachmentFiles?.cancel();
    fileDrafts?.clear();
    closeVideoWindows();
    closeRtcCallWindows();
    closeSettingsWindow();
    closeUpdateWindow();
    imageFiles?.cancel();
    messageDrag?.clear();
    messageCopy?.clear();
    clearTimeout(expiryTimer);
    stopResourceSse('application-will-quit');
    setResourceSseStatus('stopped');
    clearAuthenticatedSession();
    closeDatabase();
  });
  await initializeApplication(window);
};

const startup = createStartupController({
  readSettings: initializeLocalServices,
  restoreAccounts: async (): Promise<void> => {
    try {
      await restoreSavedSession();
    } catch (error) {
      if (!quitting)
        dialog.showErrorBox(
          '无法恢复本地账号',
          '无法读取加密登录记录。程序将退出，不会删除账号或改用未授权的本地数据。',
        );
      throw error;
    }
  },
  registerServices: registerIpcHandlers,
  notify: (phase): void => {
    markStartup(`local-${phase}`);
    sendWindowNotification(mainWindow, 'startup:phase', phase);
  },
});
