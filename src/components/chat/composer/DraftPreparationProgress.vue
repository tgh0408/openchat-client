<template>
  <div class="draft-preparation-progress">
    <el-icon
      v-if="phase === 'failed'"
      :size="30"
      class="draft-preparation-failure"
    >
      <WarningFilled />
    </el-icon>
    <div
      v-else
      class="draft-preparation-ring"
      role="progressbar"
      :aria-label="phase === 'hashing' ? '正在读取文件' : '正在解析视频'"
      :aria-valuenow="phase === 'hashing' ? progress : undefined"
      :aria-valuemin="0"
      :aria-valuemax="100"
    >
      <el-progress
        aria-hidden="true"
        type="circle"
        :width="40"
        :stroke-width="3"
        :percentage="phase === 'hashing' ? progress : 25"
        :show-text="false"
        :class="{ 'draft-preparation-spinning': phase === 'preview' }"
        color="#078b5d"
      />
      <span v-if="phase === 'hashing'">{{ progress }}%</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ElIcon, ElProgress } from 'element-plus';
import { WarningFilled } from '@element-plus/icons-vue';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/progress/style/css';

defineProps<{
  phase: 'hashing' | 'preview' | 'failed';
  progress: number;
}>();
</script>

<style scoped>
.draft-preparation-progress,
.draft-preparation-ring {
  position: relative;
  display: grid;
  place-items: center;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
}
.draft-preparation-ring > span {
  position: absolute;
  color: #386153;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.draft-preparation-spinning {
  animation: draft-preparation-spin 1s linear infinite;
}
@keyframes draft-preparation-spin {
  to {
    transform: rotate(360deg);
  }
}
.draft-preparation-failure {
  color: #b54141;
}
</style>
