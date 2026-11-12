<template>
  <img
    :key="imageSource"
    :src="imageSource"
    :alt="alt"
    draggable="false"
    @error="handleError"
  />
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../services/runtime/public-assets';
import { computed, ref, watch } from 'vue';

const props = withDefaults(
  defineProps<{
    src?: string | null;
    alt?: string;
  }>(),
  { src: null, alt: '' },
);
const fallbackSource = DEFAULT_AVATAR_URL;
const failedSource = ref<string | null>(null);
const source = computed((): string => props.src?.trim() || fallbackSource);
const imageSource = computed((): string =>
  failedSource.value === source.value ? fallbackSource : source.value,
);

/** OSS 头像加载失败时回退默认图，不影响页面其他功能。 */
const handleError = (): void => {
  if (imageSource.value !== fallbackSource) failedSource.value = source.value;
};

watch(source, (): void => {
  failedSource.value = null;
});
</script>
