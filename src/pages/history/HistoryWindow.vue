<template>
  <ChatHistory
    v-if="context"
    :conversation-id="context.conversationId"
    :conversation-title="context.conversationTitle"
    :user-id="context.userId"
    :search-messages="searchMessages"
    @close="closeWindow"
    @minimize="minimizeWindow"
  />
  <main v-else class="chat-history-window" aria-label="聊天记录窗口">
    <header class="history-titlebar">
      <h1>聊天记录</h1>
      <div class="window-actions">
        <button
          class="icon-button close-button"
          title="关闭"
          aria-label="关闭历史窗口"
          @click="closeWindow"
        >
          <el-icon><Close /></el-icon>
        </button>
      </div>
    </header>
    <div class="history-empty" role="status">
      <span>{{ error || '正在读取...' }}</span>
      <el-button v-if="error && historyApi" link @click="initialize"
        >重试</el-button
      >
    </div>
  </main>
  <div v-if="context && error" class="history-window-error" role="alert">
    {{ error }}
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElButton, ElIcon } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import { Close } from '@element-plus/icons-vue';
import type { HistoryWindowContext } from '../../../shared/windows/desktop';
import type { HistoryQuery, Message } from '../../../shared/storage/database';
import ChatHistory from './ChatHistory.vue';

const historyApi = window.historyDesktop;
const context = ref<HistoryWindowContext>();
const error = ref('');

/** 从专属只读桥接获取会话上下文，不启动登录和数据空间初始化。 */
const initialize = async (): Promise<void> => {
  error.value = '';
  if (!historyApi) {
    error.value = '请从 Electron 主窗口打开聊天记录';
    return;
  }
  try {
    context.value = await historyApi.getContext();
    document.title = `与“${context.value.conversationTitle}”的聊天记录`;
  } catch {
    error.value = '读取会话失败，请关闭后重新打开';
  }
};

/** 历史搜索通过独立桥接，查询权限由主进程绑定到当前窗口。 */
const searchMessages = async (query: HistoryQuery): Promise<Message[]> => {
  if (!historyApi) throw new Error('历史窗口接口不可用');
  return historyApi.searchMessages(query);
};

/** 关闭历史窗口自身，不发送主窗口的关闭事件。 */
const closeWindow = async (): Promise<void> => {
  try {
    if (historyApi) await historyApi.close();
    else window.close();
  } catch {
    error.value = '关闭窗口失败，请重试';
  }
};

/** 最小化历史窗口自身，保留主窗口的当前状态。 */
const minimizeWindow = async (): Promise<void> => {
  try {
    await historyApi?.minimize();
  } catch {
    error.value = '最小化失败，请重试';
  }
};

onMounted(() => {
  void initialize();
});
</script>
