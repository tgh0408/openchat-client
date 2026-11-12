<template>
  <el-dialog
    v-model="deleteOpen"
    class="chat-delete-dialog"
    width="280px"
    align-center
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
  >
    <template #header>
      <div class="chat-delete-title">删除与“{{ deleteTitle }}”的聊天?</div>
    </template>
    <p class="chat-delete-copy">删除聊天后，聊天记录也将被清空。</p>
    <template #footer>
      <el-button
        class="chat-delete-confirm"
        :loading="deleting"
        :disabled="readOnly"
        @click="emit('delete')"
        >删除</el-button
      >
      <el-button
        class="chat-delete-cancel"
        :disabled="deleting"
        @click="deleteOpen = false"
        >取消</el-button
      >
    </template>
  </el-dialog>
  <el-dialog
    v-model="clearOpen"
    title="清空聊天记录"
    width="360px"
    align-center
  >
    <p class="chat-dialog-copy">
      确定清空「{{
        activeTitle
      }}」的聊天记录？本地消息和已下载的聊天文件都会删除，此操作不可撤销。
    </p>
    <template #footer>
      <el-button @click="clearOpen = false">取消</el-button>
      <el-button
        type="danger"
        :loading="clearing"
        :disabled="readOnly"
        @click="emit('clear')"
        >清空</el-button
      >
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ElButton, ElDialog } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/dialog/style/css';

defineProps<{
  activeTitle: string;
  deleteTitle: string;
  deleting: boolean;
  clearing: boolean;
  readOnly: boolean;
}>();
const emit = defineEmits<{
  delete: [];
  clear: [];
}>();
const deleteOpen = defineModel<boolean>('deleteOpen', { required: true });
const clearOpen = defineModel<boolean>('clearOpen', { required: true });
</script>

<style>
.chat-dialog-copy {
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.chat-delete-dialog {
  border: 1px solid #c7c7c7;
  border-radius: 7px;
  box-shadow: none;
  overflow: hidden;
}
.chat-delete-dialog .el-dialog__header {
  margin-right: 0;
  padding: 34px 24px 0;
}
.chat-delete-title {
  color: #222;
  font-size: 15px;
  font-weight: 400;
  line-height: 22px;
  overflow-wrap: anywhere;
  text-align: center;
}
.chat-delete-dialog .el-dialog__body {
  padding: 7px 24px 0;
}
.chat-delete-copy {
  margin: 0;
  color: #8a8a8a;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
}
.chat-delete-dialog .el-dialog__footer {
  padding: 21px 24px 32px;
}
.chat-delete-dialog .el-dialog__footer > * {
  width: calc(50% - 4px);
  margin: 0;
}
.chat-delete-dialog .el-dialog__footer > * + * {
  margin-left: 8px;
}
.chat-delete-dialog .el-button {
  height: 30px;
  border: 0;
  border-radius: 7px;
  background: #eeeeee;
  font-size: 14px;
  font-weight: 400;
}
.chat-delete-dialog .el-button:hover,
.chat-delete-dialog .el-button:focus-visible {
  background: #e5e5e5;
}
.chat-delete-confirm {
  color: #ff3b30;
}
.chat-delete-cancel {
  color: #222;
}
.chat-delete-dialog .el-button.is-disabled {
  background: #eeeeee;
}
</style>
