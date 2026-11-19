<template>
  <aside class="chat-sidebar friend-directory" aria-label="通讯录">
    <div class="chat-search">
      <el-input
        v-model="search"
        placeholder="搜索"
        :prefix-icon="Search"
        clearable
        aria-label="搜索联系人和群聊"
      />
    </div>
    <div class="friend-directory-title">
      <el-icon :size="21"><User /></el-icon>
      <span>通讯录管理</span>
    </div>
    <div class="friend-directory-list">
      <FriendApplicationSection
        :friend-unread="friendUnread"
        :friend-unread-uids="friendUnreadApplicationUids"
        :friend-unread-error="friendUnreadError"
        :read-only="readOnly"
        :read-applications="readApplications"
        :selected-application="selectedApplication"
        :applications-revision="applicationsRevision"
        :search="search"
        @select-application="emit('selectApplication', $event)"
        @applications-loaded="emit('applicationsLoaded', $event)"
      />
      <GroupList
        :groups="groups"
        :groups-busy="groupsBusy"
        :groups-error="groupsError"
        :selected-room-id="selectedRoomId"
        :search="search"
        @select-group="emit('selectGroup', $event)"
      />
      <FriendList
        :friends="friends"
        :busy="busy"
        :error="error"
        :selected-uid="selectedUid"
        :search="search"
        :file-assistant-disabled="fileAssistantDisabled"
        :file-assistant-selected="fileAssistantSelected"
        @select="emit('select', $event)"
        @select-files="emit('selectFiles')"
      />
    </div>
  </aside>
</template>

<script setup lang="ts">
import { ElIcon, ElInput } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import { Search, User } from '@element-plus/icons-vue';
import type { Friend } from '../../../../shared/contacts/friend';
import type { GroupDirectoryItem } from '../../../../shared/contacts/group';
import type {
  FriendApplicationPage,
  FriendApplication,
} from '../../../../shared/contacts/friend-notification';
import FriendList from './friends/FriendList.vue';
import GroupList from './groups/GroupList.vue';
import FriendApplicationSection from './applications/FriendApplicationSection.vue';

defineProps<{
  friends: Friend[];
  groups: GroupDirectoryItem[];
  busy: boolean;
  groupsBusy: boolean;
  error: string;
  groupsError: string;
  selectedUid: string | null;
  selectedRoomId: string | null;
  friendUnread: number;
  friendUnreadApplicationUids: ReadonlySet<string>;
  friendUnreadError: string;
  readOnly: boolean;
  fileAssistantDisabled: boolean;
  fileAssistantSelected: boolean;
  readApplications: (pageNo: number) => Promise<FriendApplicationPage>;
  selectedApplication: FriendApplication | null;
  applicationsRevision: number;
}>();
const emit = defineEmits<{
  (event: 'select', friend: Friend): void;
  (event: 'selectFiles'): void;
  (event: 'selectGroup', group: GroupDirectoryItem): void;
  (event: 'selectApplication', application: FriendApplication): void;
  (event: 'applicationsLoaded', applications: FriendApplication[]): void;
}>();
const search = defineModel<string>('search', { required: true });
</script>

<style scoped>
.friend-directory-title {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 45px;
  margin: 0 11px 8px;
  padding: 0 52px;
  border-radius: 6px;
  background: #f9f9f9;
  color: #202023;
  font-size: 15px;
  white-space: nowrap;
}

.friend-directory-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
}

.friend-directory-section {
  border-top: 1px solid #e2e2e4;
}

.friend-directory-section:first-child {
  border-top: 0;
}

.friend-directory-section-toggle {
  display: flex;
  align-items: center;
  width: 100%;
  height: 40px;
  gap: 7px;
  padding: 0 17px;
  border: 0;
  background: transparent;
  color: #303034;
  font-size: 15px;
  text-align: left;
  cursor: pointer;
}

.friend-directory-section-toggle:hover {
  background: #e2e2e5;
}

.friend-directory-section-count {
  margin-left: auto;
  color: #96969d;
  font-size: 13px;
}

.friend-directory-unread {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 16px;
  height: 16px;
  margin-left: auto;
  padding: 0 4px;
  border-radius: 9px;
  background: #fa5151;
  color: #fff;
  font-size: 11px;
  line-height: 16px;
  white-space: nowrap;
}

.friend-directory-section-content {
  padding-bottom: 6px;
}

.friend-directory-group-row,
.friend-directory-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 58px;
  gap: 9px;
  padding: 7px 12px 7px 35px;
  border: 0;
  background: transparent;
  color: #242428;
  text-align: left;
}

.friend-directory-group-row,
.friend-directory-row {
  cursor: pointer;
}

.friend-directory-row:hover,
.friend-directory-group-row:hover {
  background: #e2e2e5;
}

.friend-directory-row--selected,
.friend-directory-row--selected:hover {
  background: #c9e9d7;
}

.friend-directory-avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  overflow: hidden;
  border-radius: 7px;
  background: #b8c8d1;
}

.friend-directory-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.friend-directory-avatar {
  color: #fff;
  font-size: 16px;
}

.friend-directory-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 15px;
}

.friend-directory-letter {
  height: 31px;
  padding: 8px 35px 0;
  color: #75757b;
  font-size: 13px;
  line-height: 20px;
}

.friend-directory-status {
  margin: 14px 12px;
  color: #96969d;
  font-size: 12px;
  line-height: 20px;
  text-align: center;
}

.friend-directory-status--error {
  color: #b74c42;
}
</style>
