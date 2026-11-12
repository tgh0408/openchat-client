<template>
  <MessageJumpButton
    class="reply-return-button"
    label="回到引用位置"
    :busy="busy"
    @jump="emit('return')"
  />
</template>

<script setup lang="ts">
import MessageJumpButton from './MessageJumpButton.vue';

defineProps<{ busy?: boolean }>();
const emit = defineEmits<{ return: [] }>();
</script>
