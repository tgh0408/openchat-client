import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ImageOcrProvider } from '../../../shared/media/image/image-ocr';
import type {
  LocalSettings,
  StoredOcrProvider,
} from '../../../shared/storage/database';
import type { LogLevel } from '../../../shared/windows/settings-window';
import { openDatabase } from './database-connection';

let settingsDatabase: Database.Database | undefined;

/** 初始化全局偏好、加密登录记录与安装标识，不打开用户内容库。 */
export const initializeSettingsDatabase = (directory: string): void => {
  try {
    settingsDatabase = openDatabase(path.join(directory, 'settings.sqlite'));
    const db = settingsDatabase;
    db.exec(`
      CREATE TABLE IF NOT EXISTS preferences (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        remember_account INTEGER NOT NULL DEFAULT 1 CHECK(remember_account IN (0, 1))
      );
      INSERT OR IGNORE INTO preferences(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS debug_preferences (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0, 1))
      );
      INSERT OR IGNORE INTO debug_preferences(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS logging_preferences (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        level TEXT NOT NULL DEFAULT 'info' CHECK(level IN ('error', 'warn', 'info'))
      );
      INSERT OR IGNORE INTO logging_preferences(id) VALUES(1);
      CREATE TABLE IF NOT EXISTS ocr_preferences (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        provider TEXT NOT NULL CHECK(provider IN ('cpu', 'dml', 'cuda', 'coreml')),
        checked_at TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE IF NOT EXISTS auth_session (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        encrypted_session BLOB NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_accounts (
        id TEXT PRIMARY KEY,
        encrypted_identity BLOB NOT NULL,
        encrypted_session BLOB
      );
      CREATE TABLE IF NOT EXISTS local_device (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        device_id TEXT NOT NULL
      );
    `);
    db.prepare(
      'INSERT OR IGNORE INTO local_device(id, device_id) VALUES(1, ?)',
    ).run(randomUUID());
  } catch (error) {
    closeSettingsDatabase();
    throw error;
  }
};

/** 返回全局设置连接；禁止在初始化失败时继续访问。 */
const getSettingsDatabase = (): Database.Database => {
  if (!settingsDatabase) throw new Error('本地数据库尚未初始化');
  return settingsDatabase;
};

/** 关闭设置库连接，不修改其中的偏好或加密账号记录。 */
export const closeSettingsDatabase = (): void => {
  settingsDatabase?.close();
  settingsDatabase = undefined;
};

/** 读取可持久化偏好，查询结果不包含任何登录凭据。 */
export const getLocalSettings = (): LocalSettings => {
  const row = getSettingsDatabase()
    .prepare(
      `
    SELECT remember_account AS rememberAccount,
      (SELECT enabled FROM debug_preferences WHERE id = 1) AS debugMode
    FROM preferences WHERE id = 1
  `,
    )
    .get() as { rememberAccount: number; debugMode: number };
  return {
    rememberAccount: row.rememberAccount === 1,
    debugMode: row.debugMode === 1,
  };
};

/** 保存记住账号开关；实际账号名称仅由渲染进程在内存中维护。 */
export const saveLocalSettings = (rememberAccount: boolean): void => {
  getSettingsDatabase()
    .prepare('UPDATE preferences SET remember_account = ? WHERE id = 1')
    .run(Number(rememberAccount));
};

/** 保存桌面调试开关，不改变账号记忆偏好或登录授权。 */
export const saveDebugMode = (enabled: boolean): void => {
  getSettingsDatabase()
    .prepare('UPDATE debug_preferences SET enabled = ? WHERE id = 1')
    .run(Number(enabled));
};

/** 读取持久化日志等级。 */
export const getStoredLogLevel = (): LogLevel => {
  const row = getSettingsDatabase()
    .prepare('SELECT level FROM logging_preferences WHERE id = 1')
    .get() as { level: LogLevel };
  return row.level;
};

/** 保存日志等级，不改变账号会话或聊天内容。 */
export const saveStoredLogLevel = (level: LogLevel): void => {
  getSettingsDatabase()
    .prepare('UPDATE logging_preferences SET level = ? WHERE id = 1')
    .run(level);
};

