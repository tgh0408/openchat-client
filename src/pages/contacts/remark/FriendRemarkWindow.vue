<template>
  <main class="friend-remark-window" aria-label="设置备注和标签">
    <header class="remark-titlebar">
      <h1>设置备注和标签</h1>
    </header>
    <form class="remark-form" @submit.prevent="submit">
      <div class="remark-scroll">
        <p v-if="error" class="remark-error" role="alert">{{ error }}</p>
        <div class="remark-field">
          <label for="friend-remark-name">备注名</label>
          <el-input
            id="friend-remark-name"
            v-model="remark"
            :disabled="!ready || busy || completed"
            :maxlength="64"
            autocomplete="off"
          />
        </div>
        <div class="remark-field">
          <label for="friend-remark-tags">标签</label>
          <el-select
            id="friend-remark-tags"
            v-model="tags"
            :disabled="!ready || busy || completed"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            :multiple-limit="10"
            placeholder="搜索或创建标签..."
            @change="normalizeTags"
          >
            <el-option
              v-for="tag in tags"
              :key="tag"
              :label="tag"
              :value="tag"
            />
          </el-select>
        </div>
        <div class="remark-field">
          <label for="friend-remark-phone-0">电话</label>
          <div
            v-for="(phone, index) in phones"
            :key="phone.id"
            class="remark-phone"
          >
            <el-input
              :id="`friend-remark-phone-${index}`"
              v-model="phone.value"
              :disabled="busy || completed"
              type="tel"
              :maxlength="32"
              placeholder="电话号码"
              :aria-label="`电话号码 ${index + 1}`"
            />
            <button
              type="button"
              class="remark-remove"
              title="移除电话"
              aria-label="移除电话"
              :disabled="busy || completed"
              @click="phones.splice(index, 1)"
            >
              <el-icon><Remove /></el-icon>
            </button>
          </div>
          <button
            v-if="phones.length < 5"
            type="button"
            class="remark-add-phone"
            :disabled="!ready || busy || completed"
            @click="addPhone"
          >
            <el-icon :size="15"><CirclePlus /></el-icon>
            <span>添加电话</span>
          </button>
        </div>
        <div class="remark-field remark-description">
          <label for="friend-remark-description">描述</label>
          <el-input
            id="friend-remark-description"
            v-model="description"
            type="textarea"
            resize="none"
            :rows="2"
            :maxlength="512"
            :disabled="!ready || busy || completed"
            placeholder="添加更多备注信息"
          />
        </div>
      </div>
      <footer class="remark-footer">
        <el-button
          type="primary"
          native-type="submit"
          :loading="saving"
          :disabled="!ready || busy || completed || !changed"
          >完成</el-button
        >
        <el-button :disabled="busy" @click="close">取消</el-button>
      </footer>
    </form>
  </main>
</template>

<script setup lang="ts">
import { getRequestErrorMessage } from '../../../../shared/api/api-error';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton, ElIcon, ElInput, ElOption, ElSelect } from 'element-plus';
import { CirclePlus, Remove } from '@element-plus/icons-vue';
import type { FriendRemarkDraft } from '../../../../shared/contacts/friend-remark';
import {
  parseFriendRemarkDraft,
  parseFriendRemarkSettings,
} from '../../../../shared/contacts/friend-remark';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/option/style/css';
import 'element-plus/es/components/select/style/css';

const remark = ref('');
const tags = ref<string[]>([]);
const phones = ref<{ id: number; value: string }[]>([]);
const description = ref('');
const ready = ref(false);
const error = ref('');
const busy = ref(false);
const saving = ref(false);
const completed = ref(false);
const initialDraft = ref('');
let nextPhoneId = 0;
let disposed = false;

/** 提交值只包含文本编辑字段，身份及版本固定在主进程。 */
const draft = computed((): FriendRemarkDraft => ({
  remark: remark.value,
  tags: [...tags.value],
  phones: phones.value.map((phone) => phone.value.trim()).filter(Boolean),
  description: description.value,
}));
/** 没有修改时保持完成按钮禁用。 */
const changed = computed(
  (): boolean => JSON.stringify(draft.value) !== initialDraft.value,
);

/** 服务端确认成功后关闭，失败保留全部草稿，不自动重试写请求。 */
const submit = async (): Promise<void> => {
  const api = window.friendRemarkDesktop;
  if (!api || !ready.value || busy.value || completed.value || !changed.value)
    return;
  busy.value = true;
  saving.value = true;
  error.value = '';
  try {
    await api.submit(parseFriendRemarkDraft(draft.value));
    if (disposed) return;
    completed.value = true;
    await api.close();
  } catch (cause) {
    if (!disposed)
      error.value = getRequestErrorMessage(cause, '备注保存失败，请重试');
  } finally {
    if (!disposed) {
      busy.value = false;
      saving.value = false;
    }
  }
};

/** 草稿标签沿用好友申请的数量和长度边界，保存前只修改内存。 */
const normalizeTags = (): void => {
  tags.value = [...new Set(tags.value.map((tag) => tag.trim().slice(0, 32)))]
    .filter(Boolean)
    .slice(0, 10);
};

