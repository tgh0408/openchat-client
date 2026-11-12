import { randomUUID } from 'node:crypto';
import { constants, lstatSync, realpathSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import type { BigIntStats } from 'node:fs';
import path from 'node:path';
import type { NativeImage } from 'electron';
import type { MessageDragRequest } from '../../../shared/chat/messages/message-drag';

interface DragTicket {
  filePath: string;
  icon: NativeImage;
  identity: BigIntStats;
  validate: () => void;
  expiresAt: number;
  source: MessageDragSource;
  directory?: string;
  key: string;
  original: BigIntStats;
}

interface MessageDragSource {
  id: number;
  validate: () => void;
  start: (filePath: string, icon: NativeImage) => void;
}

interface MessageDragDependencies {
  temporaryRoot: string;
  fileName: (request: MessageDragRequest) => string;
  capture: (request: MessageDragRequest) => () => void;
  prepare: (
    request: MessageDragRequest,
    validate: () => void,
  ) => Promise<string | null>;
  loadIcon: (
    request: MessageDragRequest,
    filePath: string,
  ) => Promise<NativeImage>;
}

/** 保留发送时的名称与扩展名，仅替换系统不允许的路径字符和保留名。 */
const exportName = (name: string): string => {
  const safe = name
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '');
  if (!safe) return '附件';
  return /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe) ? `_${safe}` : safe;
};

/** 本地文件准备与手势分离，不在准备结束后突然启动旧拖拽。 */
export const createMessageDragController = (
  dependencies: MessageDragDependencies,
): {
  prepare: (
    request: MessageDragRequest,
    source: MessageDragSource,
  ) => Promise<string | null>;
  start: (ticket: unknown, sourceId: number) => void;
  clear: () => void;
} => {
  const tickets = new Map<string, DragTicket>();
  let generation = 0;
  let pending = 0;

  /** 只清理本次创建的临时目录，不修改原始附件缓存。 */
  const removeDirectory = (directory: string | undefined): void => {
    if (directory)
      void rm(directory, { recursive: true, force: true }).catch(() => {});
  };

  /** 回收过期凭据与对应的同名导出副本。 */
  const discard = (ticket: string): void => {
    removeDirectory(tickets.get(ticket)?.directory);
    tickets.delete(ticket);
  };

  /** 原生拖出前再次拒绝替换文件及目录链接。 */
  const inspect = (filePath: string): BigIntStats => {
    const identity = lstatSync(filePath, { bigint: true });
    const actual = realpathSync(filePath);
    const expected = path.resolve(filePath);
    if (
      !identity.isFile() ||
      identity.isSymbolicLink() ||
      (process.platform === 'win32'
        ? actual.toLowerCase() !== expected.toLowerCase()
        : actual !== expected)
    )
      throw new Error('拖拽文件不可用，请重新准备');
    return identity;
  };

  /** 文件标识与高精度时间一致时才复用已准备的副本。 */
  const unchanged = (before: BigIntStats, after: BigIntStats): boolean =>
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs;

  /** 有界保存短期凭据，授权撤销和消息变更后不交付迟到的路径。 */
  const prepare = async (
    request: MessageDragRequest,
    source: MessageDragSource,
  ): Promise<string | null> => {
    if (pending >= 2) throw new Error('请等待其他附件准备完成');
    const current = generation;
    const validateSource = dependencies.capture(request);
    /** 每个异步步骤及最终拖拽均复核原授权和原消息。 */
    const validate = (): void => {
      if (current !== generation) throw new Error('拖拽请求已失效');
      source.validate();
      validateSource();
    };
    validate();
    pending++;
    let directory: string | undefined;
    try {
      let filePath = await dependencies.prepare(request, validate);
      validate();
      if (!filePath) return null;
      const sourcePath = filePath;
      const original = inspect(sourcePath);
      const name = exportName(dependencies.fileName(request));
      const key = JSON.stringify([
        source.id,
        request.conversationId,
        request.messageId,
        request.kind,
        sourcePath,
        name,
      ]);
      for (const [ticket, item] of tickets) {
        if (item.expiresAt <= Date.now()) {
          discard(ticket);
          continue;
        }
        if (item.key !== key) continue;
        try {
          item.validate();
          if (
            unchanged(item.original, original) &&
            unchanged(item.identity, inspect(item.filePath))
          )
            return ticket;
        } catch {
          // 旧窗口或文件已失效时重新准备，不能复用旧凭据。
        }
        discard(ticket);
      }
      if (path.basename(sourcePath) !== name) {
        await mkdir(dependencies.temporaryRoot, { recursive: true });
        const root = realpathSync(dependencies.temporaryRoot);
        if (
          root.toLowerCase() !==
          path.resolve(dependencies.temporaryRoot).toLowerCase()
        )
          throw new Error('拖拽临时目录不能是链接');
        validate();
        directory = await mkdtemp(path.join(root, 'message-drag-'));
        validate();
        filePath = path.join(directory, name);
        await copyFile(sourcePath, filePath, constants.COPYFILE_EXCL);
        validate();
        const latest = inspect(sourcePath);
        if (!unchanged(original, latest))
          throw new Error('文件已变化，请再次拖动');
      }
      const identity = inspect(filePath);
      validate();
      const icon = await dependencies.loadIcon(request, filePath);
      validate();
      for (const [ticket, item] of tickets) {
        if (item.expiresAt <= Date.now()) discard(ticket);
      }
      while (tickets.size >= 16) discard(tickets.keys().next().value!);
      const ticket = randomUUID();
      tickets.set(ticket, {
        filePath,
        icon,
        identity,
        validate,
        expiresAt: Date.now() + 5 * 60_000,
        source,
        directory,
        key,
        original,
      });
      directory = undefined;
      return ticket;
    } finally {
      removeDirectory(directory);
      pending--;
    }
  };

  /** 同步使用短期凭据，避免等待网络错过系统拖动手势。 */
  const start = (ticket: unknown, sourceId: number): void => {
    if (typeof ticket !== 'string') throw new Error('无效的拖拽凭据');
    const item = tickets.get(ticket);
    if (!item || item.expiresAt <= Date.now()) {
      discard(ticket);
      throw new Error('拖拽准备已过期，请再次拖动');
    }
    if (item.source.id !== sourceId) throw new Error('拖拽凭据不属于当前窗口');
    item.validate();
    const identity = inspect(item.filePath);
    if (!unchanged(item.identity, identity)) {
      discard(ticket);
      throw new Error('文件已变化，请再次拖动');
    }
    item.validate();
    item.source.start(item.filePath, item.icon);
  };

  /** 退出、重载或关闭窗口时撤销全部凭据和在途准备。 */
  const clear = (): void => {
    generation++;
    for (const ticket of tickets.keys()) discard(ticket);
    tickets.clear();
  };

  return { prepare, start, clear };
};
