<template>
  <main
    class="friend-profile"
    :class="{ 'is-stranger': isStranger }"
    aria-label="朋友资料"
    :aria-busy="loading"
  >
    <div class="friend-profile-scroll" @scroll="closeActionsMenu">
      <header class="friend-profile-identity">
        <img
          class="friend-profile-avatar"
          :src="avatar"
          alt="好友头像"
          draggable="false"
          @error="avatarFailed = true"
        />
        <div class="friend-profile-name">
          <h1>
            <span>{{
              detail?.displayName ?? context?.title ?? '朋友资料'
            }}</span>
            <el-icon v-if="detail?.sex === 0" class="is-female" aria-label="女">
              <Female />
            </el-icon>
            <el-icon
              v-else-if="detail?.sex === 1"
              class="is-male"
              aria-label="男"
            >
              <Male />
            </el-icon>
          </h1>
          <template v-if="isStranger">
            <p v-if="context?.groupMember">
              群昵称：{{ detail?.groupNickname ?? '未设置' }}
            </p>
            <p v-else>UID：{{ uid }}</p>
            <p>地区：未提供</p>
          </template>
          <template v-else>
            <p v-if="detail">昵称：{{ nickname }}</p>
            <p v-if="context">UID：{{ uid }}</p>
          </template>
        </div>
        <button
          v-if="!isStranger"
          class="friend-profile-more"
          type="button"
          title="更多操作"
          aria-label="更多操作"
          aria-haspopup="menu"
          :aria-expanded="menuExpanded"
          :disabled="
            loading ||
            opening ||
            blacklistOpen ||
            blacklistBusy ||
            deleteTarget !== null ||
            !context
          "
          @click.stop="toggleActionsMenu"
        >
          <el-icon :size="18"><MoreFilled /></el-icon>
        </button>
      </header>

      <div v-if="error" class="friend-profile-error" role="alert">
        <span>{{ error }}</span>
        <button
          type="button"
          :disabled="loading || opening || deleteTarget !== null"
          @click="load"
        >
          重试
        </button>
      </div>
      <p v-else-if="loading" class="friend-profile-status" role="status">
        正在读取资料...
      </p>
      <div
        v-if="blacklistError && !blacklistOpen"
        class="friend-profile-error"
        role="alert"
      >
        <span>{{ blacklistError }}</span>
      </div>

      <section
        v-if="isStranger"
        class="friend-profile-section friend-profile-moments"
        aria-label="朋友圈"
      >
        <h2>朋友圈</h2>
      </section>
      <section v-else class="friend-profile-section" aria-label="朋友资料">
        <h2>朋友资料</h2>
        <dl>
          <dt>备注</dt>
          <dd>{{ detail ? (detail.remark ?? '未设置') : '未读取' }}</dd>
          <template v-if="!detail?.blacklisted">
            <dt>电话</dt>
            <dd :class="{ 'friend-profile-muted': phones.length === 0 }">
              {{ phones.join('\n') || '未设置' }}
            </dd>
          </template>
        </dl>
      </section>
      <section
        v-if="!isStranger"
        class="friend-profile-section"
        aria-label="更多信息"
      >
        <h2>更多信息</h2>
        <dl>
          <template v-if="!detail?.blacklisted">
            <dt>共同群聊</dt>
            <dd class="friend-profile-muted">未提供</dd>
            <dt>个性签名</dt>
            <dd>
              {{
                detail ? (detail.personalitySignature ?? '未设置') : '未读取'
              }}
            </dd>
          </template>
          <dt>来源</dt>
          <dd class="friend-profile-muted">未提供</dd>
          <template v-if="detail?.blacklisted">
            <dt>添加时间</dt>
            <dd>{{ addedDate }}</dd>
          </template>
        </dl>
      </section>
    </div>
    <footer v-if="isStranger" class="friend-profile-add">
      <button
        type="button"
        :disabled="loading || opening || applied"
        @click="applyFriend"
      >
        {{ applied ? '已发送申请' : '添加到通讯录' }}
      </button>
    </footer>
    <footer
      v-else-if="detail?.blacklisted"
      class="friend-profile-blocked"
      role="group"
    >
      <el-icon :size="14"><Warning /></el-icon>
      <span>已添加至黑名单，你将不再收到对方的消息。</span>
    </footer>
    <footer v-else class="friend-profile-actions">
      <button type="button" :disabled="messageDisabled" @click="message">
        <el-icon :size="26"><ChatRound /></el-icon>
        <span>发消息</span>
      </button>
      <button
        type="button"
        :disabled="callDisabled"
        title="语音聊天"
        @click="requestCall(RtcMediaMode.AUDIO)"
      >
        <el-icon :size="26"><Phone /></el-icon>
        <span>语音聊天</span>
      </button>
      <button
        type="button"
        :disabled="callDisabled"
        title="视频聊天"
        @click="requestCall(RtcMediaMode.VIDEO)"
      >
        <el-icon :size="26"><VideoCamera /></el-icon>
        <span>视频聊天</span>
      </button>
    </footer>
    <FriendBlacklistDialog
      :open="blacklistOpen"
      :busy="blacklistBusy"
      :error="blacklistError"
      :disabled="loading || opening"
      @confirm="changeBlacklist(true)"
      @cancel="blacklistOpen = false"
    />
    <FriendDeleteDialog
      :target="deleteTarget"
      :avatar="avatar"
      :disabled="loading || opening"
      :request="deleteFriend"
      @cancel="deleteTarget = null"
    />
  </main>
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../../shared/api/api-error';
import { RtcMediaMode } from '../../../../shared/rtc/rtc';
import { DEFAULT_AVATAR_URL } from '../../../services/runtime/public-assets';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ComputedRef, Ref } from 'vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import {
  ChatRound,
  Female,
  Male,
  MoreFilled,
  Phone,
  VideoCamera,
  Warning,
} from '@element-plus/icons-vue';
import type {
  FriendProfileContext,
  FriendProfileDetail,
} from '../../../../shared/contacts/friend-profile';
import FriendBlacklistDialog from '../../workspace/directory/friends/FriendBlacklistDialog.vue';
import FriendDeleteDialog from '../../workspace/directory/friends/FriendDeleteDialog.vue';

