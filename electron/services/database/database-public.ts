import type Database from 'better-sqlite3';
import path from 'node:path';
import { openDatabase } from './database-connection';
import { parseImageOcrResult } from '../../../shared/media/image/image-ocr';
import type { ImageOcrResult } from '../../../shared/media/image/image-ocr';

let publicDatabase: Database.Database | undefined;
let databaseDirectory = '';

/** 关闭共享缓存连接；账号切换保留缓存，应用退出时统一释放。 */
export const closePublicDatabase = (): void => {
  publicDatabase?.close();
  publicDatabase = undefined;
  databaseDirectory = '';
};

/** 配置共享缓存目录，首次授权图片访问时才打开数据库。 */
export const initializePublicDatabase = (directory: string): void => {
  closePublicDatabase();
  databaseDirectory = directory;
};

/** 打开独立共享库，只存图片摘要和原始识别结果，不关联账号或消息。 */
const getPublicDatabase = (): Database.Database => {
  if (!databaseDirectory) throw new Error('共享缓存数据库尚未初始化');
  if (publicDatabase) return publicDatabase;
  const db = openDatabase(path.join(databaseDirectory, 'public.sqlite'));
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS img_orc (
        sha_256 TEXT PRIMARY KEY NOT NULL CHECK(length(sha_256) = 64 AND sha_256 NOT GLOB '*[^0-9a-f]*'),
        result TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    publicDatabase = db;
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};

/** 仅供已校验图片访问权限的主进程调用，损坏的缓存视为未命中。 */
export const getPublicImageOcrCache = (
  sha256: string,
): ImageOcrResult | null => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('图片摘要无效');
  const row = getPublicDatabase()
    .prepare('SELECT result FROM img_orc WHERE sha_256 = ?')
    .get(sha256) as { result: string } | undefined;
  if (!row) return null;
  try {
    return parseImageOcrResult(JSON.parse(row.result) as unknown);
  } catch {
    return null;
  }
};

/** 按原始图片摘要保存完整识别结果，跨账号和消息共用同一条记录。 */
export const savePublicImageOcrCache = (
  sha256: string,
  result: ImageOcrResult,
): void => {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('图片摘要无效');
  const parsed = parseImageOcrResult(result);
  getPublicDatabase()
    .prepare(
      `
    INSERT INTO img_orc(sha_256, result, created_at) VALUES (?, ?, ?)
    ON CONFLICT(sha_256) DO UPDATE SET result = excluded.result, created_at = excluded.created_at
  `,
    )
    .run(sha256, JSON.stringify(parsed), new Date().toISOString());
};
