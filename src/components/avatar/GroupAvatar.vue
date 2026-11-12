<template>
  <span
    class="group-avatar"
    :class="`group-avatar--${count}`"
    aria-hidden="true"
  >
    <span v-for="index in count" :key="index" class="group-avatar-cell">
      <img
        :src="group.avatarList[index - 1] || DEFAULT_AVATAR_URL"
        alt=""
        draggable="false"
        @error="showDefaultAvatar"
      />
    </span>
  </span>
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../services/runtime/public-assets';
import { computed } from 'vue';
import type { GroupDirectoryItem } from '../../../shared/contacts/group';

const props = defineProps<{
  group: Pick<GroupDirectoryItem, 'memberCount' | 'avatarList'>;
}>();

/** 列表和详情共用最多九位成员的头像布局。 */
const count = computed((): number =>
  Math.max(1, Math.min(props.group.memberCount, 9)),
);

/** 加载失败时只回退一次默认头像。 */
const showDefaultAvatar = (event: Event): void => {
  const image = event.target;
  if (
    image instanceof HTMLImageElement &&
    image.getAttribute('src') !== DEFAULT_AVATAR_URL
  )
    image.src = DEFAULT_AVATAR_URL;
};
</script>

<style scoped>
.group-avatar {
  --avatar-columns: 3;
  display: flex;
  flex: 0 0 auto;
  width: var(--group-avatar-size, 36px);
  height: var(--group-avatar-size, 36px);
  flex-wrap: wrap;
  align-content: center;
  justify-content: center;
  box-sizing: border-box;
  overflow: hidden;
  padding: 2px;
  gap: 1px;
  border: 1px solid #dedede;
  border-radius: 4px;
  background: #fff;
}

.group-avatar--1 {
  --avatar-columns: 1;
  padding: 0;
  border: 0;
}

.group-avatar--2,
.group-avatar--3,
.group-avatar--4 {
  --avatar-columns: 2;
}

.group-avatar-cell {
  position: relative;
  display: block;
  flex: 0 0
    calc((100% - (var(--avatar-columns) - 1) * 1px) / var(--avatar-columns));
  aspect-ratio: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.group-avatar-cell img {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}
</style>
