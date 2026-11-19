import type Database from 'better-sqlite3';
import { parseReplyId } from '../../../shared/chat/messages/message-reply';
import { canDeleteMessage } from '../../../shared/chat/messages/message-deletion';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { serverStorageHash } from '../runtime/storage-scope';
import { openDatabase } from './database-connection';
import { localDeviceId } from './database-settings';
import type { HistoryWindowContext } from '../../../shared/windows/desktop';
import type { ChatRoom } from '../../../shared/chat/chat';
import { FILE_ASSISTANT_TYPE } from '../../../shared/chat/chat';
import {
  compareMessageIds,
  isDeletionMessageId,
} from '../../../shared/chat/conversations/conversation-deletion';
import type { ConversationDeletion } from '../../../shared/chat/conversations/conversation-deletion';
import { parseReadMessageId } from '../../../shared/chat/conversations/conversation-read';
import { systemMessageText } from '../../../shared/chat/messages/system-message';
import {
  messageRejectionKey,
  parseMessageRejection,
} from '../../../shared/chat/messages/message-rejection';
import type { PendingConversationRead } from '../../../shared/chat/conversations/conversation-read';
import { parseFileContent } from '../../../shared/media/file/file-message';
import { parseImageContent } from '../../../shared/media/image/image';
import {
  getPublicImageOcrCache,
  savePublicImageOcrCache,
} from './database-public';
import type { ImageOcrResult } from '../../../shared/media/image/image-ocr';
import {
  parseRecallContent,
  shouldKeepRecalledMessage,
} from '../../../shared/chat/messages/recall-message';
import type { UserEmoji } from '../../../shared/chat/emoji';
import { parseEmojiSort } from '../../../shared/chat/emoji';
import {
  parseVideoContent,
  parseVideoPlaybackProgress,
} from '../../../shared/media/video/video';
import type { VideoPlaybackProgress } from '../../../shared/media/video/video';
import type { FileUploadSource } from '../media/file-sources';
import type {
  Contact,
  Conversation,
  ConversationSummary,
  LocalProfile,
  Message,
  IncomingMessageResult,
  MessagePosition,
  MessageSyncState,
  CachedMessagePage,
  HistoryQuery,
  HistoryReplyPage,
  StoredFile,
} from '../../../shared/storage/database';

let contentDatabase: Database.Database | undefined;
let dataDirectory = '';
let ownerKey: string | null = null;
let ownerServerHash: string | null = null;
let imageSaved: ((message: Message) => void) | undefined;
let messageRecalled: ((message: Message) => void) | undefined;
let messageSaved: ((message: Message) => void) | undefined;
let conversationDeletionEpoch = 0;
let conversationReadServer = '';
const localHistoryRooms = new Set<string>();
const removedGroupRooms = new Set<string>();

/** 授权后由主进程绑定可信后端地址，页面不能选择待确认记录的归属。 */
export const setConversationReadServer = (server: string): void => {
  conversationReadServer = server;
};

/** 异步列表用本地代次拒绝清空前发出的旧快照，不作为跨进程删除依据。 */
export const getConversationDeletionEpoch = (): number =>
  conversationDeletionEpoch;

/** 桌面窗口订阅落库后的记录；回调在外层事务完成后读取最终状态。 */
export const observeSavedMessages = (
  listener: (message: Message) => void,
): void => {
  messageSaved = listener;
};
let authorizeContent:
  ((mode: 'read' | 'write', owner: string | null) => void) | undefined;

/** 返回 ISO 8601 时间，统一记录格式。 */
const now = (): string => new Date().toISOString();

