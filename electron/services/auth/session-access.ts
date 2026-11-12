import type {
  AuthSession,
  AuthUser,
  SessionAccess,
} from '../../../shared/auth/auth';
import { SessionExpiredError } from '../../../shared/auth/auth';

interface SessionAccessController {
  activate: (value: AuthSession) => void;
  current: () => AuthSession | null;
  expire: () => void;
  clear: () => void;
  status: () => SessionAccess;
  requireUser: () => AuthUser;
  requireSession: () => AuthSession;
}

/** 本地与远端访问均依赖本次已验证的有效 JWT，不以离线状态代替授权。 */
export const createSessionAccess = (): SessionAccessController => {
  let session: AuthSession | null = null;

  /** 仅在真实授权完成后建立当前账号的访问范围。 */
  const activate = (value: AuthSession): void => {
    session = value;
  };
  /** 读取当前令牌对象，用于拒绝旧请求和旧计时器。 */
  const current = (): AuthSession | null => session;
  /** 令牌失效时同时撤销本地与远端访问。 */
  const expire = (): void => {
    session = null;
  };
  /** 退出、切换或重载时同时撤销本地阅读权。 */
  const clear = (): void => {
    session = null;
  };
  /** 返回不含令牌的权限状态，缺失或过期令牌不能维持身份。 */
  const status = (): SessionAccess => {
    const unavailable =
      !session ||
      !session.accessToken.trim() ||
      (session.expiresAt !== null && session.expiresAt * 1000 <= Date.now());
    return {
      userId: unavailable ? null : (session?.user.id ?? null),
      readOnly: unavailable,
    };
  };
  /** 所有数据访问必须持有未过期且非空的授权。 */
  const requireSession = (): AuthSession => {
    if (!session || status().readOnly)
      throw new SessionExpiredError('登录状态已失效，请重新登录');
    return session;
  };
  /** 本地读取同样校验 JWT，不接受页面指定身份或无令牌的只读回退。 */
  const requireUser = (): AuthUser => requireSession().user;
  return {
    activate,
    current,
    expire,
    clear,
    status,
    requireUser,
    requireSession,
  };
};
