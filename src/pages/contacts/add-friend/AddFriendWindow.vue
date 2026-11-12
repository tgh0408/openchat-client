<template>
  <main class="add-friend-window" aria-label="添加朋友">
    <header class="add-friend-titlebar">
      <h1>添加朋友</h1>
      <button
        type="button"
        class="icon-button close-button"
        title="关闭"
        aria-label="关闭添加朋友窗口"
        @click="closeWindow"
      >
        <el-icon :size="14"><Close /></el-icon>
      </button>
    </header>
    <form class="add-friend-search" @submit.prevent="search">
      <el-input
        v-model="query"
        placeholder="搜索手机号或邮箱号"
        aria-label="搜索手机号或邮箱号"
        :prefix-icon="Search"
        :maxlength="128"
        autocomplete="off"
        :disabled="actionsDisabled"
        clearable
        @input="clearResult"
      />
      <el-button
        type="primary"
        native-type="submit"
        :loading="busy"
        :disabled="actionsDisabled"
        aria-label="搜索"
      >
        <span v-if="!busy">搜索</span>
      </el-button>
    </form>
    <div
      class="add-friend-content"
      :class="{ 'add-friend-content--empty': userNotFound }"
      :aria-busy="busy"
    >
      <p v-if="userNotFound" class="add-friend-empty" role="status">
        无法找到该用户，请检查你填写的账号是否正确。
      </p>
      <p v-else-if="error" class="add-friend-error" role="alert">{{ error }}</p>
      <section
        v-if="result"
        class="add-friend-result"
        :class="{ 'is-friend': isFriend }"
        aria-label="搜索结果"
      >
        <div class="add-friend-identity">
          <img
            :src="
              avatarFailed
                ? DEFAULT_AVATAR_URL
                : result.avatar || DEFAULT_AVATAR_URL
            "
            alt="用户头像"
            draggable="false"
            @error="avatarFailed = true"
          />
          <div class="add-friend-profile">
            <h2>
              <span>{{ result.friend?.displayName || result.name }}</span>
              <el-icon
                v-if="sexIcon"
                :class="sexClass"
                :size="16"
                :aria-label="sexLabel"
                ><component :is="sexIcon"
              /></el-icon>
            </h2>
            <p v-if="isFriend">
              昵称：{{ result.friend?.name || result.name }}
            </p>
            <p>UID：{{ result.uid }}</p>
            <p>地区：<span class="unavailable">未提供</span></p>
          </div>
          <button
            v-if="isFriend"
            class="profile-more"
            type="button"
            :disabled="actionsDisabled || !result.friend?.roomId"
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            :aria-expanded="menuExpanded"
            @click.stop="toggleActionsMenu"
          >
            <el-icon :size="20"><MoreFilled /></el-icon>
          </button>
        </div>
        <div v-if="isFriend" class="profile-section">
          <h3>朋友资料</h3>
          <dl>
            <dt>备注</dt>
            <dd>{{ result.friend?.remark || '未设置' }}</dd>
          </dl>
        </div>
        <div
          class="profile-section profile-moments"
          :class="{ 'profile-moments--empty': !isFriend }"
        >
          <h3>朋友圈</h3>
          <span v-if="isFriend" class="unavailable" title="朋友圈暂未接入"
            >暂无内容</span
          >
        </div>
        <div v-if="isFriend" class="profile-section profile-information">
          <h3>更多信息</h3>
          <dl>
            <dt>共同群聊</dt>
            <dd class="unavailable">未提供</dd>
            <dt>个性签名</dt>
            <dd>{{ result.friend?.personalitySignature || '未设置' }}</dd>
          </dl>
        </div>
        <div v-if="isFriend" class="profile-actions">
          <button
            type="button"
            :disabled="actionsDisabled || !result.friend?.roomId"
            title="发消息"
            @click="openChat"
          >
            <el-icon :size="27"><ChatRound /></el-icon><span>发消息</span>
          </button>
          <button
            type="button"
            :disabled="callDisabled"
            title="语音聊天"
            @click="requestCall(RtcMediaMode.AUDIO)"
          >
            <el-icon :size="27"><Phone /></el-icon><span>语音聊天</span>
          </button>
          <button
            type="button"
            :disabled="callDisabled"
            title="视频聊天"
            @click="requestCall(RtcMediaMode.VIDEO)"
          >
            <el-icon :size="27"><VideoCamera /></el-icon><span>视频聊天</span>
          </button>
        </div>
        <div
          v-else-if="result.relationship === 'stranger'"
          class="profile-add-action"
        >
          <button
            type="button"
            :disabled="actionsDisabled"
            @click="openApplication"
          >
            添加到通讯录
          </button>
        </div>
      </section>
    </div>
    <FriendBlacklistDialog
      :open="blacklistOpen"
      :busy="blacklistBusy"
      :error="blacklistError"
      :disabled="!isFriend"
      @cancel="blacklistOpen = false"
      @confirm="changeBlacklist(true)"
    />
    <FriendDeleteDialog
      :target="deleteTarget"
      :avatar="result?.avatar || DEFAULT_AVATAR_URL"
      :disabled="!isFriend"
      :request="deleteFriend"
      @cancel="deleteTarget = null"
    />
  </main>
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../../services/runtime/public-assets';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { ElButton, ElIcon, ElInput } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import {
  ChatRound,
  Close,
  Female,
  Male,
  MoreFilled,
  Phone,
  Search,
  VideoCamera,
} from '@element-plus/icons-vue';
import { parseAddFriendQuery } from '../../../../shared/contacts/add-friend';
import type { AddFriendSearchResult } from '../../../../shared/contacts/add-friend';
import { getAuthErrorMessage } from '../../../services/auth/auth';
import { RtcMediaMode } from '../../../../shared/rtc/rtc';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import FriendBlacklistDialog from '../../workspace/directory/friends/FriendBlacklistDialog.vue';
import FriendDeleteDialog from '../../workspace/directory/friends/FriendDeleteDialog.vue';

