<template>
  <nav class="chat-rail" aria-label="主导航">
    <el-popover
      v-model:visible="profileOpen"
      placement="right-start"
      :width="336"
      :offset="8"
      trigger="click"
      :show-arrow="false"
      :popper-style="{
        maxWidth: 'calc(100vw - 76px)',
        maxHeight: 'calc(100vh - 24px)',
        overflowY: 'auto',
        padding: '24px',
        borderRadius: '8px',
        background: '#fafafa',
        borderColor: '#dedede',
        boxShadow: '0 3px 14px rgb(0 0 0 / 16%)',
      }"
    >
      <template #reference>
        <button
          ref="profileButton"
          class="chat-profile"
          title="个人信息"
          aria-label="个人信息"
          :aria-expanded="profileOpen"
        >
          <AvatarImage :src="user.avatar" alt="我的头像" />
        </button>
      </template>
      <section class="chat-profile-card" aria-label="个人信息">
        <div class="chat-profile-summary">
          <AvatarImage
            class="chat-profile-avatar"
            :src="user.avatar"
            alt="我的头像"
          />
          <div class="chat-profile-info">
            <h2>{{ user.nickname }}</h2>
            <p>
              <span>账号：</span>
              <span>{{ user.id }}</span>
            </p>
            <p><span>地区：</span><span>未提供</span></p>
          </div>
        </div>
        <p v-if="user.signature" class="chat-profile-signature">
          {{ user.signature }}
        </p>
      </section>
    </el-popover>
    <button
      class="chat-nav-button"
      :class="{ 'is-active': section === 'chats' }"
      title="聊天"
      :aria-label="chatUnread > 0 ? `聊天，${chatUnread} 条未读消息` : '聊天'"
      :aria-pressed="section === 'chats'"
      @click="emit('showChats')"
    >
      <el-icon :size="24"><ChatDotRound /></el-icon>
      <span v-if="chatUnread > 0" class="chat-nav-unread">{{
        chatUnread > 99 ? '99+' : chatUnread
      }}</span>
    </button>
    <button
      class="chat-nav-button"
      :class="{ 'is-active': section === 'directory' }"
      title="通讯录"
      :aria-label="
        friendUnread > 0 ? `通讯录，${friendUnread} 条未读好友申请` : '通讯录'
      "
      :aria-pressed="section === 'directory'"
      @click="emit('showDirectory')"
    >
      <el-icon :size="25"><User /></el-icon>
      <span v-if="friendUnread > 0" class="friend-nav-unread">{{
        friendUnread > 99 ? '99+' : friendUnread
      }}</span>
    </button>
    <div class="chat-rail-bottom">
      <button
        class="chat-nav-button"
        title="拓展设置"
        aria-label="拓展设置"
        @click="openMoreMenu"
      >
        <el-icon :size="23"><Operation /></el-icon>
      </button>
    </div>
  </nav>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ElIcon, ElPopover } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/popover/style/css';
import { ChatDotRound, Operation, User } from '@element-plus/icons-vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import type { AuthUser } from '../../../../shared/auth/auth';
import AvatarImage from '../../../components/avatar/AvatarImage.vue';

const props = defineProps<{
  user: AuthUser;
  section: 'chats' | 'directory';
  activeId: string;
  fileAssistantActive: boolean;
  hasFileAssistant: boolean;
  fileBusy: boolean;
  sending: boolean;
  busy: boolean;
  chatUnread: number;
  friendUnread: number;
}>();
const emit = defineEmits<{
  showChats: [];
  showDirectory: [];
  selectFiles: [];
  openHistory: [];
  openSettings: [];
}>();
const profileOpen = ref(false);
const profileButton = ref<HTMLButtonElement | null>(null);
let menu: ContextMenuInstance | undefined;

/** 关闭拓展设置菜单，避免旧菜单保留在账号或页面切换之后。 */
const closeMoreMenu = (): void => {
  const currentMenu = menu;
  menu = undefined;
  currentMenu?.closeMenu();
};

