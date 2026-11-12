<template>
  <div
    class="rtc-call-message"
    :class="{
      'rtc-call-message--mine': outgoing,
      'rtc-call-message--redialable': canRedial,
    }"
    :role="canRedial ? 'button' : 'status'"
    :tabindex="canRedial ? 0 : undefined"
    :aria-label="redialLabel"
    @click="requestRedial"
    @keydown.enter="requestRedial"
    @keydown.space.prevent="requestRedial"
  >
    <img
      v-if="call?.mediaMode !== RtcMediaMode.VIDEO"
      class="rtc-call-message-icon rtc-call-message-icon--image"
      :src="publicAssetUrl('video/phone.svg')"
      draggable="false"
      alt="语音通话"
    />
    <el-icon v-else class="rtc-call-message-icon" :size="28">
      <VideoCamera />
    </el-icon>
    <span>{{ label }}</span>
  </div>
</template>

<script setup lang="ts">
import { publicAssetUrl } from '../../../services/runtime/public-assets';
import { RtcCallState, RtcMediaMode } from '../../../../shared/rtc/rtc';

import { computed } from 'vue';
import { ElIcon } from 'element-plus';
import { VideoCamera } from '@element-plus/icons-vue';
import {
  formatRtcCallDuration,
  parseRtcCallMessage,
} from '../../../../shared/chat/messages/rtc-call-message';

const props = defineProps<{
  content: string;
  userId: string;
  outgoing: boolean;
  canRedial?: boolean;
}>();
const emit = defineEmits<{
  (event: 'redial', mediaMode: RtcMediaMode): void;
}>();

const call = computed(() => {
  try {
    return parseRtcCallMessage(props.content);
  } catch {
    return null;
  }
});

/** 根据终态和操作者生成不会误导用户的通话摘要。 */
const label = computed((): string => {
  if (!call.value) return '通话记录';
  switch (call.value.state) {
    case RtcCallState.REJECTED:
      return call.value.endedByUid === props.userId ? '你已拒绝' : '对方已拒绝';
    case RtcCallState.CANCELED:
      return call.value.endedByUid === props.userId ? '你已取消' : '对方已取消';
    case RtcCallState.EXPIRED:
      return '对方无响应';
    case RtcCallState.ENDED:
      return `通话时长 ${formatRtcCallDuration(call.value.durationSeconds)}`;
    default:
      return '通话记录';
  }
});

const redialLabel = computed((): string | undefined => {
  if (!props.canRedial || !call.value) return undefined;
  return call.value.mediaMode === RtcMediaMode.VIDEO
    ? '回拨视频通话'
    : '回拨语音通话';
});

/** 请求主聊天窗口按历史记录的媒体类型重新发起通话。 */
const requestRedial = (): void => {
  if (!props.canRedial || !call.value) return;
  emit('redial', call.value.mediaMode);
};
</script>

<style scoped>
.rtc-call-message {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 36px;
  padding: 8px 12px;
  color: #333;
  font-size: 14px;
  line-height: 20px;
  user-select: none;
  -webkit-user-select: none;
  background: #fff;
  border: 1px solid #e9e9e9;
  border-radius: 5px;
}
.rtc-call-message--mine {
  background: #a9e97b;
  border-color: #a9e97b;
}
.rtc-call-message--redialable:focus-visible {
  outline: 2px solid #12aa76;
  outline-offset: 2px;
}
.rtc-call-message-icon {
  color: #000;
}
.rtc-call-message-icon--image {
  width: 28px;
  height: 28px;
  -webkit-user-drag: none;
}
</style>
