<template>
  <main class="avatar-crop-window">
    <AvatarCropEditor
      v-if="bytes"
      :bytes="bytes"
      :save="save"
      :show-heading="false"
      @cancel="cancel"
    />
    <div v-else class="avatar-crop-status">
      <p role="status">{{ error || '正在加载头像' }}</p>
      <el-button @click="cancel">取消</el-button>
    </div>
  </main>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, ref } from 'vue';
import { ElButton } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import AvatarCropEditor from '../../components/avatar-crop/AvatarCropEditor.vue';

const bytes = shallowRef<Uint8Array<ArrayBufferLike>>();
const error = ref('');
let disposed = false;

/** 只从本窗口专属桥接取得选图，不启动认证或数据库。 */
const load = async (): Promise<void> => {
  try {
    if (!window.avatarCropDesktop) throw new Error('请从注册页选择头像');
    const result = await window.avatarCropDesktop.read();
    if (!disposed) bytes.value = result;
  } catch (cause) {
    if (!disposed)
      error.value = cause instanceof Error ? cause.message : '头像加载失败';
  }
};

/** 主进程再次校验裁剪图，成功后销毁窗口并回填注册表单。 */
const save = async (value: Uint8Array<ArrayBufferLike>): Promise<void> => {
  if (!window.avatarCropDesktop) throw new Error('裁剪窗口不可用');
  await window.avatarCropDesktop.confirm(value);
};

/** 取消不替换注册表单原来的头像。 */
const cancel = async (): Promise<void> => {
  try {
    await window.avatarCropDesktop?.cancel();
  } catch (cause) {
    if (!disposed)
      error.value = cause instanceof Error ? cause.message : '关闭失败';
  }
};

onMounted(load);
onBeforeUnmount((): void => {
  disposed = true;
  bytes.value = undefined;
});
</script>

<style scoped>
.avatar-crop-window {
  width: 100%;
  height: 100dvh;
  overflow: auto;
  background: #f9f9f9;
}
.avatar-crop-window :deep(.avatar-crop-editor) {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.avatar-crop-window :deep(.avatar-crop-viewport),
.avatar-crop-window :deep(.avatar-crop-controls),
.avatar-crop-window :deep(footer) {
  flex-shrink: 0;
}
.avatar-crop-window :deep(.avatar-crop-error) {
  flex: 1;
  overflow: auto;
}
.avatar-crop-status {
  padding: 24px;
  font-size: 14px;
}
</style>
