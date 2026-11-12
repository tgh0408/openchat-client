import { decodeJwt } from 'jose';
import {
  parseRegistrationAvatar,
  registrationAvatarMime,
} from './registration-avatar';
import { parseAuthBase } from '../api/api-request';
import { requestApi } from '../api/api-client';
import {
  ApiResponseError,
  getApiErrorMessage,
  getRequestErrorMessage,
  SessionExpiredError,
} from '../api/api-error';
import { parseApiResult } from '../api/api-response';
export { SessionExpiredError } from '../api/api-error';
export { parseAuthBase } from '../api/api-request';

/** 与后端 IdTypeEnum 的 code 映射一致，请求直接传递数字枚举值。 */
export enum IdTypeEnum {
  UNKNOWN = 0,
  PHONE = 1,
  EMAIL = 2,
  ID = 3,
}

/** 注册资料与可选头像字节，仅驻留内存并随同一表单提交。 */
export interface Registration {
  account: string;
  username: string;
  password: string;
  avatar?: Uint8Array;
}

/** 登录服务返回的用户资料，桌面账号随 JWT 一同加密保存。 */
export interface AuthUser {
  id: string;
  account: string;
  nickname: string;
  avatar?: string;
  signature?: string;
}

/** 后端授权会话；没有 exp 声明时不自行推算令牌有效期。 */
export interface AuthSession {
  accessToken: string;
  expiresAt: number | null;
  user: AuthUser;
  /** 用户创建时固定的本地内容库密钥，仅主进程会话保留。 */
  clientSqlPassword?: string;
}

/** 当前页面的本地访问范围，不包含 JWT，也不能用于恢复授权。 */
export interface SessionAccess {
  userId: string | null;
  readOnly: boolean;
}

/** 服务端明确撤销当前会话的原因，不包含令牌或其他设备信息。 */
export type SessionInvalidationReason = 'SESSION_REPLACED' | 'SESSION_EXPIRED';

/** 历史账号摘要，不携带其他账号的 JWT。 */
export interface SavedLoginAccount {
  id: string;
  account: string;
  hasSession: boolean;
  avatar?: string;
}

/** 登录入口状态；仅返回当前选择账号的有效会话。 */
export interface LoginState {
  accounts: SavedLoginAccount[];
  selectedAccountId: string | null;
  session: AuthSession | null;
  validationError?: string;
}

/** 区分明确失效和暂时无法校验，网络异常不能删除已有 JWT。 */
export type SessionValidation =
  | { status: 'valid'; clientSqlPassword: string }
  | { status: 'expired' | 'unavailable'; message: string };

/** 移除不应暴露给渲染进程的本地数据库密钥。 */
export const withoutClientSqlPassword = (
  session: AuthSession,
): AuthSession => {
  const { clientSqlPassword: _clientSqlPassword, ...publicSession } = session;
  return publicSession;
};

/** 校验 globalUid 业务响应，必须与保存的聊天 uid 一致才能恢复授权。 */
export const parseGlobalUidResponse = (
  value: unknown,
  expectedUid: string,
): SessionValidation => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('success' in value) ||
    typeof value.success !== 'boolean' ||
    !('code' in value) ||
    typeof value.code !== 'number'
  )
    return {
      status: 'unavailable',
      message: '登录校验服务返回的数据无效，请重试',
    };
  if (value.code >= 500)
    return {
      status: 'unavailable',
      message: getApiErrorMessage(value, '登录校验服务暂不可用，请稍后重试'),
    };
  const data = 'data' in value ? value.data : null;
  const uid =
    data && typeof data === 'object' && !Array.isArray(data) && 'uid' in data
      ? data.uid
      : null;
  const clientSqlPassword =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    'clientSqlPassword' in data
      ? data.clientSqlPassword
      : null;
  if (
    !value.success ||
    value.code !== 200 ||
    !(
      (typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0) ||
      (typeof uid === 'string' && /^[1-9]\d{0,63}$/.test(uid))
    ) ||
    typeof clientSqlPassword !== 'string' ||
    !clientSqlPassword.trim() ||
    clientSqlPassword.length > 256
  )
    return {
      status: 'expired',
      message: getApiErrorMessage(value, '登录已过期，请重新登录'),
    };
  if (String(uid) !== expectedUid)
    return {
      status: 'expired',
      message: '登录身份与当前账号不一致，请重新登录',
    };
  return { status: 'valid', clientSqlPassword };
};

