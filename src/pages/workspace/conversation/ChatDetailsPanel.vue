<template>
  <Transition name="chat-details-slide">
    <aside
      v-if="open"
      id="chat-conversation-details"
      class="chat-details-panel"
      aria-label="聊天信息"
      :inert="!open"
    >
      <div v-if="isGroup" class="chat-details-search-header">
        <div class="chat-details-member-search">
          <el-icon :size="16"><Search /></el-icon>
          <input
            v-model="memberSearch"
            type="search"
            placeholder="搜索群成员"
            aria-label="搜索群成员"
            :disabled="membersBusy || disabled"
          />
        </div>
      </div>
      <div class="chat-details-scroll" :class="{ 'is-group': isGroup }">
        <template v-if="isGroup">
          <div class="chat-details-members chat-details-group-members">
            <button
              v-for="member in visibleMembers"
              :key="member.uid"
              type="button"
              class="chat-details-member"
              :title="memberLabel(member)"
              :aria-label="`查看${memberLabel(member)}的资料`"
              :disabled="disabled"
              @click="openMemberProfile($event, member)"
            >
              <div class="chat-details-avatar">
                <img
                  :src="member.avatar || DEFAULT_AVATAR_URL"
                  alt=""
                  draggable="false"
                  @error="showDefaultAvatar"
                />
              </div>
              <span>{{ memberLabel(member) }}</span>
            </button>
            <button
              type="button"
              class="chat-details-add"
              title="添加成员"
              aria-label="添加成员"
              :disabled="disabled || groupRemoved"
              @click="openMemberPicker"
            >
              <span class="chat-details-add-icon">
                <el-icon :size="24"><Plus /></el-icon>
              </span>
              <span>添加</span>
            </button>
            <button
              v-if="canRemoveMembers"
              type="button"
              class="chat-details-add"
              title="移出成员"
              aria-label="移出成员"
              :disabled="disabled || membersBusy || Boolean(membersError)"
              @click="openRemoveMemberPicker"
            >
              <span class="chat-details-add-icon">
                <el-icon :size="24"><Minus /></el-icon>
              </span>
              <span>移出</span>
            </button>
          </div>
          <button
            v-if="hasMoreMembers"
            type="button"
            class="chat-details-more-members"
            @click="visibleMemberCount += 80"
          >
            查看更多
            <el-icon :size="12"><ArrowDown /></el-icon>
          </button>
          <button
            v-if="visibleMemberCount > 16"
            type="button"
            class="chat-details-more-members"
            @click="visibleMemberCount = 16"
          >
            收起成员
            <el-icon :size="12"><ArrowUp /></el-icon>
          </button>
          <p v-if="membersBusy" class="chat-details-hint" role="status">
            正在读取群成员...
          </p>
          <p v-if="membersError" class="chat-details-status" role="alert">
            {{ membersError }}
            <button
              type="button"
              :disabled="disabled || membersBusy"
              @click="loadGroupMembers"
            >
              重试
            </button>
          </p>
          <p
            v-else-if="!membersBusy && !filteredMembers.length"
            class="chat-details-hint"
          >
            暂无匹配的群成员
          </p>
        </template>
        <div v-else class="chat-details-members">
          <button
            type="button"
            class="chat-details-member"
            :title="title"
            :aria-label="`查看${title}的资料`"
            :disabled="!canOpenProfile || disabled"
            @click="openProfile"
          >
            <span class="chat-details-avatar">
              <el-icon
                v-if="conversation?.type === FILE_ASSISTANT_TYPE"
                :size="26"
              >
                <FolderOpened />
              </el-icon>
              <img
                v-else
                :src="avatarSource"
                alt=""
                draggable="false"
                @error="avatarFailed = true"
              />
            </span>
            <span>{{ title }}</span>
          </button>
          <button
            type="button"
            class="chat-details-add"
            title="添加成员"
            aria-label="添加成员"
            disabled
          >
            <span class="chat-details-add-icon">
              <el-icon :size="24"><Plus /></el-icon>
            </span>
            <span>添加</span>
          </button>
        </div>
        <template v-if="isGroup">
          <section class="chat-details-section">
            <div class="chat-details-section-heading">
              <h2>群聊名称</h2>
              <button
                v-if="canManageGroupInfo && !groupNameEditing"
                type="button"
                class="chat-details-icon-button"
                title="编辑群资料"
                aria-label="编辑群资料"
                :disabled="disabled"
                @click="startGroupNameEditing"
              >
                <el-icon :size="14"><Edit /></el-icon>
              </button>
            </div>
            <input
              v-if="groupNameEditing"
              v-model="groupNameDraft"
              class="chat-details-info-input"
              maxlength="256"
              :disabled="groupNameBusy"
              @blur="saveGroupName"
              @keydown.enter.prevent="saveGroupName"
              @keydown.esc="cancelGroupNameEditing"
              aria-label="群聊名称"
            />
            <p v-else>{{ group?.name || title }}</p>
          </section>
          <GroupAnnouncement
            :notice="group?.notice"
            :can-edit="canManageGroupInfo"
            :disabled="disabled"
            :editing="groupDescriptionEditing"
            :draft="groupDescriptionDraft"
            :busy="groupDescriptionBusy"
            @edit="startGroupDescriptionEditing"
            @update:draft="groupDescriptionDraft = $event"
            @save="saveGroupDescription"
            @cancel="cancelGroupDescriptionEditing"
          />
          <section class="chat-details-section">
            <h2>备注</h2>
            <p class="chat-details-muted">群聊的备注仅自己可见</p>
          </section>
          <section class="chat-details-section">
            <h2>我在本群的昵称</h2>
            <p class="chat-details-muted">{{ myGroupNickname }}</p>
          </section>
          <section class="chat-details-section chat-details-qr-section">
            <h2>群二维码</h2>
            <div v-if="group?.qrCode.length" class="chat-details-qr-list">
              <article
                v-for="(qrCode, index) in group.qrCode"
                :key="`${qrCode.url}-${qrCode.createTime}-${index}`"
                class="chat-details-qr-record"
              >
                <img
                  :src="qrCode.url"
                  :alt="`群二维码 ${index + 1}`"
                  class="chat-details-qr-image"
                />
                <div class="chat-details-qr-meta">
                  <p>
                    生成时间：{{ formatGroupRecordTime(qrCode.createTime) }}
                  </p>
                  <p v-if="qrCode.expireTime">
                    过期时间：{{ formatGroupRecordTime(qrCode.expireTime) }}
                  </p>
                  <p v-if="qrCode.keyword">密钥：{{ qrCode.keyword }}</p>
                </div>
              </article>
            </div>
            <div v-else class="chat-details-qr-empty">
              <el-icon :size="24"><Grid /></el-icon>
              <span>二维码由系统生成</span>
            </div>
          </section>
          <p v-if="groupInfoError" class="chat-details-status" role="alert">
            {{ groupInfoError }}
          </p>
          <div class="chat-details-group-options">
            <button
              type="button"
              class="chat-details-row chat-details-history"
              :disabled="disabled"
              @click="emit('history')"
            >
              <span>查找聊天内容</span>
              <el-icon :size="14"><ArrowRight /></el-icon>
            </button>
            <div class="chat-details-row">
              <span>消息免打扰</span>
              <el-switch
                :model-value="conversation?.notDisturb === 1"
                size="small"
                aria-label="消息免打扰"
                :disabled="disabled || notDisturbBusy"
                @update:model-value="changeNotDisturb"
              />
            </div>
            <p v-if="notDisturbError" class="chat-details-status" role="alert">
              {{ notDisturbError }}
            </p>
            <div class="chat-details-row chat-details-subrow">
              <span>折叠该聊天</span>
              <el-switch
                :model-value="false"
                size="small"
                aria-label="折叠该聊天"
                disabled
              />
            </div>
            <button
              type="button"
              class="chat-details-row chat-details-subrow"
              disabled
            >
              <span>关注的群成员</span>
              <el-icon :size="14"><ArrowRight /></el-icon>
            </button>
            <div class="chat-details-row">
              <span>置顶聊天</span>
              <el-switch
                :model-value="conversation?.isTop === 1"
                size="small"
                aria-label="置顶聊天"
                :disabled="disabled || topBusy"
                @update:model-value="changeTop"
              />
            </div>
            <div class="chat-details-row">
              <span>保存到通讯录</span>
              <el-switch
                :model-value="false"
                size="small"
                aria-label="保存到通讯录"
                disabled
              />
            </div>
            <div class="chat-details-row">
              <span>显示群成员昵称</span>
              <el-switch
                :model-value="true"
                size="small"
                aria-label="显示群成员昵称"
                disabled
              />
            </div>
          </div>
          <p v-if="topError" class="chat-details-status" role="alert">
            {{ topError }}
          </p>
          <button
            type="button"
            class="chat-details-clear"
            :disabled="disabled || !canClearConversation"
            @click="emit('clear')"
          >
            清空聊天记录
          </button>
          <button
            type="button"
            class="chat-details-exit"
            :disabled="!canExitGroup"
            @click="openExitDialog"
          >
            {{ departureAction === 'dissolve' ? '解散群聊' : '退出群聊' }}
          </button>
        </template>
        <template v-else>
          <div class="chat-details-search">
            <button
              type="button"
              class="chat-details-row"
              :disabled="disabled"
              @click="emit('history')"
            >
              <span>查找聊天内容</span>
              <el-icon :size="14"><ArrowRight /></el-icon>
            </button>
          </div>
          <div class="chat-details-switches">
            <div class="chat-details-row">
              <span>消息免打扰</span>
              <el-switch
                :model-value="conversation?.notDisturb === 1"
                size="small"
                aria-label="消息免打扰"
                :disabled="disabled || notDisturbBusy"
                @update:model-value="changeNotDisturb"
              />
            </div>
            <p v-if="notDisturbError" class="chat-details-status" role="alert">
              {{ notDisturbError }}
            </p>
            <div class="chat-details-row">
              <span>置顶聊天</span>
              <el-switch
                :model-value="conversation?.isTop === 1"
                size="small"
                aria-label="置顶聊天"
                :disabled="disabled || topBusy"
                @update:model-value="changeTop"
              />
            </div>
          </div>
          <button
            type="button"
            class="chat-details-clear"
            :disabled="disabled || !canClearConversation"
            @click="emit('clear')"
          >
            清空聊天记录
          </button>
        </template>
      </div>
    </aside>
  </Transition>
  <el-dialog
    :model-value="exitOpen"
    :title="exitActionLabel"
    width="320px"
    class="group-exit-dialog"
    align-center
    append-to-body
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!exitBusy"
    @update:model-value="closeExitDialog"
  >
    <p v-if="exitAction === 'dissolve'" class="group-exit-copy">
      确定解散“{{
        title
      }}”吗？解散后所有成员都将无法继续在该群聊天，已有本地聊天记录会保留。
    </p>
    <p v-else class="group-exit-copy">
      确定退出“{{
        title
      }}”吗？退出后将不再接收该群的新消息，已有聊天记录会保留。
    </p>
    <p
      v-if="exitError"
      class="chat-details-status group-exit-copy"
      role="alert"
    >
      {{ exitError }}
    </p>
    <template #footer>
      <el-button :disabled="exitBusy" @click="closeExitDialog">取消</el-button>
      <el-button
        type="danger"
        :loading="exitBusy"
        :disabled="!canExitGroup || exitBusy || exitAction !== departureAction"
        @click="confirmExitGroup"
        >{{ exitActionLabel }}</el-button
      >
    </template>
  </el-dialog>
  <ContactPickerDialog
    :open="memberPickerOpen"
    :title="removingMembers ? '移出群成员' : '添加群成员'"
    :confirm-label="removingMembers ? '移出' : '添加'"
    :busy-label="removingMembers ? '正在移出...' : '正在添加...'"
    :excluded-label="removingMembers ? '不可移出' : '已在群聊'"
    :contacts="inviteContacts"
    :excluded-uids="inviteExcludedUids"
    :loading="inviteLoading"
    :error="inviteError"
    :busy="inviteBusy"
    :submit-error="inviteSubmitError"
    :can-confirm="!disabled && (!removingMembers || canRemoveMembers)"
    @cancel="closeMemberPicker"
    @retry="loadInviteContacts"
    @confirm="addSelectedMembers"
  />
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../../shared/api/api-error';
import { DEFAULT_AVATAR_URL } from '../../../services/runtime/public-assets';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton, ElDialog, ElIcon, ElSwitch } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/switch/style/css';
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  FolderOpened,
  Grid,
  Edit,
  Minus,
  Plus,
  Search,
} from '@element-plus/icons-vue';
import type { Conversation } from '../../../../shared/storage/database';
import { FILE_ASSISTANT_TYPE } from '../../../../shared/chat/chat';
import type { FriendProfileAnchor } from '../../../../shared/contacts/friend-profile';
import type {
  GroupDirectoryItem,
  GroupDepartureAction,
  GroupMemberItem,
  UpdateGroupInfoRequest,
} from '../../../../shared/contacts/group';
import {
  canManageGroupMembers,
  canRemoveGroupMember,
  formatGroupRecordTime,
  getGroupDepartureAction,
} from '../../../../shared/contacts/group';
import type { Friend } from '../../../../shared/contacts/friend';
import ContactPickerDialog from '../../../components/contacts/ContactPickerDialog.vue';
import GroupAnnouncement from './GroupAnnouncement.vue';

