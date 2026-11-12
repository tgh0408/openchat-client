<template>
  <section class="login-panel" aria-label="登录">
    <div class="login-brand" :class="{ 'quick-login-brand': savedSession }">
      <button
        v-if="mode === 'register' && !savedSession"
        type="button"
        class="registration-avatar"
        aria-label="选择并裁剪头像（可选，JPG/PNG，最大 10 MiB）"
        title="选择并裁剪头像（可选，JPG/PNG，最大 10 MiB）"
        :disabled="registerLoading || avatarLoading || blocked"
        @click="chooseAvatar"
      >
        <AvatarImage :src="avatarPreview" alt="注册头像" />
        <el-icon class="registration-avatar-edit"><Camera /></el-icon>
      </button>
      <AvatarImage v-else :src="currentAvatar" alt="账号头像" />
      <h1>{{ panelTitle }}</h1>
      <el-button
        v-if="mode === 'register' && avatarPreview && !savedSession"
        class="registration-avatar-remove"
        :icon="Close"
        text
        aria-label="使用默认头像"
        title="使用默认头像"
        :disabled="registerLoading || avatarLoading || blocked"
        @click="clearAvatar"
      />
      <input
        ref="avatarInput"
        type="file"
        accept=".jpg,.jpeg,.png,image/jpeg,image/png"
        hidden
        @change="readBrowserAvatar"
      />
    </div>
    <form
      v-if="savedSession"
      class="password-form quick-login-form"
      @submit.prevent="enterSavedSession"
    >
      <LoginAccountInput
        ref="accountInput"
        :model-value="savedSession.user.account"
        :accounts="accounts"
        :disabled="blocked"
        @select="selectAccount"
        @update:model-value="editSavedAccount"
      />
      <div class="login-feedback" aria-live="polite">
        <p v-if="storageError" class="form-error" role="alert">
          {{ storageError }}
        </p>
      </div>
      <el-button
        class="password-submit"
        type="primary"
        native-type="submit"
        :loading="authorizing"
        :disabled="blocked"
        >进入 OpenChat</el-button
      >
    </form>
    <el-tabs
      v-else
      v-model="mode"
      stretch
      class="login-tabs"
      @tab-change="changeMode"
    >
      <el-tab-pane label="账号密码" name="password" :disabled="blocked">
        <form class="password-form" @submit.prevent="submitPassword">
          <LoginAccountInput
            ref="accountInput"
            v-model="account"
            :accounts="accounts"
            :disabled="loading || blocked"
            @update:model-value="clearError"
            @select="selectAccount"
          />
          <el-input
            v-model="password"
            aria-label="密码"
            name="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            type="password"
            show-password
            :maxlength="256"
            :disabled="loading || blocked"
            @input="clearError"
          />
          <div class="login-feedback" aria-live="polite">
            <p v-if="error || storageError" class="form-error" role="alert">
              {{ error || storageError }}
            </p>
            <p v-else-if="message" class="form-notice" role="status">
              {{ message }}
            </p>
          </div>
          <el-button
            class="password-submit"
            type="primary"
            native-type="submit"
            :loading="loading || authorizing"
            :disabled="loading || blocked"
            >{{ loading || authorizing ? '正在登录' : '登录' }}</el-button
          >
        </form>
      </el-tab-pane>
      <el-tab-pane label="注册账号" name="register" :disabled="blocked">
        <form
          class="password-form register-form"
          @submit.prevent="submitRegistration"
        >
          <el-input
            v-model="account"
            aria-label="注册账号"
            name="register-account"
            autocomplete="username"
            placeholder="邮箱或手机号"
            :prefix-icon="User"
            :maxlength="20"
            :disabled="loading || registerLoading || avatarLoading || blocked"
            @input="clearError"
          />
          <el-input
            v-model="registerUsername"
            aria-label="昵称"
            name="username"
            autocomplete="nickname"
            placeholder="请输入昵称"
            :prefix-icon="User"
            maxlength="16"
            :disabled="loading || registerLoading || blocked"
            @input="clearError"
          />
          <el-input
            v-model="registerPassword"
            aria-label="密码"
            name="new-password"
            autocomplete="new-password"
            placeholder="请输入密码"
            :prefix-icon="Lock"
            type="password"
            show-password
            maxlength="20"
            :disabled="loading || registerLoading || blocked"
            @input="clearError"
          />
          <el-input
            v-model="registerConfirmPassword"
            aria-label="确认密码"
            name="confirm-password"
            autocomplete="new-password"
            placeholder="请再次输入密码"
            :prefix-icon="Lock"
            type="password"
            show-password
            maxlength="20"
            :disabled="loading || registerLoading || blocked"
            @input="clearError"
          />
          <div class="login-feedback" aria-live="polite">
            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
          </div>
          <el-button
            class="password-submit"
            type="primary"
            native-type="submit"
            :loading="registerLoading || authorizing"
            :disabled="loading || registerLoading || avatarLoading || blocked"
            >{{
              registerLoading || authorizing ? '正在注册' : '注册'
            }}</el-button
          >
        </form>
      </el-tab-pane>
      <el-tab-pane label="扫码登录" name="qr" :disabled="blocked">
        <div class="qr-login">
          <div class="qr-frame">
            <div class="qr-overlay">
              <el-icon :size="28"><Warning /></el-icon>
            </div>
          </div>
          <p class="qr-status" role="status">扫码登录暂未接入</p>
        </div>
      </el-tab-pane>
    </el-tabs>
    <slot v-if="mode === 'password' || initializing" name="startup" />
    <el-dialog
      :model-value="browserCrop !== undefined"
      title="裁剪头像"
      width="min(440px, calc(100vw - 24px))"
      top="3vh"
      append-to-body
      destroy-on-close
      :show-close="false"
      :close-on-click-modal="false"
      :close-on-press-escape="false"
      @close="cancelBrowserCrop"
    >
      <AvatarCropEditor
        v-if="browserCrop"
        :key="browserCrop.generation"
        :bytes="browserCrop.bytes"
        :save="saveBrowserCrop"
        :show-heading="false"
        @cancel="cancelBrowserCrop"
      />
    </el-dialog>
  </section>
