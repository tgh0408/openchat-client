<template>
  <main class="settings-window" aria-label="设置">
    <header class="settings-titlebar">
      <div class="settings-titlebar-sidebar" aria-hidden="true"></div>
      <div class="settings-titlebar-content">
        <button
          class="settings-close"
          type="button"
          title="关闭"
          aria-label="关闭设置窗口"
          @click="closeWindow"
        >
          <el-icon :size="16"><Close /></el-icon>
        </button>
      </div>
    </header>
    <div class="settings-layout">
      <aside class="settings-sidebar" aria-label="设置分类">
        <button
          v-for="item in categories"
          :key="item.key"
          class="settings-nav-item"
          :class="{ 'is-active': activeCategory === item.key }"
          type="button"
          :aria-pressed="activeCategory === item.key"
          @click="activeCategory = item.key"
        >
          <el-icon :size="18"><component :is="item.icon" /></el-icon>
          <span>{{ item.label }}</span>
        </button>
      </aside>
      <section class="settings-content">
        <div v-if="activeCategory === 'about'" class="settings-about">
          <div class="settings-about-row">
            <div>
              <strong>版本信息</strong>
              <span>{{ currentVersion }}</span>
            </div>
            <button
              class="settings-light-button"
              type="button"
              :disabled="updateChecking"
              @click="checkForUpdate(true)"
            >
              {{ updateChecking ? '检查中...' : '检查更新' }}
            </button>
          </div>
          <p v-if="updateStatus" class="settings-update-status" role="status">
            {{ updateStatus }}
          </p>
        </div>
        <div
          v-else-if="activeCategory === 'general'"
          class="settings-content-inner"
        >
          <h1>通用</h1>
          <section class="settings-section" aria-label="日志设置">
            <div class="settings-row">
              <div>
                <strong>日志等级</strong>
                <span>控制桌面端日志文件记录的最低等级。</span>
              </div>
              <el-select
                v-model="logLevel"
                class="settings-log-level-select"
                size="small"
                :disabled="savingLogLevel"
                aria-label="日志等级"
                @change="saveLogLevel"
              >
                <el-option
                  v-for="option in logLevelOptions"
                  :key="option.value"
                  :label="option.label"
                  :value="option.value"
                />
              </el-select>
            </div>
          </section>
          <p v-if="logLevelError" class="settings-update-status" role="alert">
            {{ logLevelError }}
          </p>
        </div>
        <div v-else class="settings-content-inner">
          <h1>账号</h1>
          <section class="settings-section" aria-label="账号设置">
            <div class="settings-row settings-account-row">
              <div class="settings-account">
                <AvatarImage :src="account?.avatar" alt="账号头像" />
                <div>
                  <strong>{{ account?.nickname || '未读取' }}</strong>
                  <span>{{ account?.id || '未读取' }}</span>
                </div>
              </div>
              <button
                class="settings-light-button"
                type="button"
                :disabled="loggingOut"
                @click="requestLogout"
              >
                {{ loggingOut ? '退出中...' : '退出登录' }}
              </button>
            </div>
            <div class="settings-row">
              <div>
                <strong>登录方式</strong>
                <span>在本机OpenChat登录或扫码登录。</span>
              </div>
              <button
                class="settings-light-button settings-login-button"
                type="button"
              >
                在手机OpenChat中确认
                <i class="settings-status-dot" aria-hidden="true">✓</i>
              </button>
            </div>
            <div class="settings-row">
              <strong>保留聊天记录</strong>
              <span class="settings-switch is-on" aria-hidden="true"
                ><i></i
              ></span>
            </div>
          </section>

          <h2>存储</h2>
          <section class="settings-section" aria-label="存储设置">
            <div class="settings-row">
              <strong>存储空间</strong>
              <button class="settings-light-button" type="button">管理</button>
            </div>
            <div class="settings-row">
              <div>
                <strong>存储位置</strong>
                <span class="settings-link">????</span>
              </div>
              <button class="settings-light-button" type="button">更改</button>
            </div>
            <div class="settings-row">
              <div class="settings-inline-label">
                <strong>自动下载小于</strong>
                <span class="settings-number">20</span>
                <strong>MB的文件</strong>
              </div>
              <span class="settings-switch is-on" aria-hidden="true"
                ><i></i
              ></span>
            </div>
            <div class="settings-row">
              <div>
                <strong>自动下载在其他设备看过的内容</strong>
                <span>内容包括「图片、视频和文件」</span>
              </div>
              <span class="settings-switch is-on" aria-hidden="true"
                ><i></i
              ></span>
            </div>
          </section>
          <div class="settings-clear-row">
            <button class="settings-light-button" type="button">
              清空全部聊天记录
            </button>
          </div>
        </div>
      </section>
    </div>
    <div
      v-if="confirmLogoutOpen"
      class="settings-dialog-mask"
      role="presentation"
      @click.self="cancelLogout"
    >
      <section
        class="settings-confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="确认退出登录"
      >
        <p>退出登录后将无法收到新消息，<br />确定退出登录?</p>
        <div class="settings-dialog-actions">
          <button
            class="settings-dialog-button settings-dialog-button--confirm"
            type="button"
            :disabled="loggingOut"
            @click="confirmLogout"
          >
            确定
          </button>
          <button
            class="settings-dialog-button settings-dialog-button--cancel"
            type="button"
            :disabled="loggingOut"
            @click="cancelLogout"
          >
            取消
          </button>
        </div>
      </section>
    </div>
  </main>
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../shared/api/api-error';
import { onMounted, ref } from 'vue';
import { ElIcon, ElOption, ElSelect } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/option/style/css';
import 'element-plus/es/components/select/style/css';
import {
  Bell,
  Close,
  InfoFilled,
  MagicStick,
  Setting,
  Top,
  User,
} from '@element-plus/icons-vue';
import type {
  LogLevel,
  SettingsAccount,
} from '../../../shared/windows/settings-window';
import AvatarImage from '../../components/avatar/AvatarImage.vue';
import packageJson from '../../../package.json';