const props = defineProps<{
  open: boolean;
  conversation?: Conversation;
  title: string;
  disabled: boolean;
  allowClear: boolean;
  userId: string;
  group?: GroupDirectoryItem;
  listFriends: () => Promise<Friend[]>;
  listGroupMembers: (roomId: string) => Promise<GroupMemberItem[]>;
  addGroupMembers: (roomId: string, uids: string[]) => Promise<void>;
  removeGroupMembers: (roomId: string, uids: string[]) => Promise<void>;
  exitGroup: (roomId: string) => Promise<void>;
  dissolveGroup: (roomId: string) => Promise<void>;
  groupRemoved: boolean;
  updateGroupInfo: (request: UpdateGroupInfoRequest) => Promise<void>;
  toggleTop: (status: 0 | 1) => Promise<void>;
  toggleNotDisturb: (status: 0 | 1) => Promise<void>;
  notDisturbBusy: boolean;
}>();
const emit = defineEmits<{
  (event: 'profile', anchor: FriendProfileAnchor, targetUid?: string): void;
  (event: 'history'): void;
  (event: 'clear'): void;
  (event: 'members-added', roomId: string): void;
  (event: 'members-removed', roomId: string): void;
  (event: 'group-updated', roomId: string): void;
}>();
const avatarFailed = ref(false);
const memberSearch = ref('');
const groupMembers = ref<GroupMemberItem[]>([]);
const membersBusy = ref(false);
const membersError = ref('');
const topBusy = ref(false);
const topError = ref('');
const notDisturbError = ref('');
let notDisturbRequestVersion = 0;
const groupNameEditing = ref(false);
const groupNameBusy = ref(false);
const groupDescriptionEditing = ref(false);
const groupDescriptionBusy = ref(false);
const groupInfoError = ref('');
const groupNameDraft = ref('');
const groupDescriptionDraft = ref('');
const visibleMemberCount = ref(16);
const memberPickerOpen = ref(false);
const memberPickerMode = ref<'add' | 'remove'>('add');
const removingMembers = computed(
  (): boolean => memberPickerMode.value === 'remove',
);
const inviteContacts = ref<Friend[]>([]);
const inviteExcludedUids = ref<string[]>([]);
const inviteLoading = ref(false);
const inviteError = ref('');
const inviteBusy = ref(false);
const inviteSubmitError = ref('');
const exitOpen = ref(false);
const exitBusy = ref(false);
const exitError = ref('');
const exitAction = ref<GroupDepartureAction>('exit');
const exitActionLabel = computed((): string =>
  exitAction.value === 'dissolve' ? '解散群聊' : '退出群聊',
);
let exitRequestVersion = 0;
let inviteRequestVersion = 0;
let membersRequestVersion = 0;
let topRequestVersion = 0;
let groupInfoRequestVersion = 0;
const canOpenProfile = computed(
  (): boolean =>
    props.conversation?.type === 2 && Boolean(props.conversation.participantId),
);
const canClearConversation = computed(
  (): boolean =>
    props.allowClear &&
    (props.conversation?.type === 1 || props.conversation?.type === 2),
);
const isGroup = computed((): boolean => props.conversation?.type === 1);
const currentMember = computed((): GroupMemberItem | undefined =>
  groupMembers.value.find((member) => member.uid === props.userId),
);
const departureAction = computed((): GroupDepartureAction | null =>
  getGroupDepartureAction(currentMember.value?.role),
);
const canRemoveMembers = computed(
  (): boolean =>
    isGroup.value &&
    !props.groupRemoved &&
    canManageGroupMembers(currentMember.value?.role ?? null),
);
const canManageGroupInfo = computed(
  (): boolean =>
    !props.groupRemoved &&
    canManageGroupMembers(currentMember.value?.role ?? null),
);
const canExitGroup = computed(
  (): boolean =>
    props.open &&
    isGroup.value &&
    !props.disabled &&
    !props.groupRemoved &&
    !membersBusy.value &&
    !membersError.value &&
    departureAction.value !== null &&
    !inviteBusy.value &&
    !groupNameBusy.value &&
    !groupDescriptionBusy.value,
);
const group = computed((): GroupDirectoryItem | undefined => props.group);
const filteredMembers = computed((): GroupMemberItem[] => {
  const keyword = memberSearch.value.trim().toLocaleLowerCase();
  if (!keyword) return groupMembers.value;
  return groupMembers.value.filter((member) =>
    [member.username, member.nickname ?? '', member.uid]
      .join(' ')
      .toLocaleLowerCase()
      .includes(keyword),
  );
});
const visibleMembers = computed((): GroupMemberItem[] =>
  filteredMembers.value.slice(0, visibleMemberCount.value),
);
const hasMoreMembers = computed(
  (): boolean => filteredMembers.value.length > visibleMembers.value.length,
);
const myGroupNickname = computed((): string => {
  const member = groupMembers.value.find((item) => item.uid === props.userId);
  return member?.nickname || member?.username || '未设置';
});