</template>

<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
} from 'vue';
import {
  ElButton,
  ElDialog,
  ElIcon,
  ElInput,
  ElTabs,
  ElTabPane,
} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/tabs/style/css';
import 'element-plus/es/components/tab-pane/style/css';
import 'element-plus/es/components/dialog/style/css';
import { Camera, Close, Lock, User, Warning } from '@element-plus/icons-vue';
import {
  MAX_REGISTRATION_AVATAR_BYTES,
  parseRegistrationAvatar,
  registrationAvatarMime,
} from '../../../shared/auth/registration-avatar';
import {
  getAuthErrorMessage,
  loginWithPassword,
  registerWithPassword,
} from '../../services/auth/auth';
import type { AuthSession, SavedLoginAccount } from '../../services/auth/auth';
import LoginAccountInput from './LoginAccountInput.vue';
import AvatarImage from '../../components/avatar/AvatarImage.vue';
const AvatarCropEditor = defineAsyncComponent(
  () => import('../../components/avatar-crop/AvatarCropEditor.vue'),
);

const props = defineProps<{
  rememberedAccount: string;
  storageError: string;
  authorizing: boolean;
  initializing: boolean;
  savedSession: AuthSession | null;
  accounts: SavedLoginAccount[];
}>();
const blocked = computed(
  (): boolean => props.initializing || props.authorizing,
);
const emit = defineEmits<{
  authenticated: [session: AuthSession];
  enter: [];
  selectAccount: [id: string | null, draft?: string];
}>();
const mode = ref<'password' | 'register' | 'qr'>('password');
const account = ref(props.rememberedAccount);

/** 根据当前入口显示标题，不改变已有快捷登录状态。 */
const panelTitle = computed((): string => {
  if (props.savedSession) return props.savedSession.user.nickname;
  return mode.value === 'register' ? '注册' : '登录';
});

