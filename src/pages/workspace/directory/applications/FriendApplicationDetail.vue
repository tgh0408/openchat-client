<template>
  <section
    class="friend-application-detail"
    aria-label="好友申请详情"
    :aria-busy="busy"
  >
    <header class="friend-application-mobile-toolbar">
      <button
        class="chat-small-button"
        title="返回新的朋友"
        aria-label="返回新的朋友"
        @click="emit('back')"
      >
        <el-icon><ArrowLeft /></el-icon>
      </button>
    </header>
    <div class="friend-application-detail-scroll">
      <div class="friend-application-detail-body">
        <div class="friend-application-identity">
          <img
            :src="avatar"
            alt="对方头像"
            draggable="false"
            @error="avatarFailed = true"
          />
          <h1>{{ application.name }}</h1>
        </div>
        <div class="friend-application-invitation" aria-label="邀请信息">
          <p
            v-for="(message, index) in application.messages"
            :key="`${message.uid}-${index}`"
            class="friend-application-message"
          >
            <span>{{ messageAuthor(message) }}: </span
            ><span>{{ message.message }}</span>
          </p>
          <template v-if="canReplyFriendApplication(application)">
            <button
              v-if="!replyExpanded"
              class="friend-application-reply"
              :disabled="disabled || busy"
              @click="expandReply"
            >
              回复
            </button>
            <form
              v-else
              class="friend-application-composer"
              @submit.prevent="sendReply"
            >
              <textarea
                ref="replyInput"
                v-model="replyDraft"
                aria-label="回复内容"
                placeholder="输入内容..."
                maxlength="200"
                :disabled="disabled || busy || replySending"
              />
              <el-button
                native-type="submit"
                :disabled="
                  disabled || busy || replySending || !replyDraft.trim()
                "
              >
                {{ replySending ? '发送中...' : '发送' }}
              </el-button>
            </form>
          </template>
        </div>
        <dl class="friend-application-source">
          <dt>来源</dt>
          <dd>未提供</dd>
        </dl>
        <div class="friend-application-actions">
          <el-button
            v-if="canApproveFriendApplication(application)"
            class="friend-application-verify"
            :disabled="disabled || busy"
            @click="emit('approve')"
            >前往验证</el-button
          >
          <span v-else class="friend-application-result">{{
            friendApplicationStatusLabel(application)
          }}</span>
        </div>
        <p v-if="error" class="friend-application-detail-error" role="alert">
          {{ error }}
        </p>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../../../services/runtime/public-assets';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ElButton, ElIcon } from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import { ArrowLeft } from '@element-plus/icons-vue';
import {
  canApproveFriendApplication,
  canReplyFriendApplication,
  friendApplicationStatusLabel,
} from '../../../../../shared/contacts/friend-notification';
import type {
  FriendApplication,
  FriendApplicationMessage,
} from '../../../../../shared/contacts/friend-notification';

const props = defineProps<{
  application: FriendApplication;
  busy: boolean;
  disabled: boolean;
  error: string;
  reply: (msg: string) => Promise<boolean>;
}>();
const emit = defineEmits<{ back: []; approve: [] }>();
const avatarFailed = ref(false);
const replyExpanded = ref(false);
const replyDraft = ref('');
const replySending = ref(false);
const replyInput = ref<HTMLTextAreaElement | null>(null);
let replyVersion = 0;

/** 展开当前待审批申请的回复输入框。 */
const expandReply = async (): Promise<void> => {
  if (
    props.disabled ||
    props.busy ||
    !canReplyFriendApplication(props.application)
  )
    return;
  replyExpanded.value = true;
  await nextTick();
  replyInput.value?.focus();
};

/** 仅确认成功后清空草稿，切换申请或卸载后丢弃迟到结果。 */
const sendReply = async (): Promise<void> => {
  const message = replyDraft.value.trim();
  if (
    !message ||
    message.length > 200 ||
    props.disabled ||
    props.busy ||
    replySending.value ||
    !canReplyFriendApplication(props.application)
  )
    return;
  const version = replyVersion;
  replySending.value = true;
  try {
    const sent = await props.reply(message);
    if (version !== replyVersion) return;
    if (sent) {
      replyDraft.value = '';
      replyExpanded.value = false;
    }
  } finally {
    if (version === replyVersion) replySending.value = false;
  }
};