/** 携带当前 JWT 请求全局 uid；不记录令牌，也不跟随携带凭据的重定向。 */
export const requestSessionValidation = async (
  base: string | undefined,
  session: AuthSession,
  signal?: AbortSignal,
): Promise<SessionValidation> => {
  if (
    !session.accessToken.trim() ||
    (session.expiresAt !== null && session.expiresAt * 1000 <= Date.now())
  )
    return { status: 'expired', message: '登录状态已失效，请重新登录' };
  parseAuthBase(base);
  try {
    return await requestApi(
      { base, session },
      {
        path: '/capi/user/globalUid',
        method: 'GET',
        signal,
        serviceName: '登录校验',
        networkError: '无法连接登录校验服务或请求超时，请重试',
        httpError: '登录校验服务暂不可用，请稍后重试',
        parse: (result: unknown): SessionValidation =>
          parseGlobalUidResponse(result, session.user.id),
      },
    );
  } catch (error) {
    signal?.throwIfAborted();
    if (
      error instanceof SessionExpiredError ||
      (error instanceof ApiResponseError &&
        error.kind === 'business' &&
        error.code !== undefined &&
        error.code < 500)
    )
      return { status: 'expired', message: error.message };
    return {
      status: 'unavailable',
      message: getRequestErrorMessage(
        error,
        '登录校验服务暂不可用，请稍后重试',
      ),
    };
  }
};

/** 撤销本次令牌；失败返回明确提示，调用方仍须清理本地授权。 */
export const requestSessionLogout = async (
  base: string | undefined,
  session: AuthSession,
): Promise<string> => {
  try {
    await requestApi(
      { base, session },
      {
        path: '/capi/user/loginOut',
        method: 'POST',
        timeoutMs: 3000,
        serviceName: '退出登录',
        parse: (result: unknown): void => {
          if (parseApiResult(result, '退出登录').data !== null)
            throw new Error('退出登录服务返回的数据无效');
        },
      },
    );
    return '';
  } catch (error) {
    // 重复退出或已被替换的令牌会被鉴权入口拒绝，不再尝试撤销其他会话。
    if (error instanceof SessionExpiredError) return '';
    return `已退出本机，但未能确认服务端令牌撤销：${getRequestErrorMessage(error, '请检查网络')}`;
  }
};

/** 从资料对象中清洗公开字段，头像只接受 http(s) 地址。 */
export const readProfileFields = (
  value: Record<string, unknown>,
): { name: string; avatar?: string; signature?: string } => {
  const name =
    typeof value.name === 'string' ? value.name.trim().slice(0, 64) : '';
  const avatar =
    typeof value.avatar === 'string' && /^https?:\/\//.test(value.avatar.trim())
      ? value.avatar.trim().slice(0, 2048)
      : undefined;
  const signature =
    typeof value.personalitySignature === 'string' &&
    value.personalitySignature.trim()
      ? value.personalitySignature.trim().slice(0, 512)
      : undefined;
  return { name, avatar, signature };
};

/** 后端用户资料接口返回的公开资料；name 为空时调用方回退占位昵称。 */
export interface UserProfile {
  name: string;
  avatar: string | null;
  signature: string | null;
}

/** 当前阅读者的好友备注及本次房间昵称，不写入共享身份或公共消息。 */
export interface ContactProfile extends UserProfile {
  remark: string | null;
  groupNickname: string | null;
  roomId: string | null;
}

