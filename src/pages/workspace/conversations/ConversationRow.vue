<template>
  <button
    type="button"
    class="chat-conversation"
    :class="{ 'is-selected': selected }"
    :aria-pressed="selected"
    :data-conversation-id="conversation.id"
    :draggable="false"
  >
    <span class="chat-conversation-avatar">
      <span class="chat-avatar" :class="avatarClass">
        <el-icon v-if="conversation.type === FILE_ASSISTANT_TYPE" :size="27">
          <FolderOpened />
        </el-icon>
        <GroupAvatar
          v-else-if="conversation.type === 1 && group"
          :group="group"
          class="chat-conversation-group-avatar"
        />
        <AvatarImage
          v-else-if="conversation.avatar"
          :src="conversation.avatar"
        />
        <span v-else>{{ conversation.title.slice(0, 1) }}</span>
      </span>
      <span
        v-if="conversation.unreadCount > 0"
        class="chat-unread-badge"
        :class="{ 'chat-unread-badge--muted': conversation.notDisturb === 1 }"
        :aria-label="`${conversation.unreadCount} 条未读消息`"
        >{{
          conversation.unreadCount > 99 ? '99+' : conversation.unreadCount
        }}</span
      >
    </span>
    <span class="chat-conversation-copy">
      <span class="chat-conversation-top">
        <span class="chat-conversation-name" :title="name">{{ name }}</span>
        <el-icon
          v-if="conversation.notDisturb === 1"
          class="chat-conversation-muted"
          title="消息免打扰"
          aria-label="消息免打扰"
          :size="14"
          ><MuteNotification
        /></el-icon>
        <time v-if="summary">{{ formatTime(conversation.updatedAt) }}</time>
      </span>
      <span v-if="summary" class="chat-conversation-preview">{{
        summary
      }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { FolderOpened, MuteNotification } from '@element-plus/icons-vue';
import type {
  Contact,
  Conversation,
} from '../../../../shared/storage/database';
import type { GroupDirectoryItem } from '../../../../shared/contacts/group';
import { FILE_ASSISTANT_TYPE } from '../../../../shared/chat/chat';
import { groupDisplayName } from '../../../../shared/contacts/group-name';
import {
  formatMessagePreview,
  type MessagePreview,
} from '../../../services/chat/messages/message-preview';
import AvatarImage from '../../../components/avatar/AvatarImage.vue';
import GroupAvatar from '../../../components/avatar/GroupAvatar.vue';

const props = defineProps<{
  conversation: Conversation;
  preview?: MessagePreview;
  contact?: Contact;
  group?: GroupDirectoryItem;
  selected: boolean;
  userId: string;
  userNickname: string;
  formatTime: (value: string) => string;
}>();

/** 只依赖本行的摘要和联系人，其他会话更新不重新计算名称和正文。 */
const summary = computed((): string =>
  formatMessagePreview(
    props.preview,
    props.conversation.id,
    props.userId,
    props.userNickname,
    props.contact,
  ),
);

/** 文件助手沿用固定显示名，其余会话使用真实标题。 */
const name = computed((): string => {
  switch (props.conversation.type) {
    case FILE_ASSISTANT_TYPE:
      return '文件传输助手';
    case 1:
      return props.group
        ? groupDisplayName(props.group)
        : props.conversation.title;
    default:
      return props.conversation.title;
  }
});

/** 按会话类型沿用原头像配色，不改变头像加载流程。 */
const avatarClass = computed((): string => {
  switch (true) {
    case props.conversation.type === FILE_ASSISTANT_TYPE:
      return 'chat-avatar--files';
    default:
      return 'chat-avatar--contact';
  }
});
</script>

<style scoped>
.chat-unread-badge--muted {
  background: #9b9b9f;
}
.chat-conversation-muted {
  flex-shrink: 0;
  color: #98989e;
}
.is-selected .chat-conversation-muted {
  color: #e0f5ed;
}
</style>
