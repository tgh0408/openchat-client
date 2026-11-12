<template>
  <MessageQuote
    :message="message"
    :sender="sender"
    cancelable
    @cancel="emit('cancel')"
  />
</template>

<script setup lang="ts">
import type { Message } from '../../../../shared/storage/database';
import MessageQuote from '../messages/MessageQuote.vue';

defineProps<{ message: Message; sender: string }>();
const emit = defineEmits<{ cancel: [] }>();
</script>
