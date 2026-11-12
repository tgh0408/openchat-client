import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertImageOcrAssets } from '../shared/runtime/node/image-ocr-assets';

/** 只校验公共模型，开发和安装版均直接读取 public/ocr，不再复制第二份。 */
export const validatePublicOcrModels = async (
  root: string = fileURLToPath(new URL('../', import.meta.url)),
): Promise<void> => {
  try {
    await assertImageOcrAssets(path.join(root, 'public/ocr'));
  } catch (error) {
    console.warn(
      '[OCR] 文字识别不可用，继续构建其他功能；请检查 public/ocr 中的四个资源文件。',
      error,
    );
  }
};
