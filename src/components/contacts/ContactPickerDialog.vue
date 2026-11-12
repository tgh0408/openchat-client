<template>
  <el-dialog
    :model-value="open"
    class="contact-picker-dialog"
    width="724px"
    :title="title"
    align-center
    append-to-body
    destroy-on-close
    :show-close="false"
    :close-on-click-modal="false"
    :close-on-press-escape="!busy"
    @update:model-value="close"
  >
    <div
      class="contact-picker-layout"
      @pointerdown.stop
      @keydown.esc.stop="close(false)"
    >
      <section class="contact-picker-directory" aria-label="联系人">
        <div class="contact-picker-search">
          <el-icon :size="15" aria-hidden="true"><Search /></el-icon>
          <input
            v-model="search"
            type="search"
            placeholder="搜索"
            aria-label="搜索联系人"
            :disabled="busy"
          />
          <button
            v-if="search"
            type="button"
            title="清空搜索"
            aria-label="清空搜索"
            :disabled="busy"
            @click="search = ''"
          >
            <el-icon :size="14"><Close /></el-icon>
          </button>
        </div>
        <button
          class="contact-picker-directory-toggle"
          type="button"
          :aria-expanded="expanded"
          @click="expanded = !expanded"
        >
          <el-icon :size="12">
            <ArrowDown v-if="expanded" /><ArrowRight v-else />
          </el-icon>
          <span>联系人</span>
        </button>
        <div v-show="expanded" class="contact-picker-list" :aria-busy="loading">
          <p v-if="loading" class="contact-picker-status" role="status">
            正在读取联系人...
          </p>
          <div v-else-if="error" class="contact-picker-status" role="alert">
            <p>{{ error }}</p>
            <button type="button" :disabled="busy" @click="emit('retry')">
              重试
            </button>
          </div>
          <p v-else-if="!groupedContacts.length" class="contact-picker-status">
            {{ search.trim() ? '没有匹配的联系人' : '暂无联系人' }}
          </p>
          <template v-else>
            <section v-for="group in groupedContacts" :key="group.letter">
              <h3 class="contact-picker-letter">{{ group.letter }}</h3>
              <label
                v-for="contact in group.contacts"
                :key="contact.uid"
                class="contact-picker-row"
                :class="{ 'is-unavailable': excluded.has(contact.uid) }"
                :title="contact.displayName"
              >
                <input
                  class="contact-picker-checkbox"
                  type="checkbox"
                  :checked="selected.has(contact.uid)"
                  :disabled="busy || excluded.has(contact.uid)"
                  :aria-label="`选择${contact.displayName}`"
                  @change="toggle(contact.uid)"
                />
                <AvatarImage
                  class="contact-picker-avatar"
                  :src="contact.avatar"
                />
                <span class="contact-picker-name">{{
                  contact.displayName
                }}</span>
                <span
                  v-if="excluded.has(contact.uid)"
                  class="contact-picker-excluded"
                  >{{ excludedLabel }}</span
                >
              </label>
            </section>
          </template>
        </div>
      </section>

      <section class="contact-picker-selection" :aria-label="title">
        <header class="contact-picker-heading">
          <h2>{{ title }}</h2>
          <span v-if="selectedContacts.length" aria-live="polite">
            已选择 {{ selectedContacts.length }} 人
          </span>
        </header>
        <div class="contact-picker-selected-list">
          <div
            v-for="contact in selectedContacts"
            :key="contact.uid"
            class="contact-picker-selected-row"
          >
            <AvatarImage class="contact-picker-avatar" :src="contact.avatar" />
            <span class="contact-picker-name" :title="contact.displayName">
              {{ contact.displayName }}
            </span>
            <button
              type="button"
              class="contact-picker-remove"
              :title="`移除${contact.displayName}`"
              :aria-label="`移除${contact.displayName}`"
              :disabled="busy"
              @click="toggle(contact.uid)"
            >
              <el-icon :size="15"><Close /></el-icon>
            </button>
          </div>
        </div>
        <p v-if="submitError" class="contact-picker-submit-error" role="alert">
          {{ submitError }}
        </p>
        <footer class="contact-picker-footer">
          <span
            class="contact-picker-confirm-wrap"
            :title="canConfirm ? undefined : unavailableReason"
          >
            <button
              type="button"
              class="contact-picker-confirm"
              :disabled="confirmDisabled"
              @click="confirm"
            >
              {{ busy ? busyLabel : confirmLabel }}
            </button>
          </span>
          <button
            type="button"
            class="contact-picker-cancel"
            :disabled="busy"
            @click="close(false)"
          >
            取消
          </button>
        </footer>
      </section>
    </div>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { ElDialog, ElIcon } from 'element-plus';
