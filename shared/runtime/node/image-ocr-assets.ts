import { open } from 'node:fs/promises';
import path from 'node:path';
import { IMAGE_OCR_ASSETS } from '../../media/image/image-ocr-models';

/** 检查本地资源是可读的非空文件，不限制固定版本的长度或摘要。 */
export const assertImageOcrAssets = async (
  directory: string,
): Promise<void> => {
  for (const asset of IMAGE_OCR_ASSETS) {
    const handle = await open(path.join(directory, asset.file), 'r');
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size === 0)
        throw new Error(`OCR 资源不是有效的非空文件：${asset.file}`);
    } finally {
      await handle.close();
    }
  }
};
