<template>
  <main class="desktop-window" aria-label="OpenChat">
    <header class="titlebar">
      <div class="window-heading">
        <button
          v-if="view === 'settings'"
          class="icon-button back-button"
          aria-label="返回登录"
          title="返回登录"
          :disabled="savingSettings"
          @click="goBack"
        >
          <el-icon :size="15"><ArrowLeft /></el-icon>
        </button>
        <span>{{ view === 'settings' ? '设置' : 'OpenChat' }}</span>
      </div>
      <div class="window-actions">
        <button
          v-if="view === 'login'"
          class="icon-button"
          aria-label="设置"
          title="设置"
          :disabled="
            !storageReady ||
            savingSettings ||
            authenticating ||
            switchingAccount ||
            validatingSession
          "
          @click="openSettings"
        >
          <el-icon :size="15"><Setting /></el-icon>
        </button>
        <button
          class="icon-button close-button"
          aria-label="关闭"
          title="关闭"
          :disabled="openingWorkspace"
          @click="closeWindow"
        >
          <el-icon :size="16"><Close /></el-icon>
        </button>
      </div>
    </header>
    <LoginPanel
      v-if="view === 'login'"
      :remembered-account="rememberedAccount"
      :storage-error="error || notice || ''"
      :authorizing="
        authenticating ||
        switchingAccount ||
        validatingSession ||
        savingSettings
      "
      :initializing="!storageReady"
      :saved-session="session"
      :accounts="accounts"
      @authenticated="onAuthenticated"
      @enter="enterSavedSession"
      @select-account="changeAccount"
    >
      <template #startup>
        <footer
          v-if="!storageReady || validatingSession"
          class="startup-feedback"
          :aria-busy="!storageReady || validatingSession"
        >
          <div v-if="!storageReady" class="startup-status">
            <span role="status">{{ startupLabel }}</span>
            <button
              v-if="startupPhase === 'ready' && !storageReady && error"
              class="startup-retry"
              aria-label="重试读取本地设置"
              title="重试读取本地设置"
              @click="restoreLocalData()"
            >
              <el-icon :size="14"><RefreshRight /></el-icon>
            </button>
          </div>
          <p v-if="validatingSession" class="startup-validation" role="status">
            正在验证登录状态
          </p>
        </footer>
      </template>
    </LoginPanel>
    <section v-else-if="view === 'settings'" class="panel settings-panel">
      <h1>登录设置</h1>
      <div class="setting-row">
        <span>本次运行记住账号</span>
        <el-switch
          id="remember-account"
          v-model="remember"
          aria-label="本次运行记住账号"
          :disabled="savingSettings"
          @change="persistProfile"
        />
      </div>
      <div v-if="isDesktop" class="setting-row">
        <span>Debug 模式</span>
        <el-switch
          id="debug-mode"
          v-model="debugMode"
          aria-label="Debug 模式"
          :disabled="savingSettings"
          @change="persistDebugMode"
        />
      </div>
      <section class="server-settings" aria-labelledby="server-settings-title">
        <h2 id="server-settings-title">服务</h2>
        <LoginServerSettings
          :settings="serverSettings"
          :disabled="savingSettings || !storageReady"
          :persist="persistServerSettings"
        />
      </section>
      <div class="about-block">
        <span>关于</span>
        <p>
          OpenChat <span>{{ currentVersion }}</span>
        </p>
        <p class="muted-caption">OpenChat 桌面客户端</p>
      </div>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
    </section>
    <section v-else class="panel closed-panel">
      <h1>窗口已关闭</h1>
      <el-button type="primary" @click="goBack">重新打开</el-button>
    </section>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton, ElIcon, ElSwitch } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/switch/style/css';
