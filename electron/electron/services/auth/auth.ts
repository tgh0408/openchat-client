/// <reference types="vite/client" />

import { getAuthApiBase } from '../../../shared/runtime/server-settings';
import { saveServerSettings } from '../database/database-settings';
import {
  requestPasswordLogin,
  parseAuthBase,
  requestRegistration,
  requestSessionValidation,
  requestUserProfile,
} from '../../../shared/auth/auth';
import type {
  AuthSession,
  LoginState,
  SessionValidation,
} from '../../../shared/auth/auth';
import { withoutClientSqlPassword } from '../../../shared/auth/auth';
import { deleteSavedSession, saveLoginAccount } from '../database/database';
import {
  encryptProfileIdentity,
  encryptSessionPayload,
  loadLoginAccounts,
  prepareLoginAccount,
} from './session-storage';
import type { StoredLoginAccount } from './session-storage';
import { createSessionAccess } from './session-access';

const access = createSessionAccess();
let retainedSession: AuthSession | null = null;
const accounts = new Map<string, StoredLoginAccount>();
let selectedAccountId: string | null = null;
let pending: {
  account: StoredLoginAccount;
  deadline: number;
} | null = null;
let requestController: AbortController | undefined;
let validationController: AbortController | undefined;
let authGeneration = 0;

/** 切换、退出或重载时取消校验，旧响应不得更改新账号。 */
const cancelSessionValidation = (): void => {
  validationController?.abort();
  validationController = undefined;
};