/** 读取本机已确认的 OCR 后端；空记录表示尚未完成自动选择。 */
export const getStoredOcrProvider = (): StoredOcrProvider | null => {
  const row = getSettingsDatabase()
    .prepare(
      'SELECT provider, checked_at AS checkedAt FROM ocr_preferences WHERE id = 1',
    )
    .get() as { provider: unknown; checkedAt: unknown } | undefined;
  if (!row) return null;
  const { provider, checkedAt } = row;
  if (
    provider !== 'cpu' &&
    provider !== 'dml' &&
    provider !== 'cuda' &&
    provider !== 'coreml'
  )
    throw new Error('本地 OCR 后端设置无效');
  if (typeof checkedAt !== 'string') throw new Error('本地 OCR 判断时间无效');
  return { provider, checkedAt };
};

/** 原子保存本机推理选择及判断时间，不因普通识别命中缓存更新计时。 */
export const saveStoredOcrProvider = (
  provider: ImageOcrProvider,
  checkedAt: string = new Date().toISOString(),
): void => {
  if (
    provider !== 'cpu' &&
    provider !== 'dml' &&
    provider !== 'cuda' &&
    provider !== 'coreml'
  )
    throw new Error('本地 OCR 后端设置无效');
  const timestamp = Date.parse(checkedAt);
  if (
    !Number.isFinite(timestamp) ||
    new Date(timestamp).toISOString() !== checkedAt
  )
    throw new Error('本地 OCR 判断时间无效');
  getSettingsDatabase()
    .prepare(
      `
    INSERT INTO ocr_preferences(id, provider, checked_at) VALUES(1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, checked_at = excluded.checked_at
  `,
    )
    .run(provider, checkedAt);
};
/** 读取主进程加密的登录会话，不通过数据库 IPC 暴露给页面。 */
export const readEncryptedSession = (): Buffer | null => {
  const row = getSettingsDatabase()
    .prepare(
      'SELECT encrypted_session AS payload FROM auth_session WHERE id = 1',
    )
    .get() as { payload: Buffer } | undefined;
  return row?.payload ?? null;
};

/** 原子替换唯一登录会话，数据库只接收系统加密后的二进制。 */
export const writeEncryptedSession = (payload: Buffer): void => {
  getSettingsDatabase()
    .prepare(
      `
      INSERT INTO auth_session(id, encrypted_session) VALUES(1, ?)
      ON CONFLICT(id) DO UPDATE SET encrypted_session = excluded.encrypted_session
    `,
    )
    .run(payload);
};

/** 删除保存的登录会话，不影响偏好、聊天记录或其他用户数据。 */
export const deleteSavedSession = (): void => {
  getSettingsDatabase().prepare('DELETE FROM auth_session WHERE id = 1').run();
};

/** 主进程专用的加密历史账号记录。 */
export interface EncryptedLoginAccount {
  id: string;
  identity: Buffer;
  session: Buffer | null;
}

/** 读取历史账号密文，不开放原始数据库 IPC。 */
export const readLoginAccounts = (): EncryptedLoginAccount[] => {
  return getSettingsDatabase()
    .prepare(
      'SELECT id, encrypted_identity AS identity, encrypted_session AS session FROM login_accounts ORDER BY rowid DESC',
    )
    .all() as EncryptedLoginAccount[];
};

/** 原子保存账号和可选 JWT；选中时同时更新登录入口检查点。 */
export const saveLoginAccount = (
  account: EncryptedLoginAccount,
  selected = false,
): void => {
  const db = getSettingsDatabase();
  const save = db.transaction((): void => {
    db.prepare(
      `
      INSERT INTO login_accounts(id, encrypted_identity, encrypted_session) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET encrypted_identity = excluded.encrypted_identity,
        encrypted_session = excluded.encrypted_session
    `,
    ).run(account.id, account.identity, account.session);
    if (selected) writeEncryptedSession(account.session ?? account.identity);
  });
  save();
};

/** 无法恢复身份时仅移除对应账号记录，不触碰聊天内容。 */
export const deleteLoginAccount = (id: string): void => {
  getSettingsDatabase()
    .prepare('DELETE FROM login_accounts WHERE id = ?')
    .run(id);
};

/** 设置库的安装标识不随账号内容库备份或远端消息同步。 */
export const localDeviceId = (): string =>
  (
    getSettingsDatabase()
      .prepare('SELECT device_id AS id FROM local_device WHERE id = 1')
      .get() as { id: string }
  ).id;
