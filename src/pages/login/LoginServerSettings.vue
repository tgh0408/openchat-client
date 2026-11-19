<template>
  <form class="password-form server-form" @submit.prevent="save">
    <label for="login-server-address">服务器地址</label>
    <el-input
      id="login-server-address"
      v-model="authApiBase"
      placeholder="https://"
      autocomplete="off"
      :maxlength="2048"
      :disabled="disabled || saving"
      @input="clearFeedback"
    />
    <div class="login-feedback server-feedback" aria-live="polite">
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-else-if="saved" class="form-notice" role="status">
        {{ isDesktop ? '已保存' : '已保存至本次预览' }}
      </p>
    </div>
    <el-button
      class="password-submit"
      type="primary"
      native-type="submit"
      :loading="saving"
      :disabled="disabled || saving"
      >保存</el-button
    >
  </form>
</template>

<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { ElButton, ElInput } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/input/style/css';
import type { ServerSettings } from '../../../shared/runtime/server-settings';
import { getAuthErrorMessage } from '../../services/auth/auth';

const props = defineProps<{
  settings: ServerSettings;
  disabled: boolean;
  persist: (settings: ServerSettings) => Promise<ServerSettings>;
}>();
const authApiBase = ref(props.settings.authApiBase);
const saving = ref(false);
const saved = ref(false);
const error = ref('');
const isDesktop = Boolean(window.desktop);
let disposed = false;

watch(
  () => props.settings,
  (settings): void => {
    authApiBase.value = settings.authApiBase;
  },
);

/** 编辑地址时清除上次保存反馈。 */
const clearFeedback = (): void => {
  saved.value = false;
  error.value = '';
};

/** 保存业务服务器地址，媒体地址由登录请求自动获取。 */
const save = async (): Promise<void> => {
  if (props.disabled || saving.value) return;
  clearFeedback();
  saving.value = true;
  try {
    const settings = await props.persist({
      authApiBase: authApiBase.value,
      rtcServerUrl: '',
    });
    if (disposed) return;
    authApiBase.value = settings.authApiBase;
    saved.value = true;
  } catch (cause) {
    if (!disposed)
      error.value = getAuthErrorMessage(cause, '服务地址保存失败，请重试');
  } finally {
    if (!disposed) saving.value = false;
  }
};

onBeforeUnmount(() => {
  disposed = true;
});
</script>

<style scoped>
.server-form label {
  display: block;
  margin: 0 0 5px;
  color: #555;
  font-size: 12px;
  line-height: 18px;
}
.server-form .el-input + label {
  margin-top: 10px;
}
.server-feedback {
  overflow-y: auto;
  overflow-wrap: anywhere;
}
</style>
