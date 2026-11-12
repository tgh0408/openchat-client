import type { ImageOcrPreference } from '../../../../shared/media/image/image-ocr-process';
import { utilityProcess } from 'electron';
import type { ImageOcrTransport } from './image-ocr-process';

/** 启动真实独立 Node utility 进程，沿用已隔离的应用内缓存和临时目录。 */
export const createImageOcrUtilityTransport = (
  entry: string,
  preference: ImageOcrPreference,
  cwd: string,
  modelDirectory: string,
): ImageOcrTransport => {
  const child = utilityProcess.fork(entry, [], {
    cwd,
    env: {
      ...process.env,
      OPENCHAT_OCR_PROVIDER: preference,
      OPENCHAT_OCR_MODEL_DIRECTORY: modelDirectory,
    },
    execArgv: [],
    stdio: 'ignore',
    serviceName: 'OpenChat OCR',
  });
  let killRequested = false;
  child.once('spawn', (): void => {
    // 启动尚未取得 PID 时 kill 可能返回 false；获得进程后继续执行取消。
    if (killRequested) child.kill();
  });
  return {
    postMessage: (message): void => child.postMessage(message),
    kill: (): boolean => {
      killRequested = true;
      return child.kill();
    },
    onMessage: (listener): void => {
      child.on('message', listener);
    },
    onExit: (listener): void => {
      child.once('exit', listener);
    },
    onError: (listener): void => {
      child.once('error', listener);
    },
  };
};
