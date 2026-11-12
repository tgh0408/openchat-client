<template>
  <div
    class="rtc-invite-backdrop"
    role="presentation"
    @keydown.esc.stop.prevent
  >
    <section
      class="rtc-invite-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="labels.title"
      @pointerdown.stop
    >
      <header class="rtc-invite-header">
        <h2>{{ labels.title }}</h2>
        <span class="rtc-invite-count"
          >已选择{{ selectedUids.length }}个联系人</span
        >
      </header>

      <div class="rtc-invite-body">
        <section class="rtc-invite-members">
          <div class="rtc-invite-search">
            <el-icon :size="16" aria-hidden="true"><Search /></el-icon>
            <input
              v-model="search"
              type="search"
              placeholder="搜索"
              :aria-label="`搜索${labels.members}`"
              :disabled="loading || busy"
            />
          </div>
          <div class="rtc-invite-section-heading">
            <span>{{ labels.members }}</span>
            <span class="rtc-invite-directory-hint">从通讯录中选择</span>
          </div>

          <p v-if="loading" class="rtc-invite-state" role="status">
            正在读取{{ labels.members }}...
          </p>
          <p v-else-if="error" class="rtc-invite-state rtc-invite-state--error">
            {{ error }}
            <button
              v-if="mode === 'create-group'"
              type="button"
              class="rtc-invite-retry"
              :disabled="busy"
              @click="emit('retry')"
            >
              重试
            </button>
          </p>
          <p v-else-if="!filteredMembers.length" class="rtc-invite-state">
            {{ search.trim() ? `没有匹配的${labels.members}` : labels.empty }}
          </p>
          <div v-else class="rtc-invite-member-list">
            <button
              v-for="member in filteredMembers"
              :key="member.uid"
              type="button"
              class="rtc-invite-member"
              :class="{ 'rtc-invite-member--selected': isSelected(member.uid) }"
              :disabled="busy || (!isSelected(member.uid) && selectionFull)"
              :aria-pressed="isSelected(member.uid)"
              @click="toggleMember(member.uid)"
            >
              <span
                class="rtc-invite-check"
                :class="{
                  'rtc-invite-check--selected': isSelected(member.uid),
                }"
                aria-hidden="true"
              >
                <el-icon v-if="isSelected(member.uid)" :size="13">
                  <Check />
                </el-icon>
              </span>
              <img
                class="rtc-invite-avatar"
                :src="member.avatar || DEFAULT_AVATAR_URL"
                :alt="`${memberName(member)}头像`"
                @error="replaceAvatar"
              />
              <span class="rtc-invite-member-name">{{
                memberName(member)
              }}</span>
            </button>
          </div>
        </section>

        <section class="rtc-invite-selected">
          <div class="rtc-invite-section-heading">
            <span>已选成员</span>
          </div>
          <div v-if="selectedMembers.length" class="rtc-invite-selected-list">
            <div
              v-for="member in selectedMembers"
              :key="member.uid"
              class="rtc-invite-selected-member"
            >
              <img
                class="rtc-invite-avatar"
                :src="member.avatar || DEFAULT_AVATAR_URL"
                :alt="`${memberName(member)}头像`"
                @error="replaceAvatar"
              />
              <span class="rtc-invite-member-name">{{
                memberName(member)
              }}</span>
            </div>
          </div>
          <p v-else class="rtc-invite-empty">{{ labels.selection }}</p>

          <p v-if="submitError" class="rtc-invite-submit-error" role="alert">
            {{ submitError }}
          </p>
          <footer class="rtc-invite-footer">
            <button
              type="button"
              class="rtc-invite-confirm"
              :disabled="
                busy || loading || Boolean(error) || !selectedUids.length
              "
              @click="confirm"
            >
              <el-icon :size="16">
                <ChatRound v-if="mode === 'create-group'" />
                <Phone v-else />
              </el-icon>
              <span>{{ busy ? labels.busy : labels.confirm }}</span>
            </button>
            <button
              type="button"
              class="rtc-invite-cancel"
              :disabled="busy"
              @click="emit('cancel')"
            >
              取消
            </button>
          </footer>
        </section>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../../services/runtime/public-assets';
