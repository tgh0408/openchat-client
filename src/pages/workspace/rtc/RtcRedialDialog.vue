<template>
  <ElDialog
    :model-value="open"
    title="发起通话"
    width="360px"
    align-center
    :show-close="false"
    :close-on-click-modal="false"
    append-to-body
    @update:model-value="handleVisibility"
    @open-auto-focus="focusCancel"
  >
    <p class="redial-message">当前已有通话正在进行，是否强制呼出？</p>
    <template #footer>
      <ElButton ref="cancelButton" @click="emit('resolve', false)">否</ElButton>
      <ElButton type="primary" @click="emit('resolve', true)">是</ElButton>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { ElButton, ElDialog } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/dialog/style/css';

defineProps<{ open: boolean }>();
const emit = defineEmits<{ resolve: [confirmed: boolean] }>();
const cancelButton = ref<InstanceType<typeof ElButton>>();

/** Escape 关闭按取消处理，不触发创建或挂断。 */
const handleVisibility = (open: boolean): void => {
  if (!open) emit('resolve', false);
};

/** 默认聚焦否，避免回车误触发强制呼出。 */
const focusCancel = async (): Promise<void> => {
  await nextTick();
  cancelButton.value?.ref?.focus();
};
</script>

<style scoped>
.redial-message {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
</style>