/** 按当前角色固定本次确认操作，群主只解散，其他有效成员只退出。 */
const openExitDialog = (): void => {
  if (!canExitGroup.value || exitBusy.value || !departureAction.value) return;
  exitAction.value = departureAction.value;
  exitError.value = '';
  exitOpen.value = true;
};

/** 提交期间不允许主动取消，避免把已提交请求当作撤销。 */
const closeExitDialog = (): void => {
  if (exitBusy.value) return;
  exitRequestVersion++;
  exitOpen.value = false;
  exitError.value = '';
};

/** 仅明确成功才关闭确认框，失败保留后端原始错误且不自动重试。 */
const confirmExitGroup = async (): Promise<void> => {
  const roomId = props.conversation?.id;
  if (
    !roomId ||
    !exitOpen.value ||
    !canExitGroup.value ||
    exitBusy.value ||
    exitAction.value !== departureAction.value
  )
    return;
  const version = ++exitRequestVersion;
  exitBusy.value = true;
  exitError.value = '';
  try {
    switch (exitAction.value) {
      case 'exit':
        await props.exitGroup(roomId);
        break;
      case 'dissolve':
        await props.dissolveGroup(roomId);
        break;
    }
    if (version === exitRequestVersion) exitOpen.value = false;
  } catch (cause) {
    if (version === exitRequestVersion)
      exitError.value = getRequestErrorMessage(
        cause,
        `${exitActionLabel.value}失败，请重试`,
      );
  } finally {
    if (version === exitRequestVersion) exitBusy.value = false;
  }
};

