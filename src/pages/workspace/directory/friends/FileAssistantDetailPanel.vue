<template>
  <section
    class="file-assistant-detail"
    aria-label="文件助手资料"
    :aria-busy="opening"
  >
    <header class="file-assistant-toolbar">
      <button
        type="button"
        class="chat-small-button chat-mobile-back"
        title="返回通讯录"
        aria-label="返回通讯录"
        @click="emit('back')"
      >
        <el-icon><ArrowLeft /></el-icon>
      </button>
    </header>
    <div class="file-assistant-scroll">
      <div class="file-assistant-body">
        <div class="file-assistant-identity">
          <span class="file-assistant-avatar" aria-hidden="true">
            <el-icon :size="44"><FolderOpened /></el-icon>
          </span>
          <h1>文件传输助手</h1>
        </div>
        <div class="file-assistant-actions">
          <button
            type="button"
            class="file-assistant-message"
            :disabled="disabled || opening"
            @click="emit('message')"
          >
            <el-icon :size="27"><ChatDotRound /></el-icon>
            <span>{{ opening ? '正在打开...' : '发送消息' }}</span>
          </button>
        </div>
        <p v-if="error" class="file-assistant-error" role="alert">
          {{ error }}
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { ArrowLeft, ChatDotRound, FolderOpened } from '@element-plus/icons-vue';

defineProps<{
  opening: boolean;
  disabled: boolean;
  error: string;
}>();
const emit = defineEmits<{ back: []; message: [] }>();
</script>

<style scoped>
.file-assistant-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background: #fafafa;
}

.file-assistant-toolbar {
  display: none;
  align-items: center;
  min-height: 52px;
  padding: 8px 20px;
}

.file-assistant-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.file-assistant-body {
  width: min(100%, 460px);
  margin: 0 auto;
  padding: 60px 32px 30px;
}

.file-assistant-identity {
  display: flex;
  align-items: center;
  gap: 16px;
  padding-bottom: 24px;
}

.file-assistant-avatar {
  display: grid;
  place-items: center;
  flex: 0 0 72px;
  width: 72px;
  height: 72px;
  border-radius: 7px;
  background: #12aa76;
  color: #fff;
}

.file-assistant-identity h1 {
  min-width: 0;
  margin: 0;
  color: #222226;
  font-size: 21px;
  font-weight: 500;
  line-height: 1.4;
  overflow-wrap: anywhere;
}

.file-assistant-actions {
  display: flex;
  justify-content: center;
  padding-top: 24px;
  border-top: 1px solid #eeeeef;
}

.file-assistant-message {
  display: flex;
  align-items: center;
  flex-direction: column;
  gap: 10px;
  min-width: 112px;
  min-height: 78px;
  padding: 8px 12px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #31549b;
  font-size: 14px;
  cursor: pointer;
}

.file-assistant-message:hover:not(:disabled) {
  background: #edf2f8;
}

.file-assistant-message:disabled {
  color: #98989e;
  cursor: default;
}

.file-assistant-error {
  color: #b74c42;
  font-size: 13px;
  overflow-wrap: anywhere;
}

@media (max-width: 689px) {
  .file-assistant-toolbar {
    display: flex;
  }

  .file-assistant-body {
    padding: 26px 20px;
  }
}
</style>
