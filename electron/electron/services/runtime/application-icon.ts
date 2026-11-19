import { nativeImage } from 'electron';
import type { NativeImage } from 'electron';
import path from 'node:path';
import { applicationDirectory } from './runtime-paths';

/** 从开发资源或打包资源中读取统一的应用图标。 */
export const getApplicationIcon = (): NativeImage =>
  nativeImage.createFromPath(
    path.join(applicationDirectory, 'public', 'ico', 'openchat.ico'),
  );