import {
  ArrowLeft,
  Close,
  RefreshRight,
  Setting,
} from '@element-plus/icons-vue';
import {
  readLocalSettings,
  readServerSettings,
} from '../../services/storage/storage';
import {
  getServerSettings,
  type ServerSettings,
} from '../../../shared/runtime/server-settings';
import {
  logoutSession,
  getLoginState,
  selectLoginAccount,
  authorizeSession,
  getAuthErrorMessage,
  saveLoginServerSettings,
} from '../../services/auth/auth';
import type {
  AuthSession,
  LoginState,
  SavedLoginAccount,
} from '../../../shared/auth/auth';
import LoginPanel from './LoginPanel.vue';
import LoginServerSettings from './LoginServerSettings.vue';
import packageJson from '../../../package.json';
import type { StartupPhase } from '../../../shared/runtime/startup';
import { startupPhaseOrder } from '../../../shared/runtime/startup';

const props = defineProps<{ notice?: string }>();
const emit = defineEmits<{ entered: [session: AuthSession] }>();
const currentVersion = packageJson.version;
type View = 'login' | 'settings' | 'closed';
const view = ref<View>('login');
const session = ref<AuthSession | null>(null);
const authenticating = ref(false);
const openingWorkspace = ref(false);
const switchingAccount = ref(false);
const accounts = ref<SavedLoginAccount[]>([]);
const error = ref('');
const remember = ref(true);
const isDesktop = Boolean(window.desktop);
const debugMode = ref(false);
const rememberedAccount = ref('');
const storageReady = ref(false);
const startupPhase = ref<StartupPhase>('settings');
const validatingSession = ref(false);
const savingSettings = ref(false);
const serverSettings = ref(getServerSettings());
let restoreRequest = 0;
let startupRestored = false;
let unsubscribeStartup: (() => void) | undefined;
let savedRemember = true;
let savedDebugMode = false;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
let unsubscribeExpiry: (() => void) | undefined;
let expiring = false;
let disposed = false;

/** 本地阶段与远端校验分开显示，不以网络校验代替本地初始化进度。 */
const startupLabel = computed((): string => {
  switch (startupPhase.value) {
    case 'settings':
      return '读取设置';
    case 'accounts':
      return '恢复账号';
    case 'ready':
      return '恢复账号';
    case 'failed':
      return '初始化失败';
  }
});

/** 同步当前账号；无 JWT 时通过预填账号返回密码表单。 */
const applyLoginState = (state: LoginState): void => {
  accounts.value = state.accounts;
  session.value = state.session;
  error.value = state.validationError ?? props.notice ?? '';
  rememberedAccount.value =
    state.accounts.find((account) => account.id === state.selectedAccountId)
      ?.account ?? '';
};

/** 读取本地偏好与主进程恢复的会话，等待点击进入后再打开内容库。 */
const restoreLocalData = async (checkServer: boolean = true): Promise<void> => {
  if (disposed || startupPhase.value !== 'ready') return;
  const request = ++restoreRequest;
  storageReady.value = false;
  validatingSession.value = false;
  error.value = '';
  try {
    const [state, settings, servers] = await Promise.all([
      getLoginState(false),
      readLocalSettings(),
      readServerSettings(),
    ]);
    if (disposed || request !== restoreRequest) return;
    applyLoginState(state);
    serverSettings.value = servers;
    remember.value = settings.rememberAccount;
    savedRemember = remember.value;
    debugMode.value = settings.debugMode;
    savedDebugMode = debugMode.value;
    storageReady.value = true;
    scheduleSessionExpiry();
    if (checkServer && state.session) {
      validatingSession.value = true;
      const validated = await getLoginState(true);
      if (disposed || request !== restoreRequest) return;
      applyLoginState(validated);
      scheduleSessionExpiry();
    }
  } catch {
    if (disposed || request !== restoreRequest) return;
    error.value = storageReady.value
      ? '无法验证登录状态，请重试。'
      : '无法读取本地设置，请重试。';
  } finally {
    if (!disposed && request === restoreRequest)
      validatingSession.value = false;
  }
};

/** 接受单调启动状态；事件先于快照到达时不回退或重复恢复账号。 */
const applyStartupPhase = (phase: StartupPhase): void => {
  if (
    disposed ||
    startupPhaseOrder(phase) < startupPhaseOrder(startupPhase.value)
  )
    return;
  startupPhase.value = phase;
  if (phase === 'failed') {
    storageReady.value = false;
    error.value = '本地初始化失败，请关闭后重新启动。';
  } else if (phase === 'ready' && !startupRestored) {
    startupRestored = true;
    void restoreLocalData();
  }
};

