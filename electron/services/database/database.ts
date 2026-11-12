import { mkdirSync } from 'node:fs';
import {
  closePublicDatabase,
  initializePublicDatabase,
} from './database-public';
import type { Message } from '../../../shared/storage/database';
import {
  closeSettingsDatabase,
  initializeSettingsDatabase,
} from './database-settings';
import { closeUserDatabase, initializeUserDatabase } from './database-user';

export type { EncryptedLoginAccount } from './database-settings';
export {
  deleteLoginAccount,
  deleteSavedSession,
  getLocalSettings,
  getStoredLogLevel,
  getStoredOcrProvider,
  readEncryptedSession,
  readLoginAccounts,
  saveDebugMode,
  saveLocalSettings,
  saveStoredLogLevel,
  saveStoredOcrProvider,
  saveLoginAccount,
  writeEncryptedSession,
} from './database-settings';

export type { VideoUploadSource } from './database-user';
export {
  activateProfile,
  acknowledgeConversationDeletion,
  acknowledgeConversationRead,
  acknowledgeConversationFileCleanup,
  addStoredFiles,
  backupCurrentDatabase,
  clearConversation,
  confirmSentMessage,
  deleteConversation,
  deleteLocalMessage,
  deleteCachedEmoji,
  deleteStoredFile,
  findAdjacentImageMessage,
  getAttachmentPath,
  getContact,
  getConversationDeletion,
  getConversationDeletionEpoch,
  getConversationReadCursor,
  getFileMessage,
  getFileUploadSource,
  getHistoryContext,
  getHistoryIconSource,
  getHistoryMessage,
  getHistoryMessageSender,
  getImagePreviewMessage,
  getImageOcrCache,
  getMessageImageLocation,
  getMessageSyncState,
  getRemoteConversation,
  getStorageOwner,
  getVideoFilePath,
  getVideoMessage,
  getVideoPlaybackPosition,
  getVideoUploadMessage,
  getVideoUploadSource,
  listCachedEmojis,
  isClearedMessage,
  isConversationFileReferenced,
  listConversationFileCleanup,
  listPendingConversationDeletions,
  listPendingConversationReads,
  listContacts,
  listConversations,
  listUnreadConversations,
  listMessages,
  listMessageStateIds,
  listStoredFiles,
  listTemporaryMessageIds,
  listUnconfirmedMessages,
  markFileUploadCancelled,
  markVideoUploadCancelled,
  readCachedMessagePage,
  readCachedMessageBatch,
  readOutgoingMessage,
  readRecalledMessageText,
  readMessageReply,
  readHistoryReplyPage,
  observeSavedMessages,
  requireRemoteConversation,
  recordConversationRead,
  setConversationReadServer,
  setConversationNotDisturb,
  setLocalHistoryOnly,
  setGroupRemoved,
  isGroupRemoved,
  saveContact,
  saveConversation,
  saveRemoteConversation,
  saveEmojis,
  saveFileUploadSource,
  saveMessage,
  saveMessageRejection,
  saveIncomingMessage,
  saveImageOcrCache,
  saveMessageSyncPage,
  saveRemoteMessages,
  saveVideoPlaybackProgress,
  saveVideoUploadSource,
  searchMessages,
  setAttachmentPath,
  setConversationTop,
  setMessageImageLocalPath,
  setMessageAutoRetryReason,
  setVideoFilePath,
  updateRemoteConversation,
} from './database-user';

/** 启动只初始化全局设置，用户内容库必须在授权后打开。 */
export const initializeDatabase = (
  directory: string,
  authorize: (mode: 'read' | 'write', owner: string | null) => void,
  onImageSaved?: (message: Message) => void,
  onMessageRecalled?: (message: Message) => void,
): void => {
  initializeUserDatabase(directory, authorize, onImageSaved, onMessageRecalled);
  mkdirSync(directory, { recursive: true });
  try {
    initializeSettingsDatabase(directory);
    initializePublicDatabase(directory);
  } catch (error) {
    closeDatabase();
    throw error;
  }
};

/** 统一关闭用户、共享缓存及设置连接，由 SQLite 处理 WAL 检查点。 */
export const closeDatabase = (): void => {
  closeUserDatabase();
  closePublicDatabase();
  closeSettingsDatabase();
};
