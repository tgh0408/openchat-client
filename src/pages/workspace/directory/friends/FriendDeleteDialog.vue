<template>
  <el-dialog
    :model-value="target !== null"
    class="friend-delete-dialog"
    modal-class="friend-delete-overlay"
    :title="`删除“${target?.name ?? ''}”？`"
    width="284px"
    align-center
    append-to-body
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    @update:model-value="handleVisibilityChange"
  >
    <div class="friend-delete-identity">
      <img
        class="friend-delete-avatar"
        :src="avatarFailed ? DEFAULT_AVATAR_URL : avatar"
        alt="好友头像"
        draggable="false"
        @error="avatarFailed = true"
      />
      <p class="friend-delete-name">{{ target?.name }}</p>
    </div>
    <div class="friend-delete-history">
      <el-checkbox v-model="clearHistory" :disabled="busy || disabled">
        清空聊天记录
      </el-checkbox>
    </div>
    <p v-if="error" class="friend-delete-error" role="alert">{{ error }}</p>
    <template #footer>
      <el-button
        class="friend-delete-confirm"
        :loading="busy"
        :disabled="disabled || busy"
        @click="confirm"
      >
        删除
      </el-button>
      <el-button :disabled="busy" @click="emit('cancel')">取消</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../../../shared/api/api-error';
import { DEFAULT_AVATAR_URL } from '../../../../services/runtime/public-assets';
import { onBeforeUnmount, ref, watch } from 'vue';
import { ElButton, ElCheckbox, ElDialog } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/checkbox/style/css';
import 'element-plus/es/components/dialog/style/css';

const props = defineProps<{
  target: { roomId: string; name: string } | null;
  avatar: string;
  disabled: boolean;
  request: (roomId: string, clearHistory: boolean) => Promise<void>;
}>();
const emit = defineEmits<{
  (event: 'cancel'): void;
  (event: 'deleted', roomId: string, clearHistory: boolean): void;
}>();
const busy = ref(false);
const error = ref('');
const avatarFailed = ref(false);
const clearHistory = ref(false);
let generation = 0;
let disposed = false;

/** 弹窗关闭且未提交删除请求时通知父组件取消。 */
const handleVisibilityChange = (visible: boolean): void => {
  if (!visible && !busy.value) emit('cancel');
};

/** 取消本次展示上下文，迟到结果不能影响其他联系人或新授权。 */
const reset = (): void => {
  generation++;
  busy.value = false;
  error.value = '';
  avatarFailed.value = false;
  clearHistory.value = false;
};

/** 只有服务端明确成功才通知移除，失败保留确认框且不自动重试。 */
const confirm = async (): Promise<void> => {
  const target = props.target;
  if (!target || busy.value || props.disabled || disposed) return;
  const version = generation;
  const clear = clearHistory.value;
  busy.value = true;
  error.value = '';
  /** 核对当前弹窗仍属于原房间和操作。 */
  const isCurrent = (): boolean =>
    !disposed &&
    !props.disabled &&
    version === generation &&
    props.target === target;
  try {
    await props.request(target.roomId, clear);
    if (!isCurrent()) return;
    emit('deleted', target.roomId, clear);
    emit('cancel');
  } catch (cause) {
    if (isCurrent())
      error.value = getRequestErrorMessage(cause, '删除好友失败，请重试');
  } finally {
    if (isCurrent()) busy.value = false;
  }
};
watch(() => [props.target, props.disabled], reset);
onBeforeUnmount(() => {
  disposed = true;
  reset();
});
</script>

<style scoped>
:global(.el-overlay.friend-delete-overlay) {
  background: transparent;
}
:global(.friend-delete-dialog) {
  max-width: calc(100vw - 32px);
  padding: 32px 24px;
  border: 1px solid #ceced0;
  border-radius: 8px;
  background: #f7f7f7;
  box-shadow: 0 4px 20px rgb(0 0 0 / 16%);
}
:global(.friend-delete-dialog .el-dialog__header) {
  padding: 0;
  text-align: center;
}
:global(.friend-delete-dialog .el-dialog__title) {
  display: block;
  color: #222226;
  font-size: 16px;
  line-height: 22px;
  overflow-wrap: anywhere;
}
.friend-delete-identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  margin: 26px 0 20px;
}
.friend-delete-avatar {
  display: block;
  width: 36px;
  height: 36px;
  border-radius: 4px;
  object-fit: cover;
}
.friend-delete-name {
  max-width: 100%;
  margin: 0;
  color: #929292;
  font-size: 11px;
  line-height: 16px;
  text-align: center;
  overflow-wrap: anywhere;
}
.friend-delete-history {
  display: flex;
  justify-content: center;
  margin-bottom: 18px;
}
.friend-delete-history :deep(.el-checkbox) {
  --el-checkbox-checked-bg-color: #ff4d55;
  --el-checkbox-checked-input-border-color: #ff4d55;
  --el-checkbox-input-border-color-hover: #ff4d55;
  height: 28px;
  margin: 0;
}
.friend-delete-history :deep(.el-checkbox__inner) {
  width: 16px;
  height: 16px;
  border-radius: 50%;
}
.friend-delete-history :deep(.el-checkbox__inner::after) {
  left: 5px;
  top: 2px;
}
.friend-delete-history :deep(.el-checkbox__label) {
  padding-left: 6px;
  color: #888;
  font-size: 14px;
  white-space: normal;
}
.friend-delete-error {
  margin: 0 0 12px;
  color: #c43c3c;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
:global(.friend-delete-dialog .el-dialog__footer) {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  padding: 0;
}
:global(.friend-delete-dialog .el-button) {
  min-width: 0;
  height: 30px;
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: #e9e9e9;
  color: #222226;
  font-size: 14px;
}
:global(.friend-delete-dialog .el-button:hover:not(:disabled)) {
  background: #dedede;
}
:global(.friend-delete-dialog .friend-delete-confirm) {
  color: #ff4d55;
}
:global(.friend-delete-dialog .el-button.is-disabled) {
  opacity: 0.55;
}
</style>
