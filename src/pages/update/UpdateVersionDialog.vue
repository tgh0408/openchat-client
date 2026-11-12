<template>
  <section
    class="update-window"
    role="dialog"
    :aria-labelledby="titleId"
    :aria-busy="busy"
  >
    <header class="update-window__bar">
      <span :id="titleId">新版本</span>
      <span v-if="release.version">{{ release.version }}</span>
    </header>
    <div v-if="busy" class="download-content">
      <img class="update-mark" :src="logo" alt="" draggable="false" />
      <p class="download-label">正在下载...</p>
      <div
        class="download-progress"
        role="progressbar"
        :aria-valuenow="progress"
        aria-valuemin="0"
        aria-valuemax="100"
      >
        <span :style="{ width: `${progress}%` }"></span>
      </div>
    </div>
    <div v-else class="update-content">
      <img class="update-mark" :src="logo" alt="" draggable="false" />
      <h1>{{ release.appName }}</h1>
      <div
        :key="release.version"
        class="update-copy"
        tabindex="0"
        aria-label="更新说明"
      >
        <p v-for="(item, index) in release.description" :key="index">
          {{ item }}
        </p>
        <p v-if="!release.description.length">暂无更新说明</p>
      </div>
      <p v-if="statusMessage" class="update-status" role="status">
        {{ statusMessage }}
      </p>
    </div>
    <footer v-if="busy" class="download-actions">
      <button
        class="update-action update-action--primary"
        type="button"
        @click="handleCancel"
      >
        取消
      </button>
    </footer>
    <footer v-else class="update-actions">
      <button
        class="update-action"
        type="button"
        :disabled="busy"
        @click="handleIgnore"
      >
        忽略本次更新
      </button>
      <button
        class="update-action"
        type="button"
        :disabled="busy"
        @click="handleLater"
      >
        稍后处理
      </button>
      <button
        class="update-action update-action--primary"
        type="button"
        :disabled="busy || updateDisabled"
        @click="handleUpdate"
      >
        {{ busy ? '更新中' : '更新' }}
      </button>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import updateMark from '../../assets/update-mark.png';

/** 更新弹窗的展示数据，不作为后端接口协议。 */
export interface UpdateRelease {
  appName: string;
  version: string;
  description: readonly string[];
  releaseId?: number;
}

const props = withDefaults(
  defineProps<{
    release: UpdateRelease;
    logo?: string;
    busy?: boolean;
    progress?: number;
    statusMessage?: string;
    updateDisabled?: boolean;
  }>(),
  {
    logo: updateMark,
    busy: false,
    progress: 0,
    statusMessage: '',
    updateDisabled: true,
  },
);
const titleId = useId();
const emit = defineEmits<{
  ignore: [release: UpdateRelease];
  later: [release: UpdateRelease];
  update: [release: UpdateRelease];
  cancel: [];
}>();

/** 通知父组件忽略所展示版本，不擅自保存忽略记录。 */
const handleIgnore = (): void => {
  if (!props.busy) emit('ignore', props.release);
};

/** 通知父组件暂时关闭，不虚构再次提醒的计划。 */
const handleLater = (): void => {
  if (!props.busy) emit('later', props.release);
};

/** 交由父组件执行更新，进度及错误仍由父组件回传。 */
const handleUpdate = (): void => {
  if (!props.busy && !props.updateDisabled) emit('update', props.release);
};

/** 请求父组件取消当前下载，下载文件由主进程负责清理。 */
const handleCancel = (): void => {
  emit('cancel');
};
</script>

<style scoped>
.update-window {
  display: grid;
  grid-template-rows: 38px minmax(0, 1fr) auto;
  width: min(517px, 100vw);
  height: min(423px, 100dvh);
  min-height: 320px;
  overflow: hidden;
  color: #303030;
  background: #e6e6e8;
  border: 1px solid #e6e6e8;
}

.update-window__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 21px;
  font-size: 13px;
  line-height: 20px;
  -webkit-app-region: drag;
}

.update-window__bar span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.update-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  overflow: hidden;
}

.download-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 0;
  overflow: hidden;
}

.download-label {
  margin: 67px 0 0;
  font-size: 16px;
  line-height: 24px;
}

.download-progress {
  width: min(450px, calc(100% - 96px));
  height: 2px;
  margin-top: 55px;
  overflow: hidden;
  background: #c9c9cb;
}

.download-progress span {
  display: block;
  width: 0;
  height: 100%;
  background: #00c17b;
  transition: width 120ms ease-out;
}

.download-actions {
  display: flex;
  justify-content: center;
  padding: 16px 35px 60px;
}

.download-actions .update-action {
  width: 145px;
}

.update-mark {
  flex: 0 0 92px;
  width: 116px;
  height: 92px;
  margin-top: 7px;
  object-fit: contain;
}

.update-content h1 {
  flex: 0 0 auto;
  max-width: calc(100% - 48px);
  max-height: 56px;
  margin: 20px 0 0;
  overflow: auto;
  overflow-wrap: anywhere;
  text-align: center;
  font-size: 20px;
  font-weight: 400;
  line-height: 28px;
}

.update-copy {
  align-self: stretch;
  flex: 1;
  min-height: 0;
  margin: 25px 36px 0;
  overflow: auto;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 18px;
}

.update-copy p {
  margin: 0;
}

.update-status {
  align-self: stretch;
  flex: 0 0 auto;
  max-height: 36px;
  margin: 6px 36px 0;
  overflow: auto;
  overflow-wrap: anywhere;
  color: #626262;
  font-size: 12px;
  line-height: 18px;
}

.update-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 19px;
  padding: 16px 35px 44px;
}

.update-action {
  min-height: 28px;
  min-width: 0;
  padding: 4px 6px;
  border: 0;
  border-radius: 5px;
  color: #303030;
  background: #d8d8db;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
  cursor: pointer;
}

.update-action:hover:not(:disabled) {
  background: #ceced1;
}

.update-action--primary {
  color: #fff;
  background: #00c17b;
}

.update-action--primary:hover:not(:disabled) {
  background: #00ae6e;
}

.update-action:focus-visible,
.update-copy:focus-visible {
  outline: 2px solid #087a52;
  outline-offset: 2px;
}

.update-action:disabled {
  cursor: not-allowed;
}

@media (max-width: 430px) {
  .update-copy,
  .update-status {
    margin-inline: 20px;
  }

  .update-actions {
    gap: 8px;
    padding-inline: 16px;
  }

  .update-action {
    font-size: 12px;
  }
}

@media (max-height: 380px) {
  .update-mark {
    flex-basis: 64px;
    height: 64px;
  }

  .update-content h1 {
    margin-top: 8px;
  }

  .update-copy {
    margin-top: 16px;
  }

  .update-actions {
    padding-bottom: 20px;
  }
}
</style>
