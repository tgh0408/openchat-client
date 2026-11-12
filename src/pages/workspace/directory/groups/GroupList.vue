<template>
  <section class="friend-directory-section" aria-label="群聊">
    <button
      type="button"
      class="friend-directory-section-toggle"
      :aria-expanded="groupsExpanded"
      @click="toggleGroups"
    >
      <el-icon :size="16"
        ><ArrowDown v-if="groupsExpanded" /><ArrowRight v-else
      /></el-icon>
      <span>群聊</span>
      <span class="friend-directory-section-count">{{ groups.length }}</span>
    </button>
    <div v-if="groupsExpanded" class="friend-directory-section-content">
      <button
        v-for="group in filteredGroups"
        :key="group.roomId"
        type="button"
        class="friend-directory-group-row"
        :class="{
          'friend-directory-row--selected': selectedRoomId === group.roomId,
        }"
        :aria-pressed="selectedRoomId === group.roomId"
        :title="groupDisplayName(group)"
        @click="emit('selectGroup', group)"
      >
        <GroupAvatar :group="group" />
        <span class="friend-directory-name">{{ groupDisplayName(group) }}</span>
      </button>
      <p v-if="groupsBusy" class="friend-directory-status" role="status">
        正在读取群聊...
      </p>
      <p
        v-else-if="groupsError"
        class="friend-directory-status friend-directory-status--error"
      >
        {{ groupsError }}
      </p>
      <p v-else-if="!filteredGroups.length" class="friend-directory-status">
        {{ search.trim() ? '没有匹配的群聊' : '暂无群聊' }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { ArrowDown, ArrowRight } from '@element-plus/icons-vue';
import type { GroupDirectoryItem } from '../../../../../shared/contacts/group';
import { groupDisplayName } from '../../../../../shared/contacts/group-name';
import GroupAvatar from '../../../../components/avatar/GroupAvatar.vue';

const props = defineProps<{
  groups: GroupDirectoryItem[];
  groupsBusy: boolean;
  groupsError: string;
  selectedRoomId: string | null;
  search: string;
}>();
const emit = defineEmits<{
  (event: 'selectGroup', group: GroupDirectoryItem): void;
}>();
const groupsExpanded = ref(true);

/** 切换群聊分类的展开状态。 */
const toggleGroups = (): void => {
  groupsExpanded.value = !groupsExpanded.value;
};

/** 按名称过滤群聊，不改变服务端返回顺序。 */
const filteredGroups = computed((): GroupDirectoryItem[] => {
  const keyword = props.search.trim().toLocaleLowerCase();
  if (!keyword) return props.groups;
  return props.groups.filter((group) =>
    groupDisplayName(group).toLocaleLowerCase().includes(keyword),
  );
});
</script>

<style scoped src="../directory-list.css"></style>
