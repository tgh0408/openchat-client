import type { FileMetadata } from '../../../shared/media/file/file-message';

/** 本机来源只在主进程与账号内容库之间流转。 */
export interface FileUploadSource extends FileMetadata {
  filePath: string;
  digest: string;
  partDigests: string[];
  cancelRequested: boolean;
}