/** 向后端校验选中的 JWT，只有明确失效才删除对应账号的令牌。 */
export const validateRetainedSession = async (): Promise<SessionValidation> => {
  cancelSessionValidation();
  const session = getRetainedSession();
  if (!session) return { status: 'expired', message: '登录已过期，请重新登录' };
  const id = selectedAccountId;
  const base = getAuthApiBase();
  const controller = new AbortController();
  validationController = controller;
  try {
    const result = await requestSessionValidation(
      base,
      session,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    if (selectedAccountId !== id) throw new Error('账号已切换，请重试');
    if (getAuthApiBase() !== base) throw new Error('服务器已切换，请重试');
    if (getRetainedSession()?.accessToken !== session.accessToken)
      return { status: 'expired', message: '登录已过期，请重新登录' };
    if (result.status === 'valid') {
      saveServerSettings({
        authApiBase: base,
        rtcServerUrl: result.rtcServerUrl,
      });
      const enrichedSession = {
        ...session,
        clientSqlPassword: result.clientSqlPassword,
        rtcServerUrl: result.rtcServerUrl,
      };
      retainedSession = enrichedSession;
      const account = id ? accounts.get(id) : undefined;
      if (account?.session?.accessToken === session.accessToken)
        accounts.set(account.id, { ...account, session: enrichedSession });
    }
    if (result.status === 'expired') forgetSelectedSession();
    return result;
  } finally {
    if (validationController === controller) validationController = undefined;
  }
};

/** 恢复或切换时校验当前账号，保留网络异常下的 JWT 供用户重试。 */
export const getValidatedLoginState = async (): Promise<LoginState> => {
  if (!getRetainedSession()) return getLoginState();
  const result = await validateRetainedSession();
  return {
    ...getLoginState(),
    ...(result.status === 'valid' ? {} : { validationError: result.message }),
  };
};

/** 取消未完成的真实登录请求，清除尚未被主页面接收的令牌。 */
export const cancelPendingLogin = (): void => {
  requestController?.abort();
  requestController = undefined;
  pending = null;
};

/** 主进程直接向配置的真实服务登录，用户身份只来自后端响应。 */
export const loginWithBackend = async (
  credentials: unknown,
): Promise<AuthSession> => {
  cancelSessionValidation();
  cancelPendingLogin();
  const controller = new AbortController();
  requestController = controller;
  const base = getAuthApiBase();
  try {
    const session = await requestPasswordLogin(
      base,
      credentials,
      controller.signal,
    );
    if (controller.signal.aborted) throw new Error('登录请求已取消');
    const account = await prepareLoginAccount(session, base);
    if (controller.signal.aborted) throw new Error('登录请求已取消');
    if (getAuthApiBase() !== base) throw new Error('服务器已切换，请重试');
    saveServerSettings({
      authApiBase: base,
      rtcServerUrl: session.rtcServerUrl,
    });
    pending = { account, deadline: Date.now() + 60000 };
    return session;
  } finally {
    if (requestController === controller) requestController = undefined;
  }
};

/** 主进程向真实后端提交注册，不把密码或验证码写入本地状态。 */
export const registerWithBackend = async (
  registration: unknown,
): Promise<void> => {
  cancelSessionValidation();
  cancelPendingLogin();
  const controller = new AbortController();
  requestController = controller;
  try {
    await requestRegistration(getAuthApiBase(), registration, controller.signal);
    if (controller.signal.aborted) throw new Error('注册请求已取消');
  } finally {
    if (requestController === controller) requestController = undefined;
  }
};

/** 只接受本进程刚从真实登录接口取得的令牌，不解码任意令牌来授予用户权限。 */
export const consumeLoginSession = (token: string): AuthSession => {
  if (
    !pending ||
    pending.deadline <= Date.now() ||
    pending.account.session?.accessToken !== token
  )
    throw new Error('登录状态已失效，请重新登录');
  const account = pending.account;
  const session = account.session!;
  if (!session.clientSqlPassword?.trim())
    throw new Error('登录响应缺少本地数据库密钥');
  if (session.expiresAt !== null && session.expiresAt * 1000 <= Date.now()) {
    pending = null;
    throw new Error('登录已过期');
  }
  saveLoginAccount(account.encrypted, true);
  accounts.set(account.id, account);
  selectedAccountId = account.id;
  pending = null;
  return session;
};

/** 数据库初始化后恢复会话，仅供快捷入口确认，不授予内容库访问权。 */
export const restoreSavedSession = async (): Promise<void> => {
  const generation = authGeneration;
  const configuredBase = getAuthApiBase();
  const base = configuredBase ? parseAuthBase(configuredBase) : undefined;
  const saved = await loadLoginAccounts(base);
  if (generation !== authGeneration || configuredBase !== getAuthApiBase())
    return;
  accounts.clear();
  for (const account of saved.accounts) accounts.set(account.id, account);
  selectedAccountId = saved.selectedAccountId;
  retainedSession = selectedAccountId
    ? (accounts.get(selectedAccountId)?.session ?? null)
    : null;
};

/** 仅清除选中账号的 JWT，保留历史账号和其他账号的授权。 */
export const forgetSelectedSession = (): void => {
  cancelSessionValidation();
  access.expire();
  retainedSession = null;
  const account = selectedAccountId
    ? accounts.get(selectedAccountId)
    : undefined;
  if (account) {
    const cleared = {
      ...account,
      session: null,
      encrypted: { ...account.encrypted, session: null },
    };
    accounts.set(account.id, cleared);
    saveLoginAccount(cleared.encrypted, true);
  }
};

/** 检查账号有效期，失效时保留历史账号，但撤销当前访问身份。 */
const availableAccountSession = (
  account: StoredLoginAccount,
): AuthSession | null => {
  if (
    account.session &&
    (!account.session.accessToken.trim() ||
      (account.session.expiresAt !== null &&
        account.session.expiresAt * 1000 <= Date.now()))
  ) {
    const cleared = {
      ...account,
      session: null,
      encrypted: { ...account.encrypted, session: null },
    };
    saveLoginAccount(cleared.encrypted, account.id === selectedAccountId);
    accounts.set(account.id, cleared);
    if (account.id === selectedAccountId) {
      access.expire();
      retainedSession = null;
    }
    return null;
  }
  return account.session;
};

/** 返回账号摘要和当前会话，不暴露其他账号的 JWT。 */
export const getLoginState = (): LoginState => {
  const retained = getRetainedSession();
  const summaries = [...accounts.values()].map((account) => ({
    id: account.id,
    account: account.account,
    hasSession: availableAccountSession(account) !== null,
    avatar: account.profile?.avatar ?? undefined,
  }));
  return {
    accounts: summaries,
    selectedAccountId,
    session: retained ? withoutClientSqlPassword(retained) : null,
  };
};

/** 只能选择历史账号或新增登录入口，不能以页面提供的 uid 授权。 */
export const selectLoginAccount = (id: string | null): LoginState => {
  const account = id === null ? null : accounts.get(id);
  if (id !== null && !account) throw new Error('账号不存在，请重新选择');
  clearAuthenticatedSession();
  if (account) {
    const session = availableAccountSession(account);
    saveLoginAccount(accounts.get(account.id)!.encrypted, true);
    selectedAccountId = account.id;
    retainedSession = session;
  } else {
    deleteSavedSession();
    selectedAccountId = null;
  }
  return getLoginState();
};

/** 激活可信会话的内存状态，不在正常关闭时删除已保存的会话。 */
export const setAuthenticatedSession = (session: AuthSession): void => {
  access.activate(session);
  retainedSession = null;
};

/** 页面重载时暂停数据访问，只在主进程内存中保留已有后端会话。 */
export const suspendAuthenticatedSession = (): void => {
  authGeneration++;
  cancelSessionValidation();
  cancelPendingLogin();
  retainedSession = access.current() ?? retainedSession;
  access.clear();
};

/** 读取本进程已有且未到期的后端会话，不接受页面传入的身份。 */
export const getRetainedSession = (): AuthSession | null => {
  const session = access.current() ?? retainedSession;
  if (
    session &&
    (!session.accessToken.trim() ||
      (session.expiresAt !== null && session.expiresAt * 1000 <= Date.now()))
  ) {
    forgetSelectedSession();
    return null;
  }
  return session;
};

/** 仅释放内存会话，正常关闭程序时保留数据库中的加密会话。 */
export const clearAuthenticatedSession = (): void => {
  authGeneration++;
  cancelSessionValidation();
  cancelPendingLogin();
  access.clear();
  retainedSession = null;
};

/** 切换服务器时释放旧账号入口，数据库中的加密账号保留。 */
export const clearServerLoginState = (): void => {
  clearAuthenticatedSession();
  accounts.clear();
  selectedAccountId = null;
};

/** 内容写入和远端访问必须持有本次未过期的后端授权。 */
export const requireAuthenticatedSession = (): AuthSession => {
  return access.requireSession();
};

/** 本地读取同样要求当前账号持有有效 JWT。 */
export const requireLocalUser = (): AuthSession['user'] => access.requireUser();

/** 返回当前权限，不向页面返回过期 JWT。 */
export const getSessionAccess = (): ReturnType<typeof access.status> =>
  access.status();

/** 获取精确的授权对象，避免旧请求使同账号的新令牌失效。 */
export const getActiveSession = (): AuthSession | null => access.current();

/** 进入聊天前拉取真实资料并加密回写，网络失败时保留现有会话不阻断进入。 */
export const enrichSessionProfile = async (
  session: AuthSession,
  validateCurrent: () => void,
): Promise<AuthSession> => {
  const base = getAuthApiBase();
  const id = selectedAccountId;
  const original = id ? accounts.get(id) : undefined;
  /** 退出、账号切换或同账号重新登录后，不允许旧资料请求恢复已清除的令牌。 */
  const validate = (): void => {
    validateCurrent();
    if (selectedAccountId !== id || (id && accounts.get(id) !== original))
      throw new Error('账号已变化，请重试');
  };
  validate();
  const profile = await requestUserProfile(base, session).catch(
    (): null => null,
  );
  validate();
  if (!profile) return session;
  const enriched: AuthSession = {
    ...session,
    user: {
      ...session.user,
      nickname: profile.name || session.user.nickname,
      ...(profile.avatar ? { avatar: profile.avatar } : {}),
      ...(profile.signature ? { signature: profile.signature } : {}),
    },
  };
  try {
    const account = original;
    if (account) {
      const encrypted = {
        ...account.encrypted,
        identity: await encryptProfileIdentity(
          enriched,
          profile,
          base,
        ),
        session: await encryptSessionPayload(enriched, base),
      };
      validate();
      saveLoginAccount(encrypted, true);
      accounts.set(account.id, {
        ...account,
        session: enriched,
        profile,
        encrypted,
      });
    }
  } catch {
    // 加密回写失败时仍返回内存中的真实资料，不阻断进入。
    validate();
  }
  return enriched;
};
