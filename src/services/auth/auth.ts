import {
  parseAuthBase,
  parseCredentials,
  parseRegistration,
  requestPasswordLogin,
  requestRegistration,
  requestSessionValidation,
  requestSessionLogout,
} from '../../../shared/auth/auth';
import type { AuthSession, LoginState } from '../../../shared/auth/auth';
import { initializeBrowserDeviceIdentity } from '../../../shared/auth/device-identity';
import { getRequestErrorMessage } from '../../../shared/api/api-error';
export type {
  AuthSession,
  AuthUser,
  LoginState,
  SavedLoginAccount,
} from '../../../shared/auth/auth';

const configuredBase = import.meta.env.VITE_AUTH_API_BASE?.trim();
// 浏览器没有系统设备标识，沿用预览仅存内存的边界；刷新后账号也须重新登录。
if (!window.desktop) initializeBrowserDeviceIdentity();
const browserAccounts = new Map<
  string,
  { account: string; session: AuthSession | null }
>();
let browserSelectedId: string | null = null;
let browserValidationController: AbortController | undefined;

/** 浏览器切换或退出时取消旧校验，防止旧响应清除新账号。 */
const cancelBrowserValidation = (): void => {
  browserValidationController?.abort();
  browserValidationController = undefined;
};

/** 提取业务错误，隐藏 Electron IPC 包装，不输出任何令牌。 */
export const getAuthErrorMessage = (
  cause: unknown,
  fallback: string,
): string => {
  return getRequestErrorMessage(cause, fallback);
};

/** 桌面读取加密历史账号；浏览器预览只保留当前页面内存。 */
export const getLoginState = async (
  checkServer: boolean = true,
): Promise<LoginState> => {
  if (window.desktop) return window.desktop.getLoginState(checkServer);
  for (const account of browserAccounts.values()) {
    if (
      account.session &&
      (!account.session.accessToken.trim() ||
        (account.session.expiresAt !== null &&
          account.session.expiresAt * 1000 <= Date.now()))
    )
      account.session = null;
  }
  const state: LoginState = {
    accounts: [...browserAccounts].map(([id, account]) => ({
      id,
      account: account.account,
      hasSession: !!account.session,
      avatar: account.session?.user.avatar,
    })),
    selectedAccountId: browserSelectedId,
    session: browserSelectedId
      ? (browserAccounts.get(browserSelectedId)?.session ?? null)
      : null,
  };
  if (!checkServer || !state.session) return state;
  cancelBrowserValidation();
  const controller = new AbortController();
  browserValidationController = controller;
  try {
    const result = await requestSessionValidation(
      configuredBase,
      state.session,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    if (browserSelectedId !== state.selectedAccountId)
      throw new Error('账号已切换，请重试');
    if (result.status === 'expired') {
      const account = browserSelectedId
        ? browserAccounts.get(browserSelectedId)
        : undefined;
      if (account?.session?.accessToken === state.session.accessToken)
        account.session = null;
    }
    if (result.status === 'valid') {
      const account = browserSelectedId
        ? browserAccounts.get(browserSelectedId)
        : undefined;
      if (account?.session?.accessToken === state.session.accessToken)
        account.session = {
          ...account.session,
          clientSqlPassword: result.clientSqlPassword,
        };
    }
    return {
      ...(await getLoginState(false)),
      ...(result.status === 'valid' ? {} : { validationError: result.message }),
    };
  } finally {
    if (browserValidationController === controller)
      browserValidationController = undefined;
  }
};

/** 选择历史账号时不发起密码登录请求。 */
export const selectLoginAccount = async (
  id: string | null,
): Promise<LoginState> => {
  if (window.desktop) return window.desktop.selectLoginAccount(id);
  if (id !== null && !browserAccounts.has(id)) throw new Error('账号不存在');
  cancelBrowserValidation();
  browserSelectedId = id;
  return getLoginState();
};

/** 接收真实后端响应，或恢复当前选择账号的已有 JWT。 */
export const authorizeSession = async (
  value: AuthSession,
  resume: boolean,
): Promise<AuthSession> => {
  if (window.desktop)
    return resume
      ? window.desktop.resumeSession()
      : window.desktop.authorizeSession(value.accessToken);
  if (resume) {
    const state = await getLoginState();
    if (state.validationError) throw new Error(state.validationError);
    if (!state.session) throw new Error('登录已过期');
    return state.session;
  }
  browserAccounts.set(value.user.id, {
    account: value.user.account,
    session: value,
  });
  browserSelectedId = value.user.id;
  return value;
};

/** 配置存在不代表服务已连接；聊天页面不能据此宣称在线。 */
export const getServerConfiguration = ():
  'missing' | 'invalid' | 'configured' => {
  if (!configuredBase) return 'missing';
  try {
    parseAuthBase(configuredBase);
    return 'configured';
  } catch {
    return 'invalid';
  }
};

/** 浏览器预览读取当前内存会话；Electron 端不向渲染层暴露 JWT。 */
export const getCurrentBrowserSession = (): AuthSession | null => {
  if (window.desktop || !browserSelectedId) return null;
  return browserAccounts.get(browserSelectedId)?.session ?? null;
};

/** 桌面通过主进程请求后端；浏览器直接请求同一真实接口，需后端允许 CORS。 */
export const loginWithPassword = async (
  account: string,
  password: string,
  signal: AbortSignal,
): Promise<AuthSession> => {
  const credentials = parseCredentials({ account, password });
  signal.throwIfAborted();
  if (!window.desktop)
    return requestPasswordLogin(configuredBase, credentials, signal);
  const desktop = window.desktop;
  /** 模式切换时取消主进程请求，防止旧请求返回后留下待接收授权。 */
  const cancel = (): void => {
    void desktop.cancelLogin().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    const session = await desktop.login(credentials);
    signal.throwIfAborted();
    return session;
  } finally {
    signal.removeEventListener('abort', cancel);
  }
};

/** 提交注册表单；桌面端由主进程请求，浏览器预览直接请求后端。 */
export const registerWithPassword = async (
  account: string,
  username: string,
  password: string,
  signal: AbortSignal,
  avatar?: Uint8Array,
): Promise<void> => {
  const registration = parseRegistration({
    account,
    username,
    password,
    avatar,
  });
  signal.throwIfAborted();
  if (!window.desktop) {
    await requestRegistration(configuredBase, registration, signal);
    return;
  }
  const desktop = window.desktop;
  /** 离开注册页面时中止主进程中的当前请求。 */
  const cancel = (): void => {
    void desktop.cancelLogin().catch(() => undefined);
  };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await desktop.register(registration);
    signal.throwIfAborted();
  } finally {
    signal.removeEventListener('abort', cancel);
  }
};

/** 桌面交由主进程退出；浏览器撤销原令牌后仅清理对应的内存会话。 */
export const logoutSession = async (): Promise<string> => {
  cancelBrowserValidation();
  if (window.desktop) {
    await window.desktop.endSession();
    return '';
  }
  const account = browserSelectedId
    ? browserAccounts.get(browserSelectedId)
    : undefined;
  const session = account?.session;
  if (!account || !session) return '';
  const notice = await requestSessionLogout(configuredBase, session);
  if (account.session === session) account.session = null;
  return notice;
};
