import { createHash } from 'node:crypto';
import { parseAuthBase } from '../../../shared/api/api-request';

/** 取认证基址 SHA-256 的前 16 位作为目录名，保留协议、端口与服务路径的隔离。 */
export const serverStorageHash = (base: string): string =>
  createHash('sha256').update(parseAuthBase(base)).digest('hex').slice(0, 16);