type SettingsCategory =
  'account' | 'general' | 'shortcuts' | 'notifications' | 'plugins' | 'about';

const categories: ReadonlyArray<{
  key: SettingsCategory;
  label: string;
  icon: typeof User;
}> = [
  { key: 'account', label: '账号与存储', icon: User },
  { key: 'general', label: '通用', icon: Setting },
  { key: 'shortcuts', label: '快捷键', icon: Top },
  { key: 'notifications', label: '通知', icon: Bell },
  { key: 'plugins', label: '插件', icon: MagicStick },
  { key: 'about', label: '关于OpenChat', icon: InfoFilled },
];
const activeCategory = ref<SettingsCategory>('account');
const account = ref<SettingsAccount | null>(null);
const loggingOut = ref(false);
const confirmLogoutOpen = ref(false);
const currentVersion = ref(packageJson.version);
const updateChecking = ref(false);
const updateStatus = ref('');
const logLevel = ref<LogLevel>('info');
const savingLogLevel = ref(false);
const logLevelError = ref('');
const logLevelOptions: ReadonlyArray<{
  value: LogLevel;
  label: string;
}> = [
  { value: 'error', label: '仅错误（ERROR）' },
  { value: 'warn', label: '警告及错误（WARN）' },
  { value: 'info', label: '全部日志（INFO）' },
];

/** 关闭当前设置窗口。 */
const closeWindow = async (): Promise<void> => {
  await window.settingsDesktop?.close();
};

/** 请求版本检查，并在发现新版本后打开独立更新窗口。 */
const checkForUpdate = async (showResult: boolean): Promise<void> => {
  const settings = window.settingsDesktop;
  if (!settings || updateChecking.value) return;
  updateChecking.value = true;
  updateStatus.value = '';
  try {
    const result = await settings.checkForUpdate();
    if (!result) {
      updateStatus.value = showResult ? '当前已是最新版本' : '';
      return;
    }
    await settings.openUpdate(result);
  } catch (cause) {
    if (showResult)
      updateStatus.value = getRequestErrorMessage(
        cause,
        '检查更新失败，请稍后重试',
      );
  } finally {
    updateChecking.value = false;
  }
};