/** 严格校验名称及房间绑定；不能把其他群的昵称用于本次查询。 */
export const parseContactProfile = (
  value: unknown,
  expectedUid: string,
  roomId?: string,
): ContactProfile => {
  const profile = parseUserProfile(value, expectedUid);
  const data = (value as { data: Record<string, unknown> }).data;
  for (const field of ['remark', 'groupNickname']) {
    const name = data[field];
    if (
      name != null &&
      (typeof name !== 'string' || name.length > 64 || name.includes('\0'))
    )
      throw new Error('联系人名称格式无效');
  }
  if ((data.roomId ?? null) !== (roomId ?? null))
    throw new Error('联系人昵称与请求的房间不一致');
  return {
    ...profile,
    remark: typeof data.remark === 'string' ? data.remark.trim() || null : null,
    groupNickname:
      typeof data.groupNickname === 'string'
        ? data.groupNickname.trim() || null
        : null,
    roomId: roomId ?? null,
  };
};

/** 校验用户资料业务响应，uid 必须与本次请求的目标用户一致。 */
export const parseUserProfile = (
  value: unknown,
  expectedUid: string,
): UserProfile => {
  const { data } = parseApiResult(value, '用户资料');
  if (!data || typeof data !== 'object')
    throw new Error('用户资料服务返回的数据无效');
  const profile = data as Record<string, unknown>;
  if (String(profile.uid) !== expectedUid)
    throw new Error('用户资料与请求的用户不一致');
  const { name, avatar, signature } = readProfileFields(profile);
  return { name, avatar: avatar ?? null, signature: signature ?? null };
};

/** 携带当前 JWT 请求用户公开资料；失败不阻断进入，由调用方回退。 */
export const requestUserProfile = async (
  base: string | undefined,
  session: AuthSession,
  signal?: AbortSignal,
): Promise<UserProfile> => {
  return requestApi(
    { base, session },
    {
      path: '/capi/user/userinfo',
      method: 'GET',
      signal,
      serviceName: '用户资料',
      networkError: '无法连接用户资料服务或请求超时',
      parse: (result: unknown): UserProfile =>
        parseUserProfile(result, session.user.id),
    },
  );
};

/** 按 uid 拉取对方公开资料，code 使用后端 IdTypeEnum.ID 的数字编码 3。 */
export const requestUserInfo = async (
  base: string | undefined,
  session: AuthSession,
  uid: string,
  signal?: AbortSignal,
  roomId?: string,
): Promise<ContactProfile> => {
  return requestApi(
    { base, session },
    {
      path: '/capi/user/target/info',
      method: 'POST',
      body: { code: IdTypeEnum.ID, searchText: uid, roomId },
      signal,
      serviceName: '用户资料',
      networkError: '无法连接用户资料服务或请求超时',
      parse: (result: unknown): ContactProfile =>
        parseContactProfile(result, uid, roomId),
    },
  );
};

/** 校验账号密码请求的类型和长度，不将密码写入文件或日志。 */
export const parseCredentials = (
  value: unknown,
): { account: string; password: string } => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('account' in value) ||
    !('password' in value)
  )
    throw new Error('请输入账号和密码');
  const { account, password } = value;
  if (
    typeof account !== 'string' ||
    !account.trim() ||
    account.length > 64 ||
    typeof password !== 'string' ||
    !password.trim() ||
    password.length > 256
  )
    throw new Error('请输入有效的账号和密码');
  return { account: account.trim(), password };
};

/** 校验注册表单，验证码暂不参与注册协议。 */
export const parseRegistration = (value: unknown): Registration => {
  if (!value || typeof value !== 'object' || !('username' in value))
    throw new Error('请输入账号、昵称和密码');
  const credentials = parseCredentials(value);
  const username = value.username;
  if (
    credentials.account.length < 6 ||
    credentials.account.length > 20 ||
    !/^(?:1[3-9]\d{9}|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})$/.test(
      credentials.account,
    )
  )
    throw new Error('请输入 6 到 20 个字符的邮箱或手机号');
  if (credentials.password.length < 6 || credentials.password.length > 20)
    throw new Error('密码长度必须在 6 到 20 个字符之间');
  if (
    typeof username !== 'string' ||
    username.trim().length < 1 ||
    username.trim().length > 16
  )
    throw new Error('昵称长度必须在 1 到 16 个字符之间');
  return {
    ...credentials,
    username: username.trim(),
    ...('avatar' in value && value.avatar !== undefined
      ? { avatar: parseRegistrationAvatar(value.avatar) }
      : {}),
  };
};

