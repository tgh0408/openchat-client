import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { configureLocalEnvironment } from '../../../shared/runtime/node/local-environment';

export const applicationDirectory = app.isPackaged
  ? path.dirname(app.getPath('exe'))
  : app.getAppPath();

/** 获取项目内的测试数据目录；正式运行固定使用应用目录，不接受外部存储路径。 */
const getStorageDirectory = (): string => {
  const testDirectory = process.env.OPENCHAT_TEST_DATA_DIR;
  if (app.isPackaged || !testDirectory) return applicationDirectory;
  const directory = path.resolve(testDirectory);
  const relative = path.relative(
    path.join(applicationDirectory, 'test-results'),
    directory,
  );
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('测试数据目录必须位于项目 test-results 的子目录中。');
  }
  return directory;
};

/** 在 ready 和单实例锁之前重定向 Electron 数据、缓存、日志及崩溃报告目录。 */
export const configureRuntimePaths = (): string => {
  const root = getStorageDirectory();
  configureLocalEnvironment(root);
  const directories: Record<string, string> = {
    appData: '.runtime/app-data',
    userData: '.runtime/user-data',
    sessionData: '.runtime/session',
    temp: '.runtime/temp',
    logs: 'log',
    crashDumps: '.runtime/crashes',
  };
  for (const [name, relativePath] of Object.entries(directories)) {
    const directory = path.join(root, relativePath);
    mkdirSync(directory, { recursive: true });
    app.setPath(name, directory);
  }
  app.commandLine.appendSwitch('user-data-dir', app.getPath('userData'));
  app.commandLine.appendSwitch(
    'disk-cache-dir',
    path.join(app.getPath('sessionData'), 'Cache'),
  );
  app.commandLine.appendSwitch('log-file', process.env.ELECTRON_LOG_FILE!);
  return root;
};
