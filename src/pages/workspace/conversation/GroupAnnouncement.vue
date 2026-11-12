<template>
  <section class="group-announcement">
    <div class="group-announcement-heading">
      <h2>群公告</h2>
      <button
        v-if="canEdit && !editing"
        type="button"
        class="group-announcement-edit"
        title="编辑群公告"
        aria-label="编辑群公告"
        :disabled="disabled"
        @click="emit('edit')"
      >
        <el-icon :size="14"><Edit /></el-icon>
      </button>
    </div>
    <textarea
      v-if="editing"
      :value="draft"
      class="group-announcement-input"
      maxlength="300"
      rows="3"
      aria-label="群公告"
      :disabled="busy"
      @input="
        emit('update:draft', ($event.target as HTMLTextAreaElement).value)
      "
      @blur="emit('save')"
      @keydown.ctrl.enter.prevent="emit('save')"
      @keydown.esc="emit('cancel')"
    />
    <p v-else class="group-announcement-content">
      {{ notice?.description || '群主未设置' }}
    </p>
    <p v-if="notice" class="group-announcement-meta">
      写入用户：{{ notice.uid }} ·
      {{ formatGroupRecordTime(notice.createTime) }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { Edit } from '@element-plus/icons-vue';
import type { GroupNotice } from '../../../../shared/contacts/group';
import { formatGroupRecordTime } from '../../../../shared/contacts/group';

defineProps<{
  notice?: GroupNotice | null;
  canEdit: boolean;
  disabled: boolean;
  editing: boolean;
  draft: string;
  busy: boolean;
}>();

const emit = defineEmits<{
  edit: [];
  'update:draft': [value: string];
  save: [];
  cancel: [];
}>();
</script>

<style scoped>
.group-announcement {
  padding: 14px 0;
  border-top: 1px solid #ededed;
}

.group-announcement-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-announcement-heading h2 {
  margin: 0 0 9px;
  color: #222226;
  font-size: 14px;
  font-weight: 400;
}

.group-announcement-edit {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-top: -9px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #8c8c93;
  cursor: pointer;
}

.group-announcement-edit:hover:not(:disabled) {
  color: #31549b;
}

.group-announcement-edit:disabled {
  cursor: default;
  opacity: 0.55;
}

.group-announcement-input {
  box-sizing: border-box;
  width: 100%;
  border: 1px solid #d8d8dc;
  border-radius: 6px;
  padding: 7px 8px;
  background: #fff;
  color: #333338;
  font: inherit;
  line-height: 20px;
  outline: none;
  resize: vertical;
}

.group-announcement-input:focus {
  border-color: #31549b;
}

.group-announcement-content {
  margin: 0;
  color: #a2a2a8;
  line-height: 20px;
  overflow-wrap: anywhere;
}

.group-announcement-meta {
  margin: 6px 0 0;
  color: #b1b1b6;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}
</style>