/** 先绘制禁用的登录表单，再通知主进程显示窗口并启动本地初始化。 */
const initializeLogin = async (): Promise<void> => {
  const desktop = window.desktop;
  if (!desktop) {
    applyStartupPhase('ready');
    return;
  }
  try {
    unsubscribeStartup = desktop.onStartupPhase(applyStartupPhase);
    await nextTick();
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
    if (disposed) return;
    await desktop.startupRendered();
    if (disposed) return;
    applyStartupPhase(await desktop.getStartupPhase());
  } catch {
    if (!disposed) {
      error.value = '无法读取启动状态，请关闭后重新启动。';
      startupPhase.value = 'failed';
    }
  }
};

/** 切换前清除计时和旧错误，选择结果不会自动进入聊天页面。 */
const changeAccount = async (
  id: string | null,
  draft?: string,
): Promise<void> => {
  if (
    !storageReady.value ||
    validatingSession.value ||
    authenticating.value ||
    switchingAccount.value ||
    expiring
  )
    return;
  switchingAccount.value = true;
  clearTimeout(expiryTimer);
  error.value = '';
  try {
    applyLoginState(await selectLoginAccount(id));
    if (id === null && draft !== undefined) rememberedAccount.value = draft;
    view.value = 'login';
  } catch {
    error.value = '切换账号失败，请重试';
  } finally {
    switchingAccount.value = false;
    scheduleSessionExpiry();
  }
};

/** 授权失效后统一返回登录，不以无令牌的本地只读状态继续使用。 */
const expireSession = async (replaced: boolean = false): Promise<void> => {
  if (expiring || disposed) return;
  expiring = true;
  restoreRequest++;
  clearTimeout(expiryTimer);
  try {
    session.value = null;
    storageReady.value = false;
    view.value = 'login';
    // 桌面失效已由主进程清理，页面只刷新状态，不能再次清除新授权。
    if (!window.desktop) await logoutSession();
    if (disposed) return;
    await restoreLocalData(false);
    if (replaced) error.value = '账号已在其他客户端登录，请重新登录';
    else if (!error.value) error.value = '登录状态已失效，请重新登录';
  } catch {
    error.value = '无法清理过期会话，请重试。';
  } finally {
    expiring = false;
  }
};

/** 根据 JWT 到期时间清理浏览器和桌面的内存会话。 */
const scheduleSessionExpiry = (): void => {
  clearTimeout(expiryTimer);
  // 桌面由主进程统一执行过期清理，并通知页面返回登录。
  if (window.desktop) return;
  const currentSession: AuthSession | null = session.value;
  if (!currentSession || currentSession.expiresAt === null) return;
  const remaining = currentSession.expiresAt * 1000 - Date.now();
  if (remaining <= 0) {
    void expireSession();
    return;
  }
  expiryTimer = setTimeout(
    scheduleSessionExpiry,
    Math.min(remaining, 2_147_000_000),
  );
};

/** 仅更新本次运行的表单记忆偏好，不影响独立保存的加密登录会话。 */
const persistProfile = async (): Promise<void> => {
  savingSettings.value = true;
  error.value = '';
  try {
    await window.desktop?.saveLocalSettings(remember.value);
    savedRemember = remember.value;
    if (!remember.value) rememberedAccount.value = '';
  } catch {
    remember.value = savedRemember;
    error.value = '无法保存设置，已恢复原值。';
  } finally {
    savingSettings.value = false;
  }
};

/** 保存地址后同步对应服务器的账号入口，不自动授权或发起登录。 */
const persistServerSettings = async (
  value: ServerSettings,
): Promise<ServerSettings> => {
  if (savingSettings.value || !storageReady.value || validatingSession.value)
    throw new Error('请等待当前操作完成');
  savingSettings.value = true;
  clearTimeout(expiryTimer);
  try {
    const saved = await saveLoginServerSettings(value);
    if (disposed) return saved;
    serverSettings.value = saved;
    const state = await getLoginState(false);
    if (!disposed) applyLoginState(state);
    return saved;
  } finally {
    if (!disposed) {
      savingSettings.value = false;
      scheduleSessionExpiry();
    }
  }
};

