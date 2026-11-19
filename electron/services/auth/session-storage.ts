import { safeStorage } from 'electron';
import { createHash } from 'node:crypto';
import {
  parseAuthBase,
  parseAuthSession,
  readProfileFields,
} from '../../../shared/auth/auth';
import type { AuthSession, UserProfile } from '../../../shared/auth/auth';
import {
  deleteSavedSession,
  readEncryptedSession,
  readLoginAccounts,
  saveLoginAccount,
  deleteLoginAccount,
} from '../database/database';
import type { EncryptedLoginAccount } from '../database/database';

/** 身份和令牌分开加密，退出后仍可保留账号名称。 */
export interface StoredLoginAccount {
  id: string;
  account: string;
  session: AuthSession | null;
  profile: UserProfile | null;
  encrypted: EncryptedLoginAccount;
}

/** 检查系统密钥能力，不允许退回明文或 Linux basic_text 加密。 */
const requireEncryption = async (): Promise<void> => {
  if (
    !(await safeStorage.isAsyncEncryptionAvailable()) ||
    (process.platform === 'linux' &&
      ['basic_text', 'unknown'].includes(
        safeStorage.getSelectedStorageBackend(),
      ))
  )
    throw new Error('系统安全存储不可用，无法保存登录状态');
};

/** 后端和 uid 共同确定历史账号，避免不同后端的同名账号混用。 */
const accountKey = (base: string, uid: string): string =>
  createHash('sha256')
    .update(JSON.stringify([base, uid]))
    .digest('hex');

/** 将身份、JWT 和可选公开资料加密为一个会话密文，供持久化保存。 */
export const encryptSessionPayload = async (
  session: AuthSession,
  base: string | undefined,
): Promise<Buffer> => {
  await requireEncryption();
  const identity = {
    base: parseAuthBase(base),
    account: session.user.account,
    uid: session.user.id,
  };
  const profileName =
    session.user.nickname !== `用户 ${session.user.id}`
      ? session.user.nickname
      : undefined;
  return safeStorage.encryptStringAsync(
    JSON.stringify({
      ...identity,
      token: session.accessToken,
      ...(profileName ? { name: profileName } : {}),
      ...(session.user.avatar ? { avatar: session.user.avatar } : {}),
      ...(session.user.signature
        ? { personalitySignature: session.user.signature }
        : {}),
    }),
  );
};

/** 用公开资料重新加密账号身份，资料随身份持久化、不随 JWT 清除。 */
export const encryptProfileIdentity = async (
  session: AuthSession,
  profile: UserProfile,
  base: string | undefined,
): Promise<Buffer> => {
  await requireEncryption();
  const identity = {
    base: parseAuthBase(base),
    account: session.user.account,
    uid: session.user.id,
  };
  return safeStorage.encryptStringAsync(
    JSON.stringify({
      ...identity,
      ...(profile.name ? { name: profile.name } : {}),
      ...(profile.avatar ? { avatar: profile.avatar } : {}),
      ...(profile.signature ? { personalitySignature: profile.signature } : {}),
    }),
  );
};

/** 登录成功后预先加密身份和 JWT，接收授权时再原子写入。 */
export const prepareLoginAccount = async (
  session: AuthSession,
  base: string | undefined,
): Promise<StoredLoginAccount> => {
  await requireEncryption();
  const identity = {
    base: parseAuthBase(base),
    account: session.user.account,
    uid: session.user.id,
  };
  const id = accountKey(identity.base, identity.uid);
  return {
    id,
    account: identity.account,
    session,
    profile: null,
    encrypted: {
      id,
      identity: await safeStorage.encryptStringAsync(JSON.stringify(identity)),
      session: await encryptSessionPayload(session, base),
    },
  };
};