import 'element-plus/es/components/dialog/style/css';
import 'element-plus/es/components/icon/style/css';
import { ArrowDown, ArrowRight, Close, Search } from '@element-plus/icons-vue';
import type { Friend } from '../../../shared/contacts/friend';
import AvatarImage from '../avatar/AvatarImage.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    title: string;
    contacts: Friend[];
    excludedUids: string[];
    excludedLabel?: string;
    loading: boolean;
    error: string;
    submitError?: string;
    busy?: boolean;
    confirmLabel?: string;
    busyLabel?: string;
    canConfirm?: boolean;
    unavailableReason?: string;
  }>(),
  {
    excludedLabel: '已在群聊',
    busy: false,
    confirmLabel: '添加',
    busyLabel: '正在添加...',
    canConfirm: false,
    unavailableReason: '',
    submitError: '',
  },
);
const emit = defineEmits<{
  cancel: [];
  retry: [];
  confirm: [uids: string[]];
}>();
const search = ref('');
const expanded = ref(true);
const selectedUids = ref<string[]>([]);
const excluded = computed((): Set<string> => new Set(props.excludedUids));
const selected = computed((): Set<string> => new Set(selectedUids.value));
const contactsByUid = computed(
  (): Map<string, Friend> =>
    new Map(props.contacts.map((contact) => [contact.uid, contact])),
);
const selectedContacts = computed((): Friend[] =>
  selectedUids.value
    .map((uid) => contactsByUid.value.get(uid))
    .filter((contact): contact is Friend =>
      Boolean(contact && !excluded.value.has(contact.uid)),
    ),
);
const confirmDisabled = computed(
  (): boolean =>
    !props.canConfirm ||
    props.busy ||
    props.loading ||
    Boolean(props.error) ||
    !selectedContacts.value.length,
);

/** 按真实通讯录首字母分组，搜索不清除其他已选联系人。 */
const groupedContacts = computed(
  (): { letter: string; contacts: Friend[] }[] => {
    const keyword = search.value.trim().toLocaleLowerCase();
    const groups = new Map<string, Friend[]>();
    for (const contact of props.contacts) {
      const text =
        `${contact.displayName} ${contact.name} ${contact.uid}`.toLocaleLowerCase();
      if (keyword && !text.includes(keyword)) continue;
      const items = groups.get(contact.indexLetter) ?? [];
      items.push(contact);
      groups.set(contact.indexLetter, items);
    }
    return [...groups.entries()]
      .sort(([a], [b]): number => {
        if (a === b) return 0;
        if (a === '#') return 1;
        if (b === '#') return -1;
        return a.localeCompare(b);
      })
      .map(([letter, contacts]) => ({ letter, contacts }));
  },
);

/** 只切换当前可用联系人，禁止把已有群成员加入待提交列表。 */
const toggle = (uid: string): void => {
  if (
    props.busy ||
    props.loading ||
    props.error ||
    excluded.value.has(uid) ||
    !contactsByUid.value.has(uid)
  )
    return;
  if (selected.value.has(uid)) {
    selectedUids.value = selectedUids.value.filter((item) => item !== uid);
    return;
  }
  selectedUids.value = [...selectedUids.value, uid];
};

/** 取消交给调用方清理本次数据；提交中不允许关闭表单。 */
const close = (visible: boolean): void => {
  if (!visible && !props.busy) emit('cancel');
};

/** 只交付当前仍可用的选择，实际添加及成功反馈由业务调用方负责。 */
const confirm = (): void => {
  if (confirmDisabled.value) return;
  emit(
    'confirm',
    selectedContacts.value.map((contact) => contact.uid),
  );
};

watch(
  () => props.open,
  (): void => {
    search.value = '';
    selectedUids.value = [];
    expanded.value = true;
  },
);
watch([contactsByUid, excluded], (): void => {
  selectedUids.value = selectedUids.value.filter(
    (uid) => contactsByUid.value.has(uid) && !excluded.value.has(uid),
  );
});
</script>

