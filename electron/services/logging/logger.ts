import path from 'node:path';
import log from 'electron-log/main';
import type { LogLevel } from '../../../shared/windows/settings-window';
import { redactLogArgument } from './log-sanitize';

/** 单个日志文件的上限，超过后由 electron-log 轮转为同名 `.old.log`。 */
const maxLogBytes = 10 * 1024 * 1024;

/**
 * 按用户要求保持一条记录一行。
 * electron-log 默认用 util.inspect 折行输出对象参数，会破坏基于行的检索。
 */
const inspectOptions = {
  depth: 5,
  breakLength: Infinity,
  compact: true,
} as const;

/** 启动入口与业务入口是两个独立产物，等级通过进程内全局槽共享。 */
const levelKey = Symbol.for('openchat.log-level');
const registry = globalThis as typeof globalThis & {
  [levelKey]?: { initialized: boolean; level: LogLevel };
};
const logState = (registry[levelKey] ??= { initialized: false, level: 'info' });

/** 关闭主进程用不到的 transport：终端回显交给 console 包装，IPC 与远端不启用。 */
const disableUnusedTransports = (target: typeof log): void => {
  target.transports.console.level = false;
  target.transports.ipc.level = false;
  target.transports.remote.level = false;
};

/** 读取当前日志等级，供设置页回显。 */
export const getLogLevel = (): LogLevel => logState.level;

/** 更新日志等级，后续日志立即使用新阈值。 */
export const setLogLevel = (level: LogLevel): void => {
  logState.level = level;
  log.transports.file.level = level;
};

/**
 * 按项目约定把日志固定在应用目录的 `log/` 下。
 * 不依赖 `app.getPath('logs')`：electron-builder 打包后 userData 被重定向，
 * 而日志要求留在可执行文件旁边。
 */
export const initializeLogger = (root: string): void => {
  if (logState.initialized) return;
  logState.initialized = true;
  const directory = path.join(root, 'log');

  disableUnusedTransports(log);
  log.transports.file.level = logState.level;
  log.transports.file.maxSize = maxLogBytes;
  log.transports.file.resolvePathFn = () => path.join(directory, 'main.log');
  log.transports.file.inspectOptions = inspectOptions;

  /** 仅记录 error 的独立日志，与主日志分开便于快速定位故障。 */
  const errorLog = log.create({ logId: 'error' });
  disableUnusedTransports(errorLog);
  errorLog.transports.file.level = 'error';
  errorLog.transports.file.maxSize = maxLogBytes;
  errorLog.transports.file.resolvePathFn = () =>
    path.join(directory, 'error.log');
  errorLog.transports.file.inspectOptions = inspectOptions;

  // 同一条 error 会被每个启用的 transport 各跑一次 hook，用消息引用去重，
  // 避免重复写入 error.log；errorLog 自身 hooks 为空，不会再次转发。
  const forwarded = new WeakSet<object>();
  log.hooks.push((message) => {
    if (Array.isArray(message.data))
      message.data = message.data.map(redactLogArgument);
    if (
      message.level === 'error' &&
      !forwarded.has(message) &&
      message.data.length > 0
    ) {
      forwarded.add(message);
      errorLog.error(...message.data);
    }
    return message;
  });
};

export { log };
