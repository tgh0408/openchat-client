<template>
  <span class="system-message-content">
    <template v-if="invitation">
      <span class="system-message-name">{{ invitation.inviterName }}</span
      >{{ ' 邀请 '
      }}<span class="system-message-name">{{ invitation.memberName }}</span
      >{{ ' 进入了群聊' }}
    </template>
    <template v-else-if="removal">
      <span v-if="removal.memberUid === userId">你</span>
      <span v-else class="system-message-name">{{ removal.memberName }}</span
      >{{ removal.memberUid === userId ? '被 ' : ' 被 '
      }}<span class="system-message-name">{{ removal.operatorName }}</span
      >{{ ' 移出群聊' }}
    </template>
    <template v-else>{{ content }}</template>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  parseGroupInvitationMessage,
  parseGroupRemovalMessage,
} from '../../../../shared/chat/messages/system-message';

const props = defineProps<{ content: string; userId?: string }>();
const invitation = computed(() => parseGroupInvitationMessage(props.content));
const removal = computed(() => parseGroupRemovalMessage(props.content));
</script>

<style scoped>
.system-message-content {
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.system-message-name {
  color: #405b91;
}
</style>
