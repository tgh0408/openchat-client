<template>
  <section class="friend-detail" aria-label="好友资料" :aria-busy="loading">
    <header class="friend-detail-toolbar">
      <button
        class="chat-small-button chat-mobile-back"
        title="返回通讯录"
        aria-label="返回通讯录"
        @click="emit('back')"
      >
        <el-icon><ArrowLeft /></el-icon>
      </button>
    </header>
    <div v-if="!friend" class="chat-empty" aria-label="未选择好友">
      <el-icon :size="72"><User /></el-icon>
    </div>
    <div v-else class="friend-detail-scroll" @scroll="closeActionsMenu">
      <div class="friend-detail-body">
        <div class="friend-detail-identity">
          <img
            class="friend-detail-avatar"
            :src="avatar"
            alt="好友头像"
            draggable="false"
            @error="avatarFailed = true"
          />
          <div class="friend-detail-name">
            <h1>{{ detail?.displayName ?? friend.displayName }}</h1>
            <p>UID：{{ friend.uid }}</p>
            <p v-if="detail">{{ sexLabel }}</p>
          </div>
          <button
            type="button"
            class="chat-small-button friend-detail-more"
            title="更多操作"
            aria-label="更多操作"
            aria-haspopup="menu"
            :aria-expanded="menuExpanded"
            :disabled="
              loading ||
              opening ||
              disabled ||
              blacklistOpen ||
              blacklistBusy ||
              deleteTarget !== null
            "
            @click.stop="toggleActionsMenu"
          >
            <el-icon :size="20"><MoreFilled /></el-icon>
          </button>
        </div>
        <p v-if="loading" class="friend-detail-status" role="status">
          正在读取资料...
        </p>
        <p v-if="remarkError" class="friend-detail-error" role="alert">
          {{ remarkError }}
        </p>
        <div v-if="error" class="friend-detail-error" role="alert">
          <span>{{ error }}</span>
          <el-button
            :disabled="
              loading ||
              disabled ||
              opening ||
              blacklistBusy ||
              deleteTarget !== null
            "
            link
            @click="emit('refresh')"
          >
            重试
          </el-button>
        </div>
        <div
          v-if="blacklistError && !blacklistOpen"
          class="friend-detail-error"
          role="alert"
        >
          <span>{{ blacklistError }}</span>
        </div>
        <template v-if="detail">
          <section class="friend-detail-section" aria-label="朋友资料">
            <h2>朋友资料</h2>
            <dl>
              <dt>昵称</dt>
              <dd>{{ detail.name }}</dd>
              <dt>备注</dt>
              <dd :class="{ 'friend-detail-muted': !detail.remark }">
                {{ detail.remark ?? '未设置' }}
              </dd>
              <template v-if="!detail.blacklisted">
                <dt>电话</dt>
                <dd :class="{ 'friend-detail-muted': phones.length === 0 }">
                  {{ phones.join('\n') || '未设置' }}
                </dd>
                <dt>个性签名</dt>
                <dd
                  :class="{
                    'friend-detail-muted': !detail.personalitySignature,
                  }"
                >
                  {{ detail.personalitySignature ?? '未设置' }}
                </dd>
              </template>
            </dl>
          </section>
          <section class="friend-detail-section" aria-label="更多信息">
            <h2>更多信息</h2>
            <dl>
              <template v-if="detail.blacklisted">
                <dt>来源</dt>
                <dd class="friend-detail-muted">未提供</dd>
              </template>
              <dt>添加时间</dt>
              <dd>{{ addedDate }}</dd>
            </dl>
          </section>
          <p
            v-if="detail.blacklisted"
            class="friend-detail-blocked"
            role="status"
          >
            <el-icon :size="14"><Warning /></el-icon>
            <span>已添加至黑名单，你将不再收到对方的消息。</span>
          </p>
          <div v-else class="friend-detail-actions">
            <button
              class="friend-detail-message"
              :disabled="
                disabled ||
                loading ||
                opening ||
                blacklistBusy ||
                deleteTarget !== null ||
                !detail.roomId ||
                detail.blacklisted
              "
              @click="emit('message')"
            >
              <el-icon :size="27"><ChatDotRound /></el-icon>
              <span>{{ opening ? '正在打开...' : '发消息' }}</span>
            </button>
          </div>
          <p v-if="!detail.roomId" class="friend-detail-status">
            暂无可用的单聊会话
          </p>
        </template>
      </div>
    </div>
    <FriendBlacklistDialog
      :open="blacklistOpen"
      :busy="blacklistBusy"
      :error="blacklistError"
      :disabled="disabled"
      @confirm="changeBlacklist(true)"
      @cancel="resetBlacklist"
    />
    <FriendDeleteDialog
      :target="deleteTarget"
      :avatar="avatar"
      :disabled="disabled || loading || opening"
      :request="deleteFriend"
      @cancel="deleteTarget = null"
      @deleted="
        (roomId: string, clearHistory: boolean) =>
          emit('deleted', roomId, clearHistory)
      "
    />
  </section>
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../../../shared/api/api-error';
import { DEFAULT_AVATAR_URL } from '../../../../services/runtime/public-assets';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ContextMenu from '../../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../../services/context-menu/context-menu';
import { ElButton, ElIcon } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import {
  ArrowLeft,
  ChatDotRound,
  MoreFilled,
  User,
  Warning,
} from '@element-plus/icons-vue';
import type {
  Friend,
  FriendDetail,
} from '../../../../../shared/contacts/friend';
import FriendBlacklistDialog from './FriendBlacklistDialog.vue';
import FriendDeleteDialog from './FriendDeleteDialog.vue';