/** 开始编辑群名称，并复制当前服务端值到草稿。 */
const startGroupNameEditing = (): void => {
  if (!canManageGroupInfo.value || props.disabled || !props.group) return;
  groupNameDraft.value = props.group.name;
  groupInfoError.value = '';
  groupNameEditing.value = true;
};

/** 取消群名称编辑并清除错误。 */
const cancelGroupNameEditing = (): void => {
  groupNameEditing.value = false;
  groupInfoError.value = '';
};

/** 开始编辑群公告，并复制当前服务端值到草稿。 */
const startGroupDescriptionEditing = (): void => {
  if (!canManageGroupInfo.value || props.disabled || !props.group) return;
  groupDescriptionDraft.value = props.group.notice?.description ?? '';
  groupInfoError.value = '';
  groupDescriptionEditing.value = true;
};

/** 取消群公告编辑并清除错误。 */
const cancelGroupDescriptionEditing = (): void => {
  groupDescriptionEditing.value = false;
  groupInfoError.value = '';
};

/** 群名称未改变时结束编辑，否则保存并刷新群资料和当前会话标题。 */
const saveGroupName = async (): Promise<void> => {
  const roomId = props.conversation?.type === 1 ? props.conversation.id : null;
  const groupName = groupNameDraft.value.trim();
  if (
    !roomId ||
    !groupNameEditing.value ||
    !canManageGroupInfo.value ||
    groupNameBusy.value
  )
    return;
  if (!groupName) {
    groupInfoError.value = '群名称不能为空';
    return;
  }
  if (groupName === props.group?.name.trim()) {
    cancelGroupNameEditing();
    return;
  }
  const version = ++groupInfoRequestVersion;
  groupNameBusy.value = true;
  groupInfoError.value = '';
  try {
    await props.updateGroupInfo({ roomId, groupName });
    if (version !== groupInfoRequestVersion) return;
    groupNameEditing.value = false;
    emit('group-updated', roomId);
  } catch (cause) {
    if (version === groupInfoRequestVersion)
      groupInfoError.value = getRequestErrorMessage(
        cause,
        '群名称保存失败，请重试',
      );
  } finally {
    if (version === groupInfoRequestVersion) groupNameBusy.value = false;
  }
};

