import { dialog, nativeImage } from 'electron';
import type { BrowserWindow } from 'electron';
import { open } from 'node:fs/promises';
import { applicationDirectory } from '../../services/runtime/runtime-paths';
import {
  MAX_REGISTRATION_AVATAR_BYTES,
  parseRegistrationAvatar,
} from '../../../shared/auth/registration-avatar';

/** 注册专用选择器只读取用户本次明确选择的单张图片，不保留路径或文件句柄。 */
export const chooseRegistrationAvatar = async (
  window: BrowserWindow,
  validate: () => void,
): Promise<Uint8Array | null> => {
  validate();
  const selected = await dialog.showOpenDialog(window, {
    title: '选择注册头像',
    defaultPath: applicationDirectory,
    properties: ['openFile', 'dontAddToRecent'],
    filters: [{ name: 'JPG / PNG', extensions: ['jpg', 'jpeg', 'png'] }],
  });
  validate();
  if (selected.canceled || !selected.filePaths[0]) return null;
  const file = await open(selected.filePaths[0], 'r').catch((): never => {
    throw new Error('无法打开头像图片，请重新选择');
  });
  try {
    validate();
    const before = await file.stat();
    if (
      !before.isFile() ||
      before.size < 1 ||
      before.size > MAX_REGISTRATION_AVATAR_BYTES
    )
      throw new Error('头像大小须为 1 字节至 10 MiB');
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      validate();
      const result = await file.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    const after = await file.stat();
    validate();
    if (
      length !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs
    )
      throw new Error('头像文件已变化，请重新选择');
    const bytes = parseRegistrationAvatar(buffer.subarray(0, length));
    if (nativeImage.createFromBuffer(Buffer.from(bytes)).isEmpty())
      throw new Error('头像图片无法读取，请重新选择 JPG 或 PNG');
    return bytes;
  } catch (cause) {
    if (cause instanceof Error && 'code' in cause)
      throw new Error('无法读取头像图片，请重新选择');
    throw cause;
  } finally {
    await file.close();
  }
};
