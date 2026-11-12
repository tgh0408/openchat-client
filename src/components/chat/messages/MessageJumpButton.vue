<template>
  <button
    type="button"
    class="message-jump-button"
    :disabled="busy || disabled"
    :aria-busy="busy"
    :title="label"
    @click="emit('jump')"
  >
    <Loading v-if="busy" class="is-loading" />
    <DArrowRight v-else class="message-jump-arrow" />
    <span>{{ label }}</span>
  </button>
</template>

<script setup lang="ts">
import { DArrowRight, Loading } from '@element-plus/icons-vue';

defineProps<{ label: string; busy?: boolean; disabled?: boolean }>();
const emit = defineEmits<{ jump: [] }>();
</script>

<style scoped>
.message-jump-button {
  position: absolute;
  z-index: 4;
  right: 16px;
  bottom: var(--message-jump-bottom, 16px);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  max-width: calc(100% - 32px);
  padding: 0 12px;
  border: 1px solid #e6e6e6;
  border-radius: 16px;
  background: #fff;
  color: #20b660;
  box-shadow: 0 2px 12px #0000001a;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}
.message-jump-button svg {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.message-jump-button span {
  overflow: hidden;
  text-overflow: ellipsis;
}
.message-jump-arrow {
  transform: rotate(90deg);
}
.message-jump-button:focus-visible {
  outline: 2px solid #20b660;
  outline-offset: 2px;
}
.message-jump-button:disabled {
  cursor: default;
  opacity: 0.6;
}
</style>
