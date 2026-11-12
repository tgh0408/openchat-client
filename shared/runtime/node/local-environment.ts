import { mkdirSync } from 'node:fs';
import path from 'node:path';

/** 创建应用内的缓存和临时目录，限制当前进程及子进程的默认写入位置。 */
export const configureLocalEnvironment = (root: string): void => {
  const directories: Record<string, string> = {
    TEMP: '.runtime/temp',
    TMP: '.runtime/temp',
    TMPDIR: '.runtime/temp',
    HOME: '.runtime/home',
    USERPROFILE: '.runtime/home',
    APPDATA: '.runtime/app-data',
    LOCALAPPDATA: '.runtime/local-app-data',
    XDG_CACHE_HOME: '.cache',
    XDG_CONFIG_HOME: '.runtime/config',
    XDG_DATA_HOME: '.runtime/data',
    XDG_STATE_HOME: '.runtime/state',
    npm_config_cache: '.cache/npm',
    npm_config_devdir: '.cache/node-gyp',
    electron_config_cache: '.cache/electron',
    PLAYWRIGHT_BROWSERS_PATH: '.cache/playwright',
    NODE_COMPILE_CACHE: '.cache/node',
  };
  for (const [name, relativePath] of Object.entries(directories)) {
    const directory = path.join(root, relativePath);
    mkdirSync(directory, { recursive: true });
    process.env[name] = directory;
  }
  // Windows 文件选择器会访问隔离 USERPROFILE 下的桌面，即使指定了默认路径。
  mkdirSync(path.join(root, '.runtime/home/Desktop'), { recursive: true });
  mkdirSync(path.join(root, 'log'), { recursive: true });
  process.env.ELECTRON_LOG_FILE = path.join(root, 'log/electron.log');
};