const context: Ref<FriendProfileContext | null> = ref(null);
const detail: Ref<FriendProfileDetail | null> = ref(null);
const loading: Ref<boolean> = ref(true);
const opening: Ref<boolean> = ref(false);
const error: Ref<string> = ref('');
const avatarFailed: Ref<boolean> = ref(false);
const menuExpanded: Ref<boolean> = ref(false);
const blacklistOpen = ref(false);
const blacklistBusy = ref(false);
const blacklistError = ref('');
const deleteTarget = ref<{ roomId: string; name: string } | null>(null);
const applied = ref(false);

/** 原生模态表单关闭前保留资料窗口，失败只在当前页面反馈。 */
const openRemark = async (): Promise<void> => {
  const api = window.friendProfileDesktop;
  if (!api || disposed || opening.value || loading.value) return;
  closeActionsMenu();
  opening.value = true;
  error.value = '';
  try {
    const saved = await api.openRemark();
    if (!disposed && saved && detail.value)
      detail.value = {
        ...detail.value,
        remark: saved.remark,
        remarkSettings: saved,
        displayName: saved.remark ?? detail.value.name,
      };
  } catch (cause) {
    if (!disposed)
      error.value = getRequestErrorMessage(cause, '打开备注窗口失败');
  } finally {
    if (!disposed) opening.value = false;
  }
};
/** 仅真实非好友使用紧凑卡片，资料读取失败时不展示添加入口。 */
const isStranger = computed(
  (): boolean => detail.value?.relationship === 'stranger',
);
let actionsMenu: ContextMenuInstance | undefined;
let disposed = false;

/** 添加时间只展示真实关系时间，并按本机自然日格式化。 */
const addedDate = computed((): string => {
  if (!detail.value?.addedAt) return '未记录';
  const date = new Date(detail.value.addedAt);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
});

