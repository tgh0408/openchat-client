<template>
  <main class="update-confirm-window" aria-labelledby="update-confirm-title">
    <header class="update-confirm-titlebar">
      <span id="update-confirm-title">新版本</span>
      <span class="update-confirm-version">{{ version }}</span>
      <button
        class="update-confirm-close"
        type="button"
        title="以后再说"
        aria-label="以后再说"
        :disabled="responding"
        @click="respond(false)"
      >
        <el-icon :size="16"><Close /></el-icon>
      </button>
    </header>
    <section class="update-confirm-content">
      <p>OpenChat正在运行，请问是否关闭OpenChat立即升级?</p>
      <p v-if="error" class="update-confirm-error" role="alert">{{ error }}</p>
    </section>
    <footer class="update-confirm-actions">
      <button
        class="update-confirm-action update-confirm-action--primary"
        type="button"
        :disabled="!ready || responding"
        @click="respond(true)"
      >
        立即升级
      </button>
      <button
        class="update-confirm-action"
        type="button"
        :disabled="responding"
        @click="respond(false)"
      >
        以后再说
      </button>
    </footer>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { Close } from '@element-plus/icons-vue';

const version = ref('');
const error = ref('');
const ready = ref(false);
const responding = ref(false);

/** 只回传选择，关闭进程及下载由主进程在重新校验后继续。 */
const respond = async (confirmed: boolean): Promise<void> => {
  const desktop = window.updateConfirmDesktop;
  if (!desktop || responding.value || (confirmed && !ready.value)) return;
  responding.value = true;
  try {
    await desktop.respond(confirmed);
  } catch (cause) {
    responding.value = false;
    error.value = cause instanceof Error ? cause.message : '操作失败，请重试';
  }
};

/** 获取主进程绑定的版本，不初始化登录或访问账号数据库。 */
const loadVersion = async (): Promise<void> => {
  try {
    const desktop = window.updateConfirmDesktop;
    if (!desktop) throw new Error('请在桌面客户端中确认升级');
    version.value = await desktop.getVersion();
    ready.value = true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '版本信息读取失败';
  }
};

/** Escape 与以后再说一致，仅取消当前确认。 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') void respond(false);
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  void loadVersion();
});
onBeforeUnmount(() => window.removeEventListener('keydown', handleKeydown));
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.update-confirm-window {
  display: grid;
  grid-template-rows: 45px minmax(0, 1fr) auto;
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: #1f1f1f;
  background: #f7f7f7;
  border: 1px solid #d8d8d8;
}

.update-confirm-titlebar {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 0 23px;
  font-size: 13px;
  line-height: 20px;
  -webkit-app-region: drag;
}

.update-confirm-version {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-confirm-close {
  display: grid;
  flex: 0 0 26px;
  place-items: center;
  width: 26px;
  height: 26px;
  margin-left: auto;
  padding: 0;
  border: 0;
  color: #4a4a4a;
  background: transparent;
  cursor: pointer;
}

.update-confirm-close:hover {
  background: #e8e8e8;
}

.update-confirm-content {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  min-height: 0;
  padding: 8px 23px;
  overflow: auto;
  text-align: center;
}

.update-confirm-content p {
  margin: 0;
  font-size: 16px;
  line-height: 24px;
  overflow-wrap: anywhere;
}

.update-confirm-content .update-confirm-error {
  color: #b42318;
  font-size: 12px;
  line-height: 18px;
}

.update-confirm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 14px;
  padding: 17px 23px;
}

.update-confirm-action {
  width: 100px;
  height: 36px;
  padding: 4px 6px;
  border: 1px solid #d8d8d8;
  border-radius: 2px;
  color: #303030;
  background: #d8d8db;
  font-size: 16px;
  line-height: 24px;
  cursor: pointer;
}

.update-confirm-action:hover:not(:disabled) {
  background: #ceced1;
}

.update-confirm-action--primary {
  color: #fff;
  border-color: #35c93a;
  background: #35c93a;
}

.update-confirm-action--primary:hover:not(:disabled) {
  background: #2cb331;
}

.update-confirm-window button:focus-visible {
  outline: 2px solid #087a52;
  outline-offset: 2px;
}

.update-confirm-window button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
