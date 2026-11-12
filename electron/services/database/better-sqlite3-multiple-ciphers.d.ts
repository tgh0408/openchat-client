declare module 'better-sqlite3-multiple-ciphers' {
  import type Database from 'better-sqlite3';

  interface CipherDatabase extends Database.Database {
    key(key: Buffer): number;
    rekey(key: Buffer): number;
  }

  const CipherDatabase: {
    new (filename?: string | Buffer, options?: object): CipherDatabase;
  };

  export default CipherDatabase;
}
