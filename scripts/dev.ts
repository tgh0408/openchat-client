import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createServer } from 'vite';
import type { ViteDevServer } from 'vite';
import electron from 'electron';
import { buildElectron } from './electron-build';

let server: ViteDevServer | undefined;
let child: ChildProcess | undefined;
let stopping = false;

/**
 * 停止桌面子进程和开发服务器；重复调用不会重复清理资源。
 * @param code 开发进程的退出状态码，默认为正常退出。
 */
const stop = async (code: number = 0): Promise<void> => {
  if (stopping) return;
  stopping = true;
  if (child && child.exitCode === null) child.kill();
  await server?.close();
  process.exit(code);
};

/** 输出开发服务或 Electron 子进程错误，并清理已启动的资源。 */
const handleError = (error: unknown): void => {
  console.error(error);
  void stop(1);
};

/** Electron 窗口关闭后，同步结束开发服务器。 */
const handleExit = (code: number | null): void => {
  void stop(code ?? 0);
};

/** 收到终止信号时，正常关闭开发环境。 */
const handleSignal = (): void => {
  void stop();
};

/** 编译 Electron TypeScript 入口，启动 Vite，再启动桌面窗口。 */
const startDevelopment = async (): Promise<void> => {
  // npm 的 electron 入口在 Node.js 中返回可执行文件路径，而非 Electron API。
  const executable: unknown = electron;
  if (typeof executable !== 'string') {
    throw new TypeError('Electron executable path is unavailable.');
  }

  await buildElectron();
  server = await createServer();
  await server.listen();
  server.printUrls();

  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('Vite did not provide a local development URL.');

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    VITE_DEV_SERVER_URL: url,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  child = spawn(executable, ['.'], { env, stdio: 'inherit' });
  child.on('exit', handleExit);
  child.on('error', handleError);
};

process.on('SIGINT', handleSignal);
process.on('SIGTERM', handleSignal);
void startDevelopment().catch(handleError);
