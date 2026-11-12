import { app, ipcMain } from 'electron';
import { formatLogPayload, isLoggedError } from './log-sanitize';
import { log } from './logger';
import { createLoggedFetch } from './request-logging';

let installed = false;

/** 在注册 IPC 和创建窗口前安装统一诊断，不新增页面写文件或任意日志 IPC。 */
export const installDiagnostics = (): void => {
  if (installed) return;
  installed = true;
  globalThis.fetch = createLoggedFetch(globalThis.fetch.bind(globalThis), log);

  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener): void => {
    handle(channel, async (event, ...args: unknown[]): Promise<unknown> => {
      try {
        return await listener(event, ...args);
      } catch (error) {
        if (
          !isLoggedError(error) &&
          !(error instanceof Error && error.name === 'AbortError')
        )
          log.error('ipc.failure', formatLogPayload({ channel }, error));
        throw error;
      }
    });
  };
  for (const method of ['info', 'warn', 'error'] as const) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]): void => {
      if (
        typeof args[0] === 'string' &&
        args[0].startsWith("Error occurred in handler for '") &&
        isLoggedError(args[1])
      ) {
        original(...args);
        return;
      }
      for (const value of args)
        if (typeof value === 'string' || value instanceof Error)
          log[method]('main.console', formatLogPayload(undefined, value));
      original(...args);
    };
  }
  // Monitor 不拦截 Node 默认退出；默认 throw 模式的未处理 Promise 同样进入此处。
  // 不用 log.errorHandler.startCatching()，它会接管崩溃并让进程带未知状态继续运行。
  process.on('uncaughtExceptionMonitor', (error, origin) => {
    log.error('main.uncaught', formatLogPayload({ origin }, error));
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason !== 'clean-exit')
      log.error(
        'process.gone',
        formatLogPayload({
          type: details.type,
          reason: details.reason,
          exitCode: details.exitCode,
        }),
      );
  });
  app.on('web-contents-created', (_event, contents) => {
    contents.on('console-message', (details) => {
      if (!['info', 'warning', 'error'].includes(details.level)) return;
      const level =
        details.level === 'error'
          ? 'error'
          : details.level === 'warning'
            ? 'warn'
            : 'info';
      log[level](
        'renderer.console',
        formatLogPayload(
          { webContentsId: contents.id, line: details.lineNumber },
          details.message,
        ),
      );
    });
    contents.on('preload-error', (_event, _preloadPath, error) => {
      log.error(
        'renderer.preload',
        formatLogPayload({ webContentsId: contents.id }, error),
      );
    });
    contents.on('render-process-gone', (_event, details) => {
      if (details.reason !== 'clean-exit')
        log.error(
          'renderer.gone',
          formatLogPayload({
            webContentsId: contents.id,
            reason: details.reason,
            exitCode: details.exitCode,
          }),
        );
    });
    contents.on(
      'did-fail-load',
      (_event, code, description, _url, isMainFrame) => {
        if (code === -3) return;
        log.error(
          'renderer.load',
          formatLogPayload(
            { webContentsId: contents.id, code, isMainFrame },
            description,
          ),
        );
      },
    );
  });
};