<style>
.contact-picker-submit-error {
  flex-shrink: 0;
  max-height: 72px;
  margin: 8px 24px 0;
  overflow-y: auto;
  overflow-wrap: anywhere;
  color: #b74c42;
  font-size: 12px;
}
.el-dialog.contact-picker-dialog {
  max-width: calc(100vw - 24px);
  height: min(564px, calc(100dvh - 32px));
  padding: 0;
  overflow: hidden;
  border: 1px solid #d5d5d8;
  border-radius: 8px;
  background: #fafafa;
  color: #222;
  letter-spacing: 0;
  --el-dialog-border-radius: 8px;
}
.contact-picker-dialog > .el-dialog__header {
  display: none;
}
.contact-picker-dialog > .el-dialog__body {
  height: 100%;
  padding: 0;
}
.contact-picker-layout {
  display: grid;
  grid-template-columns: minmax(0, 320fr) minmax(0, 400fr);
  height: 100%;
  font-size: 14px;
  line-height: 20px;
  -webkit-app-region: no-drag;
}
.contact-picker-directory,
.contact-picker-selection {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.contact-picker-directory {
  padding-top: 20px;
  border-right: 1px solid #e7e7e9;
  background: #efeff1;
}
.contact-picker-search {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 28px;
  margin: 0 24px 8px;
  padding: 0 7px;
  border: 1px solid #d4d4d8;
  border-radius: 7px;
  background: #fff;
  color: #a4a4a9;
}
.contact-picker-search:focus-within {
  border-color: #07c160;
}
.contact-picker-search input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #222;
  font: inherit;
  font-size: 12px;
}
.contact-picker-search input::-webkit-search-cancel-button {
  appearance: none;
}
.contact-picker-search button,
.contact-picker-remove {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #99999f;
  cursor: pointer;
}
.contact-picker-directory-toggle {
  display: flex;
  align-items: center;
  gap: 14px;
  flex-shrink: 0;
  min-height: 36px;
  padding: 0 24px;
  border: 0;
  background: transparent;
  color: #222;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.contact-picker-directory-toggle .el-icon {
  color: #85858c;
}
.contact-picker-list,
.contact-picker-selected-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
}
.contact-picker-list {
  padding-bottom: 12px;
}
.contact-picker-letter {
  margin: 8px 24px 6px 52px;
  color: #99999f;
  font-size: 12px;
  font-weight: 400;
}
.contact-picker-row,
.contact-picker-selected-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 50px;
  min-width: 0;
}
.contact-picker-row {
  padding: 6px 24px;
  cursor: pointer;
}
.contact-picker-row:hover:not(.is-unavailable) {
  background: #e5e5e8;
}
.contact-picker-checkbox {
  appearance: none;
  display: grid;
  place-items: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  margin: 0 2px 0 0;
  border: 1px solid #b0b0b5;
  border-radius: 50%;
  background: transparent;
  cursor: inherit;
}
.contact-picker-checkbox:checked {
  border-color: #07c160;
  background: #07c160;
}
.contact-picker-checkbox:checked::after {
  content: '';
  width: 7px;
  height: 4px;
  margin-top: -2px;
  border-bottom: 1.5px solid #fff;
  border-left: 1.5px solid #fff;
  transform: rotate(-45deg);
}
.contact-picker-avatar {
  display: block;
  flex: 0 0 30px;
  width: 30px;
  height: 30px;
  border-radius: 4px;
  object-fit: cover;
}
.contact-picker-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.contact-picker-excluded {
  flex-shrink: 0;
  color: #96969c;
  font-size: 11px;
}
.contact-picker-row.is-unavailable {
  color: #99999f;
  cursor: not-allowed;
}
.contact-picker-status {
  margin: 16px 24px;
  color: #898990;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.contact-picker-status p {
  margin: 0 0 8px;
}
.contact-picker-status button {
  padding: 0;
  border: 0;
  background: transparent;
  color: #31549b;
  font: inherit;
  cursor: pointer;
}
.contact-picker-heading {
  display: flex;
  align-items: baseline;
  flex-wrap: wrap;
  gap: 6px 12px;
  flex-shrink: 0;
  min-height: 64px;
  padding: 24px 24px 16px;
}
.contact-picker-heading h2 {
  margin: 0;
  font: inherit;
  font-weight: 400;
  overflow-wrap: anywhere;
}
.contact-picker-heading > span {
  color: #99999f;
  font-size: 12px;
}
.contact-picker-selected-list {
  padding: 0 24px;
}
.contact-picker-remove:hover:not(:disabled) {
  background: #ebebed;
  color: #555;
}
.contact-picker-footer {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 112px));
  justify-content: center;
  gap: 24px;
  flex-shrink: 0;
  padding: 20px 24px 24px;
}
.contact-picker-confirm-wrap {
  display: block;
  min-width: 0;
}
.contact-picker-confirm,
.contact-picker-cancel {
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  border: 0;
  border-radius: 6px;
  background: #ededee;
  color: #222;
  font: inherit;
  font-size: 13px;
  overflow-wrap: anywhere;
  cursor: pointer;
}
.contact-picker-confirm:not(:disabled) {
  background: #07c160;
  color: #fff;
}
.contact-picker-confirm:disabled,
.contact-picker-cancel:disabled {
  color: #aaa;
  cursor: not-allowed;
}
.contact-picker-confirm:disabled {
  pointer-events: none;
}
.contact-picker-cancel:hover:not(:disabled) {
  background: #e2e2e4;
}
.contact-picker-dialog button:focus-visible,
.contact-picker-checkbox:focus-visible {
  outline: 2px solid #07c160;
  outline-offset: 2px;
}
@media (max-width: 560px) {
  .contact-picker-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .contact-picker-search {
    margin-inline: 12px;
  }
  .contact-picker-directory-toggle,
  .contact-picker-row,
  .contact-picker-selected-list {
    padding-inline: 12px;
  }
  .contact-picker-row,
  .contact-picker-selected-row {
    gap: 6px;
  }
  .contact-picker-letter {
    margin-left: 36px;
  }
  .contact-picker-heading {
    padding-inline: 12px;
  }
  .contact-picker-footer {
    gap: 8px;
    padding-inline: 12px;
  }
}
</style>