const props = defineProps<{
  friend: Friend | null;
  detail: FriendDetail | null;
  loading: boolean;
  opening: boolean;
  disabled: boolean;
  error: string;
  blockRoomUser: (roomId: string, uid: string) => Promise<void>;
  unblockRoomUser: (roomId: string, uid: string) => Promise<void>;
  deleteFriend: (roomId: string, clearHistory: boolean) => Promise<void>;
}>();
const emit = defineEmits<{
  (event: 'back' | 'refresh' | 'message'): void;
  (event: 'blocked', uid: string, roomId: string, blacklisted: boolean): void;
  (event: 'deleted', roomId: string, clearHistory: boolean): void;
}>();
const avatarFailed = ref(false);
const remarkBusy = ref(false);
const remarkError = ref('');
const menuExpanded = ref(false);
let actionsMenu: ContextMenuInstance | undefined;
const blacklistOpen = ref(false);
const blacklistBusy = ref(false);
const blacklistError = ref('');
const deleteTarget = ref<{ roomId: string; name: string } | null>(null);
let blacklistTarget: { uid: string; roomId: string } | null = null;
let blacklistVersion = 0;
let disposed = false;

/** 从通讯录打开原生备注窗口，返回结果只作用于当前好友。 */
const openRemark = async (): Promise<void> => {
  const detail = props.detail;
  if (
    !detail?.roomId ||
    detail.uid !== props.friend?.uid ||
    disposed ||
    remarkBusy.value ||
    props.disabled ||
    props.loading ||
    props.opening
  )
    return;
  closeActionsMenu();
  remarkError.value = '';
  if (!window.desktop) {
    remarkError.value = '请在桌面客户端设置备注和标签';
    return;
  }
  const version = blacklistVersion;
  remarkBusy.value = true;
  try {
    await window.desktop.openFriendRemark(detail.uid, detail.roomId);
  } catch (cause) {
    if (!disposed && version === blacklistVersion && !props.disabled)
      remarkError.value = getRequestErrorMessage(cause, '打开备注窗口失败');
  } finally {
    if (!disposed && version === blacklistVersion) remarkBusy.value = false;
  }
};

/** 关闭旧确认上下文，选择变化和授权失效后拒绝迟到结果。 */
const resetBlacklist = (): void => {
  remarkBusy.value = false;
  remarkError.value = '';
  deleteTarget.value = null;
  blacklistVersion++;
  blacklistOpen.value = false;
  blacklistBusy.value = false;
  blacklistError.value = '';
  blacklistTarget = null;
};

/** 绑定当前好友和房间，加入弹窗确认，移出直接请求。 */
const openBlacklist = (): void => {
  const detail = props.detail;
  if (
    disposed ||
    blacklistBusy.value ||
    blacklistOpen.value ||
    deleteTarget.value !== null ||
    !detail?.roomId ||
    detail.uid !== props.friend?.uid ||
    props.disabled ||
    props.loading ||
    props.opening
  )
    return;
  resetBlacklist();
  closeActionsMenu();
  blacklistTarget = { uid: detail.uid, roomId: detail.roomId };
  if (detail.blacklisted) {
    void changeBlacklist(false);
    return;
  }
  blacklistOpen.value = true;
};
/** 删除确认固定当前资料的真实单聊房间，不能借菜单改动其他联系人。 */
const openDeletion = (): void => {
  const detail = props.detail;
  if (
    !detail?.roomId ||
    detail.uid !== props.friend?.uid ||
    props.disabled ||
    props.loading ||
    props.opening ||
    blacklistBusy.value ||
    blacklistOpen.value ||
    deleteTarget.value ||
    disposed
  )
    return;
  closeActionsMenu();
  deleteTarget.value = { roomId: detail.roomId, name: detail.displayName };
};