/** 读取主进程核验后的当前账号资料。 */
const loadAccount = async (): Promise<void> => {
  const settings = window.settingsDesktop;
  if (!settings) return;
  try {
    account.value = await settings.getAccount();
  } catch {
    account.value = null;
  }
};

/** 读取主进程保存的日志等级并同步到设置页。 */
const loadLogLevel = async (): Promise<void> => {
  const settings = window.settingsDesktop;
  if (!settings) return;
  try {
    logLevel.value = await settings.getLogLevel();
    logLevelError.value = '';
  } catch {
    logLevelError.value = '读取日志等级失败，请稍后重试。';
  }
};

/** 保存日志等级并立即切换主进程的日志过滤规则。 */
const saveLogLevel = async (): Promise<void> => {
  const settings = window.settingsDesktop;
  if (!settings || savingLogLevel.value) return;
  savingLogLevel.value = true;
  logLevelError.value = '';
  try {
    await settings.setLogLevel(logLevel.value);
  } catch {
    const errorMessage = '保存日志等级失败，请稍后重试。';
    try {
      logLevel.value = await settings.getLogLevel();
    } catch {
      // 保留当前选择，等待用户下次打开设置页时重新读取。
    }
    logLevelError.value = errorMessage;
  } finally {
    savingLogLevel.value = false;
  }
};

/** 打开退出登录确认弹窗。 */
const requestLogout = (): void => {
  if (!loggingOut.value) confirmLogoutOpen.value = true;
};

/** 取消退出登录，保留当前窗口和会话。 */
const cancelLogout = (): void => {
  if (!loggingOut.value) confirmLogoutOpen.value = false;
};

/** 确认退出登录，复用主进程现有会话清理流程。 */
const confirmLogout = async (): Promise<void> => {
  const settings = window.settingsDesktop;
  if (!settings || loggingOut.value) return;
  loggingOut.value = true;
  confirmLogoutOpen.value = false;
  try {
    await settings.logout();
  } catch {
    loggingOut.value = false;
  }
};

