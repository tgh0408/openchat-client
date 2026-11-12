import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import type { UserConfig } from 'vite';

export const electronEntries = [
  'main',
  'main-app',
  'image-ocr-worker',
  'preload',
  'context-menu-preload',
  'settings-preload',
  'update-preload',
  'update-confirm-preload',
  'conversation-preload',
  'history-preload',
  'image-preview-preload',
  'video-preload',
  'rtc-call-preload',
  'rtc-microphone-preload',
  'screenshot-preload',
  'avatar-crop-preload',
  'add-friend-preload',
  'friend-application-preload',
  'friend-verification-preload',
  'friend-profile-preload',
  'friend-remark-preload',
  'tray-preview-preload',
] as const;

/** 为主进程和沙箱预加载脚本生成 CommonJS 入口文件名。 */
const entryFileName = (_format: string, entryName: string): string => {
  return `${entryName}.cjs`;
};

const electronEntrySources: Record<(typeof electronEntries)[number], string> = {
  main: 'main-bootstrap',
  'main-app': 'pages/workspace/main',
  'image-ocr-worker': 'services/media/image/image-ocr-worker',
  preload: 'pages/workspace/preload',
  'context-menu-preload': 'pages/context-menu/context-menu-preload',
  'settings-preload': 'pages/settings/settings-preload',
  'update-preload': 'pages/update/update-preload',
  'update-confirm-preload': 'pages/update/update-confirm-preload',
  'conversation-preload': 'pages/conversation/conversation-preload',
  'history-preload': 'pages/history/history-preload',
  'image-preview-preload': 'pages/image-preview/image-preview-preload',
  'video-preload': 'pages/video-player/video-preload',
  'rtc-call-preload': 'pages/rtc/rtc-call-preload',
  'rtc-microphone-preload': 'pages/rtc/device-menu/rtc-microphone-preload',
  'screenshot-preload': 'pages/screenshot/screenshot-preload',
  'avatar-crop-preload': 'pages/avatar-crop/avatar-crop-preload',
  'add-friend-preload': 'pages/contacts/add-friend/add-friend-preload',
  'friend-application-preload':
    'pages/contacts/application/friend-application-preload',
  'friend-verification-preload':
    'pages/contacts/application/friend-verification-preload',
  'friend-profile-preload': 'pages/contacts/profile/friend-profile-preload',
  'friend-remark-preload': 'pages/contacts/remark/friend-remark-preload',
  'tray-preview-preload': 'pages/tray-preview/tray-preview-preload',
};

/** 每个入口单独构建，避免共享模块被拆成沙箱无法加载的本地分块。 */
export const createElectronBuildConfig = (
  entry: (typeof electronEntries)[number],
  emptyOutDir: boolean,
): UserConfig => ({
  build: {
    outDir: 'dist-electron',
    // 安装资源统一由 extraFiles 部署到 public，不向 Electron 产物复制。
    copyPublicDir: false,
    emptyOutDir,
    target: 'node22',
    sourcemap: true,
    minify: false,
    lib: {
      entry: {
        [entry]: fileURLToPath(
          new URL(
            `./electron/${electronEntrySources[entry]}.ts`,
            import.meta.url,
          ),
        ),
      },
      formats: ['cjs'],
      fileName: entryFileName,
    },
    rolldownOptions: {
      output: {
        // 沙箱 preload 不能 require 本地分块，各入口必须内联共享代码。
        codeSplitting: false,
      },
      external: [
        'electron',
        'ppu-paddle-ocr',
        'onnxruntime-node',
        // electron-log 在模块加载时注册唯一 IPC 通道，必须由 Node 的
        // require 缓存保证两个主进程入口共享同一实例。
        'electron-log',
        'electron-log/main',
        'node-machine-id',
        'better-sqlite3-multiple-ciphers',
        'uiohook-napi',
        'koffi',
        'ffmpeg-static',
        '@ffprobe-installer/ffprobe',
        /^node:/,
      ],
    },
  },
});

export default defineConfig(createElectronBuildConfig('main', true));