/** 品牌头像优先用已保存会话的头像，其次用当前选中历史账号的头像。 */
const currentAvatar = computed((): string => {
  if (props.savedSession?.user.avatar) return props.savedSession.user.avatar;
  return (
    props.accounts.find((item) => item.account === account.value)?.avatar ?? ''
  );
});
const password = ref('');
const registerUsername = ref('');
const registerPassword = ref('');
const registerConfirmPassword = ref('');
const error = ref('');
const message = ref('');
const loading = ref(false);
const registerLoading = ref(false);
const avatarLoading = ref(false);
const avatarInput = ref<HTMLInputElement>();
const avatarPreview = ref('');
const browserCrop = shallowRef<{
  bytes: Uint8Array<ArrayBufferLike>;
  generation: number;
}>();
let registrationAvatar: Uint8Array<ArrayBufferLike> | undefined;
let avatarGeneration = 0;
const accountInput = ref<InstanceType<typeof LoginAccountInput>>();
let controller: AbortController | undefined;

/** 仅未编辑的已选账号允许使用已有 JWT 快捷进入。 */
const enterSavedSession = (): void => {
  if (props.savedSession && !blocked.value) emit('enter');
};

/** 输入新凭据时清除上次接口错误。 */
const clearError = (): void => {
  error.value = '';
  message.value = '';
};

/** 移除临时头像并撤销预览，迟到的读取不得恢复已移除内容。 */
const clearAvatar = (): void => {
  if (avatarLoading.value)
    void window.desktop?.cancelRegistrationAvatar().catch(() => {});
  avatarGeneration++;
  avatarLoading.value = false;
  browserCrop.value = undefined;
  registrationAvatar = undefined;
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value);
  avatarPreview.value = '';
  if (avatarInput.value) avatarInput.value.value = '';
};

/** 解码校验成功后替换预览，选择阶段不发起任何上传。 */
const previewAvatar = async (
  value: Uint8Array<ArrayBufferLike>,
  generation: number,
): Promise<void> => {
  const bytes = parseRegistrationAvatar(value);
  const blob = new Blob([new Uint8Array(bytes)], {
    type: registrationAvatarMime(bytes),
  });
  const image = await createImageBitmap(blob).catch((): never => {
    throw new Error('头像图片无法读取，请重新选择 JPG 或 PNG');
  });
  image.close();
  if (generation !== avatarGeneration || mode.value !== 'register') return;
  if (avatarPreview.value) URL.revokeObjectURL(avatarPreview.value);
  registrationAvatar = bytes;
  avatarPreview.value = URL.createObjectURL(blob);
};

/** 浏览器取消裁剪时只释放本次原图，不替换已确认头像。 */
const cancelBrowserCrop = (): void => {
  if (!browserCrop.value) return;
  browserCrop.value = undefined;
  avatarGeneration++;
  avatarLoading.value = false;
};

/** 浏览器确认后才回填预览，迟到结果不得恢复已取消的头像。 */
const saveBrowserCrop = async (
  bytes: Uint8Array<ArrayBufferLike>,
): Promise<void> => {
  const current = browserCrop.value;
  if (!current) return;
  await previewAvatar(bytes, current.generation);
  if (browserCrop.value !== current) return;
  browserCrop.value = undefined;
  avatarLoading.value = false;
};

/** 桌面使用受控原生选择器，浏览器仅打开页面文件选择器。 */
const chooseAvatar = async (): Promise<void> => {
  if (registerLoading.value || avatarLoading.value || blocked.value) return;
  clearError();
  if (!window.desktop) {
    avatarInput.value?.click();
    return;
  }
  const generation = ++avatarGeneration;
  avatarLoading.value = true;
  try {
    const bytes = await window.desktop.chooseRegistrationAvatar();
    if (bytes && generation === avatarGeneration)
      await previewAvatar(bytes, generation);
  } catch (cause) {
    if (generation === avatarGeneration)
      error.value = getAuthErrorMessage(cause, '头像选择失败，请重试');
  } finally {
    if (generation === avatarGeneration) avatarLoading.value = false;
  }
};

/** 浏览器只读取本次选择的有界文件，不保存文件路径或持久化头像草稿。 */
const readBrowserAvatar = async (event: Event): Promise<void> => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) return;
  const file = input.files?.[0];
  input.value = '';
  if (
    !file ||
    mode.value !== 'register' ||
    registerLoading.value ||
    avatarLoading.value ||
    blocked.value
  )
    return;
  const generation = ++avatarGeneration;
  avatarLoading.value = true;
  clearError();
  try {
    if (file.size < 1 || file.size > MAX_REGISTRATION_AVATAR_BYTES)
      throw new Error('头像大小须为 1 字节至 10 MiB');
    const bytes = parseRegistrationAvatar(
      new Uint8Array(await file.arrayBuffer()),
    );
    if (generation === avatarGeneration && mode.value === 'register')
      browserCrop.value = { bytes, generation };
  } catch (cause) {
    if (generation === avatarGeneration)
      error.value = getAuthErrorMessage(cause, '头像选择失败，请重试');
  } finally {
    if (generation === avatarGeneration && !browserCrop.value)
      avatarLoading.value = false;
  }
};