/** 保存桌面调试偏好，失败时恢复开关状态。 */
const persistDebugMode = async (): Promise<void> => {
  const desktop = window.desktop;
  if (!desktop) return;
  savingSettings.value = true;
  error.value = '';
  try {
    await desktop.saveDebugMode(debugMode.value);
    savedDebugMode = debugMode.value;
  } catch {
    debugMode.value = savedDebugMode;
    error.value = '无法保存设置，已恢复原值。';
  } finally {
    savingSettings.value = false;
  }
};

/** 从登录设置或关闭预览返回登录入口，已有会话也需点击确认进入。 */
const goBack = (): void => {
  if (savingSettings.value) return;
  error.value = '';
  view.value = 'login';
};

/** 通过后端校验后进入；失败时同步状态，不将网络故障当成退出登录。 */
const enterSession = async (
  value: AuthSession,
  resume: boolean,
): Promise<void> => {
  if (
    !storageReady.value ||
    validatingSession.value ||
    authenticating.value ||
    disposed
  )
    return;
  authenticating.value = true;
  error.value = '';
  const request = restoreRequest;
  try {
    const verified = await authorizeSession(value, resume);
    if (disposed || expiring || request !== restoreRequest) return;
    if (
      !verified.accessToken.trim() ||
      (verified.expiresAt !== null && verified.expiresAt * 1000 <= Date.now())
    )
      throw new Error('登录已过期');
    if (window.desktop) {
      openingWorkspace.value = true;
      await window.desktop.openWorkspace();
      return;
    }
    session.value = verified;
    rememberedAccount.value = remember.value ? verified.user.account : '';
    emit('entered', verified);
  } catch (cause) {
    if (disposed || request !== restoreRequest) return;
    session.value = null;
    view.value = 'login';
    storageReady.value = false;
    try {
      await restoreLocalData(false);
      if (!error.value)
        error.value = getAuthErrorMessage(cause, '登录校验失败，请重试');
    } catch {
      error.value = '无法读取登录状态，请重试。';
    }
  } finally {
    openingWorkspace.value = false;
    authenticating.value = false;
  }
};

/** 密码登录完成后接收本次后端授权。 */
const onAuthenticated = async (value: AuthSession): Promise<void> => {
  await enterSession(value, false);
};

/** 快捷进入仅恢复当前账号的已有会话，不重新请求密码登录接口。 */
const enterSavedSession = async (): Promise<void> => {
  if (session.value) await enterSession(session.value, true);
};

/** 桌面关闭原生窗口；浏览器关闭预览时同样清理会话。 */
const closeWindow = async (): Promise<void> => {
  if (window.desktop) await window.desktop.close();
  else {
    if (session.value) await logoutSession();
    view.value = 'closed';
  }
};

/** 打开未登录设置，不开放文件或其他用户数据入口。 */
const openSettings = (): void => {
  if (!storageReady.value || validatingSession.value) return;
  error.value = '';
  view.value = 'settings';
};

onMounted(() => {
  void initializeLogin();
  unsubscribeExpiry = window.desktop?.onSessionExpired((userId, reason) => {
    const currentSession: AuthSession | null = session.value;
    if (
      !switchingAccount.value &&
      currentSession &&
      currentSession.user.id === userId
    )
      void expireSession(reason === 'SESSION_REPLACED');
  });
});
onBeforeUnmount(() => {
  disposed = true;
  restoreRequest++;
  unsubscribeStartup?.();
  clearTimeout(expiryTimer);
  unsubscribeExpiry?.();
});
</script>

<style scoped>
.settings-panel {
  height: calc(100% - 38px);
  overflow-y: auto;
}
.server-settings {
  margin-top: 20px;
}
.server-settings h2 {
  margin: 0 0 12px;
  color: #555;
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
}
</style>