/** 保存群公告，空白内容不提交以符合服务端非空更新约定。 */
const saveGroupDescription = async (): Promise<void> => {
  const roomId = props.conversation?.type === 1 ? props.conversation.id : null;
  const groupDescription = groupDescriptionDraft.value.trim();
  if (!roomId || !canManageGroupInfo.value || groupDescriptionBusy.value)
    return;
  if (!groupDescription) {
    groupInfoError.value = '群公告不能为空';
    return;
  }
  const version = ++groupInfoRequestVersion;
  groupDescriptionBusy.value = true;
  groupInfoError.value = '';
  try {
    await props.updateGroupInfo({ roomId, groupDescription });
    if (version !== groupInfoRequestVersion) return;
    groupDescriptionEditing.value = false;
    emit('group-updated', roomId);
  } catch (cause) {
    if (version === groupInfoRequestVersion)
      groupInfoError.value = getRequestErrorMessage(
        cause,
        '群公告保存失败，请重试',
      );
  } finally {
    if (version === groupInfoRequestVersion) groupDescriptionBusy.value = false;
  }
};

/** 关闭时清除当前群的选择来源，让迟到读取不能重新打开弹窗。 */
const closeMemberPicker = (): void => {
  inviteRequestVersion++;
  memberPickerOpen.value = false;
  inviteContacts.value = [];
  inviteExcludedUids.value = [];
  inviteLoading.value = false;
  inviteError.value = '';
  inviteBusy.value = false;
  inviteSubmitError.value = '';
};

/** 添加读取好友与成员，移出仅读取真实成员并按本次角色限制可选项。 */
const loadInviteContacts = async (): Promise<void> => {
  const roomId = props.conversation?.type === 1 ? props.conversation.id : null;
  if (
    !roomId ||
    !props.open ||
    props.disabled ||
    !memberPickerOpen.value ||
    inviteBusy.value
  )
    return;
  const version = ++inviteRequestVersion;
  inviteLoading.value = true;
  inviteError.value = '';
  inviteContacts.value = [];
  inviteExcludedUids.value = [];
  try {
    if (removingMembers.value) {
      const members = await props.listGroupMembers(roomId);
      if (version !== inviteRequestVersion || !memberPickerOpen.value) return;
      groupMembers.value = members;
      const operator = members.find((member) => member.uid === props.userId);
      if (!canManageGroupMembers(operator?.role ?? null))
        throw new Error('当前已无管理员权限');
      inviteContacts.value = members.map((member): Friend => ({
        uid: member.uid,
        roomId: null,
        name: member.username,
        remark: null,
        displayName: memberLabel(member),
        indexLetter: '#',
        avatar: member.avatar,
      }));
      inviteExcludedUids.value = members
        .filter((member) => !canRemoveGroupMember(operator, member))
        .map((member) => member.uid);
      return;
    }
    const [friends, members] = await Promise.all([
      props.listFriends(),
      props.listGroupMembers(roomId),
    ]);
    if (version !== inviteRequestVersion || !memberPickerOpen.value) return;
    inviteContacts.value = friends;
    inviteExcludedUids.value = [
      props.userId,
      ...members.map((item) => item.uid),
    ];
  } catch (cause) {
    if (version === inviteRequestVersion)
      inviteError.value = getRequestErrorMessage(
        cause,
        '读取联系人失败，请重试',
      );
  } finally {
    if (version === inviteRequestVersion) inviteLoading.value = false;
  }
};

/** 群聊详情打开好友选择弹窗，成员始终以服务端真实结果为准。 */
const openMemberPicker = (): void => {
  if (
    props.disabled ||
    props.groupRemoved ||
    !props.open ||
    !isGroup.value ||
    memberPickerOpen.value
  )
    return;
  memberPickerMode.value = 'add';
  memberPickerOpen.value = true;
  void loadInviteContacts();
};