import { computed, ref } from 'vue';
import { ElIcon } from 'element-plus';
import 'element-plus/es/components/icon/style/css';
import { ChatRound, Check, Phone, Search } from '@element-plus/icons-vue';
import type { GroupMemberItem } from '../../../../shared/contacts/group';

const props = withDefaults(
  defineProps<{
    members: GroupMemberItem[];
    loading: boolean;
    busy: boolean;
    error: string;
    mode?: 'call' | 'create-group';
    submitError?: string;
  }>(),
  { mode: 'call', submitError: '' },
);
const emit = defineEmits<{
  cancel: [];
  retry: [];
  confirm: [participantUids: string[]];
}>();

const search = ref('');
const selectedUids = ref<string[]>([]);
const labels = computed(
  (): {
    title: string;
    members: string;
    empty: string;
    selection: string;
    confirm: string;
    busy: string;
  } => {
    switch (props.mode) {
      case 'create-group':
        return {
          title: '发起群聊',
          members: '好友',
          empty: '暂无可选择的好友',
          selection: '请选择好友',
          confirm: '创建',
          busy: '正在创建...',
        };
      default:
        return {
          title: '邀请加入群通话',
          members: '群成员',
          empty: '当前没有可邀请的群成员',
          selection: '请选择要加入通话的成员',
          confirm: '邀请',
          busy: '正在邀请...',
        };
    }
  },
);
const selectionFull = computed(
  (): boolean =>
    props.mode === 'create-group' && selectedUids.value.length >= 100,
);
const filteredMembers = computed((): GroupMemberItem[] => {
  const keyword = search.value.trim().toLocaleLowerCase();
  if (!keyword) return props.members;
  return props.members.filter((member) =>
    [member.nickname, member.username, member.uid]
      .filter((value): value is string => Boolean(value))
      .some((value) => value.toLocaleLowerCase().includes(keyword)),
  );
});
const selectedMembers = computed((): GroupMemberItem[] =>
  selectedUids.value
    .map((uid) => props.members.find((member) => member.uid === uid))
    .filter((member): member is GroupMemberItem => Boolean(member)),
);

/** 返回成员在邀请列表中的显示名称。 */
const memberName = (member: GroupMemberItem): string =>
  member.nickname?.trim() || member.username;

/** 判断成员是否已经被当前发起方选中。 */
const isSelected = (uid: string): boolean => selectedUids.value.includes(uid);

/** 切换单个成员的邀请状态，不改变其他已选成员。 */
const toggleMember = (uid: string): void => {
  if (props.busy || props.loading || props.error) return;
  if (isSelected(uid)) {
    selectedUids.value = selectedUids.value.filter((item) => item !== uid);
    return;
  }
  if (selectionFull.value) return;
  selectedUids.value = [...selectedUids.value, uid];
};

/** 提交当前勾选结果，关闭动作由父组件在呼叫创建成功后决定。 */
const confirm = (): void => {
  if (props.busy || props.loading || props.error || !selectedUids.value.length)
    return;
  emit('confirm', [...selectedUids.value]);
};

/** 头像失效时回退到应用默认头像，不影响成员选择。 */
const replaceAvatar = (event: Event): void => {
  if (!(event.currentTarget instanceof HTMLImageElement)) return;
  if (event.currentTarget.src.endsWith(DEFAULT_AVATAR_URL)) return;
  event.currentTarget.src = DEFAULT_AVATAR_URL;
};
</script>

