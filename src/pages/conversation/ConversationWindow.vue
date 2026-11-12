<template>
  <main class="desktop-window desktop-window--chat conversation-window">
    <ChatWorkspace
      v-if="context"
      :session="session!"
      :detached="context.conversation"
      :logging-out="false"
      :session-error="''"
      :read-only="false"
      @close="close"
    />
    <div v-else class="conversation-loading">
      <p>{{ error || '正在读取...' }}</p>
      <button v-if="error" @click="load">重试</button>
      <button @click="close">关闭</button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ChatWorkspace from '../workspace/ChatWorkspace.vue';
import type { AuthSession } from '../../../shared/auth/auth';
import type { ConversationWindowContext } from '../../../shared/windows/conversation-window';

const context = ref<ConversationWindowContext>();
const error = ref('');
// 复用工作台的用户展示类型；子窗口从未接收 JWT，所有操作由主进程原授权校验。
const session = computed<Pick<AuthSession, 'user'> | undefined>(() =>
  context.value
    ? {
        user: context.value.user,
      }
    : undefined,
);

/** 只读取窗口绑定的会话，不恢复账号或初始化数据库。 */
const load = async (): Promise<void> => {
  error.value = '';
  try {
    if (!window.conversationDesktop)
      throw new Error('独立聊天需使用桌面客户端');
    context.value = await window.conversationDesktop.context();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : '读取会话失败';
  }
};
/** 只关闭当前聊天窗。 */
const close = (): void => {
  void window.desktop?.close();
};
onMounted(load);
</script>

<style>
.conversation-window .chat-workspace {
  grid-template-columns: minmax(0, 1fr);
  padding: 0;
}
.conversation-window .chat-content {
  display: flex;
  border-radius: 0;
}
.conversation-window .chat-titlebar {
  background: #f8f8f8;
}
.conversation-window .chat-brand {
  display: none;
}
.conversation-window .chat-window-heading {
  padding-left: 12px;
}
.conversation-window .chat-mobile-back {
  display: none;
}
.conversation-loading {
  padding: 24px;
}
</style>
