<template>
  <button
    ref="element"
    type="button"
    class="chat-avatar chat-avatar--contact"
    :title="resolveMessageName(uid, roomId ?? '', contact)"
    aria-label="刷新对方资料"
    @click="refreshContact"
  >
    <img
      :key="`${uid}:${imageSource}`"
      :src="imageSource"
      alt=""
      loading="lazy"
      decoding="async"
      draggable="false"
      @error="handleImageError"
    />
  </button>
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../services/runtime/public-assets';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Contact } from '../../../shared/storage/database';
import { resolveMessageName } from '../../../shared/chat/messages/recall-message';

const props = defineProps<{
  uid: string;
  contact?: Contact;
  roomId?: string;
}>();
const emit = defineEmits<{
  (event: 'needed', uid: string): void;
  (event: 'refresh', uid: string): void;
}>();
const element = ref<HTMLButtonElement>();
const visible = ref(false);
const failedSource = ref<string | null>(null);
const avatarSource = computed(
  (): string => props.contact?.avatar || DEFAULT_AVATAR_URL,
);
const imageSource = computed((): string =>
  failedSource.value === avatarSource.value
    ? DEFAULT_AVATAR_URL
    : avatarSource.value,
);
let observer: IntersectionObserver | undefined;

/** 头像加载失败时使用本地默认图，不因图片失败循环请求用户资料。 */
const handleImageError = (): void => {
  if (imageSource.value !== DEFAULT_AVATAR_URL)
    failedSource.value = avatarSource.value;
};

/** 点击头像时允许重试原图片，同时请求刷新对方公开资料。 */
const refreshContact = (): void => {
  failedSource.value = null;
  emit('refresh', props.uid);
};

watch([() => props.uid, avatarSource], () => {
  failedSource.value = null;
});
watch([() => props.uid, visible, () => props.roomId], (): void => {
  if (props.uid && visible.value) emit('needed', props.uid);
});
onMounted(() => {
  const target: Element | undefined = element.value;
  if (!target) return;

  observer = new IntersectionObserver((entries) => {
    const entry = entries.find((item) => item.target === target);
    if (entry) visible.value = entry.isIntersecting;
  });
  observer.observe(target);
});
onBeforeUnmount(() => {
  observer?.disconnect();
});
</script>