const api = window.addFriendDesktop;
const query = ref('');
const busy = ref(false);
const error = ref('');
const userNotFound = computed((): boolean => {
  switch (error.value) {
    case '用户不存在':
    case '没有找到该用户':
    case '无法找到该用户，请检查你填写的账号是否正确。':
      return true;
    default:
      return false;
  }
});
const result = shallowRef<AddFriendSearchResult | null>(null);
const opening = ref(false);
const menuExpanded = ref(false);
const blacklistOpen = ref(false);
const blacklistBusy = ref(false);
const blacklistError = ref('');
const deleteTarget = ref<{ roomId: string; name: string } | null>(null);
const actionsDisabled = computed(
  (): boolean =>
    busy.value ||
    opening.value ||
    blacklistOpen.value ||
    blacklistBusy.value ||
    deleteTarget.value !== null,
);
const isFriend = computed(
  (): boolean => result.value?.relationship === 'friend',
);
/** 仅允许已确认且未拉黑的好友单聊拨打，处理中禁止重复操作。 */
const callDisabled = computed(
  (): boolean =>
    !api ||
    actionsDisabled.value ||
    !isFriend.value ||
    !result.value?.friend?.roomId ||
    result.value.friend.blacklisted,
);
const sex = computed(
  (): number | null => result.value?.friend?.sex ?? result.value?.sex ?? null,
);
const sexIcon = computed((): typeof Female | null => {
  switch (sex.value) {
    case 0:
      return Female;
    case 1:
      return Male;
    default:
      return null;
  }
});
const sexClass = computed((): string =>
  sex.value === 0 ? 'profile-female' : 'profile-male',
);
const sexLabel = computed((): string => (sex.value === 0 ? '女' : '男'));
const avatarFailed = ref(false);
let version = 0;
let disposed = false;
let actionsMenu: ContextMenuInstance | undefined;

/** 关闭当前展示并撤销旧资料的菜单回调，原生菜单页保持常驻。 */
const closeActionsMenu = (): void => {
  const menu = actionsMenu;
  actionsMenu = undefined;
  menuExpanded.value = false;
  menu?.closeMenu();
};

/** 复用原生备注表单，仅将成功保存的结果回填当前好友。 */
const openRemark = async (): Promise<void> => {
  const profile = result.value;
  if (!api || disposed || actionsDisabled.value || !profile?.friend) return;
  closeActionsMenu();
  opening.value = true;
  error.value = '';
  const request = version;
  try {
    const saved = await api.openRemark();
    if (!disposed && request === version && saved)
      result.value = {
        ...profile,
        friend: {
          ...profile.friend,
          remark: saved.remark,
          remarkSettings: saved,
          displayName: saved.remark ?? profile.friend.name,
        },
      };
  } catch (cause) {
    if (!disposed && request === version)
      error.value = getAuthErrorMessage(cause, '打开备注窗口失败，请重试');
  } finally {
    if (!disposed) opening.value = false;
  }
};