/** 取消旧请求并清理敏感输入，不持久化密码。 */
const cancelLogin = (): void => {
  clearAvatar();
  controller?.abort();
  controller = undefined;
  loading.value = false;
  registerLoading.value = false;
  password.value = '';
  registerPassword.value = '';
  registerConfirmPassword.value = '';
};

/** 选择其他账号前取消请求并清空密码，同步预填账号、不沿用旧账号的表单凭据。 */
const selectAccount = (id: string | null): void => {
  if (blocked.value) return;
  cancelLogin();
  clearError();
  mode.value = 'password';
  account.value = props.accounts.find((item) => item.id === id)?.account ?? '';
  emit('selectAccount', id);
};

/** 编辑快捷账号时切换到密码登录，保留输入但不沿用原账号授权。 */
const editSavedAccount = (value: string): void => {
  if (blocked.value || value === props.savedSession?.user.account) return;
  cancelLogin();
  clearError();
  emit('selectAccount', null, value);
};

/** 父页面切换账号时同步密码表单，并移除之前输入的密码。 */
const syncAccount = (): void => {
  cancelLogin();
  clearError();
  account.value = props.rememberedAccount;
  mode.value = 'password';
};

watch(() => props.rememberedAccount, syncAccount);
watch(
  () => props.savedSession,
  async (value, previous): Promise<void> => {
    if (previous && !value) {
      syncAccount();
      await nextTick();
      accountInput.value?.focus();
    }
  },
);

/** 调用真实后端，只有成功响应才能进入主进程会话接收流程。 */
const submitPassword = async (): Promise<void> => {
  if (loading.value || registerLoading.value || blocked.value) return;
  clearError();
  const current = new AbortController();
  controller = current;
  loading.value = true;
  try {
    const session = await loginWithPassword(
      account.value,
      password.value,
      current.signal,
    );
    if (current.signal.aborted) return;
    // 请求完成后先解除取消控制，卸载登录组件不能撤销待接收的授权。
    controller = undefined;
    password.value = '';
    loading.value = false;
    emit('authenticated', session);
  } catch (cause) {
    if (!current.signal.aborted)
      error.value = getAuthErrorMessage(cause, '登录失败，请重试');
  } finally {
    if (controller === current) {
      controller = undefined;
      password.value = '';
      loading.value = false;
    }
  }
};

/** 提交注册表单，注册成功后回到密码登录页。 */
const submitRegistration = async (): Promise<void> => {
  if (
    registerLoading.value ||
    loading.value ||
    avatarLoading.value ||
    blocked.value
  )
    return;
  clearError();
  if (registerPassword.value !== registerConfirmPassword.value) {
    error.value = '两次输入的密码不一致';
    return;
  }
  const current = new AbortController();
  controller = current;
  registerLoading.value = true;
  try {
    await registerWithPassword(
      account.value,
      registerUsername.value,
      registerPassword.value,
      current.signal,
      registrationAvatar,
    );
    if (current.signal.aborted) return;
    controller = undefined;
    registerLoading.value = false;
    registerUsername.value = '';
    registerPassword.value = '';
    registerConfirmPassword.value = '';
    mode.value = 'password';
    await nextTick();
    message.value = '注册成功，请使用新账号登录';
  } catch (cause) {
    if (!current.signal.aborted)
      error.value = getAuthErrorMessage(cause, '注册失败，请重试');
  } finally {
    if (controller === current) {
      controller = undefined;
      registerLoading.value = false;
      registerPassword.value = '';
      registerConfirmPassword.value = '';
    }
  }
};

/** 切换登录方式时取消请求，扫码未接入时不发送假定接口。 */
const changeMode = (): void => {
  cancelLogin();
  clearError();
};

onBeforeUnmount(cancelLogin);
</script>