/** 按当前预览版表结构初始化内容库，不维护历史版本或迁移脚本。 */
const initializeContentSchema = (db: Database.Database): void => {
  const initialize = db.transaction((): void => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS profile (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        participant_id TEXT,
        avatar TEXT,
        type INTEGER,
        is_top INTEGER NOT NULL DEFAULT 0,
        unread_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conversations_updated
        ON conversations(updated_at DESC, id DESC);
      CREATE TABLE IF NOT EXISTS conversation_preferences (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        not_disturb INTEGER NOT NULL CHECK(not_disturb IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS conversation_hidden (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS conversation_remote_summary (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        text TEXT,
        active_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS conversation_deletions (
        conversation_id TEXT PRIMARY KEY,
        last_delete_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        pending INTEGER NOT NULL CHECK(pending IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS conversation_file_cleanup (
        local_path TEXT PRIMARY KEY
      );
      CREATE TABLE IF NOT EXISTS conversation_read_state (
        server TEXT NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        observed_id TEXT NOT NULL DEFAULT '0',
        acknowledged_id TEXT NOT NULL DEFAULT '0',
        snapshot_id TEXT NOT NULL DEFAULT '0',
        snapshot_read_id TEXT NOT NULL DEFAULT '0',
        snapshot_unread INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(server, conversation_id)
      );
      CREATE INDEX IF NOT EXISTS idx_conversation_read_pending
        ON conversation_read_state(server, conversation_id)
        WHERE CAST(observed_id AS INTEGER) > CAST(acknowledged_id AS INTEGER);
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        client_msg_id TEXT,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id TEXT NOT NULL,
        content TEXT NOT NULL,
        image_local_path TEXT,
        message_type TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        edited_at TEXT,
        deleted_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
        ON messages(conversation_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_client
        ON messages(conversation_id, sender_id, client_msg_id);
      CREATE INDEX IF NOT EXISTS idx_messages_read_position
        ON messages(conversation_id, CAST(id AS INTEGER))
        WHERE status = 'sent' AND deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_messages_deleted_position
        ON messages(conversation_id, CAST(id AS INTEGER))
        WHERE status = 'sent' AND deleted_at IS NOT NULL;
      CREATE TABLE IF NOT EXISTS message_recall_text (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
        content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_auto_retry (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
        reason TEXT NOT NULL CHECK(reason IN ('offline', 'timeout'))
      );
      CREATE TABLE IF NOT EXISTS message_replies (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE ON UPDATE CASCADE,
        reply_id TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS message_sync_state (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        latest_id TEXT,
        older_cursor TEXT,
        oldest_created_at TEXT,
        oldest_id TEXT,
        exhausted INTEGER NOT NULL CHECK(exhausted IN (0, 1))
      );
      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        size INTEGER NOT NULL CHECK(size >= 0),
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        nickname TEXT NOT NULL,
        avatar TEXT,
        signature TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS contact_name_cache (
        contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
        room_id TEXT NOT NULL,
        remark TEXT,
        group_nickname TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(contact_id, room_id)
      );
      CREATE TABLE IF NOT EXISTS emojis (
        img_id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS emoji_hashes (
        img_id TEXT PRIMARY KEY REFERENCES emojis(img_id) ON DELETE CASCADE,
        sha256 TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS emoji_hashes_sha256 ON emoji_hashes(sha256);
      CREATE TABLE IF NOT EXISTS emoji_order (
        img_id TEXT PRIMARY KEY REFERENCES emojis(img_id) ON DELETE CASCADE,
        sort TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS video_files (
        resource_key TEXT PRIMARY KEY,
        local_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS file_upload_sources (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        client_msg_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        source TEXT NOT NULL,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(conversation_id, client_msg_id)
      );
      CREATE TABLE IF NOT EXISTS attachment_files (
        resource_key TEXT PRIMARY KEY,
        local_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS video_playback (
        resource_key TEXT PRIMARY KEY,
        position REAL NOT NULL CHECK(position >= 0),
        duration REAL NOT NULL CHECK(duration > 0 AND position <= duration),
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS video_upload_sources (
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        client_msg_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_name TEXT NOT NULL,
        file_size INTEGER NOT NULL,
        digest TEXT NOT NULL,
        part_digests TEXT NOT NULL,
        duration INTEGER NOT NULL,
        thumb_width INTEGER NOT NULL,
        thumb_height INTEGER NOT NULL,
        poster BLOB NOT NULL CHECK(length(poster) BETWEEN 1 AND 2097152),
        cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK(cancel_requested IN (0, 1)),
        PRIMARY KEY(conversation_id, client_msg_id)
      );
    `);
  });
  initialize();
  try {
    db.prepare('SELECT image_local_path FROM messages LIMIT 0').all();
  } catch {
    throw new Error(
      '本地消息库结构不兼容：缺少图片地址字段。请备份后使用新的内容库；程序不会自动迁移或删除原库。',
    );
  }
};

/** 按服务器摘要与可信 UID 打开独立加密内容库。 */
const openContent = (
  serverHash: string,
  key: string,
  databasePassword: string,
): Database.Database => {
  const directory = path.join(dataDirectory, serverHash);
  mkdirSync(directory, { recursive: true });
  const db = openDatabase(
    path.join(directory, `${key}.sqlite`),
    databasePassword,
  );
  try {
    initializeContentSchema(db);
    db.function(
      'system_message_text',
      { deterministic: true },
      (content: unknown): string =>
        typeof content === 'string' ? systemMessageText(content, key) : '',
    );
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

/** 配置用户库目录和授权回调，不在启动时打开内容库。 */
export const initializeUserDatabase = (
  directory: string,
  authorize: (mode: 'read' | 'write', owner: string | null) => void,
  onImageSaved?: (message: Message) => void,
  onMessageRecalled?: (message: Message) => void,
): void => {
  dataDirectory = directory;
  authorizeContent = authorize;
  imageSaved = onImageSaved;
  messageRecalled = onMessageRecalled;
};

/** 返回当前内容连接；聊天操作必须已选择用户数据空间。 */
const getContentDatabase = (
  mode: 'read' | 'write' = 'write',
): Database.Database => {
  authorizeContent?.(mode, ownerKey);
  if (!contentDatabase || !ownerKey) throw new Error('请先登录再访问本地数据');
  return contentDatabase;
};

/** 关闭用户内容库并清除账号与事件回调，不关闭全局设置库。 */
export const closeUserDatabase = (): void => {
  localHistoryRooms.clear();
  removedGroupRooms.clear();
  contentDatabase?.close();
  contentDatabase = undefined;
  ownerKey = null;
  ownerServerHash = null;
  imageSaved = undefined;
  messageRecalled = undefined;
};

/** 根据可信服务器及用户 ID 切换内容库；相同 UID 的不同服务器不复用连接。 */
export const activateProfile = (profile: LocalProfile | null): void => {
  const serverHash = profile ? serverStorageHash(profile.server) : null;
  if (profile?.id !== ownerKey || serverHash !== ownerServerHash) {
    localHistoryRooms.clear();
    removedGroupRooms.clear();
  }
  if (!profile) {
    contentDatabase?.close();
    contentDatabase = undefined;
    ownerKey = null;
    ownerServerHash = null;
    return;
  }
  authorizeContent?.('write', profile.id);
  const key = profile.id;
  if (!/^[1-9]\d{0,63}$/.test(key)) throw new Error('无效的内容库所属账号');
  const next =
    key === ownerKey && serverHash === ownerServerHash
      ? getContentDatabase()
      : openContent(serverHash!, key, profile.databasePassword);
  try {
    if (profile) {
      next
        .prepare(
          `
        INSERT INTO profile(id, nickname, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET nickname = excluded.nickname,
        updated_at = excluded.updated_at
      `,
        )
        .run(profile.id, profile.nickname, now());
    }
  } catch (error) {
    if (next !== contentDatabase) next.close();
    throw error;
  }
  if (next !== contentDatabase) contentDatabase?.close();
  contentDatabase = next;
  ownerKey = key;
  ownerServerHash = serverHash;
};

/** 返回当前数据空间标识，供异步文件对话框检测账号切换。 */
export const getStorageOwner = (): string | null => ownerKey;

/** 媒体及清理操作使用已打开内容库的服务器范围，不重新读取可变配置。 */
export const getStorageServerHash = (): string => {
  getContentDatabase('read');
  if (!ownerServerHash) throw new Error('请先登录再访问本地数据');
  return ownerServerHash;
};

/** 批量保存原生选择器返回的路径，返回值不向页面泄露绝对路径。 */
export const addStoredFiles = (
  files: { name: string; size: number; path: string }[],
): StoredFile[] => {
  const db = getContentDatabase();
  const insert = db.prepare(`
    INSERT INTO files(name, size, path, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(path) DO UPDATE SET name = excluded.name, size = excluded.size
    RETURNING id, name, size, created_at AS createdAt
  `);
  const save = db.transaction((): StoredFile[] =>
    files.map(
      (file) =>
        insert.get(file.name, file.size, file.path, now()) as StoredFile,
    ),
  );
  return save();
};

/** 按稳定顺序分页读取文件记录，避免一次加载全部历史。 */
export const listStoredFiles = (limit = 100, offset = 0): StoredFile[] => {
  return getContentDatabase('read')
    .prepare(
      `
    SELECT id, name, size, created_at AS createdAt
    FROM files ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset) as StoredFile[];
};

/** 删除指定元数据记录，不触碰磁盘文件。 */
export const deleteStoredFile = (id: number): void => {
  getContentDatabase().prepare('DELETE FROM files WHERE id = ?').run(id);
};

/** 幂等写入对方用户资料，重复拉取时更新昵称、头像与签名。 */
export const saveContact = (contact: Contact): void => {
  const db = getContentDatabase();
  db.transaction((): void => {
    db.prepare(
      `
    INSERT INTO contacts(id, nickname, avatar, signature, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nickname = excluded.nickname,
      avatar = excluded.avatar, signature = excluded.signature,
      updated_at = excluded.updated_at
    WHERE excluded.updated_at >= contacts.updated_at
  `,
    ).run(
      contact.id,
      contact.nickname,
      contact.avatar,
      contact.signature,
      contact.updatedAt,
    );
    const saveName = db.prepare(`
      INSERT INTO contact_name_cache(contact_id, room_id, remark, group_nickname, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(contact_id, room_id) DO UPDATE SET
        remark = excluded.remark, group_nickname = excluded.group_nickname, updated_at = excluded.updated_at
      WHERE excluded.updated_at >= contact_name_cache.updated_at
    `);
    if (contact.nameUpdatedAt)
      saveName.run(
        contact.id,
        '',
        contact.remark ?? null,
        null,
        contact.nameUpdatedAt,
      );
    for (const [roomId, timestamp] of Object.entries(
      contact.groupNamesUpdatedAt ?? {},
    ))
      saveName.run(
        contact.id,
        roomId,
        null,
        contact.groupNicknames?.[roomId] ?? null,
        timestamp,
      );
  })();
};

/** 名称与资料分开缓存，私有备注属于当前账号，群昵称严格按房间索引。 */
const withContactNames = (contact: Contact): Contact => {
  const rows = getContentDatabase('read')
    .prepare(
      `
    SELECT room_id AS roomId, remark, group_nickname AS nickname, updated_at AS updatedAt
    FROM contact_name_cache WHERE contact_id = ?
  `,
    )
    .all(contact.id) as {
    roomId: string;
    remark: string | null;
    nickname: string | null;
    updatedAt: string;
  }[];
  if (!rows.length) return contact;
  const groupNicknames: Record<string, string | null> = {};
  const groupNamesUpdatedAt: Record<string, string> = {};
  for (const row of rows) {
    if (!row.roomId) {
      contact.remark = row.remark;
      contact.nameUpdatedAt = row.updatedAt;
    } else {
      groupNicknames[row.roomId] = row.nickname;
      groupNamesUpdatedAt[row.roomId] = row.updatedAt;
    }
  }
  return { ...contact, groupNicknames, groupNamesUpdatedAt };
};

/** 表情及摘要在同一事务保存；完整同步移除失效收藏，单项添加保留其他记录。 */
export const saveEmojis = (
  emojis: UserEmoji[],
  replace: boolean = false,
): void => {
  const db = getContentDatabase();
  const save = db.prepare(`
    INSERT INTO emojis(img_id, url, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(img_id) DO UPDATE SET url = excluded.url,
      updated_at = excluded.updated_at
    WHERE emojis.url <> excluded.url
  `);
  const saveHash = db.prepare(`
    INSERT INTO emoji_hashes(img_id, sha256) VALUES (?, ?)
    ON CONFLICT(img_id) DO UPDATE SET sha256 = excluded.sha256
    WHERE emoji_hashes.sha256 <> excluded.sha256
  `);
  const saveOrder = db.prepare(`
    INSERT INTO emoji_order(img_id, sort) VALUES (?, ?)
    ON CONFLICT(img_id) DO UPDATE SET sort = excluded.sort
    WHERE emoji_order.sort <> excluded.sort
  `);
  db.transaction((): void => {
    if (replace) {
      const ids = new Set(emojis.map((emoji) => emoji.imgId));
      for (const existing of listCachedEmojis())
        if (!ids.has(existing.imgId))
          db.prepare('DELETE FROM emojis WHERE img_id = ?').run(existing.imgId);
    }
    const timestamp = now();
    for (const emoji of emojis) {
      const sort = parseEmojiSort(emoji.sort);
      save.run(emoji.imgId, emoji.url, timestamp);
      saveOrder.run(emoji.imgId, sort);
      if (emoji.sha256 !== null) saveHash.run(emoji.imgId, emoji.sha256);
      else
        db.prepare('DELETE FROM emoji_hashes WHERE img_id = ?').run(
          emoji.imgId,
        );
    }
  })();
};

/** 删除单个收藏缓存，关联摘要由外键同一语句级联删除。 */
export const deleteCachedEmoji = (imgId: string): void => {
  getContentDatabase()
    .prepare('DELETE FROM emojis WHERE img_id = ?')
    .run(imgId);
};

/** 读取当前账号的本地表情缓存，图片二进制不存入数据库。 */
export const listCachedEmojis = (): UserEmoji[] =>
  getContentDatabase('read')
    .prepare(
      `SELECT e.img_id AS imgId, e.url, h.sha256, COALESCE(o.sort, '0') AS sort
       FROM emojis e LEFT JOIN emoji_hashes h ON h.img_id = e.img_id
       LEFT JOIN emoji_order o ON o.img_id = e.img_id
       ORDER BY CAST(COALESCE(o.sort, '0') AS INTEGER), length(e.img_id), e.img_id`,
    )
    .all() as UserEmoji[];

/** 按对方 uid 读取单条资料，用于消息头像的按需加载。 */
export const getContact = (uid: string): Contact | null => {
  const contact = getContentDatabase('read')
    .prepare(
      `
      SELECT id, nickname, avatar, signature, updated_at AS updatedAt
      FROM contacts WHERE id = ?
    `,
    )
    .get(uid) as Contact | undefined;
  return contact ? withContactNames(contact) : null;
};

/** 按更新时间倒序读取缓存的对方资料。 */
export const listContacts = (): Contact[] => {
  const contacts = getContentDatabase('read')
    .prepare(
      `
    SELECT id, nickname, avatar, signature, updated_at AS updatedAt
    FROM contacts ORDER BY updated_at DESC, id DESC
  `,
    )
    .all() as Contact[];
  return contacts.map(withContactNames);
};

/** 写入会话摘要；远端会话可带完整字段，本地会话缺省时使用默认值。 */
export const saveConversation = (
  input: Pick<Conversation, 'id' | 'title'> &
    Partial<
      Pick<
        Conversation,
        | 'participantId'
        | 'avatar'
        | 'type'
        | 'isTop'
        | 'unreadCount'
        | 'createdAt'
        | 'updatedAt'
      >
    >,
): Conversation => {
  const timestamp = now();
  const participantId = input.participantId ?? null;
  const avatar = input.avatar ?? null;
  const type = input.type ?? null;
  const isTop = input.isTop ?? 0;
  const unreadCount = input.unreadCount ?? 0;
  const createdAt = input.createdAt ?? timestamp;
  const updatedAt = input.updatedAt ?? timestamp;
  return getContentDatabase()
    .prepare(
      `
    INSERT INTO conversations(id, title, participant_id, avatar, type, is_top,
      unread_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title,
      participant_id = excluded.participant_id, avatar = excluded.avatar,
      type = excluded.type, is_top = excluded.is_top,
      unread_count = excluded.unread_count, updated_at = excluded.updated_at
    RETURNING id, title, participant_id AS participantId, avatar, type,
      is_top AS isTop, unread_count AS unreadCount,
      created_at AS createdAt, updated_at AS updatedAt
  `,
    )
    .get(
      input.id,
      input.title,
      participantId,
      avatar,
      type,
      isTop,
      unreadCount,
      createdAt,
      updatedAt,
    ) as Conversation;
};

/** 远端摘要仍可能引用本地已删消息，保存前按本地标记过滤。 */
const saveRemoteSummary = (room: ChatRoom, activeAt: string): boolean => {
  const db = getContentDatabase();
  const deleted =
    room.lastMsgId !== undefined
      ? isClearedMessage(room.roomId, room.lastMsgId)
      : Boolean(
          db
            .prepare(
              `SELECT 1 FROM messages WHERE conversation_id = ?
             AND deleted_at IS NOT NULL AND created_at = ? LIMIT 1`,
            )
            .get(room.roomId, activeAt),
        );
  if (deleted) {
    db.prepare(
      'DELETE FROM conversation_remote_summary WHERE conversation_id = ?',
    ).run(room.roomId);
    return false;
  }
  db.prepare(
    `INSERT INTO conversation_remote_summary(conversation_id, text, active_at)
     VALUES (?, ?, ?)
     ON CONFLICT(conversation_id) DO UPDATE SET
       text = excluded.text, active_at = excluded.active_at`,
  ).run(room.roomId, room.text, activeAt);
  return true;
};

/** 原子保存远端会话及其最新摘要，确保空本地库首次登录也能显示预览。 */
export const saveRemoteConversation = (room: ChatRoom): Conversation => {
  const db = getContentDatabase();
  return db.transaction((): Conversation => {
    const activeAt =
      room.activeTime > 0 ? new Date(room.activeTime).toISOString() : null;
    const conversation = saveConversation({
      id: room.roomId,
      participantId: room.participantId,
      title: room.name || `会话 ${room.roomId}`,
      avatar: room.avatar,
      type: room.type,
      isTop: room.isTop,
      unreadCount: room.unreadCount,
      ...(activeAt ? { createdAt: activeAt, updatedAt: activeAt } : {}),
    });
    if (room.notDisturb !== undefined)
      setConversationNotDisturb(room.roomId, room.notDisturb);
    conversation.notDisturb = requireRemoteConversation(room.roomId).notDisturb;
    if (activeAt) saveRemoteSummary(room, activeAt);
    conversation.unreadCount = reconcileConversationRead(room);
    showConversation(room.roomId);
    return conversation;
  })();
};

/** 原子更新远端会话的置顶状态，保持本地排序与服务端状态一致。 */
export const setConversationTop = (roomId: string, status: 0 | 1): void => {
  const db = getContentDatabase();
  requireRemoteConversation(roomId);
  db.prepare(
    `UPDATE conversations SET is_top = ?
     WHERE id = ? AND type IN (1, 2, 3)`,
  ).run(status, roomId);
};

/** 仅保存服务端确认的免打扰设置，不改变未读、摘要、排序或历史。 */
export const setConversationNotDisturb = (
  roomId: string,
  status: 0 | 1,
): void => {
  if (status !== 0 && status !== 1) throw new Error('会话免打扰状态无效');
  requireRemoteConversation(roomId);
  getContentDatabase()
    .prepare(
      `INSERT INTO conversation_preferences(conversation_id, not_disturb)
       VALUES (?, ?) ON CONFLICT(conversation_id)
       DO UPDATE SET not_disturb = excluded.not_disturb`,
    )
    .run(roomId, status);
};

/** 服务端确认隐藏后持久保存显示状态，保留消息、已读和会话偏好。 */
export const hideConversation = (roomId: string): void => {
  requireRemoteConversation(roomId);
  getContentDatabase()
    .prepare(
      'INSERT INTO conversation_hidden(conversation_id) VALUES (?) ON CONFLICT DO NOTHING',
    )
    .run(roomId);
};

/** 服务端返回可见会话或指定会话详情后，只恢复该会话的显示状态。 */
export const showConversation = (roomId: string): void => {
  getContentDatabase()
    .prepare('DELETE FROM conversation_hidden WHERE conversation_id = ?')
    .run(roomId);
};

/** 分页读取当前用户的会话摘要，置顶优先再按活跃时间倒序。 */
export const listConversations = (
  limit = 50,
  offset = 0,
): ConversationSummary[] => {
  return getContentDatabase('read')
    .prepare(
      `
    SELECT c.id, c.title, c.participant_id AS participantId, c.avatar, c.type,
      c.is_top AS isTop, c.unread_count AS unreadCount,
      COALESCE(p.not_disturb, 0) AS notDisturb,
      c.created_at AS createdAt, c.updated_at AS updatedAt,
      CASE WHEN m.message_type = 'system' AND m.deleted_at IS NULL
        AND (r.conversation_id IS NULL OR m.created_at >= r.active_at) THEN system_message_text(m.content)
        WHEN m.message_type = 'recalled' AND m.deleted_at IS NULL
        AND (r.conversation_id IS NULL OR m.created_at >= r.active_at) THEN m.content
        WHEN r.conversation_id IS NOT NULL
        AND (m.id IS NULL OR m.created_at <= r.active_at) THEN r.text
        WHEN m.deleted_at IS NOT NULL THEN '消息已移除'
        WHEN m.message_type = 'emoji' THEN '[表情包]'
        WHEN m.message_type = 'image' THEN '[图片]'
        WHEN m.message_type = 'audio' THEN '[语音]'
        WHEN m.message_type = 'video' THEN '[视频]'
        WHEN m.message_type = 'rtc-call' THEN '[通话]'
        WHEN m.message_type = 'file' THEN '[文件]'
        WHEN m.message_type = 'recalled' THEN m.content
        WHEN m.message_type = 'system' THEN system_message_text(m.content)
        WHEN m.message_type = 'local-notice' THEN json_extract(m.content, '$.text')
        WHEN m.message_type = 'upload-cancelled' THEN '[已取消发送]'
        WHEN m.message_type = 'temporary' THEN CASE WHEN json_extract(m.content, '$.targetType') = 6 THEN '[文件上传中]' ELSE '[视频上传中]' END
        ELSE substr(m.content, 1, 120) END AS lastMessage,
      CASE WHEN c.type IS NULL OR c.type = 3 OR m.deleted_at IS NOT NULL OR m.message_type IN ('recalled', 'system', 'local-notice') OR
        (r.conversation_id IS NOT NULL AND (m.id IS NULL OR m.created_at <= r.active_at))
        THEN NULL ELSE m.sender_id END AS lastMessageSenderId,
      CASE WHEN m.message_type = 'recalled' AND m.deleted_at IS NULL
        AND (r.conversation_id IS NULL OR m.created_at >= r.active_at)
        THEN 'recalled' ELSE NULL END AS lastMessageType,
      CASE WHEN r.conversation_id IS NULL OR m.created_at >= r.active_at
        THEN m.id ELSE NULL END AS lastMessageId,
      CASE WHEN r.conversation_id IS NOT NULL AND (m.id IS NULL OR m.created_at <= r.active_at)
        THEN r.active_at ELSE m.created_at END AS lastMessageCreatedAt
    FROM conversations c
    LEFT JOIN conversation_preferences p ON p.conversation_id = c.id
    LEFT JOIN conversation_remote_summary r ON r.conversation_id = c.id
    LEFT JOIN messages m ON m.id = (
      SELECT id FROM messages WHERE conversation_id = c.id AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC LIMIT 1
    )
    WHERE NOT EXISTS (SELECT 1 FROM conversation_hidden h WHERE h.conversation_id = c.id)
    ORDER BY c.is_top DESC, c.updated_at DESC, c.id DESC LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset) as ConversationSummary[];
};

/** 分页读取托盘需要的未读会话，不查询消息正文或推进阅读位置。 */
export const listUnreadConversations = (
  limit: number = 200,
  offset: number = 0,
): Pick<
  Conversation,
  'id' | 'title' | 'avatar' | 'type' | 'unreadCount' | 'updatedAt'
>[] =>
  getContentDatabase('read')
    .prepare(
      `
    SELECT id, title, avatar, type, unread_count AS unreadCount, updated_at AS updatedAt
    FROM conversations WHERE unread_count > 0 AND type IN (1, 2)
      AND NOT EXISTS (SELECT 1 FROM conversation_preferences p
        WHERE p.conversation_id = conversations.id AND p.not_disturb = 1)
      AND NOT EXISTS (SELECT 1 FROM conversation_hidden h
        WHERE h.conversation_id = conversations.id)
    ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?
  `,
    )
    .all(limit, offset) as Pick<
    Conversation,
    'id' | 'title' | 'avatar' | 'type' | 'unreadCount' | 'updatedAt'
  >[];

/** 确认当前内容库中存在可刷新详情的远端会话。 */
export const getRemoteConversation = (roomId: string): Conversation | null => {
  const conversation = getContentDatabase('read')
    .prepare(
      `
    SELECT id, title, participant_id AS participantId, avatar, type,
      is_top AS isTop, unread_count AS unreadCount,
      COALESCE((SELECT not_disturb FROM conversation_preferences WHERE conversation_id = conversations.id), 0) AS notDisturb,
      created_at AS createdAt, updated_at AS updatedAt
    FROM conversations WHERE id = ? AND type IN (1, 2, 3)
  `,
    )
    .get(roomId) as Conversation | undefined;
  return conversation ?? null;
};

/** 确认当前内容库中存在可刷新详情的远端会话。 */
export const requireRemoteConversation = (roomId: string): Conversation => {
  const conversation = getRemoteConversation(roomId);
  if (!conversation) throw new Error('远端会话不存在，请刷新会话列表');
  return conversation;
};

interface ConversationReadRow {
  observedId: string;
  acknowledgedId: string;
  snapshotId: string;
  snapshotReadId: string;
  snapshotUnread: number;
}

/** 读取已绑定后端的阅读水位，账号隔离继续由内容库授权负责。 */
const readConversationPosition = (
  roomId: string,
): ConversationReadRow | undefined =>
  getContentDatabase('read')
    .prepare(
      `SELECT observed_id AS observedId, acknowledged_id AS acknowledgedId,
        snapshot_id AS snapshotId, snapshot_read_id AS snapshotReadId,
        snapshot_unread AS snapshotUnread FROM conversation_read_state
       WHERE server = ? AND conversation_id = ?`,
    )
    .get(conversationReadServer, roomId) as ConversationReadRow | undefined;

/** 仅比较校验过的十进制 ID，不转 JavaScript Number。 */
const greaterReadId = (left: string, right: string): string =>
  compareMessageIds(left, right) >= 0 ? left : right;

/** 返回本账号当前有效阅读位置，不将尚未提交的本地已读误作未读。 */
export const getConversationReadCursor = (
  roomId: string,
): string | undefined => {
  requireRemoteConversation(roomId);
  const state = readConversationPosition(roomId);
  return state
    ? greaterReadId(state.observedId, state.acknowledgedId)
    : undefined;
};

/** 统计本地真实可见的对方消息，用于扣除已阅读区间和补入快照之后的实时消息。 */
const countReadRange = (
  roomId: string,
  after: string,
  through: string,
): number => {
  const row = getContentDatabase('read')
    .prepare(
      `SELECT COUNT(*) AS total FROM messages
       WHERE conversation_id = ? AND sender_id <> ? AND status = 'sent'
         AND deleted_at IS NULL AND id NOT GLOB '*[^0-9]*' AND id <> ''
         AND CAST(id AS INTEGER) > CAST(? AS INTEGER)
         AND CAST(id AS INTEGER) <= CAST(? AS INTEGER)`,
    )
    .get(roomId, ownerKey, after, through) as { total: number };
  return row.total;
};

/** 服务端未读包含本地已删消息，按原快照区间扣除，不改服务端快照值。 */
const countDeletedRange = (
  roomId: string,
  after: string,
  through: string,
): number => {
  const row = getContentDatabase('read')
    .prepare(
      `SELECT COUNT(*) AS total FROM messages
       WHERE conversation_id = ? AND sender_id <> ? AND status = 'sent'
         AND deleted_at IS NOT NULL AND id NOT GLOB '*[^0-9]*' AND id <> ''
         AND CAST(id AS INTEGER) > CAST(? AS INTEGER)
         AND CAST(id AS INTEGER) <= CAST(? AS INTEGER)`,
    )
    .get(roomId, ownerKey, after, through) as { total: number };
  return row.total;
};

/** 从持久化快照和单调阅读水位重算角标，旧详情不能恢复已经读过的消息。 */
const updateReadUnread = (roomId: string): number => {
  const state = readConversationPosition(roomId);
  const conversation = requireRemoteConversation(roomId);
  if (!state) return conversation.unreadCount;
  const read = greaterReadId(state.observedId, state.acknowledgedId);
  let unread = 0;
  if (conversation.type !== FILE_ASSISTANT_TYPE) {
    if (compareMessageIds(state.snapshotId, read) > 0)
      unread = Math.max(
        0,
        state.snapshotUnread -
          countReadRange(roomId, state.snapshotReadId, read) -
          countDeletedRange(roomId, state.snapshotReadId, state.snapshotId),
      );
    unread += countReadRange(
      roomId,
      greaterReadId(read, state.snapshotId),
      '9223372036854775807',
    );
  }
  getContentDatabase()
    .prepare('UPDATE conversations SET unread_count = ? WHERE id = ?')
    .run(unread, roomId);
  return unread;
};

/** 保存单调的服务端快照；新接口缺省时保留原有计数，不伪造确认。 */
const reconcileConversationRead = (room: ChatRoom): number => {
  if (
    !conversationReadServer ||
    room.lastMsgId === undefined ||
    room.lastReadMsgId === undefined
  )
    return room.unreadCount;
  const previous = readConversationPosition(room.roomId);
  const replace =
    !previous ||
    (compareMessageIds(room.lastMsgId, previous.snapshotId) >= 0 &&
      compareMessageIds(room.lastReadMsgId, previous.snapshotReadId) >= 0);
  getContentDatabase()
    .prepare(
      `INSERT INTO conversation_read_state(server, conversation_id, acknowledged_id,
         snapshot_id, snapshot_read_id, snapshot_unread) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(server, conversation_id) DO UPDATE SET
         acknowledged_id = excluded.acknowledged_id, snapshot_id = excluded.snapshot_id,
         snapshot_read_id = excluded.snapshot_read_id, snapshot_unread = excluded.snapshot_unread`,
    )
    .run(
      conversationReadServer,
      room.roomId,
      greaterReadId(previous?.acknowledgedId ?? '0', room.lastReadMsgId),
      replace ? room.lastMsgId : previous!.snapshotId,
      replace ? room.lastReadMsgId : previous!.snapshotReadId,
      replace ? room.unreadCount : previous!.snapshotUnread,
    );
  return updateReadUnread(room.roomId);
};

/** 实际展示后立即持久化阅读水位；请求失败或退出不丢失待确认进度。 */
export const recordConversationRead = (
  roomId: string,
  messageId: string,
): number => {
  parseReadMessageId(roomId);
  parseReadMessageId(messageId);
  if (!conversationReadServer) throw new Error('已读同步尚未绑定服务器');
  const db = getContentDatabase();
  return db.transaction((): number => {
    requireRemoteConversation(roomId);
    const message = getHistoryMessage(roomId, messageId);
    if (message.status !== 'sent' || message.deletedAt)
      throw new Error('只能确认已展示的服务端消息');
    const previous = readConversationPosition(roomId);
    if (compareMessageIds(messageId, previous?.observedId ?? '0') <= 0)
      return requireRemoteConversation(roomId).unreadCount;
    db.prepare(
      `INSERT INTO conversation_read_state(server, conversation_id, observed_id)
       VALUES (?, ?, ?) ON CONFLICT(server, conversation_id)
       DO UPDATE SET observed_id = excluded.observed_id`,
    ).run(conversationReadServer, roomId, messageId);
    return updateReadUnread(roomId);
  })();
};

/** 稳定分页只消费有新阅读进度的会话，不轮询所有会话或读取聊天正文。 */
export const listPendingConversationReads = (
  after: string = '',
): PendingConversationRead[] =>
  getContentDatabase('read')
    .prepare(
      `SELECT conversation_id AS conversationId, observed_id AS lastReadMsgId
       FROM conversation_read_state WHERE server = ? AND conversation_id > ?
         AND CAST(observed_id AS INTEGER) > CAST(acknowledged_id AS INTEGER)
       ORDER BY conversation_id LIMIT 50`,
    )
    .all(conversationReadServer, after) as PendingConversationRead[];

/** 旧响应只推进已确认水位，绝不覆盖请求期间新增的 observed_id。 */
export const acknowledgeConversationRead = (
  read: PendingConversationRead,
  acknowledgedId: string,
): number | null => {
  parseReadMessageId(acknowledgedId);
  const db = getContentDatabase();
  return db.transaction((): number | null => {
    const state = readConversationPosition(read.conversationId);
    if (!state) return null;
    db.prepare(
      `UPDATE conversation_read_state SET acknowledged_id = ?
       WHERE server = ? AND conversation_id = ?`,
    ).run(
      greaterReadId(state.acknowledgedId, acknowledgedId),
      conversationReadServer,
      read.conversationId,
    );
    return updateReadUnread(read.conversationId);
  })();
};

/** 原子刷新会话详情与服务器摘要，保留关联用户及创建时间，不伪造聊天消息。 */
export const updateRemoteConversation = (
  room: ChatRoom,
): ConversationSummary => {
  const db = getContentDatabase();
  return db.transaction((): ConversationSummary => {
    const activeAt = new Date(room.activeTime).toISOString();
    const previous = requireRemoteConversation(room.roomId);
    const conversation = saveConversation({
      ...previous,
      participantId: room.participantId,
      title: room.name || `会话 ${room.roomId}`,
      avatar: room.avatar,
      type: room.type,
      isTop: room.isTop,
      unreadCount: room.unreadCount,
      updatedAt: activeAt,
    });
    if (room.notDisturb !== undefined)
      setConversationNotDisturb(room.roomId, room.notDisturb);
    conversation.notDisturb = requireRemoteConversation(room.roomId).notDisturb;
    conversation.unreadCount = reconcileConversationRead(room);
    showConversation(room.roomId);
    const hasRemoteSummary = saveRemoteSummary(room, activeAt);
    const latest = db
      .prepare(
        `
      SELECT id, CASE WHEN deleted_at IS NOT NULL THEN '消息已移除'
        WHEN message_type = 'emoji' THEN '[表情包]'
        WHEN message_type = 'image' THEN '[图片]'
        WHEN message_type = 'audio' THEN '[语音]'
        WHEN message_type = 'video' THEN '[视频]'
        WHEN message_type = 'rtc-call' THEN '[通话]'
        WHEN message_type = 'file' THEN '[文件]'
        WHEN message_type = 'recalled' THEN content
        WHEN message_type = 'system' THEN system_message_text(content)
        WHEN message_type = 'local-notice' THEN json_extract(content, '$.text')
        WHEN message_type = 'upload-cancelled' THEN '[已取消发送]'
        WHEN message_type = 'temporary' THEN CASE WHEN json_extract(content, '$.targetType') = 6 THEN '[文件上传中]' ELSE '[视频上传中]' END
        ELSE substr(content, 1, 120) END AS content, created_at AS createdAt,
        CASE WHEN deleted_at IS NOT NULL OR message_type IN ('recalled', 'system', 'local-notice') THEN NULL ELSE sender_id END AS senderId,
        CASE WHEN deleted_at IS NULL THEN message_type ELSE NULL END AS messageType
      FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
        AND (? = 0 OR created_at >= ?)
      ORDER BY created_at DESC, id DESC LIMIT 1
    `,
      )
      .get(room.roomId, Number(hasRemoteSummary), activeAt) as
      | {
          id: string;
          content: string;
          createdAt: string;
          senderId: string | null;
          messageType: string | null;
        }
      | undefined;
    const useLocal =
      latest &&
      (!hasRemoteSummary ||
        latest.createdAt > activeAt ||
        latest.messageType === 'recalled' ||
        latest.messageType === 'system');
    if (latest && latest.createdAt > activeAt) {
      db.prepare('UPDATE conversations SET updated_at = ? WHERE id = ?').run(
        latest.createdAt,
        room.roomId,
      );
      conversation.updatedAt = latest.createdAt;
    }
    let lastMessage = hasRemoteSummary ? room.text : null;
    if (useLocal) lastMessage = latest.content;
    return {
      ...conversation,
      lastMessage,
      lastMessageSenderId:
        room.type !== FILE_ASSISTANT_TYPE && useLocal ? latest.senderId : null,
      lastMessageType: useLocal ? latest.messageType : null,
      lastMessageId: latest?.id ?? null,
      lastMessageCreatedAt: latest?.createdAt ?? activeAt,
    };
  })();
};

/** 删除会话及其消息，外键级联确保不会残留孤立记录。 */
type ConversationFileReference = {
  localPath: string;
  resourceKey: string | null;
  table: 'attachment_files' | 'video_files' | null;
};

type MessageResourceReferences = {
  paths: Set<string>;
  keys: Set<string>;
};

/** 删除本地会话记录，保留应用缓存文件以兼容原有删除会话语义。 */
export const deleteConversation = (id: string): void => {
  getContentDatabase()
    .prepare('DELETE FROM conversations WHERE id = ?')
    .run(id);
  localHistoryRooms.delete(id);
  removedGroupRooms.delete(id);
};

/** 删除边界独立于会话保存，服务端确认后仍用于阻止迟到消息回流。 */
export const getConversationDeletion = (
  conversationId: string,
): ConversationDeletion | null =>
  (getContentDatabase('read')
    .prepare(
      `SELECT conversation_id AS conversationId, last_delete_id AS lastDeleteId,
         revision, pending FROM conversation_deletions WHERE conversation_id = ?`,
    )
    .get(conversationId) as ConversationDeletion | undefined) ?? null;

/** 持久删除标记优先过滤，数字消息 ID 另外受会话清空边界约束。 */
export const isClearedMessage = (
  conversationId: string,
  messageId: string,
): boolean => {
  const deleted = getContentDatabase('read')
    .prepare(
      `SELECT 1 FROM messages WHERE conversation_id = ? AND id = ?
       AND deleted_at IS NOT NULL`,
    )
    .get(conversationId, messageId);
  if (deleted) return true;
  if (!isDeletionMessageId(messageId)) return false;
  const state = getConversationDeletion(conversationId);
  return (
    state !== null && compareMessageIds(messageId, state.lastDeleteId) <= 0
  );
};

/** 分批读取当前账号待同步的删除操作，不依赖会话是否仍存在。 */
export const listPendingConversationDeletions = (
  after: string = '',
): ConversationDeletion[] =>
  getContentDatabase('read')
    .prepare(
      `SELECT conversation_id AS conversationId, last_delete_id AS lastDeleteId,
         revision, pending FROM conversation_deletions
       WHERE pending = 1 AND conversation_id > ? ORDER BY conversation_id LIMIT 50`,
    )
    .all(after) as ConversationDeletion[];

/** 只确认本次发送的版本，清空期间生成的新操作留给下一轮。 */
export const acknowledgeConversationDeletion = (
  deletion: ConversationDeletion,
): void => {
  getContentDatabase()
    .prepare(
      `UPDATE conversation_deletions SET pending = 0
       WHERE conversation_id = ? AND revision = ?`,
    )
    .run(deletion.conversationId, deletion.revision);
};

/** 文件删除失败或进程退出后仍保留清理队列，供下一次授权重试。 */
export const listConversationFileCleanup = (): string[] =>
  (
    getContentDatabase('read')
      .prepare('SELECT local_path AS localPath FROM conversation_file_cleanup')
      .all() as { localPath: string }[]
  ).map((item) => item.localPath);

/** 只在文件已删除或被其他消息重新引用后消费清理记录。 */
export const acknowledgeConversationFileCleanup = (localPath: string): void => {
  getContentDatabase()
    .prepare('DELETE FROM conversation_file_cleanup WHERE local_path = ?')
    .run(localPath);
};

/** 清理前再次核对当前索引及消息，避免删除后来重新下载或共享的缓存。 */
export const isConversationFileReferenced = (localPath: string): boolean => {
  const db = getContentDatabase('read');
  const original = localPath.endsWith('.play.mp4')
    ? localPath.slice(0, -'.play.mp4'.length)
    : localPath;
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM messages WHERE image_local_path = ?
       UNION ALL SELECT 1 FROM attachment_files WHERE local_path = ?
       UNION ALL SELECT 1 FROM video_files WHERE local_path = ? LIMIT 1`,
      )
      .get(original, original, original),
  );
};

/** 读取消息引用的本地媒体路径，资源键使用 URL 摘要而不是消息 ID。 */
const readMessageResourceReferences = (
  db: Database.Database,
  conversationId?: string,
): MessageResourceReferences => {
  const rows = (
    conversationId
      ? db
          .prepare(
            `SELECT message_type AS messageType, content,
               image_local_path AS imageLocalPath
             FROM messages WHERE conversation_id = ?`,
          )
          .all(conversationId)
      : db
          .prepare(
            `SELECT message_type AS messageType, content,
               image_local_path AS imageLocalPath
             FROM messages`,
          )
          .all()
  ) as {
    messageType: string;
    content: string;
    imageLocalPath: string | null;
  }[];
  const paths = new Set<string>();
  const keys = new Set<string>();
  const addResource = (
    table: 'attachment_files' | 'video_files',
    url: string | null,
  ): void => {
    if (!url) return;
    keys.add(`${table}:${createHash('sha256').update(url).digest('hex')}`);
  };
  for (const row of rows) {
    if (row.imageLocalPath) paths.add(row.imageLocalPath);
    if (row.messageType === 'file') {
      const file = parseFileContent(row.content);
      addResource('attachment_files', file?.url ?? null);
    }
    if (row.messageType === 'video') {
      const video = parseVideoContent(row.content);
      addResource('video_files', video?.url ?? null);
      addResource('video_files', video?.thumbUrl ?? null);
    }
  }
  return { paths, keys };
};

/** 清空本地会话并保留已知消息边界；服务端已清空时不新增远端清空待办。 */
export const clearConversation = (
  id: string,
  remoteCleared: boolean = false,
): string[] => {
  const db = getContentDatabase();
  const remove = db.transaction((): string[] => {
    const conversation = db
      .prepare('SELECT type FROM conversations WHERE id = ?')
      .get(id) as { type: number | null } | undefined;
    if (!conversation && !remoteCleared) throw new Error('会话不存在');
    if (remoteCleared || conversation?.type !== null) {
      const previous = getConversationDeletion(id);
      let lastDeleteId = previous?.lastDeleteId ?? '0';
      const ids = db
        .prepare(
          `SELECT id FROM messages WHERE conversation_id = ?
           UNION ALL SELECT latest_id AS id FROM message_sync_state
           WHERE conversation_id = ? AND latest_id IS NOT NULL`,
        )
        .all(id, id) as { id: string }[];
      for (const message of ids) {
        if (
          isDeletionMessageId(message.id) &&
          compareMessageIds(message.id, lastDeleteId) > 0
        )
          lastDeleteId = message.id;
      }
      db.prepare(
        `INSERT INTO conversation_deletions(conversation_id, last_delete_id, revision, pending)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET last_delete_id = excluded.last_delete_id,
           revision = excluded.revision, pending = excluded.pending`,
      ).run(
        id,
        lastDeleteId,
        randomUUID(),
        remoteCleared ? (previous?.pending ?? 0) : 1,
      );
    }
    const rows = db
      .prepare(
        `SELECT message_type AS messageType, content,
           image_local_path AS imageLocalPath
         FROM messages WHERE conversation_id = ?`,
      )
      .all(id) as {
      messageType: string;
      content: string;
      imageLocalPath: string | null;
    }[];
    const candidates: ConversationFileReference[] = [];
    const addIndexedPath = (
      table: 'attachment_files' | 'video_files',
      url: string | null,
    ): void => {
      if (!url) return;
      const resourceKey = createHash('sha256').update(url).digest('hex');
      const row = db
        .prepare(
          `SELECT local_path AS localPath FROM ${table}
           WHERE resource_key = ?`,
        )
        .get(resourceKey) as { localPath: string } | undefined;
      if (row)
        candidates.push({ localPath: row.localPath, resourceKey, table });
    };
    for (const row of rows) {
      if (row.imageLocalPath)
        candidates.push({
          localPath: row.imageLocalPath,
          resourceKey: null,
          table: null,
        });
      if (row.messageType === 'file') {
        const file = parseFileContent(row.content);
        addIndexedPath('attachment_files', file?.url ?? null);
      }
      if (row.messageType === 'video') {
        const video = parseVideoContent(row.content);
        addIndexedPath('video_files', video?.url ?? null);
        addIndexedPath('video_files', video?.thumbUrl ?? null);
      }
    }

    db.prepare('DELETE FROM conversations WHERE id = ?').run(id);
    const remaining = readMessageResourceReferences(db);
    const paths = new Set<string>();
    const deleteIndexed = new Set<string>();
    for (const candidate of candidates) {
      const scope = candidate.resourceKey
        ? `${candidate.table}:${candidate.resourceKey}`
        : null;
      if (
        !remaining.paths.has(candidate.localPath) &&
        (!scope || !remaining.keys.has(scope))
      ) {
        paths.add(candidate.localPath);
        if (candidate.table === 'video_files')
          paths.add(`${candidate.localPath}.play.mp4`);
        if (scope) deleteIndexed.add(scope);
      }
    }
    for (const scope of deleteIndexed) {
      const separator = scope.indexOf(':');
      const table = scope.slice(0, separator);
      const resourceKey = scope.slice(separator + 1);
      db.prepare(`DELETE FROM ${table} WHERE resource_key = ?`).run(
        resourceKey,
      );
      if (table === 'video_files')
        db.prepare('DELETE FROM video_playback WHERE resource_key = ?').run(
          resourceKey,
        );
    }
    const enqueueFile = db.prepare(
      'INSERT INTO conversation_file_cleanup(local_path) VALUES (?) ON CONFLICT DO NOTHING',
    );
    for (const localPath of paths) enqueueFile.run(localPath);
    return [...paths];
  });
  const paths = remove();
  localHistoryRooms.delete(id);
  removedGroupRooms.delete(id);
  conversationDeletionEpoch++;
  return paths;
};

/** 幂等写入消息并更新会话时间，禁止移动既有消息到其他会话。 */
export const saveMessage = (message: Message): boolean => {
  const db = getContentDatabase();
  if (isClearedMessage(message.conversationId, message.id)) return false;
  const recallOwner = ownerKey;
  let newlyRecalled = false;
  let persisted = false;
  const save = db.transaction((): void => {
    let replyId = parseReplyId(message.replyId);
    if (message.replyId === undefined)
      replyId =
        (
          db
            .prepare(
              'SELECT reply_id AS replyId FROM message_replies WHERE message_id = ?',
            )
            .get(message.id) as { replyId: string } | undefined
        )?.replyId ?? null;
    const remoteUrl =
      message.messageType === 'image'
        ? (parseImageContent(message.content)?.url ?? null)
        : null;
    let localPath: string | null = null;
    const existing = db
      .prepare(
        `SELECT id, conversation_id AS conversationId, sender_id AS senderId,
          status, message_type AS messageType, deleted_at AS deletedAt, content,
          image_local_path AS localPath FROM messages WHERE id = ?`,
      )
      .get(message.id) as
      | {
          id: string;
          conversationId: string;
          senderId: string;
          status: string;
          messageType: string;
          deletedAt: string | null;
          content: string;
          localPath: string | null;
        }
      | undefined;
    if (existing && existing.conversationId !== message.conversationId) {
      throw new Error('不能更改已有消息所属的会话');
    }
    if (existing && existing.senderId !== message.senderId)
      throw new Error('不能更改已有消息的发送者');
    // 本地提示一经保存即保留原记录，不接受同步、发送确认或普通消息写入覆盖。
    if (existing?.messageType === 'local-notice') return;
    if (shouldKeepRecalledMessage(existing, message)) return;
    newlyRecalled =
      message.messageType === 'recalled' &&
      (existing?.messageType !== 'recalled' ||
        existing.content !== message.content);
    // 取消态阻止迟到上传恢复，但服务端撤回仍可覆盖。
    if (
      existing?.messageType === 'upload-cancelled' &&
      message.messageType !== 'upload-cancelled' &&
      message.messageType !== 'recalled'
    )
      return;
    if (
      message.messageType === 'temporary' &&
      existing &&
      existing.messageType !== 'temporary'
    )
      return;
    let deletedAt = existing?.deletedAt ?? message.deletedAt;
    let editText =
      existing?.messageType === 'text' && !existing.deletedAt
        ? existing.content
        : null;
    if (
      remoteUrl &&
      existing &&
      parseImageContent(existing.content)?.url === remoteUrl
    )
      localPath = existing.localPath;
    if (
      existing?.status === 'sent' &&
      (message.status === 'pending' || message.status === 'failed')
    )
      return;
    if (message.clientMsgId) {
      const local = db
        .prepare(
          `
          SELECT id, status, message_type AS messageType, deleted_at AS deletedAt, content,
            image_local_path AS localPath
          FROM messages
          WHERE client_msg_id = ? AND conversation_id = ? AND sender_id = ?
        `,
        )
        .all(message.clientMsgId, message.conversationId, message.senderId) as {
        id: string;
        status: string;
        messageType: string;
        deletedAt: string | null;
        content: string;
        localPath: string | null;
      }[];
      if (local.some((item) => item.deletedAt)) return;
      if (
        message.messageType !== 'recalled' &&
        local.some((item) => item.messageType === 'recalled')
      )
        return;
      if (
        message.messageType !== 'upload-cancelled' &&
        message.messageType !== 'recalled' &&
        local.some((item) => item.messageType === 'upload-cancelled')
      )
        return;
      if (
        message.messageType === 'temporary' &&
        local.some((item) => item.messageType !== 'temporary')
      )
        return;
      if (
        (message.status === 'pending' || message.status === 'failed') &&
        local.some((item) => item.status === 'sent')
      )
        return;
      if (message.status === 'sent') {
        for (const duplicate of local) {
          if (message.replyId === undefined && replyId === null)
            replyId =
              (
                db
                  .prepare(
                    'SELECT reply_id AS replyId FROM message_replies WHERE message_id = ?',
                  )
                  .get(duplicate.id) as { replyId: string } | undefined
              )?.replyId ?? null;
          deletedAt ??= duplicate.deletedAt;
          if (duplicate.messageType === 'text' && !duplicate.deletedAt)
            editText ??= duplicate.content;
          if (
            remoteUrl &&
            parseImageContent(duplicate.content)?.url === remoteUrl
          ) {
            localPath ??= duplicate.localPath;
          }
          if (duplicate.id !== message.id)
            db.prepare('DELETE FROM messages WHERE id = ?').run(duplicate.id);
        }
      }
    }
    db.prepare(
      `
      INSERT INTO messages(id, client_msg_id, conversation_id, sender_id,
        content, message_type, status, created_at, edited_at, deleted_at, image_local_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET client_msg_id = excluded.client_msg_id,
        sender_id = excluded.sender_id, content = excluded.content,
        message_type = excluded.message_type, status = excluded.status,
        created_at = excluded.created_at,
        edited_at = excluded.edited_at, deleted_at = excluded.deleted_at,
        image_local_path = excluded.image_local_path
    `,
    ).run(
      message.id,
      message.clientMsgId,
      message.conversationId,
      message.senderId,
      deletedAt ? '' : message.content,
      message.messageType,
      message.status,
      message.createdAt,
      message.editedAt,
      deletedAt,
      deletedAt ? null : localPath,
    );
    if (replyId !== null && !deletedAt && message.messageType !== 'recalled')
      db.prepare(
        `INSERT INTO message_replies(message_id, reply_id) VALUES (?, ?)
         ON CONFLICT(message_id) DO UPDATE SET reply_id = excluded.reply_id`,
      ).run(message.id, replyId);
    else
      db.prepare('DELETE FROM message_replies WHERE message_id = ?').run(
        message.id,
      );
    if (message.status === 'sent' || deletedAt)
      db.prepare('DELETE FROM message_auto_retry WHERE message_id = ?').run(
        message.id,
      );
    else if (message.autoRetryReason !== undefined)
      setMessageAutoRetryReason(
        message.conversationId,
        message.clientMsgId ?? '',
        message.autoRetryReason,
      );
    // 撤回正文仍只保存公开身份；本人的文本副本单独保留，不进入历史搜索或推送。
    if (
      !deletedAt &&
      message.messageType === 'recalled' &&
      message.status === 'sent' &&
      message.senderId === ownerKey &&
      parseRecallContent(message.content).recallUid === ownerKey
    ) {
      if (editText !== null)
        db.prepare(
          'INSERT INTO message_recall_text(message_id, content) VALUES (?, ?) ON CONFLICT(message_id) DO NOTHING',
        ).run(message.id, editText);
    } else {
      db.prepare('DELETE FROM message_recall_text WHERE message_id = ?').run(
        message.id,
      );
    }
    persisted = true;
    db.prepare(
      `
      UPDATE conversations SET updated_at = MAX(updated_at, ?) WHERE id = ?
    `,
    ).run(
      message.editedAt ?? message.deletedAt ?? message.createdAt,
      message.conversationId,
    );
  });
  save();
  if (persisted && messageSaved)
    queueMicrotask((): void => {
      if (contentDatabase !== db || ownerKey !== recallOwner || !messageSaved)
        return;
      let current: Message;
      try {
        current = getHistoryMessage(message.conversationId, message.id);
      } catch {
        return;
      }
      messageSaved(current);
    });
  if (newlyRecalled)
    queueMicrotask((): void => {
      if (
        contentDatabase !== db ||
        ownerKey !== recallOwner ||
        !messageRecalled
      )
        return;
      try {
        const current = getHistoryMessage(message.conversationId, message.id);
        if (current.messageType === 'recalled') messageRecalled(current);
      } catch {
        // 外层事务回滚、删除会话或退出后不向旧窗口发通知。
      }
    });
  if (persisted && message.messageType === 'image' && !message.deletedAt)
    imageSaved?.(message);
  return persisted;
};

/** 实时消息与未读增量原子落库，历史、重复推送和原位更新不会重复计数。 */
export const saveIncomingMessage = (
  message: Message,
  incrementUnread: boolean,
): IncomingMessageResult & { newUnreadMessage: boolean } => {
  const db = getContentDatabase();
  if (message.status !== 'sent') throw new Error('接收消息必须已由服务端确认');
  return db.transaction(
    (): IncomingMessageResult & { newUnreadMessage: boolean } => {
      const conversation = requireRemoteConversation(message.conversationId);
      const existing = db
        .prepare(
          `SELECT 1 FROM messages
         WHERE id = ? OR (conversation_id = ? AND sender_id = ? AND client_msg_id = ?)
         LIMIT 1`,
        )
        .get(
          message.id,
          message.conversationId,
          message.senderId,
          message.clientMsgId,
        );
      const saved = saveMessage(message);
      const readState = readConversationPosition(message.conversationId);
      if (
        saved &&
        !existing &&
        (incrementUnread || readState !== undefined) &&
        message.senderId !== ownerKey &&
        !message.deletedAt &&
        message.messageType !== 'recalled' &&
        message.messageType !== 'upload-cancelled' &&
        conversation.type !== FILE_ASSISTANT_TYPE &&
        (!readState ||
          compareMessageIds(
            message.id,
            greaterReadId(
              readState.snapshotId,
              greaterReadId(readState.observedId, readState.acknowledgedId),
            ),
          ) > 0)
      )
        db.prepare(
          `UPDATE conversations SET unread_count = MIN(unread_count + 1, ?)
         WHERE id = ?`,
        ).run(Number.MAX_SAFE_INTEGER, message.conversationId);
      const unreadCount = requireRemoteConversation(
        message.conversationId,
      ).unreadCount;
      return {
        saved,
        unreadCount,
        // 新房间同步可能已计入本条消息，不能仅凭落库前后的未读差额判定新提醒。
        newUnreadMessage:
          saved &&
          !existing &&
          unreadCount > 0 &&
          message.senderId !== ownerKey &&
          !message.deletedAt &&
          message.messageType !== 'recalled' &&
          message.messageType !== 'upload-cancelled' &&
          conversation.type !== FILE_ASSISTANT_TYPE,
      };
    },
  )();
};

/** 图片地址仅供主进程读取，不向普通消息 IPC 暴露本地文件系统路径。 */
export const getMessageImageLocation = (
  conversationId: string,
  messageId: string,
): { remoteUrl: string | null; localPath: string | null } => {
  const message = getImagePreviewMessage(conversationId, messageId);
  const location = getContentDatabase('read')
    .prepare(
      `
    SELECT image_local_path AS localPath
    FROM messages WHERE id = ?
  `,
    )
    .get(message.id) as { localPath: string | null };
  return {
    remoteUrl: parseImageContent(message.content)?.url ?? null,
    localPath: location.localPath,
  };
};

/** 仅主进程按消息回写路径，兼容确认后的新 ID，并核对正文地址防止关联旧资源。 */
export const setMessageImageLocalPath = (
  conversationId: string,
  messageId: string,
  remoteUrl: string,
  localPath: string,
): void => {
  const message = getImagePreviewMessage(conversationId, messageId);
  if (parseImageContent(message.content)?.url !== remoteUrl)
    throw new Error('图片消息已变化，不能写入旧资源路径');
  getContentDatabase()
    .prepare(
      `
    UPDATE messages SET image_local_path = ?
    WHERE id = ? AND message_type = 'image' AND deleted_at IS NULL
  `,
    )
    .run(localPath, message.id);
};

/** 同步游标仍按完整远端页推进，已删记录既不覆盖也不返回给页面。 */
export const saveRemoteMessages = (messages: Message[]): Message[] => {
  const db = getContentDatabase();
  const save = db.transaction((): Message[] => {
    const read = db.prepare(`
      SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
        (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
        sender_id AS senderId, content, message_type AS messageType, status,
        created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
      FROM messages WHERE id = ? AND deleted_at IS NULL
    `);
    const saved: Message[] = [];
    for (const message of messages) {
      if (
        message.messageType === 'local-notice' ||
        message.id.startsWith('local-rejection:')
      )
        throw new Error('服务端消息不能写入本地提示');
      saveMessage({ ...message, status: 'sent' });
      const stored = read.get(message.id) as Message | undefined;
      if (stored) saved.push(stored);
    }
    return saved;
  });
  return save();
};

/** 读取服务端已确认的连续区间，缺少进度时不猜测旧缓存的完整性。 */
export const getMessageSyncState = (
  conversationId: string,
): MessageSyncState | null => {
  const row = getContentDatabase('read')
    .prepare(
      `
    SELECT latest_id AS latestId, older_cursor AS olderCursor,
      oldest_created_at AS oldestCreatedAt, oldest_id AS oldestId, exhausted
    FROM message_sync_state WHERE conversation_id = ?
  `,
    )
    .get(conversationId) as
    | {
        latestId: string | null;
        olderCursor: string | null;
        oldestCreatedAt: string | null;
        oldestId: string | null;
        exhausted: number;
      }
    | undefined;
  return row
    ? {
        conversationId,
        latestId: row.latestId,
        olderCursor: row.olderCursor,
        oldest:
          row.oldestCreatedAt && row.oldestId
            ? { createdAt: row.oldestCreatedAt, id: row.oldestId }
            : null,
        exhausted: row.exhausted === 1,
      }
    : null;
};

/** 消息和已确认同步进度原子提交，网络或写入失败时不跳过未完成的页。 */
export const saveMessageSyncPage = (
  messages: Message[],
  state: MessageSyncState | null,
): void => {
  const db = getContentDatabase();
  db.transaction((): void => {
    if (
      state &&
      messages.some(
        (message) => message.conversationId !== state.conversationId,
      )
    )
      throw new Error('同步消息与会话不一致');
    saveRemoteMessages(messages);
    if (!state) return;
    db.prepare(
      `
      INSERT INTO message_sync_state(
        conversation_id, latest_id, older_cursor, oldest_created_at, oldest_id, exhausted
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET latest_id = excluded.latest_id,
        older_cursor = excluded.older_cursor, oldest_created_at = excluded.oldest_created_at,
        oldest_id = excluded.oldest_id, exhausted = excluded.exhausted
    `,
    ).run(
      state.conversationId,
      state.latestId,
      state.olderCursor,
      state.oldest?.createdAt ?? null,
      state.oldest?.id ?? null,
      Number(state.exhausted),
    );
  })();
};

/** 远端同步不可用时放开本地分页，不修改持久游标或授予离线身份。 */
export const setLocalHistoryOnly = (
  conversationId: string,
  localOnly: boolean,
): void => {
  getContentDatabase('read');
  if (localOnly) localHistoryRooms.add(conversationId);
  else if (!removedGroupRooms.has(conversationId))
    localHistoryRooms.delete(conversationId);
};

/** 退出状态只留在本次授权内，重新进入仍由真实详情接口确认。 */
export const setGroupRemoved = (roomId: string, removed: boolean): void => {
  getContentDatabase('read');
  if (removed) {
    removedGroupRooms.add(roomId);
    localHistoryRooms.add(roomId);
  } else removedGroupRooms.delete(roomId);
};

/** 仅阻止已确认离群的远端补同步，不影响本地消息访问。 */
export const isGroupRemoved = (roomId: string): boolean => {
  getContentDatabase('read');
  return removedGroupRooms.has(roomId);
};

/** 在线按连续区间读取；只读或同步失败时遍历全部本地缓存，不改变同步边界。 */
export const readCachedMessagePage = (
  conversationId: string,
  before: MessagePosition | null,
  localOnly: boolean = false,
): CachedMessagePage => {
  const db = getContentDatabase('read');
  localOnly ||= localHistoryRooms.has(conversationId);
  const conversation = db
    .prepare('SELECT type FROM conversations WHERE id = ?')
    .get(conversationId) as { type: number | null } | undefined;
  if (!conversation) throw new Error('会话不存在');
  const state =
    conversation.type === null ? null : getMessageSyncState(conversationId);
  const floor = !localOnly && state && !state.exhausted ? state.oldest : null;
  const rows = db
    .prepare(
      `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages WHERE conversation_id = @conversationId AND deleted_at IS NULL
      AND (@beforeAt IS NULL OR created_at < @beforeAt OR (created_at = @beforeAt AND id < @beforeId))
      AND (@floorAt IS NULL OR created_at > @floorAt OR (created_at = @floorAt AND id >= @floorId))
    ORDER BY created_at DESC, id DESC LIMIT 51
  `,
    )
    .all({
      conversationId,
      beforeAt: before?.createdAt ?? null,
      beforeId: before?.id ?? null,
      floorAt: floor?.createdAt ?? null,
      floorId: floor?.id ?? null,
    }) as Message[];
  const list = rows.slice(0, 50);
  const last = list[list.length - 1];
  return {
    list,
    before: last ? { createdAt: last.createdAt, id: last.id } : before,
    hasMoreLocal: rows.length > 50,
    hasMoreRemote:
      !localOnly && conversation.type !== null && !state?.exhausted,
  };
};

/** 按已浏览的身份批量回读正文，始终限制在当前授权内容库及指定会话内。 */
export const readCachedMessageBatch = (
  conversationId: string,
  ids: string[],
): Message[] => {
  if (ids.length < 1 || ids.length > 50) throw new Error('无效的消息回读数量');
  return getContentDatabase('read')
    .prepare(
      `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
      AND id IN (${ids.map(() => '?').join(',')})
    LIMIT 50
  `,
    )
    .all(conversationId, ...ids) as Message[];
};

/** 发送确认后把待发送消息的 id 从本地 UUID 更新为后端消息 id，并标记已发送。 */
export const confirmSentMessage = (
  clientMsgId: string,
  serverId: string,
): void => {
  getContentDatabase()
    .prepare(
      `
    UPDATE messages SET id = ?, status = 'sent'
    WHERE client_msg_id = ? AND status = 'pending' AND deleted_at IS NULL
  `,
    )
    .run(serverId, clientMsgId);
};

/** 分页查询消息，时间相同时按 ID 排序，保持页面顺序稳定。 */
export const listMessages = (
  conversationId: string,
  limit = 50,
  offset = 0,
): Message[] => {
  return getContentDatabase('read')
    .prepare(
      `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages WHERE conversation_id = ? AND deleted_at IS NULL
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `,
    )
    .all(conversationId, limit, offset) as Message[];
};

/** 只记录本人未确认普通消息的离线或请求超时资格，不恢复已确认或删除的记录。 */
export const setMessageAutoRetryReason = (
  roomId: string,
  clientMsgId: string,
  reason: Message['autoRetryReason'],
): void => {
  const db = getContentDatabase();
  const message = readOutgoingMessage(roomId, clientMsgId);
  if (!message) return;
  if (
    !reason ||
    !['pending', 'failed'].includes(message.status) ||
    !['text', 'emoji', 'image', 'video', 'audio'].includes(message.messageType)
  ) {
    db.prepare('DELETE FROM message_auto_retry WHERE message_id = ?').run(
      message.id,
    );
    return;
  }
  db.prepare(
    `INSERT INTO message_auto_retry(message_id, reason) VALUES (?, ?)
     ON CONFLICT(message_id) DO UPDATE SET reason = excluded.reason`,
  ).run(message.id, reason);
};

/** 按稳定游标读取具备自动重试资格的消息，不猜测历史失败记录的原因。 */
export const listUnconfirmedMessages = (
  after: MessagePosition | null,
): Message[] =>
  getContentDatabase('read')
    .prepare(
      `SELECT m.id, m.client_msg_id AS clientMsgId,
        (SELECT reply_id FROM message_replies WHERE message_id = m.id) AS replyId,
        m.conversation_id AS conversationId, m.sender_id AS senderId,
        m.content, m.message_type AS messageType, m.status, r.reason AS autoRetryReason,
        m.created_at AS createdAt, m.edited_at AS editedAt, m.deleted_at AS deletedAt
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       JOIN message_auto_retry r ON r.message_id = m.id
       WHERE c.type IS NOT NULL AND m.sender_id = ?
         AND m.client_msg_id IS NOT NULL AND m.client_msg_id <> ''
         AND m.status IN ('pending', 'failed') AND m.deleted_at IS NULL
         AND m.message_type IN ('text', 'emoji', 'image', 'video', 'audio')
         AND (m.created_at > ? OR (m.created_at = ? AND m.id > ?))
       ORDER BY m.created_at, m.id LIMIT 50`,
    )
    .all(
      ownerKey,
      after?.createdAt ?? '',
      after?.createdAt ?? '',
      after?.id ?? '',
    ) as Message[];

/** 重试前重新核对本人的原始消息，已确认、删除或账号变化时不使用旧快照。 */
export const readOutgoingMessage = (
  roomId: string,
  clientMsgId: string,
): Message | null =>
  (getContentDatabase('read')
    .prepare(
      `SELECT m.id, m.client_msg_id AS clientMsgId,
        (SELECT reply_id FROM message_replies WHERE message_id = m.id) AS replyId,
        m.conversation_id AS conversationId, m.sender_id AS senderId,
        m.content, m.message_type AS messageType, m.status, r.reason AS autoRetryReason,
        m.created_at AS createdAt, m.edited_at AS editedAt, m.deleted_at AS deletedAt
       FROM messages m JOIN conversations c ON c.id = m.conversation_id
       LEFT JOIN message_auto_retry r ON r.message_id = m.id
       WHERE c.type IS NOT NULL AND m.conversation_id = ?
         AND m.client_msg_id = ? AND m.sender_id = ? AND m.deleted_at IS NULL
       ORDER BY CASE WHEN m.status = 'sent' THEN 0 ELSE 1 END, m.id LIMIT 1`,
    )
    .get(roomId, clientMsgId, ownerKey) as Message | undefined) ?? null;

/** 原子保存失败状态和独立本地提示，重复拒收不覆盖记录，清空后的迟到响应不重建消息。 */
export const saveMessageRejection = (
  roomId: string,
  clientMsgId: string,
  text: string,
): void => {
  const db = getContentDatabase();
  if (parseMessageRejection(text) !== text) throw new Error('无效的拒收提示');
  db.transaction((): void => {
    const message = readOutgoingMessage(roomId, clientMsgId);
    if (!message || !['pending', 'failed'].includes(message.status)) return;
    saveMessage({ ...message, status: 'failed', autoRetryReason: null });
    const id = `local-rejection:${createHash('sha256')
      .update(JSON.stringify([messageRejectionKey(message), text]))
      .digest('hex')
      .slice(0, 40)}`;
    saveMessage({
      id,
      clientMsgId: null,
      conversationId: roomId,
      senderId: message.senderId,
      content: JSON.stringify({ clientMsgId, text }),
      messageType: 'local-notice',
      status: 'sent',
      createdAt: new Date(Date.parse(message.createdAt) + 1).toISOString(),
      editedAt: null,
      deletedAt: null,
    });
  })();
};

/** 重连按 ID 分批补查占位，不因最新历史边界早于原位更新而遗漏最终视频。 */
export const listTemporaryMessageIds = (
  roomId: string,
  afterId: string,
): string[] =>
  (
    getContentDatabase('read')
      .prepare(
        `
    SELECT id FROM messages WHERE conversation_id = ? AND message_type = 'temporary'
      AND status = 'sent' AND deleted_at IS NULL AND id > ?
    ORDER BY id LIMIT 50
  `,
      )
      .all(roomId, afterId) as { id: string }[]
  ).map((row) => row.id);

/** 只读获取历史窗口图标来源，不使用页面提供的头像地址或房间类型。 */
export const getHistoryIconSource = (
  conversationId: string,
): Pick<Conversation, 'title' | 'type' | 'avatar'> => {
  const conversation = getContentDatabase('read')
    .prepare('SELECT title, type, avatar FROM conversations WHERE id = ?')
    .get(conversationId) as
    Pick<Conversation, 'title' | 'type' | 'avatar'> | undefined;
  if (!conversation) throw new Error('会话不存在');
  return conversation;
};

/** 从当前内容库读取历史窗口上下文，不接受渲染进程传入用户资料。 */
export const getHistoryContext = (
  conversationId: string,
): HistoryWindowContext => {
  const db = getContentDatabase('read');
  const conversation = db
    .prepare('SELECT id, title FROM conversations WHERE id = ?')
    .get(conversationId) as { id: string; title: string } | undefined;
  const profile = db
    .prepare('SELECT id FROM profile ORDER BY updated_at DESC LIMIT 1')
    .get() as { id: string } | undefined;
  if (!conversation || !profile) throw new Error('会话不存在或尚未登录');
  return {
    conversationId: conversation.id,
    conversationTitle: conversation.title,
    userId: profile.id,
  };
};

/** 只解析绑定会话内未删除消息的发送者，不接受页面指定任意 uid。 */
export const getHistoryMessageSender = (
  conversationId: string,
  messageId: string,
): string => {
  const message = getContentDatabase('read')
    .prepare(
      `SELECT sender_id AS senderId FROM messages
       WHERE conversation_id = ? AND id = ? AND deleted_at IS NULL`,
    )
    .get(conversationId, messageId) as { senderId: string } | undefined;
  if (!message) throw new Error('历史消息不存在或已移除');
  return message.senderId;
};

/** 精确读取本账号已缓存的会话消息，不接收任意查询或跨会话替代标识。 */
export const getHistoryMessage = (
  conversationId: string,
  messageId: string,
): Message => {
  const message = getContentDatabase('read')
    .prepare(
      `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages WHERE conversation_id = ? AND id = ? AND deleted_at IS NULL
  `,
    )
    .get(conversationId, messageId) as Message | undefined;
  if (!message) throw new Error('消息不存在或已移除');
  return message;
};

/** 从已保存的引用关系读取同会话原消息，不允许页面指定任意引用目标。 */
export const readMessageReply = (
  conversationId: string,
  messageId: string,
): Message | null => {
  const source = getHistoryMessage(conversationId, messageId);
  if (!source.replyId || source.messageType === 'recalled') return null;
  return (
    (getContentDatabase('read')
      .prepare(
        `SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
          sender_id AS senderId, content, message_type AS messageType, status,
          created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
         FROM messages
         WHERE conversation_id = ? AND id = ? AND deleted_at IS NULL`,
      )
      .get(conversationId, source.replyId) as Message | undefined) ?? null
  );
};

/** 仅标记本地正常消息，保留行及标识以阻止重启后的历史和推送回填。 */
export const deleteLocalMessage = (
  conversationId: string,
  messageId: string,
): void => {
  const db = getContentDatabase();
  const existing = db
    .prepare(
      `SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
     FROM messages WHERE conversation_id = ? AND id = ?`,
    )
    .get(conversationId, messageId) as Message | undefined;
  if (!existing) throw new Error('消息不存在');
  if (existing.deletedAt) return;
  if (!canDeleteMessage(existing)) throw new Error('只能删除已确认的正常消息');
  const timestamp = now();
  const removed: Message = {
    ...existing,
    content: '',
    deletedAt: timestamp,
  };
  db.transaction((): void => {
    const state = readConversationPosition(conversationId);
    const result = db
      .prepare(
        `UPDATE messages SET deleted_at = ?, content = '', image_local_path = NULL
       WHERE conversation_id = ? AND id = ? AND deleted_at IS NULL`,
      )
      .run(timestamp, conversationId, messageId);
    if (result.changes !== 1) throw new Error('消息删除状态已变化，请重试');
    db.prepare('DELETE FROM message_recall_text WHERE message_id = ?').run(
      messageId,
    );
    db.prepare('DELETE FROM message_auto_retry WHERE message_id = ?').run(
      messageId,
    );
    db.prepare('DELETE FROM message_replies WHERE message_id = ?').run(
      messageId,
    );
    db.prepare(
      `DELETE FROM conversation_remote_summary
       WHERE conversation_id = ? AND active_at <= ?`,
    ).run(conversationId, existing.createdAt);
    if (state) updateReadUnread(conversationId);
  })();
  messageSaved?.(removed);
  messageRecalled?.(removed);
};

/** 按实际引用关系定位原文所在的一页，不把 gapCount 当作本地偏移。 */
export const readHistoryReplyPage = (
  conversationId: string,
  messageId: string,
): HistoryReplyPage | null => {
  const target = readMessageReply(conversationId, messageId);
  if (!target) return null;
  const row = getContentDatabase('read')
    .prepare(
      `SELECT COUNT(*) AS count FROM messages
       WHERE conversation_id = ? AND deleted_at IS NULL
         AND (created_at > ? OR (created_at = ? AND id > ?))`,
    )
    .get(conversationId, target.createdAt, target.createdAt, target.id) as {
    count: number;
  };
  const offset = Math.max(0, row.count - 20);
  return {
    targetId: target.id,
    offset,
    list: searchMessages({
      conversationId,
      keyword: '',
      category: 'all',
      startAt: null,
      endAt: null,
      offset,
    }),
  };
};

/** 仅主窗口在有效账号下读取本人撤回文本，不恢复消息正文或暴露他人原文。 */
export const readRecalledMessageText = (
  conversationId: string,
  messageId: string,
): string | null => {
  const db = getContentDatabase('read');
  const message = getHistoryMessage(conversationId, messageId);
  if (
    message.messageType !== 'recalled' ||
    message.status !== 'sent' ||
    message.senderId !== ownerKey ||
    parseRecallContent(message.content).recallUid !== ownerKey
  )
    return null;
  const original = db
    .prepare('SELECT content FROM message_recall_text WHERE message_id = ?')
    .get(messageId) as { content: string } | undefined;
  return original?.content ?? null;
};

/** 重连按稳定 ID 分批核对当前会话缓存，包含早于历史补洞边界的可变消息。 */
export const listMessageStateIds = (
  conversationId: string,
  afterId: string,
): string[] =>
  (
    getContentDatabase('read')
      .prepare(
        `
    SELECT id FROM messages
    WHERE conversation_id = ? AND id > ? AND id NOT GLOB '*[^0-9]*'
      AND status = 'sent' AND deleted_at IS NULL AND message_type <> 'recalled'
    ORDER BY id LIMIT 50
  `,
      )
      .all(conversationId, afterId) as { id: string }[]
  ).map((row) => row.id);

/** 精确读取当前会话的图片，兼容发送确认后的消息 ID 替换，不允许跨会话匹配。 */
export const getImagePreviewMessage = (
  conversationId: string,
  messageId: string,
): Message => {
  const db = getContentDatabase('read');
  const message = db
    .prepare(
      `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages WHERE conversation_id = ? AND message_type = 'image' AND deleted_at IS NULL
      AND (id = ? OR (client_msg_id = ? AND sender_id = ?))
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1
  `,
    )
    .get(conversationId, messageId, messageId, ownerKey, messageId) as
    Message | undefined;
  if (!message) throw new Error('图片消息不存在或已移除');
  return message;
};

/** 校验当前账号的图片消息访问权，再按原始字节摘要读取共享缓存。 */
export const getImageOcrCache = (
  conversationId: string,
  messageId: string,
  sha256: string,
): ImageOcrResult | null => {
  getImagePreviewMessage(conversationId, messageId);
  return getPublicImageOcrCache(sha256);
};

/** 保存前复核当前消息和写权限，编辑草稿不进入共享缓存。 */
export const saveImageOcrCache = (
  conversationId: string,
  messageId: string,
  sha256: string,
  result: ImageOcrResult,
): void => {
  getImagePreviewMessage(conversationId, messageId);
  getContentDatabase('write');
  savePublicImageOcrCache(sha256, result);
};

/** 视频始终按会话与消息标识读取；只允许本人 clientMsgId 的确认替换。 */
export const getVideoMessage = (
  conversationId: string,
  messageId: string,
): Message => {
  const message = getContentDatabase('read')
    .prepare(
      `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages WHERE conversation_id = ? AND message_type = 'video'
      AND deleted_at IS NULL
      AND (id = ? OR (client_msg_id = ? AND sender_id = ?))
    ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1
  `,
    )
    .get(conversationId, messageId, messageId, ownerKey, messageId) as
    Message | undefined;
  if (!message) throw new Error('视频消息不存在或已移除');
  return message;
};

/** 本机发送来源仅由主进程使用，不经 IPC 暴露路径或文件摘要。 */
export interface VideoUploadSource {
  filePath: string;
  fileName: string;
  fileSize: number;
  digest: string;
  partDigests: string;
  duration: number;
  thumbWidth: number;
  thumbHeight: number;
  poster: Uint8Array;
  cancelRequested: number;
}

/** 只解析当前账号发出的未删除视频或上传占位，兼容 SSE 替换消息 ID。 */
export const getVideoUploadMessage = (
  roomId: string,
  messageId: string,
): Message | null =>
  (getContentDatabase('read')
    .prepare(
      `SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
        (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
        sender_id AS senderId, content, message_type AS messageType, status,
        created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
       FROM messages WHERE conversation_id = ? AND sender_id = ?
         AND deleted_at IS NULL AND message_type IN ('temporary', 'upload-cancelled', 'video', 'file')
         AND (id = ? OR client_msg_id = ?)
       ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END LIMIT 1`,
    )
    .get(roomId, ownerKey, messageId, messageId, messageId) as
    Message | undefined) ?? null;

/** 按需读取单条本机来源；远端消息和其他安装的备份不能获得上传来源。 */
export const getVideoUploadSource = (
  roomId: string,
  clientMsgId: string,
): VideoUploadSource | null =>
  (getContentDatabase('read')
    .prepare(
      `SELECT file_path AS filePath, file_name AS fileName, file_size AS fileSize,
        digest, part_digests AS partDigests, duration, thumb_width AS thumbWidth,
        thumb_height AS thumbHeight, poster, cancel_requested AS cancelRequested
       FROM video_upload_sources
       WHERE conversation_id = ? AND client_msg_id = ? AND device_id = ?`,
    )
    .get(roomId, clientMsgId, localDeviceId()) as
    VideoUploadSource | undefined) ?? null;

/** 首次远端请求前绑定原生选中来源；已有占位不能通过重新选文件补造来源。 */
export const saveVideoUploadSource = (
  roomId: string,
  clientMsgId: string,
  source: VideoUploadSource,
): void => {
  const db = getContentDatabase('write');
  const save = db.transaction((): void => {
    const message = getVideoUploadMessage(roomId, clientMsgId);
    if (!message || message.clientMsgId !== clientMsgId)
      throw new Error('本地视频消息不存在');
    const existing = getVideoUploadSource(roomId, clientMsgId);
    if (existing) {
      if (
        existing.filePath !== source.filePath ||
        existing.digest !== source.digest ||
        existing.fileSize !== source.fileSize
      )
        throw new Error('不能替换首次发送的原文件');
      return;
    }
    if (
      message.id !== clientMsgId ||
      message.status !== 'pending' ||
      message.messageType !== 'temporary'
    )
      throw new Error('仅首次发送的设备可以恢复上传');
    db.prepare(
      `INSERT INTO video_upload_sources(
        conversation_id, client_msg_id, device_id, file_path, file_name, file_size,
        digest, part_digests, duration, thumb_width, thumb_height, poster
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      roomId,
      clientMsgId,
      localDeviceId(),
      source.filePath,
      source.fileName,
      source.fileSize,
      source.digest,
      source.partDigests,
      source.duration,
      source.thumbWidth,
      source.thumbHeight,
      Buffer.from(source.poster),
    );
  });
  save();
};

/** 取消意图先持久化，退出或断网后不得恢复为继续上传。 */
export const markVideoUploadCancelled = (
  roomId: string,
  clientMsgId: string,
): void => {
  getContentDatabase('write')
    .prepare(
      `UPDATE video_upload_sources SET cancel_requested = 1
       WHERE conversation_id = ? AND client_msg_id = ? AND device_id = ?`,
    )
    .run(roomId, clientMsgId, localDeviceId());
};

/** 文件来源绑定当前安装，其他设备的内容库备份不授予续传权限。 */
export const getFileUploadSource = (
  roomId: string,
  clientMsgId: string,
): FileUploadSource | null => {
  const row = getContentDatabase('read')
    .prepare(
      `SELECT source, cancel_requested AS cancelled FROM file_upload_sources
     WHERE conversation_id = ? AND client_msg_id = ? AND device_id = ?`,
    )
    .get(roomId, clientMsgId, localDeviceId()) as
    { source: string; cancelled: number } | undefined;
  if (!row) return null;
  return {
    ...(JSON.parse(row.source) as FileUploadSource),
    cancelRequested: Boolean(row.cancelled),
  };
};

/** 首次提交前持久化来源，禁止向已有远端占位补造本机来源。 */
export const saveFileUploadSource = (
  roomId: string,
  clientMsgId: string,
  source: FileUploadSource,
): void => {
  const db = getContentDatabase('write');
  db.transaction((): void => {
    const message = getVideoUploadMessage(roomId, clientMsgId);
    const existing = getFileUploadSource(roomId, clientMsgId);
    if (existing) {
      if (
        existing.filePath !== source.filePath ||
        existing.digest !== source.digest ||
        existing.fileSize !== source.fileSize
      )
        throw new Error('不能替换首次发送的原文件');
      return;
    }
    if (
      !message ||
      message.id !== clientMsgId ||
      message.clientMsgId !== clientMsgId ||
      message.status !== 'pending' ||
      message.messageType !== 'temporary'
    )
      throw new Error('仅首次发送的设备可以恢复上传');
    db.prepare(
      `INSERT INTO file_upload_sources(conversation_id,client_msg_id,device_id,source)
      VALUES (?,?,?,?)`,
    ).run(roomId, clientMsgId, localDeviceId(), JSON.stringify(source));
  })();
};

/** 取消意图持久化后，重启不得继续旧消息上传。 */
export const markFileUploadCancelled = (
  roomId: string,
  clientMsgId: string,
): void => {
  getContentDatabase('write')
    .prepare(
      `UPDATE file_upload_sources SET cancel_requested=1
    WHERE conversation_id=? AND client_msg_id=? AND device_id=?`,
    )
    .run(roomId, clientMsgId, localDeviceId());
};

/** 按消息归属读取文件，不接受渲染进程提供的下载地址。 */
export const getFileMessage = (roomId: string, messageId: string): Message => {
  const message = getContentDatabase('read')
    .prepare(
      `SELECT id, client_msg_id AS clientMsgId,
    (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
    conversation_id AS conversationId, sender_id AS senderId, content, message_type AS messageType,
    status, created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages WHERE conversation_id=? AND deleted_at IS NULL AND message_type='file'
    AND (id=? OR (client_msg_id=? AND sender_id=?)) LIMIT 1`,
    )
    .get(roomId, messageId, messageId, ownerKey) as Message | undefined;
  if (!message) throw new Error('文件消息不存在');
  return message;
};

/** 文件缓存只保存应用内相对路径。 */
export const getAttachmentPath = (key: string): string | null =>
  (
    getContentDatabase('read')
      .prepare(
        'SELECT local_path AS path FROM attachment_files WHERE resource_key=?',
      )
      .get(key) as { path: string } | undefined
  )?.path ?? null;

/** 下载完成后提交缓存索引，不能记录半文件。 */
export const setAttachmentPath = (key: string, relative: string): void => {
  getContentDatabase('write')
    .prepare(
      `INSERT INTO attachment_files(resource_key,local_path) VALUES (?,?)
    ON CONFLICT(resource_key) DO UPDATE SET local_path=excluded.local_path`,
    )
    .run(key, relative);
};

/** 视频和封面缓存以资源摘要索引，不在消息协议中存放磁盘路径。 */
export const getVideoFilePath = (resourceKey: string): string | null =>
  (
    getContentDatabase('read')
      .prepare(
        'SELECT local_path AS localPath FROM video_files WHERE resource_key = ?',
      )
      .get(resourceKey) as { localPath: string } | undefined
  )?.localPath ?? null;

/** 以原视频资源摘要关联进度，不受消息 ID 确认替换或本地转码路径影响。 */
export const getVideoPlaybackPosition = (resourceUrl: string): number => {
  const key = createHash('sha256').update(resourceUrl).digest('hex');
  return (
    (
      getContentDatabase('read')
        .prepare('SELECT position FROM video_playback WHERE resource_key = ?')
        .get(key) as { position: number } | undefined
    )?.position ?? 0
  );
};

/** 仅有效授权可记录播放位置；允许向后拖动，完整播放结束后重置为零。 */
export const saveVideoPlaybackProgress = (
  resourceUrl: string,
  value: VideoPlaybackProgress,
): void => {
  const progress = parseVideoPlaybackProgress(value);
  const key = createHash('sha256').update(resourceUrl).digest('hex');
  getContentDatabase('write')
    .prepare(
      `INSERT INTO video_playback(resource_key, position, duration, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(resource_key) DO UPDATE SET position = excluded.position,
         duration = excluded.duration, updated_at = excluded.updated_at`,
    )
    .run(key, progress.ended ? 0 : progress.position, progress.duration, now());
};

/** 原子落盘后记录资源位置，仅有效授权可写入当前内容库。 */
export const setVideoFilePath = (
  resourceKey: string,
  localPath: string,
): void => {
  getContentDatabase('write')
    .prepare(
      `
    INSERT INTO video_files (resource_key, local_path) VALUES (?, ?)
    ON CONFLICT(resource_key) DO UPDATE SET local_path = excluded.local_path
  `,
    )
    .run(resourceKey, localPath);
};

/** 只查询当前图片相邻的一条已缓存普通图片，不加载整段历史或推进已读位置。 */
export const findAdjacentImageMessage = (
  conversationId: string,
  messageId: string,
  direction: 'previous' | 'next',
): Message | null => {
  const current = getImagePreviewMessage(conversationId, messageId);
  const previous = direction === 'previous';
  return (
    (getContentDatabase('read')
      .prepare(
        `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages
    WHERE conversation_id = @conversationId AND message_type = 'image' AND deleted_at IS NULL
      AND (created_at ${previous ? '<' : '>'} @createdAt
        OR (created_at = @createdAt AND id ${previous ? '<' : '>'} @id))
    ORDER BY created_at ${previous ? 'DESC' : 'ASC'}, id ${previous ? 'DESC' : 'ASC'} LIMIT 1
  `,
      )
      .get({ conversationId, createdAt: current.createdAt, id: current.id }) as
      Message | undefined) ?? null
  );
};

/** 在当前用户和指定会话内搜索全部历史，筛选在分页之前执行。 */
export const searchMessages = (query: HistoryQuery): Message[] => {
  return getContentDatabase('read')
    .prepare(
      `
    SELECT id, client_msg_id AS clientMsgId, conversation_id AS conversationId,
      (SELECT reply_id FROM message_replies WHERE message_id = messages.id) AS replyId,
      sender_id AS senderId, content, message_type AS messageType, status,
      created_at AS createdAt, edited_at AS editedAt, deleted_at AS deletedAt
    FROM messages
    WHERE conversation_id = @conversationId AND deleted_at IS NULL
      AND instr(lower(CASE WHEN message_type = 'system' THEN system_message_text(content)
        WHEN message_type = 'local-notice' THEN json_extract(content, '$.text')
        ELSE content END), lower(@keyword)) > 0
      AND (@startAt IS NULL OR (created_at >= @startAt AND created_at < @endAt))
      AND (
        @category = 'all'
        OR (@category = 'file' AND (message_type = 'file' OR (message_type IN ('temporary', 'upload-cancelled') AND json_extract(content, '$.targetType') = 6)))
        OR (@category = 'media' AND (message_type IN ('image', 'video', 'emoji') OR (message_type IN ('temporary', 'upload-cancelled') AND coalesce(json_extract(content, '$.targetType'), 5) = 5)))
        OR (@category = 'link' AND message_type NOT IN ('emoji', 'image', 'video', 'file', 'audio', 'temporary', 'upload-cancelled') AND (instr(lower(content), 'https://') > 0 OR instr(lower(content), 'http://') > 0))
        OR (@category IN ('music', 'miniapp', 'channel') AND message_type = @category)
      )
    ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET @offset
  `,
    )
    .all({ ...query }) as Message[];
};

/** 使用在线备份生成一致副本，避免直接复制 WAL 数据库丢失记录。 */
export const backupCurrentDatabase = async (
  directory: string,
): Promise<void> => {
  const target = path.join(directory, `openchat-backup-${randomUUID()}.sqlite`);
  await getContentDatabase().backup(target);
};
