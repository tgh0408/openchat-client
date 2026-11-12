<template>
  <UpdateVersionDialog
    v-if="release"
    :release="{
      appName: 'OpenChat',
      version: release.version,
      description: release.updateInfo,
      releaseId: release.releaseId,
    }"
    :busy="downloading"
    :progress="progress"
    :status-message="status"
    :update-disabled="updating"
    @ignore="closeWindow"
    @later="closeWindow"
    @update="downloadUpdate"
    @cancel="cancelUpdate"
  />
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { UpdateReleaseInfo } from '../../../shared/update/update';
import UpdateVersionDialog from './UpdateVersionDialog.vue';

const release = ref<UpdateReleaseInfo | null>(null);
const downloading = ref(false);
const updating = ref(false);
const progress = ref(0);
const status = ref('');
let unsubscribeUpdateProgress: (() => void) | undefined;

/** 关闭当前更新窗口，不影响设置窗口。 */
const closeWindow = async (): Promise<void> => {
  if (downloading.value) return;
  await window.updateDesktop?.close();
};

/** 处理更新窗口中的安装包下载。 */
const downloadUpdate = async (): Promise<void> => {
  const update = window.updateDesktop;
  if (!update || !release.value || updating.value) return;
  updating.value = true;
  progress.value = 0;
  status.value = '';
  try {
    if (!(await update.downloadUpdate())) return;
    progress.value = 100;
    status.value = '安装程序已启动，客户端即将退出';
  } catch (cause) {
    status.value = cause instanceof Error ? cause.message : '下载失败，请重试';
  } finally {
    downloading.value = false;
    updating.value = false;
  }
};

/** 取消安装包下载并保留当前更新窗口。 */
const cancelUpdate = async (): Promise<void> => {
  await window.updateDesktop?.cancelUpdate().catch(() => undefined);
  downloading.value = false;
  status.value = '下载已取消';
};

/** 读取主进程绑定的发布版本并初始化进度订阅。 */
const loadRelease = async (): Promise<void> => {
  try {
    release.value = (await window.updateDesktop?.getRelease()) ?? null;
  } catch (cause) {
    status.value = cause instanceof Error ? cause.message : '更新信息读取失败';
  }
};

onMounted(() => {
  unsubscribeUpdateProgress = window.updateDesktop?.onUpdateProgress(
    (updateProgress) => {
      progress.value = updateProgress.percent;
      downloading.value = updateProgress.status === 'downloading';
    },
  );
  void loadRelease();
});

onBeforeUnmount(() => {
  unsubscribeUpdateProgress?.();
});
</script>

<style>
html,
body,
#app {
  width: 100%;
  height: 100%;
  overflow: hidden;
}
</style>
