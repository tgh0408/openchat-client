import { build } from 'vite';
import { validatePublicOcrModels } from './ocr-models';
import {
  createElectronBuildConfig,
  electronEntries,
} from '../vite.electron.config';

/** 顺序生成独立入口，仅首次清空产物目录，开发与发布共用同一构建流程。 */
export const buildElectron = async (): Promise<void> => {
  for (const [index, entry] of electronEntries.entries()) {
    await build({
      ...createElectronBuildConfig(entry, index === 0),
      configFile: false,
    });
  }
  await validatePublicOcrModels();
};
