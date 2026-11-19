import CipherDatabase from 'better-sqlite3-multiple-ciphers';
import type Database from 'better-sqlite3';

/** 创建数据库连接并开启外键、WAL 和锁等待。 */
export const openDatabase = (
  filePath: string,
  databasePassword?: string,
): Database.Database => {
  const db = new CipherDatabase(filePath, { timeout: 5000 });
  try {
    if (databasePassword !== undefined) {
      if (!databasePassword.trim()) throw new Error('本地数据库密钥无效');
      db.key(Buffer.from(databasePassword, 'utf8'));
    }
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
};
