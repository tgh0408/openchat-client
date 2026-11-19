import { app } from 'electron';
import path from 'node:path';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import log from 'electron-log/main';
import type { LocalImageData } from '../../../../shared/media/image/image';
import { MAX_IMAGE_BYTES } from '../../../../shared/media/image/image';
import type { ImageOcrResult } from '../../../../shared/media/image/image-ocr';
import { assertImageOcrAssets } from '../../../../shared/runtime/node/image-ocr-assets';
import { applicationDirectory } from '../../runtime/runtime-paths';
import {
  getStoredOcrProvider,
  saveStoredOcrProvider,
} from '../../database/database';
import { createImageOcrProviderSelection } from './image-ocr-provider-settings';
import type { ImageOcrProcessClient } from './image-ocr-process';
import { createImageOcrProcessClient } from './image-ocr-process';
import { createImageOcrUtilityTransport } from './image-ocr-transport';

let unavailableReason = '';

/** 子进程使用真实解包路径，模型单独从应用目录的 public/ocr 读取。 */
const getOcrDirectory = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'dist-electron')
    : __dirname;

const selection = createImageOcrProviderSelection({
  read: getStoredOcrProvider,
  save: saveStoredOcrProvider,
  forceCpu: process.env.OPENCHAT_OCR_PROVIDER === 'cpu',
  onSaveError: (): void =>
    log.warn('[OCR] 后端设置保存失败，本次运行继续沿用内存选择'),
});
let client: ImageOcrProcessClient | undefined;

/** 设置库就绪后初始化一次本机选择，账号切换及子进程回收不重新判断。 */
export const initializeImageOcrProvider = (): void => {
  if (client) return;
  const preference = selection.initialize();
  client = createImageOcrProcessClient({
    spawn: (provider) =>
      createImageOcrUtilityTransport(
        path.join(getOcrDirectory(), 'image-ocr-worker.cjs'),
        provider,
        applicationDirectory,
        path.join(applicationDirectory, 'public', 'ocr'),
      ),
    preference,
    onMetrics: (metrics): void => {
      selection.confirm(metrics.provider);
      log.info('[OCR] 识别基准（provider 为配置后端）', metrics);
    },
    onFallback: (reason): void => {
      selection.confirm('cpu');
      log.warn('[OCR] GPU 识别失败，已记住 CPU 选择并准备重试', reason);
    },
    onExecution: (execution): void =>
      log.info('[OCR] 实际模型执行（ONNX 内核事件）', execution),
  });
};
/** 授权撤销或应用退出时释放复用模型和任务数据，普通预览关闭不停止后台队列。 */
export const stopImageOcrProcess = (): void => client?.stop();

app.once('before-quit', stopImageOcrProcess);
app.once('will-quit', stopImageOcrProcess);

/** 识别资源不可用仅报告能力缺失，不影响图片加载或应用启动。 */
export const isImageOcrAvailable = async (): Promise<boolean> => {
  try {
    const directory = getOcrDirectory();
    await assertImageOcrAssets(
      path.join(applicationDirectory, 'public', 'ocr'),
    );
    const entry = path.join(directory, 'image-ocr-worker.cjs');
    await access(entry, constants.R_OK);
    const info = await stat(entry);
    if (!info.isFile() || !info.size) throw new Error('OCR 子进程入口无效');
    unavailableReason = '';
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : '资源检查失败';
    if (reason !== unavailableReason) {
      unavailableReason = reason;
      log.error(
        '[OCR] 文字识别不可用，已禁用识别入口，其他功能不受影响',
        reason,
      );
    }
    return false;
  }
};

/** 仅转交已授权的编码图片，解码、缩放、推理均在可独立终止的进程中完成。 */
export const recognizeImageText = async (
  image: LocalImageData,
  signal: AbortSignal,
): Promise<ImageOcrResult> => {
  signal.throwIfAborted();
  if (!image.bytes.byteLength || image.bytes.byteLength > MAX_IMAGE_BYTES)
    throw new Error('图片大小无效或超过 50 MiB');
  if (!(await isImageOcrAvailable())) throw new Error('本地文字识别资源不可用');
  signal.throwIfAborted();
  if (!client) throw new Error('OCR 本机设置尚未初始化');
  return client.recognize(image.bytes, signal);
};
