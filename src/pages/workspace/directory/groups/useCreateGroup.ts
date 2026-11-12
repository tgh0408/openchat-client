import { onBeforeUnmount, ref, shallowRef, watch, type Ref } from 'vue';
import type { AuthSession } from '../../../../services/auth/auth';
import type { createChatStore } from '../../../../services/chat/chat';
import type {
  GroupDirectoryItem,
  GroupMemberItem,
} from '../../../../../shared/contacts/group';
import { getRequestErrorMessage } from '../../../../../shared/api/api-error';

interface CreateGroupOptions {
  store: Pick<
    ReturnType<typeof createChatStore>,
    'listFriends' | 'createGroup'
  >;
  getSession: () => AuthSession | Pick<AuthSession, 'user'>;
  isUnavailable: () => boolean;
  isOffline: () => boolean;
  error: Ref<string>;
  onCreated: (group: GroupDirectoryItem) => Promise<void>;
}

interface CreateGroupController {
  open: Ref<boolean>;
  members: Ref<GroupMemberItem[]>;
  loading: Ref<boolean>;
  busy: Ref<boolean>;
  loadError: Ref<string>;
  submitError: Ref<string>;
  show: () => Promise<void>;
  cancel: () => void;
  confirm: (uids: string[]) => Promise<void>;
  loadFriends: () => Promise<void>;
}

/** 管理好友选择与创建状态，已成功的创建不会因同步失败再次提交。 */
export const useCreateGroup = (
  options: CreateGroupOptions,
): CreateGroupController => {
  const open = ref(false);
  const members = shallowRef<GroupMemberItem[]>([]);
  const loading = ref(false);
  const busy = ref(false);
  const loadError = ref('');
  const submitError = ref('');
  let version = 0;
  let stopped = false;

  /** 关闭时废弃在途读取和迟到反馈，草稿只保留在本次弹窗。 */
  const reset = (): void => {
    version++;
    open.value = false;
    members.value = [];
    loading.value = false;
    busy.value = false;
    loadError.value = '';
    submitError.value = '';
  };

  /** 本地反馈必须仍属于原页面与原授权，网络变化不伪装为创建失败。 */
  const isCurrent = (
    requestVersion: number,
    session: ReturnType<CreateGroupOptions['getSession']>,
  ): boolean =>
    !stopped &&
    version === requestVersion &&
    options.getSession() === session &&
    !options.isUnavailable();

  /** 每次打开读取当前真实好友，沿用备注、昵称及头像，不展示本人。 */
  const loadFriends = async (): Promise<void> => {
    if (!open.value || busy.value || loading.value || options.isUnavailable())
      return;
    const requestVersion = ++version;
    const session = options.getSession();
    loading.value = true;
    loadError.value = '';
    try {
      const friends = await options.store.listFriends();
      if (!isCurrent(requestVersion, session)) return;
      members.value = friends
        .filter((friend) => friend.uid !== session.user.id)
        .map((friend) => ({
          uid: friend.uid,
          username: friend.name,
          nickname: friend.displayName,
          avatar: friend.avatar,
          role: null,
        }));
    } catch (cause) {
      if (isCurrent(requestVersion, session))
        loadError.value = getRequestErrorMessage(cause, '好友读取失败，请重试');
    } finally {
      if (isCurrent(requestVersion, session)) loading.value = false;
    }
  };

  /** 发起入口只在已授权桌面可用，浏览器不创建无法同步的会话。 */
  const show = async (): Promise<void> => {
    if (stopped || options.isUnavailable() || open.value || busy.value) return;
    if (!window.desktop) {
      options.error.value = '请在桌面客户端发起群聊';
      return;
    }
    if (options.isOffline()) {
      options.error.value = '当前离线，无法发起群聊';
      return;
    }
    reset();
    open.value = true;
    await loadFriends();
  };

  /** 提交期间不取消，避免用户把尚未确认的创建当成已撤销。 */
  const cancel = (): void => {
    if (!busy.value) reset();
  };

  /** 服务端确认前保留选择，确认后关闭弹窗并单独处理会话同步失败。 */
  const confirm = async (uids: string[]): Promise<void> => {
    if (
      !open.value ||
      busy.value ||
      loading.value ||
      loadError.value ||
      options.isUnavailable()
    )
      return;
    const session = options.getSession();
    const requestVersion = version;
    const available = new Set(members.value.map((member) => member.uid));
    if (
      !uids.length ||
      uids.length > 100 ||
      uids.some((uid) => uid === session.user.id || !available.has(uid))
    ) {
      submitError.value = '请选择 1 至 100 位好友';
      return;
    }
    busy.value = true;
    submitError.value = '';
    let created = false;
    try {
      if (options.isOffline()) throw new Error('当前离线，无法发起群聊');
      const group = await options.store.createGroup([...new Set(uids)]);
      if (!isCurrent(requestVersion, session)) return;
      created = true;
      open.value = false;
      members.value = [];
      await options.onCreated(group);
    } catch (cause) {
      if (!isCurrent(requestVersion, session)) return;
      if (created) {
        options.error.value = `群聊已创建，打开会话失败：${getRequestErrorMessage(cause, '请从通讯录进入群聊')}`;
      } else {
        submitError.value = getRequestErrorMessage(
          cause,
          '创建群聊失败，请重试',
        );
      }
    } finally {
      if (isCurrent(requestVersion, session)) busy.value = false;
    }
  };

  watch([options.getSession, options.isUnavailable], reset, { flush: 'sync' });
  onBeforeUnmount((): void => {
    stopped = true;
    reset();
  });

  return {
    open,
    members,
    loading,
    busy,
    loadError,
    submitError,
    show,
    cancel,
    confirm,
    loadFriends,
  };
};
