<template>
  <section class="friend-directory-section" aria-label="新的朋友">
    <button
      type="button"
      class="friend-directory-section-toggle"
      :aria-expanded="applicationsExpanded"
      :disabled="readOnly"
      @click="applicationsExpanded = !applicationsExpanded"
    >
      <el-icon :size="16"
        ><ArrowDown v-if="applicationsExpanded" /><ArrowRight v-else
      /></el-icon>
      <span>新的朋友</span>
      <span
        v-if="friendUnread > 0"
        class="friend-directory-unread"
        :aria-label="`${friendUnread} 条未读好友申请`"
        >{{ friendUnread > 99 ? '99+' : friendUnread }}</span
      >
    </button>
    <p
      v-if="friendUnreadError"
      class="friend-directory-status friend-directory-status--error"
      role="status"
    >
      {{ friendUnreadError }}
    </p>
    <FriendApplicationList
      v-if="applicationsExpanded && !readOnly"
      :disabled="readOnly"
      :read="readApplications"
      :selected="selectedApplication"
      :unread-uids="friendUnreadUids"
      :search="search"
      :revision="applicationsRevision"
      @select="emit('selectApplication', $event)"
      @loaded="emit('applicationsLoaded', $event)"
    />
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import FriendApplicationList from './FriendApplicationList.vue';
import type {
  FriendApplicationPage,
  FriendApplication,
} from '../../../../../shared/contacts/friend-notification';

defineProps<{
  friendUnread: number;
  friendUnreadUids: ReadonlySet<string>;
  friendUnreadError: string;
  readOnly: boolean;
  readApplications: (pageNo: number) => Promise<FriendApplicationPage>;
  selectedApplication: FriendApplication | null;
  applicationsRevision: number;
  search: string;
}>();
const emit = defineEmits<{
  (event: 'selectApplication', application: FriendApplication): void;
  (event: 'applicationsLoaded', applications: FriendApplication[]): void;
}>();
const applicationsExpanded = ref(false);
</script>

<style scoped src="../directory-list.css"></style>
