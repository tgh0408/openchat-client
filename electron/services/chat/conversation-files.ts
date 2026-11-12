import { lstat, realpath, unlink } from 'node:fs/promises';
import path from 'node:path';

interface CleanupDependencies {
  validate: () => void;
  referenced: (localPath: string) => boolean;
  acknowledge: (localPath: string) => void;
}

/** 只删除账号应用目录内的普通缓存文件；失败不消费持久清理记录。 */
export const cleanupConversationFiles = async (
  root: string,
  owner: string,
  localPaths: string[],
  dependencies: CleanupDependencies,
): Promise<void> => {
  const fileRoot = path.resolve(root, 'file', owner);
  for (const localPath of new Set(localPaths)) {
    dependencies.validate();
    const parts = localPath.split('/');
    if (
      parts[0] !== 'file' ||
      parts[1] !== owner ||
      parts.length < 3 ||
      parts.some(
        (part) => !part || part === '.' || part === '..' || part.includes('\\'),
      )
    )
      throw new Error('聊天缓存路径无效');
    const absolute = path.resolve(root, ...parts);
    const relative = path.relative(fileRoot, absolute);
    if (
      !relative ||
      relative.startsWith(`..${path.sep}`) ||
      relative === '..' ||
      path.isAbsolute(relative)
    )
      throw new Error('聊天缓存路径越界');
    if (dependencies.referenced(localPath)) {
      dependencies.acknowledge(localPath);
      continue;
    }
    try {
      const directory = path.dirname(absolute);
      if (
        path.resolve(await realpath(directory)).toLowerCase() !==
        directory.toLowerCase()
      )
        throw new Error('聊天缓存目录不能是链接');
      const info = await lstat(absolute);
      dependencies.validate();
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('聊天缓存不是普通文件');
      if (!dependencies.referenced(localPath)) await unlink(absolute);
      dependencies.validate();
      dependencies.acknowledge(localPath);
    } catch (cause) {
      dependencies.validate();
      if (!(
        cause instanceof Error &&
        'code' in cause &&
        cause.code === 'ENOENT'
      ))
        throw cause;
      dependencies.acknowledge(localPath);
    }
  }
};
