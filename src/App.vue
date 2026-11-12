<template>
  <component
    :is="workspace"
    v-if="workspace && session"
    :initial-session="session"
    @logged-out="returnToLogin"
  />
  <LoginWindow v-else :notice="notice" @entered="enterWorkspace" />
</template>

<script setup lang="ts">
import { shallowRef, ref } from 'vue';
import type { Component } from 'vue';
import type { AuthSession } from '../shared/auth/auth';
import LoginWindow from './pages/login/LoginWindow.vue';

const workspace = shallowRef<Component | null>(null);
const session = shallowRef<AuthSession | null>(null);
const notice = ref('');

/** 浏览器预览在同一页面挂载独立工作台，不伪装原生窗口。 */
const enterWorkspace = async (value: AuthSession): Promise<void> => {
  try {
    workspace.value = (
      await import('./pages/workspace/WorkspaceWindow.vue')
    ).default;
    session.value = value;
    notice.value = '';
  } catch {
    notice.value = '聊天页面加载失败，请重试';
  }
};

/** 浏览器退出后释放工作台组件，重新挂载登录入口。 */
const returnToLogin = (message: string = ''): void => {
  session.value = null;
  workspace.value = null;
  notice.value = message;
};
</script>
