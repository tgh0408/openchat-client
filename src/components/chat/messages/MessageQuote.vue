<template>
  <div
    class="composer-reply"
    :class="{
      'composer-reply--media': message.messageType !== 'text',
      'message-quote--compact': compact,
    }"
    role="group"
    aria-label="引用消息"
  >
    <span class="composer-reply-name" :title="sender">{{ sender }}:</span>
    <span
      v-if="message.messageType === 'text'"
      class="composer-reply-content"
      :title="message.content"
      >{{ message.content.replace(/\s+/g, ' ') }}</span
    >
    <div v-else class="composer-reply-media">
      <ImageMessage
        v-if="message.messageType === 'image'"
        :content="message.content"
        :conversation-id="message.conversationId"
        :message-id="message.id"
        auto-download
      />
      <VideoMessage
        v-else-if="message.messageType === 'video'"
        :message="message"
        :read-only="disabled"
      />
      <FileMessage
        v-else-if="message.messageType === 'file'"
        :message="message"
        :read-only="disabled"
        :show-cancelled-label="false"
      />
      <VoiceMessage
        v-else-if="message.messageType === 'audio'"
        :message="message"
        :disabled="disabled"
      />
      <EmojiMessage
        v-else-if="message.messageType === 'emoji'"
        :content="message.content"
      />
    </div>
    <button
      v-if="cancelable"
      type="button"
      class="composer-reply-cancel"
      title="取消引用"
      aria-label="取消引用"
      @click="emit('cancel')"
    >
      <Close />
    </button>
  </div>
</template>

<script setup lang="ts">
import { Close } from '@element-plus/icons-vue';
import type { Message } from '../../../../shared/storage/database';
import ImageMessage from './ImageMessage.vue';
import VideoMessage from './VideoMessage.vue';
import FileMessage from './FileMessage.vue';
import VoiceMessage from './VoiceMessage.vue';
import EmojiMessage from './EmojiMessage.vue';

defineProps<{
  message: Message;
  sender: string;
  cancelable?: boolean;
  compact?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ cancel: [] }>();
</script>

<style scoped>
.composer-reply {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: 4px;
  height: 24px;
  flex-shrink: 0;
  box-sizing: border-box;
  max-width: calc(100% - 3px);
  min-width: 0;
  margin: 0 0 4px 3px;
  padding-left: 8px;
  border-left: 2px solid #dedee2;
  color: #92929b;
  font-size: 12px;
}
.composer-reply--media {
  height: 72px;
}
.composer-reply-name {
  max-width: 35%;
  flex-shrink: 0;
}
.composer-reply-name,
.composer-reply-content {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-reply-content {
  min-width: 0;
}
.composer-reply-media {
  min-width: 0;
  max-width: 228px;
  max-height: 72px;
  overflow: auto;
}
.composer-reply-media :deep(.message-image) {
  width: 96px;
}
.composer-reply-media :deep(.message-image-status) {
  gap: 2px;
  padding: 2px;
  overflow: auto;
  font-size: 11px;
}
.composer-reply-media :deep(.message-image-status > .el-icon) {
  font-size: 16px !important;
  flex-shrink: 0;
}
.composer-reply-media :deep(.message-image-status button) {
  min-height: 20px;
  padding: 2px;
}
.composer-reply-media :deep(.message-emoji) {
  width: 72px;
}
.composer-reply-media :deep(.video-message-card) {
  box-sizing: border-box;
  max-width: min(128px, 100%);
  max-height: 72px;
}
.composer-reply-media :deep(.video-message-action) {
  width: 24px;
  height: 24px;
  top: 10px;
  left: calc(50% - 12px);
}
.composer-reply-media :deep(.video-message-action svg),
.composer-reply-media :deep(.video-message-placeholder svg) {
  width: 18px;
  height: 18px;
}
.composer-reply-media :deep(.video-message-state) {
  top: 36px;
  bottom: auto;
  font-size: 10px;
  line-height: 14px;
}
.composer-reply-media :deep(.video-message-duration) {
  bottom: 2px;
  right: 3px;
  font-size: 10px;
  line-height: 14px;
}
.composer-reply-media :deep(.file-attachment-card) {
  height: 44px;
  gap: 8px;
  padding: 5px 10px;
}
.composer-reply-media :deep(.file-attachment-name) {
  font-size: 12px;
  line-height: 16px;
}
.composer-reply-media :deep(.file-attachment-size) {
  font-size: 11px;
  line-height: 14px;
}
.composer-reply-media :deep(.file-attachment-icon) {
  height: 30px;
}
.composer-reply-media :deep(.file-message-icon-action) {
  top: 8px;
}
.composer-reply-media :deep(.file-message-status) {
  min-height: 24px;
  margin-top: 2px;
}
.composer-reply-cancel {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 5px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #96969e;
  cursor: pointer;
}
.composer-reply-cancel:hover,
.composer-reply-cancel:focus-visible {
  background: #e8e8eb;
  color: #45454c;
}
.composer-reply-cancel svg {
  width: 14px;
  height: 14px;
}
.message-quote--compact {
  align-self: auto;
  height: auto;
  min-height: 24px;
  max-width: 100%;
  margin: 2px 0 0;
}
.message-quote--compact .composer-reply-content {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  line-height: 18px;
}
.message-quote--compact .composer-reply-media :deep(.message-image) {
  width: 54px;
}
.message-quote--compact .composer-reply-media :deep(.message-emoji) {
  width: 40px;
}
.message-quote--compact .composer-reply-media :deep(p) {
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 12px;
}
</style>