/** 加入需确认，移出直接提交并保留请求期间的防重复保护。 */
const openBlacklist = (): void => {
  if (
    disposed ||
    !detail.value?.roomId ||
    loading.value ||
    opening.value ||
    blacklistOpen.value ||
    deleteTarget.value !== null ||
    blacklistBusy.value
  )
    return;
  closeActionsMenu();
  blacklistError.value = '';
  if (detail.value.blacklisted) {
    void changeBlacklist(false);
    return;
  }
  blacklistOpen.value = true;
};
/** 固定当前好友详情，非好友和本人不提供删除入口。 */
const openDeletion = (): void => {
  const profile = detail.value;
  if (
    !profile?.roomId ||
    profile.relationship !== 'friend' ||
    disposed ||
    loading.value ||
    opening.value ||
    blacklistBusy.value ||
    blacklistOpen.value ||
    deleteTarget.value
  )
    return;
  closeActionsMenu();
  deleteTarget.value = { roomId: profile.roomId, name: profile.displayName };
};

/** 子窗口不提交目标参数，由主进程使用绑定的单聊房间并在成功后关闭。 */
const deleteFriend = async (
  _roomId: string,
  clearHistory: boolean,
): Promise<void> => {
  const api = window.friendProfileDesktop;
  if (!api || disposed) throw new Error('资料窗口已关闭');
  await api.deleteFriend(clearHistory);
};

/** 仅在主进程确认成功后更新展示，失败在当前资料或加入确认框中提示。 */
const changeBlacklist = async (blocked: boolean): Promise<void> => {
  const api = window.friendProfileDesktop;
  const profile = detail.value;
  if (
    !api ||
    !profile ||
    (blocked && !blacklistOpen.value) ||
    loading.value ||
    opening.value ||
    blacklistBusy.value ||
    disposed
  )
    return;
  blacklistBusy.value = true;
  blacklistError.value = '';
  try {
    await api.setBlacklisted(blocked);
    if (disposed || detail.value !== profile) return;
    detail.value = { ...profile, blacklisted: blocked };
    blacklistOpen.value = false;
  } catch (cause) {
    if (!disposed)
      blacklistError.value = getRequestErrorMessage(
        cause,
        '黑名单操作失败，请重试',
      );
  } finally {
    if (!disposed) blacklistBusy.value = false;
  }
};

/** 推荐选项沿用真实性别，未提供时不猜测称谓。 */
const recommendLabel: ComputedRef<string> = computed((): string => {
  switch (detail.value?.sex) {
    case 0:
      return '把她推荐给朋友';
    case 1:
      return '把他推荐给朋友';
    default:
      return '推荐给朋友';
  }
});

/** 收起菜单并同步三点按钮状态，不保留已失效的资料入口。 */
const closeActionsMenu = (): void => {
  const menu = actionsMenu;
  actionsMenu = undefined;
  menuExpanded.value = false;
  menu?.closeMenu();
};

/** 复用通讯录详情菜单，黑名单项按真实状态切换加入或移出。 */
const toggleActionsMenu = (event: MouseEvent): void => {
  if (actionsMenu) {
    closeActionsMenu();
    return;
  }
  if (
    disposed ||
    loading.value ||
    opening.value ||
    blacklistOpen.value ||
    deleteTarget.value !== null ||
    blacklistBusy.value ||
    !context.value
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
        disabled:
          !detail.value?.roomId || detail.value.relationship !== 'friend',
        onClick: (): void => {
          void openRemark();
        },
      },
      { label: '设置朋友权限', divided: 'down' },
      { label: recommendLabel.value, divided: 'down' },
      { label: '设为星标朋友', divided: 'down' },
      {
        label: detail.value?.blacklisted ? '移出黑名单' : '加入黑名单',
        disabled: !detail.value?.roomId,
        divided: 'down',
        onClick: openBlacklist,
      },
      {
        label: '删除联系人',
        customClass: 'chat-context-menu-danger',
        disabled:
          !detail.value?.roomId || detail.value.relationship !== 'friend',
        onClick: openDeletion,
      },
    ],
  });
  actionsMenu = menu;
  menuExpanded.value = true;
};

/** 在脚本中读取昵称，模板只绑定明确的字符串类型。 */
const nickname: ComputedRef<string> = computed(
  (): string => detail.value?.name ?? '',
);

/** 使用已保存的私有备注电话，随详情读取和备注保存结果更新。 */
const phones = computed(
  (): string[] => detail.value?.remarkSettings?.phones ?? [],
);

/** 在脚本中读取绑定好友 UID，保持字符串标识不变。 */
const uid: ComputedRef<string> = computed(
  (): string => context.value?.uid ?? '',
);

