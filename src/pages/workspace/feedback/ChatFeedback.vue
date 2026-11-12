<template>
  <div
    class="chat-feedback"
    :class="{ 'chat-feedback--error': isError }"
    role="status"
  >
    <span>{{ text }}</span>
    <el-button v-if="initializationFailed" link @click="emit('retry')"
      >重试</el-button
    >
    <el-button v-else-if="readOnly" link @click="emit('logout')"
      >重新登录</el-button
    >
    <button
      v-else
      class="chat-small-button"
      title="关闭提示"
      aria-label="关闭提示"
      @click="emit('close')"
    >
      <el-icon><Close /></el-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { ElButton, ElIcon } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import { Close } from '@element-plus/icons-vue';

defineProps<{
  text: string;
  isError: boolean;
  initializationFailed: boolean;
  readOnly: boolean;
}>();
const emit = defineEmits<{ retry: []; logout: []; close: [] }>();
</script>

<style>
.chat-feedback {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 14px;
  font-size: 12px;
  background: #e6f4e9;
  color: #318450;
  flex-shrink: 0;
  overflow-wrap: anywhere;
}
.chat-feedback--error {
  background: #fff0ed;
  color: #b74c42;
}
</style>