/** 在左下角按钮上方打开统一风格的拓展设置菜单。 */
const openMoreMenu = (event: MouseEvent): void => {
  if (!(event.currentTarget instanceof HTMLElement)) return;
  if (menu) {
    closeMoreMenu();
    return;
  }
  closeMoreMenu();
  const bounds = event.currentTarget.getBoundingClientRect();
  const menuHeight = 5 * 39 + 12;
  const currentMenu = ContextMenu.showContextMenu({
    x: bounds.right + 2,
    y: Math.max(8, bounds.bottom - menuHeight),
    theme: 'mac',
    customClass: 'chat-context-menu chat-nav-context-menu',
    minWidth: 136,
    maxWidth: 136,
    preserveIconWidth: false,
    onClose: (): void => {
      if (menu === currentMenu) menu = undefined;
    },
    items: [
      {
        label: '聊天文件',
        onClick: (): void => emit('selectFiles'),
      },
      {
        label: '聊天记录管理',
        disabled:
          !props.activeId || props.busy || props.sending || props.fileBusy,
        onClick: (): void => emit('openHistory'),
      },
      { label: '锁定' },
      { label: '意见反馈' },
      {
        label: '设置',
        onClick: (): void => emit('openSettings'),
      },
    ],
  });
  menu = currentMenu;
};

/** Escape 收起个人资料并将焦点还给头像。 */
const closeProfileOnEscape = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.isComposing || !profileOpen.value) return;
  profileOpen.value = false;
  profileButton.value?.focus();
};

watch(
  () => props.user.id,
  () => {
    profileOpen.value = false;
    closeMoreMenu();
  },
);
onMounted(() => document.addEventListener('keydown', closeProfileOnEscape));
onBeforeUnmount(() => {
  document.removeEventListener('keydown', closeProfileOnEscape);
  closeMoreMenu();
});
</script>

<style>
.chat-rail {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 59px;
  min-width: 59px;
  gap: 10px;
  padding: 12px 0 10px;
}
.chat-profile {
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  margin: 0 0 10px;
  border: 0;
  padding: 0;
  border-radius: 5px;
  overflow: hidden;
  cursor: pointer;
}
.chat-profile img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.chat-nav-button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 40px;
  height: 42px;
  padding: 0;
  color: #68686d;
  border: 0;
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.chat-nav-button:hover {
  background: #cfd0d7;
}
.chat-nav-button.is-active {
  color: #00bc70;
}
.chat-rail-bottom {
  margin-top: auto;
}
</style>

<style scoped>
.chat-profile-card {
  color: #222;
  text-align: left;
  letter-spacing: 0;
  -webkit-app-region: no-drag;
}
.chat-profile-summary {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  align-items: start;
  gap: 16px;
}
.chat-profile-avatar {
  display: block;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  object-fit: cover;
}
.chat-profile-info {
  min-width: 0;
}
.chat-profile-info h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 400;
  line-height: 28px;
  overflow-wrap: anywhere;
}
.chat-profile-info p {
  display: flex;
  margin: 0;
  color: #777;
  font-size: 14px;
  line-height: 21px;
}
.chat-profile-info p > span:first-child {
  flex-shrink: 0;
}
.chat-profile-info p > span:last-child {
  min-width: 0;
  overflow-wrap: anywhere;
}
.chat-profile-signature {
  margin: 16px 0 0;
  padding-top: 14px;
  border-top: 1px solid #ebebeb;
  color: #777;
  font-size: 14px;
  line-height: 21px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.chat-nav-button {
  position: relative;
}
.friend-nav-unread,
.chat-nav-unread {
  position: absolute;
  top: 3px;
  right: 1px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 17px;
  height: 17px;
  padding: 0 4px;
  border-radius: 9px;
  background: #fa5151;
  color: #fff;
  font-size: 11px;
  line-height: 17px;
  white-space: nowrap;
}
</style>
