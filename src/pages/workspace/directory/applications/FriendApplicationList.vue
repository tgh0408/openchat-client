<template>
  <div class="friend-applications" aria-label="收到和发出的好友申请">
    <ul>
      <li v-for="item in filteredApplications" :key="item.applyId">
        <button
          type="button"
          class="friend-application-row"
          :class="{
            'friend-application-row--selected':
              selected?.applyId === item.applyId,
            'friend-application-row--unread': isUnread(item),
          }"
          :aria-pressed="selected?.applyId === item.applyId"
          :disabled="disabled"
          @click="emit('select', item)"
        >
          <img
            :src="avatarSource(item)"
            alt=""
            draggable="false"
            @error="markAvatarFailed(item)"
          />
          <div class="friend-application-copy">
            <div class="friend-application-heading">
              <span class="friend-application-name" :title="item.name">
                <span
                  v-if="isUnread(item)"
                  class="friend-application-unread-dot"
                  aria-label="未读"
                />
                {{ item.name }}
              </span>
              <span class="friend-application-state">{{
                friendApplicationStatusLabel(item)
              }}</span>
            </div>
            <p :title="item.message">{{ item.message }}</p>
          </div>
        </button>
      </li>
    </ul>
    <p v-if="error" class="friend-application-error" role="alert">
      {{ error }}
    </p>
    <p v-else-if="busy" class="friend-application-status" role="status">
      正在读取申请...
    </p>
    <p
      v-else-if="!filteredApplications.length"
      class="friend-application-status"
    >
      {{ search.trim() ? '没有匹配的好友申请' : '暂无好友申请' }}
    </p>
    <button
      v-if="!isLast && applications.length"
      type="button"
      class="friend-application-more"
      :disabled="busy || disabled"
      @click="load(false)"
    >
      加载更多
    </button>
  </div>
</template>

<script setup lang="ts">
import { DEFAULT_AVATAR_URL } from '../../../../services/runtime/public-assets';
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import type {
  FriendApplicationPage,
  FriendApplication,
} from '../../../../../shared/contacts/friend-notification';
import {
  friendApplicationStatusLabel,
  isFriendApplicationUnread,
} from '../../../../../shared/contacts/friend-notification';
import { getAuthErrorMessage } from '../../../../services/auth/auth';

const props = defineProps<{
  disabled: boolean;
  read: (pageNo: number) => Promise<FriendApplicationPage>;
  selected: FriendApplication | null;
  unreadUids: ReadonlySet<string>;
  search: string;
  revision: number;
}>();
const emit = defineEmits<{
  select: [application: FriendApplication];
  loaded: [applications: FriendApplication[]];
}>();
const applications = shallowRef<FriendApplication[]>([]);
const busy = ref(false);
const error = ref('');
const isLast = ref(true);
let pageNo = 0;
let disposed = false;
let reloadPending = false;
const failedAvatars = ref(new Set<string>());

/** 搜索已读取的昵称、申请语与 UID，不伪造远端搜索结果。 */
const filteredApplications = computed((): FriendApplication[] => {
  const keyword = props.search.trim().toLocaleLowerCase();
  if (!keyword) return applications.value;
  return applications.value.filter((item) =>
    `${item.name} ${item.message} ${item.peerUid}`
      .toLocaleLowerCase()
      .includes(keyword),
  );
});

/** 失败头像回退应用默认图，不让损坏图片影响申请选择。 */
const avatarSource = (item: FriendApplication): string =>
  item.avatar && !failedAvatars.value.has(item.avatar)
    ? item.avatar
    : DEFAULT_AVATAR_URL;

/** 按图片地址记录失败，服务端换头像后允许加载新地址。 */
const markAvatarFailed = (item: FriendApplication): void => {
  if (item.avatar) failedAvatars.value.add(item.avatar);
};

/** 收到的申请与发出申请的新回复共用当前账号的权威未读摘要。 */
const isUnread = (item: FriendApplication): boolean =>
  isFriendApplicationUnread(item, props.unreadUids);

