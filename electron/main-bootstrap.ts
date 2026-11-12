import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  protocol,
  session,
} from 'electron';
import type { IpcMainInvokeEvent } from 'electron';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { configureRuntimePaths } from './services/runtime/runtime-paths';
import { getApplicationIcon } from './services/runtime/application-icon';
import { initializeLogger } from './services/logging/logger';
import { installDiagnostics } from './services/logging/diagnostics';

const started = performance.now();
let window: BrowserWindow | undefined;
let stopping = false;
let handedOver = false;
let loading: Promise<void> | undefined;
let storageDirectory = '';

/** 可选输出不含账号或地址的阶段耗时，包含进入 JS 之前的进程启动时间。 */
const mark = (stage: string): void => {
  if (process.env.OPENCHAT_STARTUP_TIMING !== '1') return;
  console.info(
    '[startup:timing]',
    JSON.stringify({
      stage,
      elapsedMs: Math.round(performance.now() - started),
      processMs: Math.round(process.uptime() * 1000),
    }),
  );
};

/** 启动错误明确退出，不留下隐藏进程或自动改换数据目录。 */
const fail = (error: unknown): void => {
  if (stopping) return;
  stopping = true;
  console.error('Failed to start Electron:', error);
  dialog.showErrorBox(
    '无法启动 OpenChat',
    '请检查程序文件是否完整、程序目录是否可写，然后重新启动。不会自动删除本地数据。',
  );
  app.exit(1);
};

/** 获取唯一主页面地址，供首屏 IPC 校验。 */
const getRendererUrl = (): string => {
  if (!app.isPackaged && process.env.VITE_DEV_SERVER_URL)
    return new URL(process.env.VITE_DEV_SERVER_URL).href;
  return pathToFileURL(path.join(__dirname, '../dist/index.html')).href;
};

/** 启动接口仅接受当前存活窗口的主框架，不接受子窗口或其他来源。 */
const validate = (event: IpcMainInvokeEvent): BrowserWindow => {
  if (
    stopping ||
    !window ||
    window.isDestroyed() ||
    window.webContents.isDestroyed() ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame ||
    event.senderFrame.url !== getRendererUrl()
  )
    throw new Error('无效的启动窗口调用');
  return window;
};

/** 首屏显示后才加载独立业务产物；关闭窗口会取消尚未开始的交接。 */
const loadApplication = async (current: BrowserWindow): Promise<void> => {
  await new Promise<void>((resolve) => setImmediate(resolve));
  if (stopping || current.isDestroyed()) return;
  mark('business-load-start');
  const require = createRequire(__filename);
  const application: typeof import('./pages/workspace/main') = require('./main-app.cjs');
  mark('business-loaded');
  if (stopping || current.isDestroyed()) return;
  await application.startMainApplication(current, storageDirectory, mark);
  handedOver = true;
};

/** 安全策略先于 renderer 加载，数据库及业务模块不在此入口导入。 */
const startBootstrap = async (): Promise<void> => {
  if (stopping) return;
  mark('electron-ready');
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  session.defaultSession.on('will-download', (event) => event.preventDefault());
  window = new BrowserWindow({
    width: 282,
    height: 380,
    useContentSize: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    frame: false,
    // 登录窗口独立创建，保持现有非透明外观。
    transparent: false,
    backgroundColor: '#f9f9f9',
    show: false,
    title: 'OpenChat',
    icon: getApplicationIcon(),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  const current = window;
  current.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  current.webContents.on('will-navigate', (event) => event.preventDefault());
  current.webContents.on('preload-error', () =>
    fail(new Error('主窗口预加载失败')),
  );
  current.webContents.on('render-process-gone', () => {
    if (!handedOver) fail(new Error('登录页面进程已退出'));
  });
  current.on('closed', () => {
    if (window === current) window = undefined;
    if (!handedOver) {
      stopping = true;
      app.quit();
    }
  });
  ipcMain.handle('window:close', (event) => validate(event).close());
  ipcMain.handle('startup:get-phase', (event) => {
    validate(event);
    return 'settings';
  });
  ipcMain.handle('startup:rendered', (event) => {
    const target = validate(event);
    if (!target.isVisible()) {
      target.show();
      mark('login-visible');
    }
    loading ??= loadApplication(target);
    void loading.catch(fail);
  });
  mark('window-created');
  await current.loadURL(getRendererUrl());
  mark('document-loaded');
};

/** 路径、协议和单实例锁在 ready 之前完成，只在拥有锁时创建窗口。 */
const prepare = (): void => {
  try {
    mark('entry');
    storageDirectory = configureRuntimePaths();
    initializeLogger(storageDirectory);
    installDiagnostics();
    protocol.registerSchemesAsPrivileged([
      {
        scheme: 'openchat-video',
        privileges: {
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          corsEnabled: true,
        },
      },
    ]);
    mark('paths-ready');
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      return;
    }
    app.on('before-quit', () => {
      stopping = true;
    });
    app.on('second-instance', () => {
      if (handedOver || !window || window.isDestroyed()) return;
      if (window.isMinimized()) window.restore();
      window.focus();
    });
    void app.whenReady().then(startBootstrap).catch(fail);
  } catch (error) {
    fail(error);
  }
};

prepare();