/** 服务端成功后更新状态，失败在资料页或加入确认框中提示。 */
const changeBlacklist = async (blocked: boolean): Promise<void> => {
  const target = blacklistTarget;
  if (
    !target ||
    (blocked && !blacklistOpen.value) ||
    blacklistBusy.value ||
    props.disabled ||
    props.loading ||
    props.opening ||
    disposed
  )
    return;
  const version = blacklistVersion;
  blacklistBusy.value = true;
  blacklistError.value = '';
  /** 完成结果只更新仍在查看的原好友。 */
  const isCurrent = (): boolean =>
    !disposed &&
    !props.disabled &&
    version === blacklistVersion &&
    target.uid === props.friend?.uid &&
    target.roomId === props.detail?.roomId;
  try {
    const request = blocked ? props.blockRoomUser : props.unblockRoomUser;
    await request(target.roomId, target.uid);
    if (!isCurrent()) return;
    blacklistOpen.value = false;
    emit('blocked', target.uid, target.roomId, blocked);
  } catch (cause) {
    if (isCurrent())
      blacklistError.value = getRequestErrorMessage(
        cause,
        '黑名单操作失败，请重试',
      );
  } finally {
    if (isCurrent()) blacklistBusy.value = false;
  }
};
/** 详情优先使用本次返回的头像，加载失败时回退应用默认图。 */
const avatar = computed((): string => {
  if (avatarFailed.value) return DEFAULT_AVATAR_URL;
  const source = props.detail ? props.detail.avatar : props.friend?.avatar;
  return source || DEFAULT_AVATAR_URL;
});
/** 按后端现有性别枚举显示，未知值不猜测。 */
const sexLabel = computed((): string => {
  switch (props.detail?.sex) {
    case 1:
      return '性别：男';
    case 0:
      return '性别：女';
    default:
      return '性别：未设置';
  }
});
/** 从当前好友详情读取备注电话，保留号码原有顺序和字符串格式。 */
const phones = computed(
  (): string[] => props.detail?.remarkSettings?.phones ?? [],
);
/** 推荐入口使用已知性别，资料未提供时不猜测称谓。 */
const recommendLabel = computed((): string => {
  switch (props.detail?.sex) {
    case 0:
      return '把她推荐给朋友';
    case 1:
      return '把他推荐给朋友';
    default:
      return '推荐给朋友';
  }
});

/** 关闭浮层并清除展开状态，避免留下旧联系人的菜单。 */
const closeActionsMenu = (): void => {
  const menu = actionsMenu;
  actionsMenu = undefined;
  menuExpanded.value = false;
  menu?.closeMenu();
};