/** 移出入口仅向本次成员列表确认的管理员开放，弹窗再次读取权限。 */
const openRemoveMemberPicker = (): void => {
  if (
    props.disabled ||
    !props.open ||
    !canRemoveMembers.value ||
    membersBusy.value ||
    membersError.value ||
    memberPickerOpen.value
  )
    return;
  memberPickerMode.value = 'remove';
  memberPickerOpen.value = true;
  void loadInviteContacts();
};

/** 显示群成员昵称，未设置群昵称时回退账号昵称。 */
const memberLabel = (member: GroupMemberItem): string =>
  member.nickname || member.username || `用户 ${member.uid}`;

/** 群成员头像加载失败时回退默认头像。 */
const showDefaultAvatar = (event: Event): void => {
  const image = event.target;
  if (
    image instanceof HTMLImageElement &&
    image.getAttribute('src') !== DEFAULT_AVATAR_URL
  )
    image.src = DEFAULT_AVATAR_URL;
};

/** 从群成员头像打开与单聊一致的资料窗口，并绑定真实成员 UID。 */
const openMemberProfile = (
  event: MouseEvent,
  member: GroupMemberItem,
): void => {
  if (props.disabled || !(event.currentTarget instanceof HTMLElement)) return;
  const avatar = event.currentTarget.querySelector('.chat-details-avatar');
  if (!avatar) return;
  const { x, y, width, height } = avatar.getBoundingClientRect();
  emit('profile', { x, y, width, height }, member.uid);
};

/** 仅当前详情显示设置错误，切换会话、关闭或卸载后丢弃旧反馈。 */
const changeNotDisturb = async (
  value: string | number | boolean,
): Promise<void> => {
  if (typeof value !== 'boolean' || props.notDisturbBusy || props.disabled)
    return;
  const version = ++notDisturbRequestVersion;
  notDisturbError.value = '';
  try {
    await props.toggleNotDisturb(value ? 1 : 0);
  } catch (cause) {
    if (version === notDisturbRequestVersion)
      notDisturbError.value = getRequestErrorMessage(
        cause,
        '免打扰设置失败，请重试',
      );
  }
};

/** 置顶状态沿用会话接口，服务端成功后才由父页面更新本地排序。 */
const changeTop = async (value: string | number | boolean): Promise<void> => {
  if (typeof value !== 'boolean' || topBusy.value || props.disabled) return;
  const version = ++topRequestVersion;
  topBusy.value = true;
  topError.value = '';
  try {
    await props.toggleTop(value ? 1 : 0);
  } catch (cause) {
    if (version === topRequestVersion)
      topError.value = getRequestErrorMessage(cause, '置顶设置失败，请重试');
  } finally {
    if (version === topRequestVersion) topBusy.value = false;
  }
};

/** 读取当前群成员，旧群聊或旧账号的响应不能覆盖当前侧栏。 */
const loadGroupMembers = async (): Promise<void> => {
  const roomId = props.conversation?.type === 1 ? props.conversation.id : null;
  if (!roomId || !props.open || props.disabled || props.groupRemoved) return;
  const version = ++membersRequestVersion;
  membersBusy.value = true;
  membersError.value = '';
  try {
    const result = await props.listGroupMembers(roomId);
    if (version !== membersRequestVersion || !isGroup.value || !props.open)
      return;
    groupMembers.value = result;
  } catch (cause) {
    if (version === membersRequestVersion)
      membersError.value = getRequestErrorMessage(
        cause,
        '群成员读取失败，请重试',
      );
  } finally {
    if (version === membersRequestVersion) membersBusy.value = false;
  }
};

/** 明确成员操作成功后刷新真实列表；失败保留选择，不自动重试写请求。 */
const addSelectedMembers = async (uids: string[]): Promise<void> => {
  const roomId = props.conversation?.type === 1 ? props.conversation.id : null;
  if (
    !roomId ||
    !props.open ||
    props.disabled ||
    !memberPickerOpen.value ||
    inviteBusy.value ||
    inviteLoading.value ||
    inviteError.value
  )
    return;
  const version = ++inviteRequestVersion;
  const removing = removingMembers.value;
  inviteBusy.value = true;
  inviteSubmitError.value = '';
  try {
    if (removing) {
      if (
        !canRemoveMembers.value ||
        uids.some((uid) => {
          const member = groupMembers.value.find((item) => item.uid === uid);
          return !member || !canRemoveGroupMember(currentMember.value, member);
        })
      )
        throw new Error('所选成员不可移出，请重新读取群成员');
      await props.removeGroupMembers(roomId, uids);
    } else {
      await props.addGroupMembers(roomId, uids);
    }
    if (version !== inviteRequestVersion) return;
    closeMemberPicker();
    if (removing) emit('members-removed', roomId);
    else emit('members-added', roomId);
    await loadGroupMembers();
  } catch (cause) {
    if (version === inviteRequestVersion) {
      const fallback = removing
        ? '移出群成员失败，请重试'
        : '添加群成员失败，请重试';
      inviteSubmitError.value = getRequestErrorMessage(cause, fallback);
    }
  } finally {
    if (version === inviteRequestVersion) inviteBusy.value = false;
  }
};