onMounted(() => {
  void loadAccount();
  void loadLogLevel();
});
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.settings-window {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: #fbfbfb;
  color: #222;
  user-select: none;
}
.settings-titlebar {
  display: grid;
  grid-template-columns: 160px minmax(0, 1fr);
  flex: 0 0 40px;
  height: 40px;
  -webkit-app-region: drag;
}
.settings-titlebar-sidebar {
  height: 100%;
  background: #f1f1f3;
}
.settings-titlebar-content {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: 100%;
  background: #fbfbfb;
}
.settings-close {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #686868;
  cursor: pointer;
  -webkit-app-region: no-drag;
}
.settings-close:hover {
  background: #e9e9e9;
  color: #222;
}
.settings-layout {
  display: flex;
  flex: 1;
  min-height: 0;
}
.settings-sidebar {
  flex: 0 0 160px;
  padding: 0 0 16px;
  background: #f1f1f3;
}
.settings-nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  height: 40px;
  padding: 0 18px;
  border: 0;
  background: transparent;
  color: #262626;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
}
.settings-nav-item:hover {
  background: #e6e6e8;
}
.settings-nav-item.is-active {
  background: #14b477;
  color: #fff;
}
.settings-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  background: #fff;
  scrollbar-color: #aaa transparent;
  scrollbar-width: thin;
}
.settings-content-inner {
  width: min(100%, 440px);
  min-height: 100%;
  padding: 9px 40px 40px;
}
.settings-about {
  min-height: 100%;
  padding: 20px 18px;
}
.settings-about-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}
.settings-about-row strong,
.settings-about-row span {
  display: block;
  font-weight: 400;
  line-height: 20px;
}
.settings-update-status {
  margin: 12px 0 0;
  color: #777;
  font-size: 12px;
  line-height: 18px;
}
.settings-about-row strong {
  font-size: 14px;
}
.settings-about-row span {
  color: #999;
  font-size: 12px;
}
.settings-content h1,
.settings-content h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 31px;
}
.settings-content h2 {
  margin-top: 34px;
}
.settings-section {
  border-top: 1px solid #ededed;
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 62px;
  border-bottom: 1px solid #ededed;
  font-size: 14px;
}
.settings-row > div {
  min-width: 0;
}
.settings-log-level-select {
  flex: 0 0 168px;
  width: 168px;
}
.settings-row strong,
.settings-row span {
  display: block;
  font-weight: 400;
  line-height: 20px;
}
.settings-row span:not(.settings-switch):not(.settings-status-dot) {
  color: #999;
  font-size: 12px;
}
.settings-account-row {
  min-height: 62px;
}
.settings-account {
  display: flex;
  align-items: center;
  gap: 10px;
}
.settings-account img {
  width: 42px;
  height: 42px;
  border-radius: 5px;
  object-fit: cover;
}
.settings-account strong {
  font-size: 14px;
}
.settings-account span {
  color: #999;
  font-size: 12px;
}
.settings-light-button {
  flex: 0 0 auto;
  min-width: 48px;
  height: 26px;
  padding: 0 11px;
  border: 0;
  border-radius: 6px;
  background: #f0f0f0;
  color: #333;
  font-size: 12px;
  cursor: pointer;
}
.settings-light-button:disabled {
  color: #999;
  opacity: 0.75;
}
.settings-login-button {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
}
.settings-status-dot {
  display: inline-grid !important;
  place-items: center;
  width: 15px;
  height: 15px;
  border-radius: 4px;
  background: #10bd7a;
  color: #fff !important;
  font-size: 11px !important;
  line-height: 15px !important;
}
.settings-link {
  color: #4776b4 !important;
}
.settings-inline-label {
  display: flex !important;
  align-items: center;
  gap: 6px;
}
.settings-number {
  display: inline-block !important;
  min-width: 34px;
  height: 26px;
  padding: 3px 6px;
  border: 1px solid #dedede;
  border-radius: 5px;
  background: #fff;
  color: #444 !important;
  text-align: center;
}
.settings-clear-row {
  display: flex;
  justify-content: flex-end;
  padding-top: 12px;
}
.settings-switch {
  position: relative;
  display: block !important;
  flex: 0 0 28px;
  width: 28px;
  height: 16px;
  border-radius: 9px;
  background: #c9c9c9;
}
.settings-switch.is-on {
  background: #0cc47b;
}
.settings-switch i {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 1px 2px rgb(0 0 0 / 16%);
}
.settings-switch.is-on i {
  left: 14px;
}
.settings-dialog-mask {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgb(255 255 255 / 12%);
}
.settings-confirm-dialog {
  width: 284px;
  min-height: 164px;
  padding: 28px 24px 24px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 5px 18px rgb(0 0 0 / 12%);
  color: #222;
}
.settings-confirm-dialog p {
  margin: 0;
  font-size: 14px;
  line-height: 21px;
  text-align: center;
}
.settings-dialog-actions {
  display: flex;
  gap: 8px;
  margin-top: 25px;
}
.settings-dialog-button {
  flex: 1;
  height: 30px;
  border: 0;
  border-radius: 6px;
  font-size: 13px;
  cursor: pointer;
}
.settings-dialog-button--confirm {
  background: #00c676;
  color: #fff;
}
.settings-dialog-button--cancel {
  background: #ededed;
  color: #333;
}
.settings-dialog-button:hover,
.settings-light-button:hover {
  filter: brightness(0.97);
}
.settings-dialog-button:disabled,
.settings-light-button:disabled {
  cursor: default;
  filter: none;
}
</style>
