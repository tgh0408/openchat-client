<template>
  <UpdateVersionDialog
    v-if="open"
    :release="previewRelease"
    @ignore="closePreview"
    @later="closePreview"
  />
  <el-button v-else @click="open = true">查看更新</el-button>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ElButton } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import UpdateVersionDialog from './UpdateVersionDialog.vue';
import type { UpdateRelease } from './UpdateVersionDialog.vue';

// 参考图文案仅供独立页面预览，不代表已检测到可用更新。
const previewRelease: UpdateRelease = {
  appName: 'OpenChat',
  version: '',
  description: [
    '图片视频可以合并发送；',
    '表情可以预览动态效果；',
    '修复一些已知问题。',
  ],
};
const open = ref(true);

/** 只关闭预览，不保存忽略版本或创建提醒任务。 */
const closePreview = (): void => {
  open.value = false;
};
</script>