/** 优先展示真实头像，加载失败时使用默认头像。 */
const avatar: ComputedRef<string> = computed((): string => {
  if (avatarFailed.value) return DEFAULT_AVATAR_URL;
  const source = detail.value ? detail.value.avatar : context.value?.avatar;
  return source || DEFAULT_AVATAR_URL;
});

/** 资料未就绪、正在打开或已拉黑时禁用发消息入口。 */
const messageDisabled: ComputedRef<boolean> = computed((): boolean => {
  if (
    loading.value ||
    opening.value ||
    blacklistOpen.value ||
    blacklistBusy.value ||
    deleteTarget.value !== null
  )
    return true;
  const profile = detail.value;
  if (!profile?.roomId) return true;
  return profile.blacklisted;
});

/** 通话沿用聊天操作的忙碌保护，仅向已确认的好友开放。 */
const callDisabled = computed(
  (): boolean =>
    messageDisabled.value || detail.value?.relationship !== 'friend',
);

/** 交由主工作台复用通话入口，资料窗不直接创建呼叫或申请媒体权限。 */
const requestCall = async (mediaMode: RtcMediaMode): Promise<void> => {
  const api = window.friendProfileDesktop;
  if (!api || disposed || callDisabled.value) return;
  closeActionsMenu();
  opening.value = true;
  error.value = '';
  try {
    await api.requestCall(mediaMode);
  } catch (cause) {
    if (!disposed)
      error.value = getRequestErrorMessage(cause, '通话发起失败，请重试');
  } finally {
    if (!disposed) opening.value = false;
  }
};

/** 先展示绑定会话摘要，再补充真实详情；失败保留摘要并提供重试。 */
const load = async (): Promise<void> => {
  if (blacklistBusy.value || opening.value || deleteTarget.value || disposed)
    return;
  blacklistOpen.value = false;
  blacklistError.value = '';
  closeActionsMenu();
  const api = window.friendProfileDesktop;
  if (!api) {
    loading.value = false;
    error.value = '请在桌面客户端打开好友资料';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    const summary = await api.context();
    if (disposed) return;
    context.value = summary;
    const result = await api.read();
    if (disposed) return;
    detail.value = result;
    avatarFailed.value = false;
  } catch (cause) {
    if (!disposed)
      error.value = getRequestErrorMessage(cause, '读取资料失败，请重试');
  } finally {
    if (!disposed) loading.value = false;
  }
};

/** 打开绑定陌生人的申请表单，只有真实提交成功才显示已申请。 */
const applyFriend = async (): Promise<void> => {
  const api = window.friendProfileDesktop;
  if (
    !api ||
    !isStranger.value ||
    loading.value ||
    opening.value ||
    applied.value ||
    disposed
  )
    return;
  opening.value = true;
  error.value = '';
  try {
    const submitted = await api.openApplication();
    if (!disposed) {
      applied.value = submitted !== null;
      if (
        submitted?.status === 'ADDED' &&
        detail.value?.uid === submitted.friend.uid
      )
        detail.value = {
          ...detail.value,
          ...submitted.friend,
          relationship: 'friend',
          blacklisted: false,
        };
    }
  } catch (cause) {
    if (!disposed)
      error.value = getRequestErrorMessage(cause, '打开申请失败，请重试');
  } finally {
    if (!disposed) opening.value = false;
  }
};

/** 回到绑定会话并聚焦输入框，不自动发送任何内容。 */
const message = async (): Promise<void> => {
  if (messageDisabled.value || !window.friendProfileDesktop) return;
  closeActionsMenu();
  opening.value = true;
  try {
    await window.friendProfileDesktop.message();
  } catch (cause) {
    if (!disposed)
      error.value = getRequestErrorMessage(cause, '返回聊天失败，请重试');
  } finally {
    if (!disposed) opening.value = false;
  }
};

onMounted(() => {
  window.addEventListener('resize', closeActionsMenu);
  if (!window.contextMenuHost)
    window.addEventListener('blur', closeActionsMenu);
  void load();
});
onBeforeUnmount(() => {
  disposed = true;
  closeActionsMenu();
  window.removeEventListener('resize', closeActionsMenu);
  window.removeEventListener('blur', closeActionsMenu);
});
</script>