/** 传递头像的视口坐标，由主进程换算为原生小窗位置。 */
const openProfile = (event: MouseEvent): void => {
  if (!canOpenProfile.value || props.disabled) return;
  if (!(event.currentTarget instanceof HTMLElement)) return;
  const avatar = event.currentTarget.querySelector('.chat-details-avatar');
  if (!avatar) return;
  const { x, y, width, height } = avatar.getBoundingClientRect();
  const anchor: FriendProfileAnchor = { x, y, width, height };
  emit('profile', anchor);
};
const avatarSource = computed((): string =>
  avatarFailed.value
    ? DEFAULT_AVATAR_URL
    : props.conversation?.avatar || DEFAULT_AVATAR_URL,
);

watch(
  () => props.conversation?.avatar,
  () => {
    avatarFailed.value = false;
  },
);
watch(
  () => [
    props.open,
    props.conversation?.id,
    props.conversation?.type,
    props.userId,
    props.disabled,
    props.groupRemoved,
  ],
  () => {
    closeMemberPicker();
    exitRequestVersion++;
    exitOpen.value = false;
    exitBusy.value = false;
    exitError.value = '';
    membersRequestVersion++;
    topRequestVersion++;
    notDisturbRequestVersion++;
    notDisturbError.value = '';
    membersBusy.value = false;
    topBusy.value = false;
    memberSearch.value = '';
    visibleMemberCount.value = 16;
    groupMembers.value = [];
    membersError.value = '';
    topError.value = '';
    groupInfoRequestVersion++;
    groupNameEditing.value = false;
    groupNameBusy.value = false;
    groupDescriptionEditing.value = false;
    groupDescriptionBusy.value = false;
    groupInfoError.value = '';
    if (props.open && isGroup.value) void loadGroupMembers();
  },
  { immediate: true },
);
watch(memberSearch, () => {
  visibleMemberCount.value = 16;
});
onBeforeUnmount(() => {
  exitRequestVersion++;
  inviteRequestVersion++;
  membersRequestVersion++;
  topRequestVersion++;
  notDisturbRequestVersion++;
  groupInfoRequestVersion++;
});
</script>