/** 解析后端业务响应和可选 JWT 到期时间；解码只检查格式，不代表验签。 */
export const parseAuthSession = (
  value: unknown,
  account: string,
  requireClientSqlPassword: boolean = true,
): AuthSession => {
  const { data } = parseApiResult(value, '登录');
  if (
    !data ||
    typeof data !== 'object' ||
    !('uid' in data) ||
    !('token' in data)
  )
    throw new Error('登录服务返回的数据无效');
  const responseData = data as Record<string, unknown>;
  const { uid, token: accessToken } = responseData;
  const clientSqlPassword = responseData.clientSqlPassword;
  const validClientSqlPassword =
    typeof clientSqlPassword === 'string' &&
    !!clientSqlPassword.trim() &&
    clientSqlPassword.length <= 256;
  if (
    typeof accessToken !== 'string' ||
    !accessToken.trim() ||
    accessToken.length > 16384 ||
    (requireClientSqlPassword && !validClientSqlPassword) ||
    !(
      (typeof uid === 'number' && Number.isSafeInteger(uid) && uid > 0) ||
      (typeof uid === 'string' && /^[1-9]\d{0,63}$/.test(uid))
    )
  )
    throw new Error('登录服务返回的数据无效');
  let claims: ReturnType<typeof decodeJwt>;
  try {
    claims = decodeJwt(accessToken);
  } catch {
    throw new Error('登录服务返回的 token 格式无效');
  }
  if (
    (claims.exp !== undefined &&
      (!Number.isSafeInteger(claims.exp) || claims.exp * 1000 <= Date.now())) ||
    (claims.uid !== undefined && String(claims.uid) !== String(uid))
  )
    throw new Error('登录令牌无效或已过期');
  const { name, avatar, signature } = readProfileFields(
    responseData,
  );
  return {
    accessToken,
    expiresAt: claims.exp ?? null,
    ...(validClientSqlPassword ? { clientSqlPassword } : {}),
    user: {
      id: String(uid),
      account,
      nickname: name || `用户 ${uid}`,
      ...(avatar ? { avatar } : {}),
      ...(signature ? { signature } : {}),
    },
  };
};

/** 向固定后端提交 userId/password，不打印凭据，不重试或回退到本地认证。 */
export const requestPasswordLogin = async (
  base: string | undefined,
  value: unknown,
  signal?: AbortSignal,
): Promise<AuthSession> => {
  const credentials = parseCredentials(value);
  const session = await requestApi(
    { base },
    {
      path: '/capi/user/public/login',
      method: 'POST',
      body: { userId: credentials.account, password: credentials.password },
      signal,
      serviceName: '登录',
      networkError: '无法连接登录服务或请求超时，请稍后重试',
      httpError: (status: number): string =>
        status === 401 || status === 403
          ? '账号或密码错误'
          : '登录服务请求失败',
      parse: (result: unknown): AuthSession =>
        parseAuthSession(result, credentials.account),
    },
  );
  const validation = await requestSessionValidation(base, session, signal);
  if (validation.status !== 'valid') throw new Error(validation.message);
  return session;
};

/** 向后端提交账号注册，不保存密码或验证码，也不自动登录。 */
export const requestRegistration = async (
  base: string | undefined,
  value: unknown,
  signal?: AbortSignal,
): Promise<void> => {
  signal?.throwIfAborted();
  const registration = parseRegistration(value);
  const form = new FormData();
  form.set('userId', registration.account);
  form.set('username', registration.username);
  form.set('password', registration.password);
  if (registration.avatar) {
    const type = registrationAvatarMime(registration.avatar);
    form.set(
      'avatar',
      new Blob([new Uint8Array(registration.avatar)], { type }),
      type === 'image/png' ? 'avatar.png' : 'avatar.jpg',
    );
  }
  await requestApi(
    { base },
    {
      path: '/capi/user/public/register',
      method: 'POST',
      body: form,
      signal,
      serviceName: '注册',
      networkError: '无法连接注册服务或请求超时，请稍后重试',
      parse: (result: unknown): void => {
        parseApiResult(result, '注册');
      },
    },
  );
};