watch(
  [
    () => props.application.applyId,
    () => props.application.status,
    () => props.disabled,
  ],
  (): void => {
    replyVersion++;
    replyDraft.value = '';
    replyExpanded.value = false;
    replySending.value = false;
  },
);
onBeforeUnmount((): void => {
  replyVersion++;
});

/** 使用申请列表中的真实头像，加载失败时保留固定尺寸的默认头像。 */
const avatar = computed((): string =>
  avatarFailed.value
    ? DEFAULT_AVATAR_URL
    : props.application.avatar || DEFAULT_AVATAR_URL,
);

/** 按消息 UID 区分申请人和当前用户，保留临时聊天的对话顺序。 */
const messageAuthor = (message: FriendApplicationMessage): string => {
  if (message.uid === props.application.uid)
    return props.application.direction === 'SENT'
      ? '我'
      : props.application.name;
  return props.application.direction === 'SENT' ? props.application.name : '我';
};

watch(
  () => props.application.avatar,
  (): void => {
    avatarFailed.value = false;
  },
);
</script>

<style scoped>
.friend-application-detail {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  background: #fafafa;
}
.friend-application-mobile-toolbar {
  display: none;
  padding: 8px 16px;
}
.friend-application-detail-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.friend-application-detail-body {
  width: min(100%, 423px);
  margin: 0 auto;
  padding: 64px 24px 32px;
}
.friend-application-identity {
  display: flex;
  align-items: flex-start;
  gap: 16px;
  min-width: 0;
}
.friend-application-identity img {
  width: 72px;
  height: 72px;
  flex: 0 0 72px;
  border-radius: 6px;
  object-fit: cover;
}
.friend-application-identity h1 {
  min-width: 0;
  margin: 2px 0 0;
  color: #222226;
  font-size: 17px;
  font-weight: 400;
  line-height: 24px;
  overflow-wrap: anywhere;
}
.friend-application-invitation {
  margin-top: 16px;
  padding: 12px;
  border-radius: 4px;
  background: #eeeef0;
  color: #77777e;
  font-size: 14px;
  line-height: 22px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.friend-application-message {
  margin: 0;
}
.friend-application-message + .friend-application-message {
  margin-top: 10px;
  padding-top: 10px;
  border-top: 1px solid #e2e2e5;
}
.friend-application-reply {
  display: block;
  margin-top: 8px;
  padding: 0;
  border: 0;
  background: transparent;
  color: #405b8e;
  font: inherit;
  cursor: pointer;
}
.friend-application-reply:disabled {
  opacity: 0.5;
  cursor: default;
}
.friend-application-composer {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 8px;
  border: 1px solid #ceced3;
  border-radius: 6px;
  background: #fafafa;
  white-space: normal;
}
.friend-application-composer:focus-within {
  border-color: #37c967;
}
.friend-application-composer textarea {
  box-sizing: border-box;
  width: 100%;
  min-height: 64px;
  padding: 0;
  resize: vertical;
  border: 0;
  outline: none;
  background: transparent;
  color: #333337;
  font: inherit;
}
.friend-application-composer .el-button {
  align-self: flex-end;
  min-width: 62px;
  height: 28px;
}
.friend-application-source {
  display: grid;
  grid-template-columns: 64px minmax(0, 1fr);
  gap: 16px;
  margin: 16px 0 0;
  padding: 20px 0;
  border-top: 1px solid #eeeef0;
  border-bottom: 1px solid #eeeef0;
  font-size: 14px;
  line-height: 22px;
}
.friend-application-source dt {
  color: #79797f;
}
.friend-application-source dd {
  margin: 0;
  color: #97979d;
}
.friend-application-actions {
  display: flex;
  justify-content: center;
  margin-top: 16px;
}
.friend-application-verify {
  width: 112px;
  height: 32px;
  border: 0;
  border-radius: 5px;
  background: #ececee;
  color: #222226;
  font-size: 14px;
}
.friend-application-verify:hover:not(:disabled) {
  background: #e0e0e3;
  color: #222226;
}
.friend-application-result {
  color: #99999f;
  font-size: 14px;
  line-height: 32px;
}
.friend-application-detail-error {
  color: #b74c42;
  font-size: 13px;
  line-height: 20px;
  overflow-wrap: anywhere;
}
@media (width < 690px) {
  .friend-application-mobile-toolbar {
    display: flex;
  }
  .friend-application-detail-body {
    padding: 24px 20px;
  }
}
</style>