/** 只同步已加载页或下一页，不因打开列表批量确认已读。 */
const load = async (reset: boolean): Promise<void> => {
  if (props.disabled || disposed) return;
  if (busy.value) {
    if (reset) reloadPending = true;
    return;
  }
  busy.value = true;
  error.value = '';
  const revision = props.revision;
  const targetPage = reset ? Math.max(pageNo, 1) : pageNo + 1;
  try {
    const records = new Map<string, FriendApplication>();
    if (!reset) {
      for (const item of applications.value) records.set(item.applyId, item);
    }
    let last = false;
    let completedPage = pageNo;
    for (let page = reset ? 1 : targetPage; page <= targetPage; page++) {
      const result = await props.read(page);
      if (disposed || props.disabled) return;
      for (const item of result.list) records.set(item.applyId, item);
      completedPage = page;
      last = result.isLast;
      if (last) break;
    }
    // HTTP 审批成功可能先于旧分页响应到达；申请终态不能退回等待验证。
    const previous = new Map(
      applications.value.map((item) => [item.applyId, item]),
    );
    applications.value = [...records.values()].map((item) => {
      const known = previous.get(item.applyId);
      if (known && known.status !== 1 && item.status === 1)
        return { ...item, status: known.status };
      return item;
    });
    pageNo = completedPage;
    isLast.value = last;
    if (revision !== props.revision) reloadPending = true;
    emit('loaded', applications.value);
  } catch (cause) {
    if (!disposed && !props.disabled)
      error.value = getAuthErrorMessage(cause, '好友申请读取失败，请重试');
  } finally {
    if (!disposed && !props.disabled) {
      busy.value = false;
      if (reloadPending) {
        reloadPending = false;
        void load(true);
      }
    }
  }
};

watch(
  () => props.revision,
  (): void => {
    void load(true);
  },
);
watch(
  () => props.selected,
  (selected): void => {
    if (!selected) return;
    applications.value = applications.value.map((item) =>
      item.applyId === selected.applyId ? selected : item,
    );
  },
);
onMounted(() => {
  void load(true);
});
onBeforeUnmount(() => {
  disposed = true;
});
</script>

<style scoped>
.friend-applications ul {
  margin: 0;
  padding: 0;
  list-style: none;
}
.friend-application-row {
  display: flex;
  align-items: center;
  width: 100%;
  height: 71px;
  gap: 9px;
  padding: 10px 12px 10px 35px;
  border: 0;
  background: transparent;
  color: #242428;
  text-align: left;
  cursor: pointer;
}
.friend-application-row:hover {
  background: #e2e2e5;
}
.friend-application-row--selected,
.friend-application-row--selected:hover {
  background: #10a36d;
  color: #fff;
}
.friend-application-row--unread .friend-application-name {
  font-weight: 600;
}
.friend-applications img {
  width: 36px;
  height: 36px;
  flex: 0 0 36px;
  border-radius: 6px;
  object-fit: cover;
}
.friend-application-copy {
  flex: 1;
  min-width: 0;
}
.friend-application-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.friend-application-name,
.friend-application-copy p {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.friend-application-name {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  font-size: 14px;
}
.friend-application-unread-dot {
  width: 6px;
  height: 6px;
  flex: 0 0 6px;
  margin-right: 5px;
  border-radius: 50%;
  background: #fa5151;
}
.friend-application-state {
  flex: 0 0 auto;
  color: #96969d;
  font-size: 11px;
  white-space: nowrap;
}
.friend-application-copy p {
  margin: 4px 0;
  color: #77777e;
  font-size: 12px;
}
.friend-application-status,
.friend-application-error {
  font-size: 12px;
  color: #909097;
}
.friend-application-row--selected .friend-application-state,
.friend-application-row--selected .friend-application-copy p {
  color: #d2f0e5;
}
.friend-application-status,
.friend-application-error {
  margin: 12px 17px;
  overflow-wrap: anywhere;
  text-align: center;
}
.friend-application-error {
  color: #b74c42;
}
.friend-application-more {
  display: block;
  margin: 8px auto 12px;
  border: 0;
  background: transparent;
  color: #138454;
  cursor: pointer;
}
.friend-applications button:disabled {
  cursor: default;
  opacity: 0.5;
}
</style>
