import { onBeforeUnmount, shallowRef, type Ref } from 'vue';
import type { Contact } from '../../../../shared/storage/database';
import type { FriendRemarkUpdated } from '../../../../shared/contacts/friend-remark';
import {
  isContactNameFresh,
  mergeContactProfiles,
} from '../../../../shared/contacts/contact-name';
import type { AuthSession } from '../../../services/auth/auth';
import type { createChatStore } from '../../../services/chat/chat';

interface WorkspaceContactOptions {
  store: Pick<ReturnType<typeof createChatStore>, 'getContactProfile'>;
  getSession: () => AuthSession | Pick<AuthSession, 'user'>;
  isReadOnly: () => boolean;
  isDisposed: () => boolean;
  isRemoteConversation: (roomId: string) => boolean;
}

interface WorkspaceContacts {
  contacts: Ref<Record<string, Contact>>;
  ensureContact: (uid: string, roomId?: string) => Promise<void>;
  refreshContact: (uid: string, roomId?: string) => Promise<void>;
  updateContactRemark: (update: FriendRemarkUpdated) => void;
}

/** 管理工作台头像和昵称缓存，合并资料请求并限制失败后的自动重试。 */
export const useWorkspaceContacts = (
  options: WorkspaceContactOptions,
): WorkspaceContacts => {
  const { store, getSession, isReadOnly, isRemoteConversation } = options;
  let stopped = false;
  /** 检查工作台或联系人缓存模块是否已经卸载。 */
  const isDisposed = (): boolean => stopped || options.isDisposed();
  const contacts = shallowRef<Record<string, Contact>>({});
  const contactRequests = new Map<string, Promise<void>>();
  const contactRetryAfter = new Map<string, number>();
  /** 需要展示头像或摘要昵称时读取资料；相同用户请求合并，失败后短暂冷却。 */
  const loadContact = async (
    uid: string,
    force: boolean,
    roomId?: string,
  ): Promise<void> => {
    if (isDisposed() || isReadOnly() || !uid || uid === getSession().user.id)
      return;
    const scope = roomId && isRemoteConversation(roomId) ? roomId : undefined;
    const key = JSON.stringify([uid, scope ?? null]);
    const pending = contactRequests.get(key);
    if (pending) return pending;
    if (
      !force &&
      (isContactNameFresh(contacts.value[uid], scope) ||
        (contactRetryAfter.get(key) ?? 0) > Date.now())
    )
      return;
    /** 资料成功后更新当前工作区，失败时保留已有头像并允许手动刷新。 */
    const request = async (): Promise<void> => {
      try {
        const contact = await store.getContactProfile(uid, force, scope);
        if (isDisposed()) return;
        contacts.value = {
          ...contacts.value,
          [uid]: mergeContactProfiles(contacts.value[uid], contact),
        };
        contactRetryAfter.delete(key);
      } catch {
        if (!isDisposed()) contactRetryAfter.set(key, Date.now() + 30000);
      } finally {
        contactRequests.delete(key);
      }
    };
    const promise = request();
    contactRequests.set(key, promise);
    await promise;
  };

  /** 可见消息按需读取缓存或缺失资料，不因重复出现同一发送者而重复请求。 */
  const ensureContact = async (uid: string, roomId?: string): Promise<void> => {
    await loadContact(uid, false, roomId);
  };

  /** 用户点击头像时跳过资料缓存，重新获取对方最新公开资料。 */
  const refreshContact = async (
    uid: string,
    roomId?: string,
  ): Promise<void> => {
    await loadContact(uid, true, roomId);
  };

  /** 将已确认的好友备注写入头像和昵称缓存，保留已有头像与签名。 */
  const updateContactRemark = (update: FriendRemarkUpdated): void => {
    if (isDisposed() || isReadOnly() || update.userId !== getSession().user.id)
      return;
    const cached = contacts.value[update.uid];
    const timestamp = new Date().toISOString();
    contacts.value = {
      ...contacts.value,
      [update.uid]: {
        ...cached,
        id: update.uid,
        nickname: update.name,
        avatar: cached?.avatar ?? null,
        signature: cached?.signature ?? null,
        updatedAt: timestamp,
        remark: update.settings.remark,
        nameUpdatedAt: timestamp,
      },
    };
  };

  onBeforeUnmount((): void => {
    stopped = true;
    contactRequests.clear();
    contactRetryAfter.clear();
  });

  return { contacts, ensureContact, refreshContact, updateContactRemark };
};
