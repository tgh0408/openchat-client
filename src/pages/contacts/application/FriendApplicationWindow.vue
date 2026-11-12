<template>
  <main
    class="friend-application"
    :class="{ 'friend-verification': verification }"
    aria-labelledby="application-title"
  >
    <header class="application-titlebar">
      <h1 id="application-title">{{ title }}</h1>
    </header>
    <form class="application-form" @submit.prevent="submit">
      <div
        ref="scrollArea"
        class="application-scroll"
        :aria-busy="loading || submitting"
      >
        <p v-if="error" class="application-error" role="alert">{{ error }}</p>
        <div v-if="!verification" class="application-field">
          <label for="application-message">发送添加朋友申请</label>
          <el-input
            id="application-message"
            v-model="message"
            type="textarea"
            :rows="3"
            :maxlength="200"
            :disabled="locked"
            resize="none"
            spellcheck="false"
          />
        </div>
        <div class="application-field">
          <label for="application-remark">备注</label>
          <el-input
            id="application-remark"
            ref="remarkInput"
            v-model="remark"
            :placeholder="targetName"
            :maxlength="64"
            :disabled="locked"
            autocomplete="off"
          />
        </div>
        <div class="application-field application-tags">
          <label for="application-tags">标签</label>
          <el-select
            id="application-tags"
            v-model="tags"
            multiple
            filterable
            allow-create
            default-first-option
            :reserve-keyword="false"
            :multiple-limit="10"
            :disabled="locked"
            placeholder="搜索或创建标签..."
            aria-label="标签"
            popper-class="friend-application-tag-options"
          >
            <el-option
              v-for="tag in tags"
              :key="tag"
              :label="tag"
              :value="tag"
            />
          </el-select>
        </div>
        <fieldset class="application-permissions" :disabled="locked">
          <legend>朋友权限</legend>
          <label class="permission-row">
            <input
              v-model="permission"
              type="radio"
              name="permission"
              value="all"
            />
            <span>聊天、朋友圈、OpenChat运动等</span>
          </label>
          <label class="permission-row">
            <input
              v-model="permission"
              type="radio"
              name="permission"
              value="chat"
            />
            <span>仅聊天</span>
          </label>
        </fieldset>
        <fieldset
          v-if="permission === 'all'"
          class="application-moments"
          :disabled="locked"
        >
          <legend>朋友圈和状态</legend>
          <div class="moment-row">
            <span id="hide-mine-label">不让他（她）看</span>
            <el-switch
              v-model="hideMine"
              :disabled="locked"
              aria-labelledby="hide-mine-label"
            />
          </div>
          <div class="moment-row">
            <span id="hide-theirs-label">不看他（她）</span>
            <el-switch
              v-model="hideTheirs"
              :disabled="locked"
              aria-labelledby="hide-theirs-label"
            />
          </div>
        </fieldset>
      </div>
      <footer class="application-footer">
        <el-button
          type="primary"
          native-type="submit"
          :loading="submitting"
          :disabled="locked"
          >确定</el-button
        >
        <el-button :disabled="closing || submitting" @click="closeWindow">{{
          submitted ? '关闭' : '取消'
        }}</el-button>
      </footer>
    </form>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElButton, ElInput, ElOption, ElSelect, ElSwitch } from 'element-plus';
import type { InputInstance } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/input/style/css';
import 'element-plus/es/components/option/style/css';
import 'element-plus/es/components/select/style/css';
import 'element-plus/es/components/switch/style/css';
import { getAuthErrorMessage } from '../../../services/auth/auth';
import {
  parseFriendApplicationDraft,
  parseFriendSettingsDraft,
} from '../../../../shared/contacts/friend-application';

const verification = window.location.hash === '#friend-verification';
const title = verification ? '通过朋友验证' : '申请添加朋友';
const api = verification
  ? window.friendVerificationDesktop
  : window.friendApplicationDesktop;
const remarkInput = ref<InputInstance>();
const message = ref('');
const remark = ref('');
const targetName = ref('');
const tags = ref<string[]>([]);
const permission = ref<'all' | 'chat'>('all');
const hideMine = ref(false);
const hideTheirs = ref(false);
const loading = ref(true);
const ready = ref(false);
const closing = ref(false);
const error = ref('');
const submitting = ref(false);
const submitted = ref(false);
const scrollArea = ref<HTMLElement | null>(null);
const locked = computed(
  (): boolean =>
    loading.value ||
    !ready.value ||
    submitting.value ||
    submitted.value ||
    closing.value,
);
let disposed = false;

/** 只读取绑定对象及本人真实昵称，不在子窗口恢复会话或初始化数据库。 */
const loadContext = async (): Promise<void> => {
  try {
    if (!api) throw new Error('请从桌面客户端打开申请窗口');
    const context = await api.read();
    if (disposed) return;
    if ('nickname' in context)
      message.value = `我是${context.nickname}`.slice(0, 200);
    targetName.value = context.targetName;
    if (verification) remark.value = context.targetName.slice(0, 64);
    ready.value = true;
  } catch (cause) {
    if (!disposed)
      error.value = getAuthErrorMessage(cause, '读取申请资料失败，请重新打开');
  } finally {
    if (!disposed) loading.value = false;
  }
  if (verification && !disposed && ready.value) {
    await nextTick();
    if (!disposed) remarkInput.value?.focus();
  }
};

/** 取消只关闭申请窗口，保留父窗口搜索结果。 */
const closeWindow = async (): Promise<void> => {
  if (closing.value || submitting.value) return;
  closing.value = true;
  try {
    if (api) await api.close();
    else window.close();
  } catch (cause) {
    if (!disposed)
      error.value = getAuthErrorMessage(cause, '关闭窗口失败，请重试');
  } finally {
    if (!disposed) closing.value = false;
  }
};