/** 黑名单更新成功才回填状态，失败保留确认框或当前资料的错误提示。 */
const changeBlacklist = async (blocked: boolean): Promise<void> => {
  const profile = result.value;
  if (
    !api ||
    disposed ||
    !profile?.friend ||
    opening.value ||
    busy.value ||
    blacklistBusy.value ||
    deleteTarget.value ||
    (blocked && !blacklistOpen.value)
  )
    return;
  closeActionsMenu();
  const request = version;
  blacklistBusy.value = true;
  blacklistError.value = '';
  error.value = '';
  try {
    await api.setBlacklisted(blocked);
    if (disposed || request !== version) return;
    result.value = {
      ...profile,
      friend: { ...profile.friend, blacklisted: blocked },
    };
    blacklistOpen.value = false;
  } catch (cause) {
    if (!disposed && request === version) {
      const message = getAuthErrorMessage(cause, '黑名单操作失败，请重试');
      if (blocked) blacklistError.value = message;
      else error.value = message;
    }
  } finally {
    if (!disposed) blacklistBusy.value = false;
  }
};

/** 加入黑名单需确认，移出直接复用现有请求流程。 */
const openBlacklist = (): void => {
  if (disposed || actionsDisabled.value || !result.value?.friend) return;
  closeActionsMenu();
  blacklistError.value = '';
  if (result.value.friend.blacklisted) void changeBlacklist(false);
  else blacklistOpen.value = true;
};

/** 删除前固定当前好友，复用现有确认框及清空历史选项。 */
const openDeletion = (): void => {
  const friend = result.value?.friend;
  if (disposed || actionsDisabled.value || !friend?.roomId) return;
  closeActionsMenu();
  deleteTarget.value = { roomId: friend.roomId, name: friend.displayName };
};

/** 主进程固定搜索对象并处理本地清理，页面不能指定删除另一个好友。 */
const deleteFriend = async (
  roomId: string,
  clearHistory: boolean,
): Promise<void> => {
  if (!api || disposed || result.value?.friend?.roomId !== roomId)
    throw new Error('搜索结果已变化，请重新打开菜单');
  await api.deleteFriend(clearHistory);
};

/** 推荐文案沿用真实资料性别，不推测缺省值。 */
const recommendLabel = computed((): string => {
  switch (sex.value) {
    case 0:
      return '把她推荐给朋友';
    case 1:
      return '把他推荐给朋友';
    default:
      return '推荐给朋友';
  }
});

/** 三点入口复用常驻菜单和原有样式，内容按当前好友状态生成。 */
const toggleActionsMenu = (event: MouseEvent): void => {
  if (actionsMenu) {
    closeActionsMenu();
    return;
  }
  if (
    disposed ||
    actionsDisabled.value ||
    !isFriend.value ||
    !result.value?.friend?.roomId ||
    !(event.currentTarget instanceof HTMLElement)
  )
    return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const menu = ContextMenu.showContextMenu({
    x: Math.max(8, bounds.right - 160),
    y: bounds.bottom + 2,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 160,
    maxWidth: Math.max(160, window.innerWidth - 16),
    maxHeight: Math.max(80, window.innerHeight - 16),
    preserveIconWidth: false,
    onClose: (): void => {
      if (actionsMenu !== menu) return;
      actionsMenu = undefined;
      menuExpanded.value = false;
    },
    items: [
      {
        label: '设置备注和标签',
        onClick: (): void => {
          void openRemark();
        },
      },
      { label: '设置朋友权限', divided: 'down', disabled: true },
      { label: recommendLabel.value, divided: 'down', disabled: true },
      { label: '设为星标朋友', divided: 'down', disabled: true },
      {
        label: result.value.friend.blacklisted ? '移出黑名单' : '加入黑名单',
        divided: 'down',
        onClick: openBlacklist,
      },
      {
        label: '删除联系人',
        customClass: 'chat-context-menu-danger',
        onClick: openDeletion,
      },
    ],
  });
  actionsMenu = menu;
  menuExpanded.value = true;
};

/** 编辑搜索词后清除旧资料，并拒绝旧请求覆盖新输入。 */
const clearResult = (): void => {
  closeActionsMenu();
  version++;
  error.value = '';
  result.value = null;
  avatarFailed.value = false;
};