<style scoped>
.rtc-invite-backdrop {
  position: absolute;
  z-index: 40;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 20px;
  background: rgb(0 0 0 / 18%);
}
.rtc-invite-dialog {
  display: flex;
  flex-direction: column;
  width: min(720px, 100%);
  height: min(560px, 100%);
  min-height: 420px;
  overflow: hidden;
  border: 1px solid #d5d5d8;
  border-radius: 8px;
  background: #fff;
  color: #303036;
  box-shadow: 0 14px 36px rgb(0 0 0 / 18%);
}
.rtc-invite-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  flex-shrink: 0;
  min-height: 58px;
  padding: 0 24px;
  border-bottom: 1px solid #ededee;
}
.rtc-invite-header h2 {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
.rtc-invite-count {
  color: #999aa0;
  font-size: 12px;
  white-space: nowrap;
}
.rtc-invite-body {
  display: grid;
  grid-template-columns: 320px minmax(0, 1fr);
  grid-template-rows: minmax(0, 1fr);
  min-height: 0;
  flex: 1;
}
.rtc-invite-members,
.rtc-invite-selected {
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.rtc-invite-members {
  min-width: 0;
  padding: 18px 16px 12px 24px;
  background: #f5f5f7;
}
.rtc-invite-selected {
  min-width: 0;
  padding: 18px 24px 12px;
  background: #fff;
}
.rtc-invite-empty {
  flex: 1;
}
.rtc-invite-search {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 8px;
  border: 1px solid #16c784;
  border-radius: 6px;
  background: #fff;
  color: #a2a3a8;
}
.rtc-invite-search input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #303036;
  font: inherit;
  font-size: 12px;
}
.rtc-invite-search input::placeholder {
  color: #a2a3a8;
}
.rtc-invite-section-heading {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-height: 38px;
  color: #66676d;
  font-size: 12px;
}
.rtc-invite-directory-hint {
  color: #31549b;
  cursor: default;
}
.rtc-invite-member-list,
.rtc-invite-selected-list {
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  scrollbar-width: thin;
}
.rtc-invite-member {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 50px;
  padding: 6px 8px 6px 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #303036;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.rtc-invite-member:hover:not(:disabled),
.rtc-invite-member--selected {
  background: #e9eaed;
}
.rtc-invite-member:disabled {
  cursor: default;
  opacity: 0.65;
}
.rtc-invite-check {
  display: grid;
  place-items: center;
  flex: 0 0 16px;
  width: 16px;
  height: 16px;
  margin-left: 0;
  border: 1px solid #b5b6ba;
  border-radius: 50%;
  color: #fff;
}
.rtc-invite-check--selected {
  border-color: #72d9b4;
  background: #72d9b4;
}
.rtc-invite-avatar {
  display: block;
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  border-radius: 4px;
  object-fit: cover;
  background: #e7e7e9;
}
.rtc-invite-member-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rtc-invite-selected-member {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 50px;
}
.rtc-invite-state,
.rtc-invite-empty {
  margin: 18px 0;
  color: #999aa0;
  font-size: 12px;
  line-height: 20px;
}
.rtc-invite-state--error {
  color: #c94d4d;
  overflow-wrap: anywhere;
}
.rtc-invite-retry {
  margin-left: 8px;
  border: 0;
  background: transparent;
  color: #31549b;
  cursor: pointer;
}
.rtc-invite-submit-error {
  flex-shrink: 0;
  max-height: 64px;
  margin: 8px 0 0;
  overflow-y: auto;
  overflow-wrap: anywhere;
  color: #c94d4d;
  font-size: 12px;
}
.rtc-invite-footer {
  display: flex;
  flex-shrink: 0;
  justify-content: flex-end;
  gap: 24px;
  padding: 14px 52px 12px 0;
}
.rtc-invite-confirm,
.rtc-invite-cancel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-width: 112px;
  height: 32px;
  padding: 0 16px;
  border: 0;
  border-radius: 6px;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.rtc-invite-confirm {
  background: #e9e9eb;
  color: #999aa0;
}
.rtc-invite-confirm:not(:disabled) {
  background: #6ed8b3;
  color: #fff;
}
.rtc-invite-cancel {
  background: #e9e9eb;
  color: #303036;
}
.rtc-invite-confirm:hover:not(:disabled),
.rtc-invite-cancel:hover:not(:disabled) {
  filter: brightness(0.97);
}
.rtc-invite-confirm:disabled,
.rtc-invite-cancel:disabled {
  cursor: default;
  opacity: 0.65;
}
.rtc-invite-confirm:focus-visible,
.rtc-invite-cancel:focus-visible,
.rtc-invite-member:focus-visible {
  outline: 2px solid #07c160;
  outline-offset: 2px;
}
@media (max-width: 620px) {
  .rtc-invite-dialog {
    min-height: 0;
  }
  .rtc-invite-body {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: auto auto;
    overflow-y: auto;
  }
  .rtc-invite-selected {
    border-top: 1px solid #ededee;
  }
  .rtc-invite-member-list,
  .rtc-invite-selected-list {
    flex: none;
    max-height: 180px;
  }
  .rtc-invite-footer {
    padding-inline: 0;
  }
}
</style>
