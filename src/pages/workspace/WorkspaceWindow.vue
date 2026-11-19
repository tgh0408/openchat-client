<template>
  <main class="desktop-window desktop-window--chat" aria-label="OpenChat">
    <ChatWorkspace
      v-if="session"
      :session="session"
      :logging-out="loggingOut"
      :session-error="error"
      :read-only="false"
      @logout="logout"
      @close="closeWindow"
      @local-read-error="checkLocalAccess"
      @initialized="completeWorkspaceInitialization"
    />
    <section v-else-if="error" class="panel">
      <p class="form-error" role="alert">{{ error }}</p>
      <el-button @click="logout()">返回登录</el-button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { ElButton } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import type { AuthSession } from '../../../shared/auth/auth';
import { logoutSession } from '../../services/auth/auth';
import ChatWorkspace from './ChatWorkspace.vue';
import { readServerSettings } from '../../services/storage/storage';

const props = defineProps<{ initialSession?: AuthSession }>();
const emit = defineEmits<{ loggedOut: [message?: string] }>();
const session = shallowRef<AuthSession | null>(null);
const loggingOut = ref(false);
const error = ref('');
let disposed = false;
let checkingLocalAccess = false;
let initializationCompleted = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;

/** 桌面由主进程销毁当前窗口；预览只卸载工作台，不删除历史。 */
const logout = async (message: string = ''): Promise<void> => {
  if (loggingOut.value || disposed) return;
  loggingOut.value = true;
  try {
    const notice = await logoutSession();
    if (!window.desktop && !disposed) emit('loggedOut', notice || message);
  } catch {
    if (!disposed) error.value = '退出失败，请重试';
  } finally {
    if (!disposed) loggingOut.value = false;
  }
};

/** 本地读取异常只核对授权，普通 IO 错误不清理令牌。 */
const checkLocalAccess = async (): Promise<void> => {
  const desktop = window.desktop;
  const current = session.value;
  if (!desktop || !current || checkingLocalAccess || disposed) return;
  checkingLocalAccess = true;
  try {
    const access = await desktop.getSessionAccess();
    if (disposed || session.value !== current) return;
    if (access.userId !== current.user.id || access.readOnly)
      await desktop.returnToLogin();
  } catch {
    if (!disposed) error.value = '无法读取当前访问状态，请重试或重新登录';
  } finally {
    checkingLocalAccess = false;
  }
};

/** 浏览器按 JWT 有效期撤销内存会话；桌面统一由主进程执行。 */
const scheduleExpiry = (): void => {
  clearTimeout(expiryTimer);
  if (window.desktop || !session.value || session.value.expiresAt === null)
    return;
  const remaining = session.value.expiresAt * 1000 - Date.now();
  if (remaining <= 0) {
    void logout('登录状态已失效，请重新登录');
    return;
  }
  expiryTimer = setTimeout(scheduleExpiry, Math.min(remaining, 2_147_000_000));
};

/** 会话同步尝试和本地列表加载结束后，才允许主进程显示工作台并连接 SSE。 */
const completeWorkspaceInitialization = async (): Promise<void> => {
  if (disposed || initializationCompleted || !session.value) return;
  initializationCompleted = true;
  try {
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (disposed) return;
    await window.desktop?.workspaceReady();
  } catch {
    if (disposed) return;
    session.value = null;
    error.value = '无法进入聊天，请重新登录';
    await window.desktop?.returnToLogin().catch(() => {});
  }
};

/** 只接收主进程已验证的授权；SSE 等待子组件完成会话初始化后再启动。 */
const initializeWorkspace = async (): Promise<void> => {
  try {
    await readServerSettings();
    const current = window.desktop
      ? await window.desktop.getWorkspaceSession()
      : props.initialSession;
    if (disposed) return;
    if (!current) throw new Error('登录状态已失效');
    session.value = current;
    scheduleExpiry();
  } catch {
    if (disposed) return;
    session.value = null;
    error.value = '无法进入聊天，请重新登录';
    await window.desktop?.returnToLogin().catch(() => {});
  }
};

/** 原生关闭保留加密会话，浏览器退出预览沿用内存清理。 */
const closeWindow = async (): Promise<void> => {
  if (window.desktop) await window.desktop.close();
  else await logout();
};

onMounted(() => void initializeWorkspace());
onBeforeUnmount(() => {
  disposed = true;
  session.value = null;
  clearTimeout(expiryTimer);
});
</script>