/** 按当前搜索词读取真实用户资料，空输入不发起请求。 */
const search = async (): Promise<void> => {
  if (disposed || actionsDisabled.value) return;
  clearResult();
  const request = version;
  try {
    const text = parseAddFriendQuery(query.value);
    if (!api) throw new Error('请从桌面客户端打开添加朋友窗口');
    busy.value = true;
    const found = await api.search(text);
    if (!disposed && request === version) result.value = found;
  } catch (cause) {
    if (!disposed && request === version)
      error.value = getAuthErrorMessage(cause, '搜索失败，请重试');
  } finally {
    if (!disposed) busy.value = false;
  }
};

/** 让主窗口进入当前好友的真实会话，迟到错误不覆盖新搜索。 */
const openChat = async (): Promise<void> => {
  if (
    !api ||
    disposed ||
    actionsDisabled.value ||
    !result.value?.friend?.roomId
  )
    return;
  closeActionsMenu();
  const request = version;
  opening.value = true;
  try {
    await api.openChat();
  } catch (cause) {
    if (!disposed && request === version)
      error.value = getAuthErrorMessage(cause, '打开好友会话失败，请重试');
  } finally {
    if (!disposed) opening.value = false;
  }
};

/** 复用主工作台通话流程，迟到反馈不能覆盖新搜索结果。 */
const requestCall = async (mediaMode: RtcMediaMode): Promise<void> => {
  if (!api || disposed || callDisabled.value) return;
  closeActionsMenu();
  const request = version;
  opening.value = true;
  error.value = '';
  try {
    await api.requestCall(mediaMode);
  } catch (cause) {
    if (!disposed && request === version)
      error.value = getAuthErrorMessage(cause, '通话发起失败，请重试');
  } finally {
    if (!disposed) opening.value = false;
  }
};

/** 将当前搜索对象交给主进程，打开独立申请窗口。 */
const openApplication = async (): Promise<void> => {
  if (
    !api ||
    disposed ||
    actionsDisabled.value ||
    result.value?.relationship !== 'stranger'
  )
    return;
  closeActionsMenu();
  const request = version;
  opening.value = true;
  error.value = '';
  try {
    const restored = await api.openApplication(result.value.uid);
    if (!disposed && request === version && restored) result.value = restored;
  } catch (cause) {
    if (!disposed && request === version)
      error.value = getAuthErrorMessage(cause, '打开申请窗口失败，请重试');
  } finally {
    if (!disposed) opening.value = false;
  }
};

/** 关闭独立窗口，失败时保留可重试的关闭按钮。 */
const closeWindow = async (): Promise<void> => {
  closeActionsMenu();
  try {
    if (api) await api.close();
    else window.close();
  } catch {
    error.value = '关闭窗口失败，请重试';
  }
};

/** Escape 优先收起菜单或交给确认框处理，不连带关闭来源窗口。 */
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.isComposing) return;
  if (actionsMenu) {
    event.preventDefault();
    event.stopImmediatePropagation();
    closeActionsMenu();
    return;
  }
  if (!actionsDisabled.value) void closeWindow();
};

onMounted(() => {
  document.title = '添加朋友';
  window.addEventListener('keydown', onKeydown, true);
});
onBeforeUnmount(() => {
  closeActionsMenu();
  disposed = true;
  version++;
  window.removeEventListener('keydown', onKeydown, true);
});
</script>

<style scoped>
.add-friend-window {
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: #f9f9f9;
  border: 1px solid #d4d4d4;
  border-radius: 8px;
}

.add-friend-titlebar {
  position: relative;
  height: 40px;
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}

.add-friend-titlebar h1 {
  margin: 0 44px;
  font-size: 14px;
  font-weight: 400;
  line-height: 40px;
  text-align: center;
}

.add-friend-titlebar .close-button {
  position: absolute;
  top: 0;
  right: 0;
  height: 38px;
}

.add-friend-search {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 64px;
  gap: 8px;
  margin: 8px 24px 0;
  flex-shrink: 0;
}

.add-friend-search .el-input {
  min-width: 0;
  height: 39px;
  font-size: 16px;
  --el-input-bg-color: #f9f9f9;
  --el-input-border-color: #e0e0e0;
  --el-input-placeholder-color: #9c9ca6;
}

.add-friend-search :deep(.el-input__wrapper) {
  padding: 1px 12px;
  border-radius: 7px;
}

