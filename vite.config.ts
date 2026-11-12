import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { loadEnv, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

const defaultConnectSources = [
  "'self'",
  'openchat-video:',
  'https:',
  'ws://127.0.0.1:5173',
];

/** 将 LiveKit WebSocket 地址转换为 CSP 所需的信令与校验地址。 */
const readRtcConnectSources = (rawServerUrl: string | undefined): string[] => {
  const serverUrl = rawServerUrl?.trim();
  if (!serverUrl) return [];

  let parsed: URL;
  try {
    parsed = new URL(serverUrl);
  } catch {
    throw new Error('VITE_RTC_SERVER_URL 必须是有效的 ws:// 或 wss:// 地址');
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    throw new Error('VITE_RTC_SERVER_URL 必须使用 ws:// 或 wss:// 协议');
  }
  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.hostname
  ) {
    throw new Error('VITE_RTC_SERVER_URL 不得包含用户名、密码、查询参数或片段');
  }

  const httpProtocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  const host = parsed.host;
  return [`${parsed.protocol}//${host}`, `${httpProtocol}//${host}`];
};

/** 在 Vite 生成页面时注入精确的 connect-src，避免放开任意 WebSocket。 */
const createContentSecurityPolicyPlugin = (
  rtcServerUrl: string | undefined,
  authApiBase: string | undefined,
): Plugin => {
  const authSource = authApiBase?.trim();
  const connectSources = [
    ...defaultConnectSources,
    ...(authSource ? [new URL(authSource).origin] : []),
    ...readRtcConnectSources(rtcServerUrl),
  ];
  const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self' blob: 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "media-src 'self' blob: openchat-video:",
    "img-src 'self' data: blob: https: http://localhost:* http://127.0.0.1:*",
    `connect-src ${connectSources.join(' ')}`,
  ].join('; ');

  return {
    name: 'openchat-content-security-policy',
    transformIndexHtml(html: string): string {
      return html.replace(
        '__OPENCHAT_CONTENT_SECURITY_POLICY__',
        contentSecurityPolicy,
      );
    },
  };
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    base: './',
    plugins: [
      vue(),
      createContentSecurityPolicyPlugin(
        env.VITE_RTC_SERVER_URL,
        env.VITE_AUTH_API_BASE,
      ),
    ],
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      watch: {
        // 运行数据不是源码，避免监听 Electron 锁定文件及持续写入的缓存。
        ignored: [
          '.runtime',
          '.cache',
          'database',
          'backups',
          'file',
          'log',
          'dist-electron',
          'release',
          'test-results',
          'playwright-report',
        ].map(
          (directory) =>
            `${fileURLToPath(new URL(`./${directory}/`, import.meta.url)).replaceAll('\\', '/')}**`,
        ),
      },
    },
  };
});
