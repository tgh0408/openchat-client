<template>
  <section class="group-detail" aria-label="群聊详情" :aria-busy="opening">
    <div class="group-detail-toolbar">
      <button
        type="button"
        class="chat-small-button chat-mobile-back"
        title="返回通讯录"
        aria-label="返回通讯录"
        @click="emit('back')"
      >
        <el-icon><ArrowLeft /></el-icon>
      </button>
    </div>
    <div class="group-detail-identity">
      <GroupAvatar :group="group" class="group-detail-avatar" />
      <h1 :title="groupDisplayName(group)">{{ groupDisplayName(group) }}</h1>
      <p class="group-detail-description">
        {{ group.notice?.description || '(群主未设置)' }}
      </p>
      <p v-if="group.notice" class="group-detail-meta">
        写入用户：{{ group.notice.uid }} ·
        {{ formatGroupRecordTime(group.notice.createTime) }}
      </p>
      <div v-if="group.qrCode.length" class="group-detail-qr-list">
        <article
          v-for="(qrCode, index) in group.qrCode"
          :key="`${qrCode.url}-${qrCode.createTime}-${index}`"
          class="group-detail-qr-record"
        >
          <img
            :src="qrCode.url"
            :alt="`群二维码 ${index + 1}`"
            class="group-detail-qr"
          />
          <p class="group-detail-meta">
            生成时间：{{ formatGroupRecordTime(qrCode.createTime) }}
          </p>
          <p v-if="qrCode.expireTime" class="group-detail-meta">
            过期时间：{{ formatGroupRecordTime(qrCode.expireTime) }}
          </p>
          <p v-if="qrCode.keyword" class="group-detail-meta">
            密钥：{{ qrCode.keyword }}
          </p>
        </article>
      </div>
      <el-button
        class="group-detail-enter"
        type="success"
        :loading="opening"
        :disabled="disabled"
        @click="emit('enter')"
        >进入群聊</el-button
      >
      <p v-if="error" class="group-detail-error" role="alert">{{ error }}</p>
    </div>
    <footer class="group-detail-footer">
      <el-tooltip content="暂未接入从通讯录移除群聊" placement="top">
        <span tabindex="0" aria-label="从通讯录中删除，暂不可用">
          <button type="button" class="group-detail-remove" disabled>
            从通讯录中删除
          </button>
        </span>
      </el-tooltip>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { ElButton, ElIcon, ElTooltip } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/tooltip/style/css';
import { ArrowLeft } from '@element-plus/icons-vue';
import {
  formatGroupRecordTime,
  type GroupDirectoryItem,
} from '../../../../../shared/contacts/group';
import GroupAvatar from '../../../../components/avatar/GroupAvatar.vue';
import { groupDisplayName } from '../../../../../shared/contacts/group-name';

defineProps<{
  group: GroupDirectoryItem;
  opening: boolean;
  disabled: boolean;
  error: string;
}>();
const emit = defineEmits<{ back: []; enter: [] }>();
</script>

<style scoped>
.group-detail {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  background: #fafafa;
}

.group-detail-toolbar {
  display: flex;
  flex: 0 0 44px;
  align-items: center;
  padding: 0 16px;
}

.group-detail-identity {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: min(10vh, 80px) 24px 32px;
  text-align: center;
}

.group-detail-avatar {
  --group-avatar-size: 80px;
}

.group-detail-identity h1 {
  max-width: 100%;
  margin: 16px 0;
  color: #202023;
  font-size: 20px;
  font-weight: 400;
  line-height: 1.4;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.group-detail-enter {
  --el-button-bg-color: #00c477;
  --el-button-border-color: #00c477;
  --el-button-hover-bg-color: #00b36c;
  --el-button-hover-border-color: #00b36c;
  min-width: 88px;
  height: 32px;
  padding: 0 12px;
  border-radius: 5px;
  font-size: 16px;
}

.group-detail-description {
  max-width: 360px;
  margin: 0 0 20px;
  color: #85858b;
  font-size: 14px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.group-detail-qr {
  width: 160px;
  height: 160px;
  margin-bottom: 24px;
  border: 1px solid #e2e2e5;
  object-fit: contain;
  background: #fff;
}

.group-detail-qr-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  margin-bottom: 24px;
}

.group-detail-qr-record {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.group-detail-error {
  max-width: 360px;
  margin: 16px 0 0;
  color: #b74c42;
  font-size: 13px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.group-detail-meta {
  max-width: 360px;
  margin: 0;
  color: #a2a2a8;
  font-size: 12px;
  line-height: 18px;
  overflow-wrap: anywhere;
}

.group-detail-footer {
  margin-top: auto;
  padding: 24px 16px 48px;
  text-align: center;
}

.group-detail-remove {
  border: 0;
  padding: 4px;
  background: transparent;
  color: #31549b;
  font-size: 14px;
  cursor: not-allowed;
}
</style>