/** 真正提交成功后关闭，失败保留草稿；结果不确定时不自动重试。 */
const submit = async (): Promise<void> => {
  if (!api || locked.value) return;
  error.value = '';
  submitting.value = true;
  try {
    const settings = parseFriendSettingsDraft({
      remark: remark.value,
      tags: [...tags.value],
      permission: permission.value,
      hideMine: hideMine.value,
      hideTheirs: hideTheirs.value,
    });
    if (verification) {
      if (!window.friendVerificationDesktop) throw new Error('验证窗口已失效');
      await window.friendVerificationDesktop.submit(settings);
    } else {
      if (!window.friendApplicationDesktop) throw new Error('申请窗口已失效');
      await window.friendApplicationDesktop.submit(
        parseFriendApplicationDraft({
          ...settings,
          message: message.value,
        }),
      );
    }
    if (disposed) return;
    submitted.value = true;
  } catch (cause) {
    if (!disposed) {
      error.value = getAuthErrorMessage(cause, '提交失败，请重试');
      scrollArea.value?.scrollTo({ top: 0 });
    }
  } finally {
    if (!disposed) submitting.value = false;
  }
  if (!disposed && submitted.value) await closeWindow();
};

/** 选择标签或输入法处理 Escape 后，不再额外关闭原生窗口。 */
const onKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape' && !event.isComposing && !event.defaultPrevented)
    void closeWindow();
};

onMounted(() => {
  document.title = title;
  window.addEventListener('keydown', onKeydown);
  void loadContext();
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener('keydown', onKeydown);
});
</script>

<style scoped>
.friend-application {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100dvh;
  overflow: hidden;
  border: 1px solid #ccc;
  border-radius: 8px;
  background: #f9f9f9;
  color: #191919;
}
.application-titlebar {
  flex: 0 0 52px;
  -webkit-app-region: drag;
  user-select: none;
}
.application-titlebar h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 400;
  line-height: 52px;
  text-align: center;
}
.application-form {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.application-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 11px 14px 18px 23px;
  scrollbar-gutter: stable;
}
.application-scroll::-webkit-scrollbar {
  width: 9px;
}
.application-scroll::-webkit-scrollbar-thumb {
  border: 1px solid #f9f9f9;
  border-radius: 6px;
  background: #b1b1b1;
}
.application-field {
  margin-bottom: 20px;
}
.application-field > label,
fieldset legend {
  display: block;
  margin: 0 0 8px;
  padding: 0 11px;
  color: #9999a1;
  font-size: 14px;
  line-height: 20px;
}
.application-field .el-input,
.application-field .el-textarea,
.application-field .el-select {
  width: 100%;
  font-size: 16px;
  --el-input-bg-color: #f9f9f9;
  --el-fill-color-blank: #f9f9f9;
  --el-border-color: #e2e2e2;
  --el-input-border-color: #e2e2e2;
  --el-text-color-placeholder: #9999a1;
  --el-input-focus-border-color: #00c676;
  --el-color-primary: #00c676;
}
.application-field :deep(.el-textarea__inner) {
  height: 82px;
  padding: 12px 13px;
  border-radius: 8px;
  line-height: 23px;
}
.application-field :deep(.el-input__wrapper) {
  height: 50px;
  padding: 0 13px;
  border-radius: 8px;
}
.application-tags {
  margin-bottom: 25px;
}
.application-tags :deep(.el-select__wrapper) {
  min-height: 46px;
  padding: 10px 11px;
  border-radius: 6px;
}
.application-tags :deep(.el-select__suffix) {
  display: none;
}
.application-tags :deep(.el-select__selected-item),
.application-tags :deep(.el-tag__content) {
  min-width: 0;
  max-width: 100%;
}
fieldset {
  min-width: 0;
  margin: 0 11px;
  padding: 0;
  border: 0;
}
fieldset legend {
  width: 100%;
  margin-bottom: 0;
  padding: 0 0 7px;
}
.permission-row,
.moment-row {
  display: flex;
  align-items: center;
  min-height: 44px;
  border-top: 1px solid #ededed;
  font-size: 16px;
  line-height: 22px;
}
.permission-row {
  gap: 8px;
  cursor: pointer;
}
.permission-row input {
  appearance: none;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  margin: 0;
  border: 1px solid #aaa;
  border-radius: 50%;
  background: #f9f9f9;
}
.permission-row input:checked {
  border: 5px solid #00c676;
}
.permission-row input:focus-visible {
  outline: 2px solid #00ae68;
  outline-offset: 3px;
}
.application-moments {
  margin-top: 18px;
}
.moment-row {
  justify-content: space-between;
  gap: 10px;
  min-height: 52px;
}
.moment-row .el-switch {
  flex-shrink: 0;
}
.friend-verification .moment-row {
  min-height: 44px;
}
.application-footer {
  display: grid;
  flex: 0 0 auto;
  grid-template-columns: repeat(2, minmax(0, 112px));
  justify-content: center;
  gap: 24px;
  padding: 20px 24px 23px;
  background: #f9f9f9;
}
.application-footer .el-button {
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
.application-footer .el-button--primary {
  background: #00c676;
  color: #fff;
}
.application-footer .el-button:not(:disabled):hover {
  background: #e2e2e2;
}
.application-footer .el-button--primary:not(:disabled):hover {
  background: #00ae68;
}
.application-footer .el-button.is-disabled {
  opacity: 0.55;
}
.application-error {
  margin: 0 0 12px;
  color: #c63b3b;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
</style>
