<template>
  <Teleport to="body">
    <div
      v-if="text"
      class="emoji-collection-feedback"
      :class="{ 'is-error': failed }"
      :role="failed ? 'alert' : 'status'"
      aria-atomic="true"
    >
      <el-icon
        v-if="pending"
        class="emoji-collection-spinner"
        :size="42"
        aria-hidden="true"
      >
        <Loading />
      </el-icon>
      <el-icon v-else :size="48" aria-hidden="true">
        <CircleClose v-if="failed" />
        <Check v-else />
      </el-icon>
      <span>{{ text }}</span>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ElIcon } from 'element-plus';
import { Check, CircleClose, Loading } from '@element-plus/icons-vue';
import 'element-plus/es/components/icon/style/css';

defineProps<{ text: string; pending: boolean; failed: boolean }>();
</script>

<style scoped>
.emoji-collection-feedback {
  position: fixed;
  z-index: 3000;
  top: 50%;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  box-sizing: border-box;
  width: 120px;
  height: 120px;
  max-width: calc(100vw - 32px);
  padding: 16px 12px;
  border-radius: 8px;
  background: #4c4c4c;
  color: #f5f5f5;
  font-size: 14px;
  line-height: 20px;
  text-align: center;
  overflow-wrap: anywhere;
  transform: translate(-50%, -50%);
  pointer-events: none;
}
.emoji-collection-feedback .el-icon {
  flex-shrink: 0;
  color: #ddd;
}
.emoji-collection-spinner {
  animation: emoji-feedback-spin 0.8s linear infinite;
}
.emoji-collection-feedback.is-error {
  width: 320px;
  height: auto;
  min-height: 120px;
  max-height: calc(100vh - 32px);
  overflow-y: auto;
  pointer-events: auto;
}
@keyframes emoji-feedback-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .emoji-collection-feedback .emoji-collection-spinner {
    animation: emoji-feedback-spin 0.8s linear infinite !important;
  }
}
</style>