/** 三点按钮复用会话右键菜单，关系操作绑定当前详情。 */
const toggleActionsMenu = (event: MouseEvent): void => {
  if (actionsMenu) {
    closeActionsMenu();
    return;
  }
  if (
    !props.friend ||
    props.loading ||
    props.opening ||
    props.disabled ||
    remarkBusy.value ||
    blacklistOpen.value ||
    blacklistBusy.value ||
    deleteTarget.value !== null
  )
    return;
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const bounds = event.currentTarget.getBoundingClientRect();
  const menu = ContextMenu.showContextMenu({
    x: Math.max(8, bounds.right - 160),
    y: bounds.bottom + 2,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 160,
    maxWidth: Math.max(160, window.innerWidth - 16),
    preserveIconWidth: false,
    onClose: (): void => {
      if (actionsMenu !== menu) return;
      actionsMenu = undefined;
      menuExpanded.value = false;
    },
    items: [
      {
        label: '设置备注和标签',
        disabled: !props.detail?.roomId,
        onClick: (): void => {
          void openRemark();
        },
      },
      { label: '设置朋友权限', divided: 'down' },
      { label: recommendLabel.value, divided: 'down' },
      { label: '设为星标朋友', divided: 'down' },
      {
        label: props.detail?.blacklisted ? '移出黑名单' : '加入黑名单',
        disabled: !props.detail?.roomId,
        divided: 'down',
        onClick: openBlacklist,
      },
      {
        label: '删除联系人',
        customClass: 'chat-context-menu-danger',
        disabled: !props.detail?.roomId,
        onClick: openDeletion,
      },
    ],
  });
  actionsMenu = menu;
  menuExpanded.value = true;
};
/** 将带时区的关系创建时间按本机自然日展示。 */
const addedDate = computed((): string => {
  if (!props.detail?.addedAt) return '未记录';
  const date = new Date(props.detail.addedAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
});
watch(
  () => [props.friend?.uid, props.detail?.avatar, props.loading],
  () => {
    avatarFailed.value = false;
  },
);
watch(
  () => [props.friend?.uid, props.loading, props.opening, props.disabled],
  closeActionsMenu,
);
watch(
  () => [props.friend?.uid, props.detail?.roomId, props.disabled],
  resetBlacklist,
);
onMounted(() => window.addEventListener('resize', closeActionsMenu));
onBeforeUnmount(() => {
  disposed = true;
  resetBlacklist();
  closeActionsMenu();
  window.removeEventListener('resize', closeActionsMenu);
});
</script>

<style scoped>
.friend-detail-blocked {
  display: flex;
  align-items: center;
  gap: 7px;
  min-height: 92px;
  margin: 0;
  padding: 24px 0;
  border-top: 1px solid #eeeeef;
  color: #99999f;
  font-size: 13px;
  line-height: 20px;
}
.friend-detail-blocked .el-icon {
  flex-shrink: 0;
  color: #ff4d4f;
}
.friend-detail-blocked span {
  min-width: 0;
  overflow-wrap: anywhere;
}

.friend-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: #fafafa;
}

.friend-detail-toolbar {
  display: none;
  align-items: center;
  gap: 12px;
  min-height: 52px;
  padding: 8px 20px;
}

.friend-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.friend-detail-body {
  width: min(100%, 460px);
  margin: 0 auto;
  padding: 60px 32px 30px;
}

.friend-detail-identity {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 24px;
}

.friend-detail-avatar {
  flex: 0 0 72px;
  width: 72px;
  height: 72px;
  border-radius: 7px;
  object-fit: cover;
}

.friend-detail-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.friend-detail-more {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  padding: 0;
  color: #75757c;
}

.friend-detail-name h1 {
  margin: 0 0 9px;
  font-size: 21px;
  line-height: 1.4;
  font-weight: 500;
  color: #222226;
}

.friend-detail-name p {
  margin: 3px 0;
  color: #75757c;
  font-size: 13px;
}

.friend-detail-section {
  padding: 21px 0;
  border-top: 1px solid #eeeeef;
}

.friend-detail-section h2 {
  margin: 0 0 16px;
  color: #75757c;
  font-size: 14px;
  font-weight: 400;
}

.friend-detail-section dl {
  display: grid;
  grid-template-columns: 72px minmax(0, 1fr);
  gap: 14px 10px;
  margin: 0;
  font-size: 14px;
  line-height: 1.6;
}

.friend-detail-section dt,
.friend-detail-muted {
  color: #85858b;
}

.friend-detail-section dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.friend-detail-actions {
  display: flex;
  justify-content: center;
  padding-top: 24px;
  border-top: 1px solid #eeeeef;
}

.friend-detail-message {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 10px;
  min-width: 96px;
  min-height: 78px;
  border: 0;
  border-radius: 4px;
  padding: 8px 12px;
  background: transparent;
  color: #31549b;
  font-size: 14px;
  cursor: pointer;
}

.friend-detail-message:hover:not(:disabled) {
  background: #edf2f8;
}

.friend-detail-message:disabled {
  color: #98989e;
  cursor: default;
}

.friend-detail-status {
  color: #85858b;
  font-size: 13px;
  text-align: center;
}

.friend-detail-error {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 18px;
  color: #b74c42;
  font-size: 13px;
  overflow-wrap: anywhere;
}

.friend-detail-error span {
  flex: 1;
  min-width: 0;
}

@media (max-width: 560px) {
  .friend-detail-toolbar {
    display: flex;
  }

  .friend-detail-body {
    padding: 26px 20px;
  }
}
</style>