/** 校验解密身份并提取公开资料，历史账号名称本身不能作为登录凭据。 */
const parseIdentity = (
  text: string,
): {
  base: string;
  account: string;
  uid: string;
  name?: string;
  avatar?: string;
  personalitySignature?: string;
} => {
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== 'object' ||
    !('base' in value) ||
    typeof value.base !== 'string' ||
    !('account' in value) ||
    typeof value.account !== 'string' ||
    !value.account.trim() ||
    value.account.length > 64 ||
    !('uid' in value) ||
    typeof value.uid !== 'string' ||
    !/^[1-9]\d{0,63}$/.test(value.uid)
  )
    throw new Error('保存的账号无效');
  const fields = readProfileFields(value as Record<string, unknown>);
  return {
    base: value.base,
    account: value.account,
    uid: value.uid,
    ...(fields.name ? { name: fields.name } : {}),
    ...(fields.avatar ? { avatar: fields.avatar } : {}),
    ...(fields.signature ? { personalitySignature: fields.signature } : {}),
  };
};

/** 把解密身份中的扁平资料字段整理为可读的公开资料。 */
const profileFromIdentity = (identity: {
  name?: string;
  avatar?: string;
  personalitySignature?: string;
}): UserProfile | null =>
  identity.name || identity.avatar || identity.personalitySignature
    ? {
        name: identity.name ?? '',
        avatar: identity.avatar ?? null,
        signature: identity.personalitySignature ?? null,
      }
    : null;

/** 恢复单个账号；令牌损坏或到期时只保留通过解密校验的身份。 */
const decodeAccount = async (
  identityBuffer: Buffer,
  tokenBuffer: Buffer | null,
  base: string | undefined,
): Promise<StoredLoginAccount | null> => {
  const decrypted = await safeStorage.decryptStringAsync(identityBuffer);
  const identity = parseIdentity(decrypted.result);
  // 其他服务器的账号仅跳过，切换地址不删除原有加密记录。
  if (identity.base !== base) return null;
  const id = accountKey(identity.base, identity.uid);
  let session: AuthSession | null = null;
  let encryptedSession: Buffer | null = null;
  if (tokenBuffer) {
    try {
      const token = await safeStorage.decryptStringAsync(tokenBuffer);
      const tokenIdentity = parseIdentity(token.result);
      if (
        tokenIdentity.base !== identity.base ||
        tokenIdentity.uid !== identity.uid ||
        tokenIdentity.account !== identity.account
      )
        throw new Error('账号和令牌不一致');
      session = parseAuthSession(
        { success: true, code: 200, data: JSON.parse(token.result) as unknown },
        identity.account,
        false,
      );
      encryptedSession = token.shouldReEncrypt
        ? await safeStorage.encryptStringAsync(token.result)
        : tokenBuffer;
    } catch {
      session = null;
    }
  }
  // 身份密文始终不含 token，选中检查点则可能携带 JWT。
  const encryptedIdentity = await safeStorage.encryptStringAsync(
    JSON.stringify(identity),
  );
  return {
    id,
    account: identity.account,
    session,
    profile: profileFromIdentity(identity),
    encrypted: { id, identity: encryptedIdentity, session: encryptedSession },
  };
};

/** 载入历史账号和选中检查点；身份损坏删除对应记录，JWT 失效保留账号。 */
export const loadLoginAccounts = async (
  base: string | undefined,
): Promise<{
  accounts: StoredLoginAccount[];
  selectedAccountId: string | null;
}> => {
  const records = readLoginAccounts();
  const checkpoint = readEncryptedSession();
  if (!records.length && !checkpoint)
    return { accounts: [], selectedAccountId: null };
  await requireEncryption();
  const accounts = new Map<string, StoredLoginAccount>();
  for (const record of records) {
    let account: StoredLoginAccount | null;
    try {
      account = await decodeAccount(record.identity, record.session, base);
      if (!account) continue;
      if (account.id !== record.id) throw new Error('账号标识不一致');
    } catch {
      deleteLoginAccount(record.id);
      continue;
    }
    saveLoginAccount(account.encrypted);
    accounts.set(account.id, account);
  }
  let selectedAccountId: string | null = null;
  if (checkpoint) {
    let account: StoredLoginAccount | null = null;
    try {
      account = await decodeAccount(checkpoint, checkpoint, base);
    } catch {
      deleteSavedSession();
    }
    if (account) {
      // 历史账号记录优先，检查点不能恢复已经清除的令牌。
      const selected = accounts.get(account.id) ?? account;
      saveLoginAccount(selected.encrypted, true);
      accounts.set(selected.id, selected);
      selectedAccountId = selected.id;
    }
  }
  return { accounts: [...accounts.values()], selectedAccountId };
};
