import { constants } from 'node:fs';
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
} from 'node:fs/promises';
import path from 'node:path';
import type { BigIntStats } from 'node:fs';

interface CopySource {
  filePath: string;
  fileName: string;
}

interface CopyDependencies {
  temporaryRoot: string;
  write: (
    filePath: string,
    image: boolean,
    validate: () => void,
  ) => Promise<void>;
}

/** 保留原名称和扩展名，仅替换文件系统不允许的字符及保留名。 */
const exportName = (name: string): string => {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (!safe) return '附件';
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? `_${safe}` : safe;
};

/** 拒绝链接和被替换的目录，避免剪贴板导出未授权文件。 */
const inspect = async (filePath: string): Promise<BigIntStats> => {
  const identity = await lstat(filePath, { bigint: true });
  const actual = await realpath(filePath);
  const expected = path.resolve(filePath);
  if (
    !identity.isFile() ||
    identity.isSymbolicLink() ||
    (process.platform === 'win32'
      ? actual.toLowerCase() !== expected.toLowerCase()
      : actual !== expected)
  )
    throw new Error('复制文件不可用，请重试');
  return identity;
};

/** 创建原名快照，保留至授权结束，避免拖拽凭据过期或后续复制破坏粘贴。 */
export const createMessageCopyController = (
  dependencies: CopyDependencies,
): {
  copy: (
    prepare: (validate: () => void) => Promise<CopySource>,
    validateSource: () => void,
    image: boolean,
  ) => Promise<void>;
  clear: () => void;
} => {
  const directories = new Set<string>();
  let generation = 0;
  let pending = false;

  /** 仅清理本控制器创建的应用内快照目录。 */
  const remove = (directory: string): void => {
    void rm(directory, { recursive: true, force: true }).catch(() => {});
  };

  /** 下载、复制及写入剪贴板前复核原窗口、账号和消息。 */
  const copy = async (
    prepare: (validate: () => void) => Promise<CopySource>,
    validateSource: () => void,
    image: boolean,
  ): Promise<void> => {
    if (pending) throw new Error('正在复制附件，请稍候');
    const current = generation;
    /** 授权结束后拒绝在途复制，不写入迟到的剪贴板数据。 */
    const validate = (): void => {
      if (current !== generation) throw new Error('复制请求已失效');
      validateSource();
    };
    validate();
    pending = true;
    let directory: string | undefined;
    try {
      const source = await prepare(validate);
      validate();
      const original = await inspect(source.filePath);
      await mkdir(dependencies.temporaryRoot, { recursive: true });
      const root = await realpath(dependencies.temporaryRoot);
      if (
        root.toLowerCase() !==
        path.resolve(dependencies.temporaryRoot).toLowerCase()
      )
        throw new Error('复制临时目录不能是链接');
      validate();
      directory = await mkdtemp(path.join(root, 'message-copy-'));
      const destination = path.join(directory, exportName(source.fileName));
      validate();
      await copyFile(source.filePath, destination, constants.COPYFILE_EXCL);
      const latest = await inspect(source.filePath);
      if (
        original.dev !== latest.dev ||
        original.ino !== latest.ino ||
        original.size !== latest.size ||
        original.mtimeNs !== latest.mtimeNs ||
        original.ctimeNs !== latest.ctimeNs
      )
        throw new Error('复制期间文件已变化，请重试');
      await inspect(destination);
      validate();
      await dependencies.write(destination, image, validate);
      validate();
      directories.add(directory);
      directory = undefined;
    } finally {
      if (directory) remove(directory);
      pending = false;
    }
  };

  /** 退出、重载和授权失效时撤销在途复制并回收文件快照。 */
  const clear = (): void => {
    generation++;
    for (const directory of directories) remove(directory);
    directories.clear();
  };
  return { copy, clear };
};