/** 电话只追加到本次窗口内存，删除行后不复用旧输入标识。 */
const addPhone = (): void => {
  if (!ready.value || busy.value || completed.value || phones.value.length >= 5)
    return;
  phones.value.push({ id: nextPhoneId++, value: '' });
};

/** 取消关闭原生窗口，不把草稿当成保存成功。 */
const close = async (): Promise<void> => {
  if (busy.value) return;
  try {
    await window.friendRemarkDesktop?.close();
  } catch {
    if (!disposed) error.value = '关闭窗口失败，请重试';
  }
};

/** 下拉框先处理 Escape；未被消费的按键取消当前窗口。 */
const handleKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing)
    return;
  event.preventDefault();
  void close();
};

/** 读取主进程绑定的真实备注，缺省时以真实昵称预填。 */
const load = async (): Promise<void> => {
  const api = window.friendRemarkDesktop;
  if (!api) {
    error.value = '请在桌面客户端打开备注窗口';
    return;
  }
  try {
    const context = await api.read();
    if (disposed) return;
    const settings = parseFriendRemarkSettings(context.settings);
    remark.value = settings.remark ?? context.name;
    tags.value = [...settings.tags];
    phones.value = settings.phones.map((value) => ({
      id: nextPhoneId++,
      value,
    }));
    description.value = settings.description;
    initialDraft.value = JSON.stringify(draft.value);
    ready.value = true;
  } catch (cause) {
    if (!disposed)
      error.value = getRequestErrorMessage(
        cause,
        '读取好友备注失败，请关闭后重试',
      );
  }
};

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
  void load();
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<style scoped>
.friend-remark-window {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  border: 1px solid #d4d4d4;
  border-radius: 8px;
  background: #f9f9f9;
  color: #191919;
  font-size: 14px;
}
.remark-titlebar {
  flex: 0 0 43px;
  -webkit-app-region: drag;
  user-select: none;
}
.remark-titlebar h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 43px;
  text-align: center;
}
.remark-form {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.remark-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px 24px 16px;
}
.remark-field {
  margin-bottom: 23px;
}
.remark-field > label {
  display: block;
  margin: 0 0 8px;
  padding: 0 11px;
  color: #9999a1;
  font-size: 13px;
  line-height: 19px;
}
.remark-field .el-input,
.remark-field .el-textarea,
.remark-field .el-select {
  width: 100%;
  font-size: 14px;
  --el-input-bg-color: #f9f9f9;
  --el-fill-color-blank: #f9f9f9;
  --el-border-color: #e2e2e2;
  --el-input-border-color: #e2e2e2;
  --el-text-color-placeholder: #9999a1;
}
.remark-field :deep(.el-input__wrapper),
.remark-field :deep(.el-select__wrapper) {
  min-height: 43px;
  padding: 9px 12px;
  border-radius: 7px;
}
.remark-field :deep(.el-select__suffix) {
  display: none;
}
.remark-field :deep(.el-select__selected-item),
.remark-field :deep(.el-tag__content) {
  min-width: 0;
  max-width: 100%;
}
.remark-field :deep(.el-textarea__inner) {
  height: 63px;
  padding: 12px;
  border-radius: 7px;
  line-height: 20px;
}
.remark-add-phone {
  display: flex;
  align-items: center;
  border: 1px solid #e2e2e2;
  border-radius: 7px;
  background: transparent;
  color: #294995;
  font-size: 14px;
}
.remark-add-phone {
  gap: 10px;
  width: 100%;
  min-height: 43px;
  padding: 10px 12px;
  text-align: left;
  cursor: pointer;
}
.remark-phone {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-bottom: 8px;
}
.remark-phone .el-input {
  min-width: 0;
}
.remark-remove {
  display: grid;
  flex: 0 0 28px;
  place-items: center;
  width: 28px;
  height: 32px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #9999a1;
  cursor: pointer;
}
.remark-description {
  margin-bottom: 9px;
}
.remark-remove:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}
.remark-add-phone:not(:disabled):hover,
.remark-remove:hover {
  background: #ededed;
}
.remark-add-phone:focus-visible,
.remark-remove:focus-visible {
  outline: 2px solid #00ae68;
  outline-offset: 2px;
}
.remark-footer {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(2, minmax(0, 112px));
  justify-content: center;
  gap: 24px;
  padding: 20px 24px 23px;
}
.remark-footer .el-button {
  width: 100%;
  height: 30px;
  margin: 0;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: #ededed;
  color: #191919;
  font-size: 14px;
}
.remark-footer .el-button.is-disabled {
  color: #aaa;
}
.remark-footer .el-button--primary:not(:disabled) {
  background: #00c676;
  color: #fff;
}
.remark-footer .el-button--primary:not(:disabled):hover {
  background: #00ae68;
}
.remark-footer .el-button:not(:disabled):hover {
  background: #e2e2e2;
}
.remark-error {
  margin: 0 0 12px;
  color: #c63b3b;
  font-size: 13px;
  overflow-wrap: anywhere;
}
</style>
