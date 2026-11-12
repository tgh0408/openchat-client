<template>
  <el-dialog
    :model-value="open"
    class="friend-blacklist-dialog"
    title="加入黑名单"
    width="280px"
    align-center
    append-to-body
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    @update:model-value="
      (value: boolean) => {
        if (!value && !busy) emit('cancel');
      }
    "
  >
    <p class="friend-blacklist-copy">
      加入黑名单后，你将不再收到对方在此聊天中的消息。
    </p>
    <p v-if="error" class="friend-blacklist-error" role="alert">{{ error }}</p>
    <template #footer>
      <el-button
        class="friend-blacklist-confirm"
        :loading="busy"
        :disabled="disabled || busy"
        @click="emit('confirm')"
        >确定</el-button
      >
      <el-button :disabled="busy" @click="emit('cancel')">取消</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElButton, ElDialog } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/dialog/style/css';

defineProps<{
  open: boolean;
  busy: boolean;
  error: string;
  disabled: boolean;
}>();
const emit = defineEmits<{
  (event: 'confirm' | 'cancel'): void;
}>();
</script>

<style scoped>
:global(.friend-blacklist-dialog) {
  max-width: calc(100vw - 32px);
  padding: 32px 24px;
  border: 1px solid #d6d6d8;
  border-radius: 8px;
  background: #f7f7f7;
}
:global(.friend-blacklist-dialog .el-dialog__header) {
  padding: 0;
  text-align: center;
}
:global(.friend-blacklist-dialog .el-dialog__title) {
  color: #222226;
  font-size: 16px;
  line-height: 22px;
}
.friend-blacklist-copy {
  margin: 12px 0 24px;
  color: #75757c;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  overflow-wrap: anywhere;
}
.friend-blacklist-error {
  margin: 0 0 12px;
  color: #c43c3c;
  font-size: 13px;
  overflow-wrap: anywhere;
}
:global(.friend-blacklist-dialog .el-dialog__footer) {
  display: flex;
  gap: 8px;
  padding: 0;
}
:global(.friend-blacklist-dialog .el-button) {
  flex: 1;
  min-width: 0;
  height: 30px;
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: #e9e9e9;
  color: #222226;
}
:global(.friend-blacklist-dialog .el-button:hover:not(:disabled)) {
  background: #dedede;
}
:global(.friend-blacklist-dialog .friend-blacklist-confirm) {
  color: #ff4040;
}
</style>