.add-friend-search :deep(.el-input__prefix) {
  font-size: 20px;
  color: #aaa;
}

.add-friend-search .el-button {
  width: 64px;
  height: 38px;
  margin: 0;
  padding: 0;
  font-size: 16px;
  --el-color-primary: #00c676;
}

.add-friend-content {
  min-height: 0;
  overflow-y: auto;
  padding: 16px 23px 23px;
}

.add-friend-error {
  margin: 16px 0 0;
  color: #c63b3b;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.add-friend-content--empty {
  display: grid;
  flex: 1;
  place-items: center;
  padding: 16px 23px 36px;
}

.add-friend-empty {
  margin: 0;
  color: #9999a1;
  font-size: 14px;
  line-height: 22px;
  text-align: center;
  overflow-wrap: anywhere;
}

.add-friend-result {
  padding: 24px;
  min-height: 292px;
  border-radius: 8px;
  background: #ededf0;
}

.add-friend-identity {
  position: relative;
  display: flex;
  gap: 16px;
  padding-bottom: 15px;
}

.add-friend-identity img {
  width: 72px;
  height: 72px;
  flex-shrink: 0;
  border-radius: 6px;
  object-fit: cover;
}

.add-friend-profile {
  min-width: 0;
  overflow-wrap: anywhere;
}

.add-friend-result h2 {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 0 0 7px;
  font-size: 20px;
  line-height: 27px;
  font-weight: 400;
}

.add-friend-result h2 > span {
  min-width: 0;
}
.add-friend-result h2 .el-icon {
  flex-shrink: 0;
}
.is-friend h2 {
  padding-right: 22px;
  font-size: 18px;
}
.profile-female {
  color: #fb777d;
}
.profile-male {
  color: #518ed0;
}

.add-friend-result p {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: #777;
}

.profile-more {
  position: absolute;
  top: 0;
  right: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: #666;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border-radius: 4px;
  cursor: pointer;
}
.profile-more:not(:disabled):hover,
.profile-more[aria-expanded='true'] {
  background: #dedee3;
}
.profile-more:focus-visible {
  outline: 2px solid #304f91;
  outline-offset: 2px;
}
.profile-more:disabled {
  cursor: not-allowed;
}
.profile-section {
  border-top: 1px solid #e2e2e6;
  padding: 18px 0;
}
.profile-section h3 {
  margin: 0 0 10px;
  color: #74747a;
  font-size: 16px;
  font-weight: 400;
  line-height: 22px;
}
.profile-section dl {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 7px 10px;
  margin: 0;
  font-size: 16px;
  line-height: 22px;
}
.profile-section dt {
  color: #74747a;
}
.profile-section dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.profile-moments {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 72px;
}
.profile-moments h3 {
  flex: 0 0 70px;
  margin: 0;
}
.profile-moments--empty {
  align-items: flex-start;
}
.unavailable {
  color: #95959b;
  font-size: 14px;
}
.profile-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  border-top: 1px solid #e2e2e6;
  padding-top: 26px;
  gap: 6px;
}
.profile-actions button {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
  min-width: 0;
  min-height: 62px;
  padding: 3px 0;
  color: #304f91;
  background: transparent;
  border: 0;
  font-size: 14px;
  cursor: pointer;
}
.profile-actions button:disabled {
  cursor: not-allowed;
}
.profile-actions button:not(:disabled):hover {
  background: #e1e4ec;
  border-radius: 4px;
}
.profile-actions button:focus-visible {
  outline: 2px solid #304f91;
  outline-offset: 2px;
}
.profile-add-action {
  display: flex;
  justify-content: center;
  border-top: 1px solid #e2e2e6;
  padding: 24px 0 27px;
}
.profile-add-action button {
  padding: 5px 12px;
  border: 0;
  border-radius: 6px;
  background: #e1e1e5;
  color: #222;
  font-size: 16px;
  line-height: 22px;
  cursor: pointer;
}
.profile-add-action button:not(:disabled):hover {
  background: #d7d7dd;
}
.profile-add-action button:focus-visible {
  outline: 2px solid #00ae68;
  outline-offset: 2px;
}
.profile-add-action button:disabled {
  cursor: not-allowed;
}
@media (max-width: 360px) {
  .add-friend-result {
    padding: 16px;
  }
  .add-friend-identity {
    gap: 10px;
  }
  .profile-actions button {
    font-size: 12px;
  }
}
</style>
