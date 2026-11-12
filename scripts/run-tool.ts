import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { configureLocalEnvironment } from '../shared/runtime/node/local-environment.ts';

/** 在加载工具前固定项目目录和环境，避免工具默认写入用户缓存或系统临时目录。 */
const runTool = (): void => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  configureLocalEnvironment(root);
  process.chdir(root);
  const tools: Record<string, string> = {
    tsx: 'tsx/dist/cli.mjs',
    vite: 'vite/bin/vite.js',
    tsc: 'typescript/bin/tsc',
    electron: 'electron/cli.js',
    prettier: 'prettier/bin/prettier.cjs',
    playwright: '@playwright/test/cli.js',
  };
  const [tool, ...args] = process.argv.slice(2);
  const entry =
    tool === 'npm'
      ? process.env.npm_execpath
      : tool && Object.prototype.hasOwnProperty.call(tools, tool)
        ? path.join(root, 'node_modules', tools[tool]!)
        : undefined;
  if (!entry) throw new Error('无效的工具名称，请通过项目 npm 脚本运行。');
  const child = spawn(process.execPath, [entry, ...args], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  child.on('error', (error: Error): void => {
    console.error(error);
    process.exitCode = 1;
  });
  child.on('exit', (code: number | null): void => {
    process.exitCode = code ?? 1;
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
};

runTool();
