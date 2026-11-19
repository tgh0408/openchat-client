<template>
  <section class="friend-directory-section" aria-label="联系人">
    <button
      type="button"
      class="friend-directory-section-toggle"
      :aria-expanded="friendsExpanded"
      @click="toggleFriends"
    >
      <el-icon :size="16" aria-hidden="true">
        <component :is="friendsExpanded ? ArrowDown : ArrowRight" />
      </el-icon>
      <span>联系人</span>
      <span class="friend-directory-section-count">{{
        friends.length + 1
      }}</span>
    </button>
    <div v-if="friendsExpanded" class="friend-directory-section-content">
      <button
        v-if="showFileAssistant"
        type="button"
        class="friend-directory-row"
        :class="{ 'friend-directory-row--selected': fileAssistantSelected }"
        :aria-pressed="fileAssistantSelected"
        :disabled="fileAssistantDisabled"
        title="文件传输助手"
        @click="emit('selectFiles')"
      >
        <span class="friend-directory-avatar friend-directory-avatar--files">
          <el-icon :size="25"><FolderOpened /></el-icon>
        </span>
        <span class="friend-directory-name">文件传输助手</span>
      </button>
      <template v-for="group in groupedFriends" :key="group.letter">
        <div class="friend-directory-letter">{{ group.letter }}</div>
        <button
          v-for="friend in group.friends"
          :key="friend.uid"
          type="button"
          class="friend-directory-row"
          :class="{
            'friend-directory-row--selected': selectedUid === friend.uid,
          }"
          :aria-pressed="selectedUid === friend.uid"
          :title="friend.displayName"
          @click="emit('select', friend)"
        >
          <span class="friend-directory-avatar">
            <AvatarImage v-if="friend.avatar" :src="friend.avatar" />
            <span v-else>{{ friend.displayName.slice(0, 1) || '?' }}</span>
          </span>
          <span class="friend-directory-name">{{ friend.displayName }}</span>
        </button>
      </template>
      <p v-if="busy" class="friend-directory-status" role="status">
        正在读取联系人...
      </p>
      <p
        v-else-if="error"
        class="friend-directory-status friend-directory-status--error"
      >
        {{ error }}
      </p>
      <p
        v-else-if="!groupedFriends.length && !showFileAssistant"
        class="friend-directory-status"
      >
        {{ search.trim() ? '没有匹配的联系人' : '暂无联系人' }}
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { ArrowDown, ArrowRight, FolderOpened } from '@element-plus/icons-vue';
import type { Friend } from '../../../../../shared/contacts/friend';
import AvatarImage from '../../../../components/avatar/AvatarImage.vue';

const props = defineProps<{
  friends: Friend[];
  busy: boolean;
  error: string;
  selectedUid: string | null;
  search: string;
  fileAssistantDisabled: boolean;
  fileAssistantSelected: boolean;
}>();
const emit = defineEmits<{
  (event: 'select', friend: Friend): void;
  (event: 'selectFiles'): void;
}>();
const friendsExpanded = ref(false);
/** 文件助手是固定入口，不受好友列表、隐藏状态或删除操作影响。 */
const showFileAssistant = computed((): boolean =>
  '文件助手 文件传输助手 file assistant'.includes(
    props.search.trim().toLocaleLowerCase(),
  ),
);

/** 切换联系人分类的展开状态。 */
const toggleFriends = (): void => {
  friendsExpanded.value = !friendsExpanded.value;
};

/** 按联系人名称和 UID 过滤，保留后端返回的首字母分组。 */
const groupedFriends = computed((): { letter: string; friends: Friend[] }[] => {
  const keyword = props.search.trim().toLocaleLowerCase();
  const groups = new Map<string, Friend[]>();
  for (const friend of props.friends) {
    const searchable =
      `${friend.displayName} ${friend.name} ${friend.uid}`.toLocaleLowerCase();
    if (keyword && !searchable.includes(keyword)) continue;
    const group = groups.get(friend.indexLetter) ?? [];
    group.push(friend);
    groups.set(friend.indexLetter, group);
  }
  return [...groups.entries()]
    .sort(
      (
        [leftLetter]: [string, Friend[]],
        [rightLetter]: [string, Friend[]],
      ): number => {
        if (leftLetter === '#') return 1;
        if (rightLetter === '#') return -1;
        return leftLetter.localeCompare(rightLetter);
      },
    )
    .map(([letter, group]) => ({ letter, friends: group }));
});
</script>

<style scoped src="../directory-list.css"></style>

<style scoped>
.friend-directory-avatar--files {
  background: #12aa76;
}

.friend-directory-row:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