<style scoped>
.friend-profile {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100dvh;
  padding: 23px 23px 16px;
  overflow: hidden;
  border: 1px solid #d9d9dc;
  border-radius: 8px;
  background: #fafafa;
  color: #222;
  font-size: 15px;
  line-height: 1.5;
  -webkit-app-region: no-drag;
}
.friend-profile-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
.friend-profile.is-stranger {
  padding-bottom: 23px;
}
.is-stranger .friend-profile-identity {
  padding-bottom: 15px;
}
.is-stranger .friend-profile-name h1 {
  font-size: 16px;
}
.friend-profile-moments {
  min-height: 72px;
  padding: 12px 0;
}
.friend-profile-add {
  display: flex;
  justify-content: center;
  flex-shrink: 0;
  padding-top: 24px;
  border-top: 1px solid #ededee;
}
.friend-profile-add button {
  max-width: 100%;
  min-height: 32px;
  padding: 4px 12px;
  border: 0;
  border-radius: 6px;
  background: #ededed;
  color: #222;
  font: inherit;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.friend-profile-add button:hover:not(:disabled) {
  background: #e2e2e2;
}
.friend-profile-add button:disabled {
  color: #999;
  cursor: not-allowed;
}
.friend-profile-add button:focus-visible {
  outline: 2px solid #31549b;
  outline-offset: 2px;
}
.friend-profile-identity {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  padding-bottom: 19px;
}
.friend-profile-avatar {
  width: 72px;
  height: 72px;
  flex: 0 0 72px;
  object-fit: cover;
  border-radius: 6px;
}
.friend-profile-name {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.friend-profile-name h1 {
  display: flex;
  align-items: baseline;
  gap: 5px;
  margin: 0 0 5px;
  font-size: 19px;
  line-height: 1.4;
  font-weight: 400;
}
.friend-profile-name h1 span {
  min-width: 0;
}
.friend-profile-name h1 .el-icon {
  flex-shrink: 0;
  font-size: 16px;
}
.is-female {
  color: #f47786;
}
.is-male {
  color: #518fc5;
}
.friend-profile-name p {
  margin: 0;
  color: #77777f;
  font-size: 13px;
  line-height: 19px;
}
.friend-profile-more {
  display: grid;
  place-items: center;
  flex: 0 0 22px;
  width: 22px;
  height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #74747a;
  border-radius: 4px;
  cursor: pointer;
}
.friend-profile-more:hover:not(:disabled),
.friend-profile-more[aria-expanded='true'] {
  background: #e9e9e9;
}
.friend-profile-more:focus-visible {
  outline: 2px solid #31549b;
  outline-offset: 2px;
}
.friend-profile-more:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.friend-profile-section {
  padding: 17px 0;
  border-top: 1px solid #ededee;
}
.friend-profile-section h2 {
  margin: 0 0 8px;
  color: #77777f;
  font-size: 15px;
  font-weight: 400;
}
.friend-profile-section dl {
  display: grid;
  grid-template-columns: 70px minmax(0, 1fr);
  gap: 5px 10px;
  margin: 0;
}
.friend-profile-section dt,
.friend-profile-muted {
  color: #77777f;
}
.friend-profile-section dd {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.friend-profile-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  flex-shrink: 0;
  gap: 6px;
  padding-top: 19px;
  border-top: 1px solid #ededee;
}
.friend-profile-blocked {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-shrink: 0;
  min-height: 92px;
  padding: 20px 0;
  border-top: 1px solid #ededee;
  color: #99999f;
  font-size: 13px;
  line-height: 20px;
}
.friend-profile-blocked .el-icon {
  flex-shrink: 0;
  color: #ff4d4f;
}
.friend-profile-blocked span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.friend-profile-actions button {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  min-height: 68px;
  padding: 4px 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #31549b;
  font-size: 13px;
  cursor: pointer;
}
.friend-profile-actions button:hover:not(:disabled) {
  background: #edf2f8;
}
.friend-profile-actions button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.friend-profile-actions button:focus-visible {
  outline: 2px solid #31549b;
}
.friend-profile-status {
  margin: 8px 0;
  color: #77777f;
  font-size: 13px;
}
.friend-profile-error {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 13px;
  color: #b74c42;
}
.friend-profile-error span {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.friend-profile-error button {
  flex-shrink: 0;
  border: 0;
  background: transparent;
  color: #31549b;
  cursor: pointer;
}
</style>
