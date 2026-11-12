<template>
  <ElDialog
    :model-value="Boolean(call) || Boolean(error)"
    title="通话恢复"
    width="360px"
    align-center
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="false"
    append-to-body
  >
    <p v-if="call" class="recovery-message">
      与 {{ call.peerName }} 的{{
        call.call.mediaMode === RtcMediaMode.AUDIO ? '语音' : '视频'
      }}通话尚在进行，是否重连？
    </p>
    <p v-if="error" class="recovery-error" role="alert">{{ error }}</p>
    <template #footer>
      <template v-if="call">
        <ElButton :disabled="busy" @click="emit('resolve', false)"
          >挂断</ElButton
        >
        <ElButton type="primary" :loading="busy" @click="emit('resolve', true)"
          >重连</ElButton
        >
      </template>
      <template v-else>
        <ElButton :disabled="busy" @click="emit('dismiss')">稍后</ElButton>
        <ElButton type="primary" :loading="busy" @click="emit('retry')"
          >重试</ElButton
        >
      </template>
    </template>
  </ElDialog>
</template>

<script setup lang="ts">
import { ElButton, ElDialog } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/dialog/style/css';
import { RtcMediaMode, type RtcOngoingCall } from '../../../../shared/rtc/rtc';

defineProps<{ call: RtcOngoingCall | null; busy: boolean; error: string }>();
const emit = defineEmits<{
  resolve: [reconnect: boolean];
  retry: [];
  dismiss: [];
}>();
</script>

<style scoped>
.recovery-message,
.recovery-error {
  overflow-wrap: anywhere;
  line-height: 1.6;
}
.recovery-error {
  color: var(--el-color-danger);
}
</style>
