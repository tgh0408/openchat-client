import { onBeforeUnmount, ref, type Ref } from 'vue';
import { getRequestErrorMessage } from '../../../../shared/api/api-error';
import type { UserEmoji } from '../../../../shared/chat/emoji';
import type { AuthSession } from '../../../services/auth/auth';

interface WorkspaceEmojiOptions {
  getSession: () => AuthSession | Pick<AuthSession, 'user'>;
  isReadOnly: () => boolean;
  isDisposed: () => boolean;
}

interface WorkspaceEmojis {
  userEmojis: Ref<UserEmoji[]>;
  emojiLoading: Ref<boolean>;
  emojiError: Ref<string>;
  busyEmojiId: Ref<string>;
  emojiOperation: Ref<'delete' | 'front'>;
  loadEmojis: () => Promise<void>;
  deleteEmoji: (emoji: UserEmoji) => Promise<void>;
  moveEmojiToFront: (emoji: UserEmoji) => Promise<void>;
  invalidateEmojiRequests: () => void;
}

/** 管理收藏表情的缓存读取、远端刷新和排序修改，发送仍由工作台统一处理。 */
export const useWorkspaceEmojis = (
  options: WorkspaceEmojiOptions,
): WorkspaceEmojis => {
  const { getSession, isReadOnly } = options;
  let stopped = false;
  /** 检查工作台或表情模块是否已经卸载。 */
  const isDisposed = (): boolean => stopped || options.isDisposed();
  const userEmojis = ref<UserEmoji[]>([]);
  const emojiLoading = ref(false);
  const emojiError = ref('');
  const busyEmojiId = ref('');
  const emojiOperation = ref<'delete' | 'front'>('delete');
  let emojiRequestVersion = 0;
  let emojiRefreshAfterMutation = false;

  /** 每次打开先读本地缓存再请求最新列表，旧请求不得覆盖新列表。 */
  const loadEmojis = async (): Promise<void> => {
    if (isDisposed()) return;
    if (busyEmojiId.value) {
      emojiRefreshAfterMutation = true;
      return;
    }
    const version = ++emojiRequestVersion;
    emojiError.value = '';
    if (!window.desktop) {
      emojiError.value = '表情包需要在桌面程序中读取';
      return;
    }
    emojiLoading.value = true;
    try {
      try {
        const cached = await window.desktop.listCachedEmojis();
        if (isDisposed() || version !== emojiRequestVersion) return;
        userEmojis.value = cached;
      } catch {
        // 本地读取失败仍尝试真实接口，网络失败时保留当前可见列表。
      }
      if (isDisposed() || isReadOnly() || version !== emojiRequestVersion)
        return;
      const list = await window.desktop.listEmojis();
      if (isDisposed() || version !== emojiRequestVersion) return;
      userEmojis.value = list;
    } catch (cause) {
      if (!isDisposed() && version === emojiRequestVersion)
        emojiError.value = getRequestErrorMessage(
          cause,
          '获取表情包失败，请重试',
        );
    } finally {
      if (!isDisposed() && version === emojiRequestVersion)
        emojiLoading.value = false;
    }
  };

  /** 收藏变更确认后更新面板，失败保留原顺序；旧列表和旧授权不能覆盖结果。 */
  const mutateEmoji = async (
    emoji: UserEmoji,
    operation: 'delete' | 'front',
  ): Promise<void> => {
    const desktop = window.desktop;
    if (
      !desktop ||
      isDisposed() ||
      isReadOnly() ||
      busyEmojiId.value ||
      !userEmojis.value.some((item) => item.imgId === emoji.imgId)
    )
      return;
    const session = getSession();
    emojiRequestVersion++;
    emojiLoading.value = false;
    emojiError.value = '';
    busyEmojiId.value = emoji.imgId;
    emojiOperation.value = operation;
    try {
      switch (operation) {
        case 'delete':
          await desktop.deleteEmoji(emoji.imgId);
          if (isDisposed() || isReadOnly() || getSession() !== session) return;
          userEmojis.value = userEmojis.value.filter(
            (item) => item.imgId !== emoji.imgId,
          );
          break;
        case 'front': {
          const list = await desktop.moveEmojiToFront(emoji.imgId);
          if (isDisposed() || isReadOnly() || getSession() !== session) return;
          userEmojis.value = list;
          break;
        }
      }
    } catch (cause) {
      if (!isDisposed() && !isReadOnly() && getSession() === session)
        emojiError.value = getRequestErrorMessage(
          cause,
          '更新表情包失败，请重试',
        );
    } finally {
      if (!isDisposed() && getSession() === session) {
        busyEmojiId.value = '';
        if (emojiRefreshAfterMutation) {
          emojiRefreshAfterMutation = false;
          if (!isReadOnly()) void loadEmojis();
        }
      }
    }
  };

  /** 删除本人收藏，成功后同步移除当前面板记录。 */
  const deleteEmoji = async (emoji: UserEmoji): Promise<void> => {
    await mutateEmoji(emoji, 'delete');
  };

  /** 将目标移到最前，排序值由后端分配，不乐观伪造成功。 */
  const moveEmojiToFront = async (emoji: UserEmoji): Promise<void> => {
    await mutateEmoji(emoji, 'front');
  };

  /** 废弃旧列表请求及修改后的补刷，避免失效后更新表情面板。 */
  const invalidateEmojiRequests = (): void => {
    emojiRequestVersion++;
    emojiRefreshAfterMutation = false;
    emojiLoading.value = false;
  };

  onBeforeUnmount((): void => {
    stopped = true;
    invalidateEmojiRequests();
  });

  return {
    userEmojis,
    emojiLoading,
    emojiError,
    busyEmojiId,
    emojiOperation,
    loadEmojis,
    deleteEmoji,
    moveEmojiToFront,
    invalidateEmojiRequests,
  };
};