<style scoped>
:global(.group-exit-dialog) {
  max-width: calc(100vw - 32px);
  border-radius: 8px;
}
.group-exit-copy {
  margin: 0 0 16px;
  line-height: 22px;
  overflow-wrap: anywhere;
}
.chat-details-panel {
  position: absolute;
  z-index: 5;
  inset: 0 0 0 auto;
  width: 250px;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid #ededed;
  background: #fafafa;
  color: #222;
  font-size: 14px;
  letter-spacing: 0;
  -webkit-app-region: no-drag;
}
.chat-details-scroll {
  flex: 1;
  min-height: 0;
  padding: 16px 14px;
  overflow-y: auto;
}
.chat-details-scroll.is-group {
  padding-top: 0;
}
.chat-details-members {
  display: flex;
  flex-wrap: wrap;
  align-items: start;
  gap: 8px;
  min-height: 76px;
  padding-bottom: 16px;
}
.chat-details-group-members {
  padding-top: 14px;
  border-top: 1px solid #ededed;
}
.chat-details-search-header {
  flex-shrink: 0;
  padding: 16px 14px 8px;
  background: #fafafa;
}
.chat-details-member-search {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 34px;
  padding: 0 8px;
  border: 1px solid #dedee1;
  border-radius: 7px;
  background: #fff;
  color: #b1b1b6;
}
.chat-details-member-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: #333338;
  font: inherit;
}
.chat-details-member-search input::placeholder {
  color: #a4a4aa;
}
.chat-details-more-members {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  width: 100%;
  min-height: 24px;
  margin: -7px 0 8px;
  border: 0;
  background: transparent;
  color: #85858b;
  font: inherit;
  cursor: pointer;
}
.chat-details-status {
  margin: 0 0 10px;
  color: #b74c42;
  font-size: 12px;
  line-height: 18px;
}
.chat-details-status button {
  border: 0;
  background: transparent;
  color: #31549b;
  cursor: pointer;
}
.chat-details-hint {
  color: #85858b;
  font-size: 12px;
}
.chat-details-section {
  padding: 14px 0;
  border-top: 1px solid #ededed;
}
.chat-details-section h2 {
  margin: 0 0 9px;
  color: #222226;
  font-size: 14px;
  font-weight: 400;
}
.chat-details-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.chat-details-section-heading h2 {
  margin-bottom: 9px;
}
.chat-details-icon-button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #8c8c93;
  cursor: pointer;
}
.chat-details-icon-button:hover:not(:disabled) {
  color: #31549b;
}
.chat-details-info-input,
.chat-details-info-textarea {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #d8d8dc;
  border-radius: 6px;
  padding: 7px 8px;
  background: #fff;
  color: #333338;
  font: inherit;
  outline: none;
}
.chat-details-info-textarea {
  resize: vertical;
  line-height: 20px;
}
.chat-details-info-input:focus,
.chat-details-info-textarea:focus {
  border-color: #31549b;
}
.chat-details-qr-section {
  display: flex;
  flex-direction: column;
}
.chat-details-qr-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.chat-details-qr-record {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}
.chat-details-qr-image {
  align-self: center;
  width: 148px;
  height: 148px;
  margin-top: 4px;
  border: 1px solid #e2e2e5;
  object-fit: contain;
  background: #fff;
}
.chat-details-qr-meta {
  width: 100%;
  color: #a2a2a8;
  font-size: 12px;
  line-height: 18px;
}
.chat-details-qr-meta p {
  margin: 0;
}
.chat-details-qr-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 96px;
  color: #a2a2a8;
}
.chat-details-info-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 0;
}
.chat-details-info-button {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-height: 30px;
  padding: 0 10px;
  border: 1px solid #d8d8dc;
  border-radius: 6px;
  background: #fff;
  color: #55555b;
  font: inherit;
  cursor: pointer;
}
.chat-details-info-button--primary {
  border-color: #31549b;
  background: #31549b;
  color: #fff;
}
.chat-details-info-button:disabled,
.chat-details-icon-button:disabled {
  cursor: default;
  opacity: 0.55;
}
.chat-details-section p {
  margin: 0;
  color: #333338;
  line-height: 20px;
  overflow-wrap: anywhere;
}
.chat-details-section .chat-details-muted {
  color: #a2a2a8;
}
.chat-details-qr {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 52px;
  padding: 0;
  border: 0;
  border-top: 1px solid #ededed;
  background: transparent;
  color: #333338;
  font: inherit;
  text-align: left;
}
.chat-details-qr > span:first-child {
  flex: 1;
}
.chat-details-qr-icon {
  color: #a6a6ab;
}
.chat-details-group-options {
  border-top: 1px solid #ededed;
}
.chat-details-group-options .chat-details-row {
  min-height: 44px;
}
.chat-details-group-options .chat-details-history {
  min-height: 54px;
  margin-bottom: 10px;
  border-bottom: 1px solid #ededed;
}
.chat-details-group-options .chat-details-subrow {
  padding-left: 14px;
  position: relative;
}
.chat-details-subrow::before {
  content: '';
  position: absolute;
  left: 0;
  width: 8px;
  border-top: 1px solid #b6b6ba;
}
.chat-details-group-options .chat-details-row > .el-icon {
  color: #b6b6ba;
}
.chat-details-member,
.chat-details-add {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  width: 42px;
  min-width: 0;
  color: #99999f;
  font-size: 13px;
  line-height: 18px;
}
.chat-details-member {
  padding: 0;
  border: 0;
  background: transparent;
  cursor: pointer;
}
.chat-details-member:hover:not(:disabled) .chat-details-avatar {
  outline: 2px solid #d9d9dd;
}
.chat-details-member:focus-visible {
  outline: 2px solid #31549b;
  outline-offset: 3px;
}
.chat-details-member > span {
  width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-details-avatar,
.chat-details-add-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  border-radius: 4px;
}
.chat-details-avatar {
  overflow: hidden;
  background: #efefef;
  color: #82858a;
}
.chat-details-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.chat-details-add {
  padding: 0;
  border: 0;
  background: transparent;
}
.chat-details-add-icon {
  border: 1px dashed #bdbdc2;
  color: #b5b5ba;
}
.chat-details-add:not(:disabled) {
  cursor: pointer;
}
.chat-details-add:hover:not(:disabled) .chat-details-add-icon {
  border-color: #88888e;
  background: #efefef;
}
.chat-details-add:focus-visible {
  outline: 2px solid #31549b;
  outline-offset: 3px;
}
.chat-details-search,
.chat-details-switches {
  border-top: 1px solid #ededed;
}
.chat-details-search {
  padding: 10px 0;
}
.chat-details-switches {
  padding: 10px 12px 10px 0;
}
.chat-details-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 36px;
  width: 100%;
  padding: 4px 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
button.chat-details-row:not(:disabled) {
  cursor: pointer;
}
.chat-details-row > span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.chat-details-row > .el-icon {
  flex-shrink: 0;
  color: #b6b6ba;
}
.chat-details-row :deep(.el-switch) {
  flex-shrink: 0;
  --el-switch-off-color: #e6e6e8;
  --el-switch-on-color: #07c160;
}
.chat-details-clear {
  display: block;
  width: 100%;
  min-height: 56px;
  padding: 16px 0;
  border: 0;
  border-top: 1px solid #ededed;
  background: transparent;
  color: #ff4d4f;
  font: inherit;
  cursor: pointer;
}
.chat-details-exit {
  display: block;
  width: 100%;
  min-height: 52px;
  padding: 15px 0;
  border: 0;
  border-top: 1px solid #ededed;
  background: transparent;
  color: #ff4d4f;
  font: inherit;
  cursor: pointer;
}
.chat-details-exit:hover:not(:disabled) {
  background: #f4eeee;
}
.chat-details-exit:disabled {
  color: #a5a5ab;
}
.chat-details-panel button:disabled {
  cursor: not-allowed;
  opacity: 1;
}
.chat-details-slide-enter-active,
.chat-details-slide-leave-active {
  transition: transform 240ms ease;
}
.chat-details-slide-enter-from,
.chat-details-slide-leave-to {
  transform: translateX(100%);
}
@media (prefers-reduced-motion: reduce) {
  .chat-details-panel.chat-details-slide-enter-active,
  .chat-details-panel.chat-details-slide-leave-active {
    transition: transform 240ms ease !important;
  }
}
</style>
