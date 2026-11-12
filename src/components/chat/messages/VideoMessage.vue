<template>
  <div class="video-message" @contextmenu="showVideoMenu">
    <button
      type="button"
      class="video-message-card"
      :draggable="draggable"
      @pointerdown="prepareDrag"
      @dragstart="startDrag"
      @click.capture="guardDragClick"
      :style="dimensions"
      :title="label"
      :aria-label="label"
      :aria-disabled="!canActivate"
      :tabindex="canActivate ? 0 : -1"
      @click="activate"
    >
      <img
        v-if="send?.posterUrl || posterUrl"
        :src="send?.posterUrl || posterUrl"
        alt=""
        draggable="false"
      />
      <span v-else class="video-message-placeholder"
        ><Document v-if="filePlaceholder" /><VideoCamera v-else
      /></span>
      <span
        v-if="
          send && !['failed', 'cancel-failed', 'cancelled'].includes(send.phase)
        "
        class="video-message-progress"
        role="progressbar"
        :aria-valuenow="percentage"
        :aria-valuemin="0"
        :aria-valuemax="100"
        :aria-label="uploadLabel"
      >
        <el-progress
          type="circle"
          :width="44"
          :stroke-width="3"
          :percentage="percentage"
          :show-text="false"
          color="#fff"
        />
        <span>{{ percentage }}%</span>
      </span>
      <span
        v-else
        class="video-message-action"
        :class="{
          'is-loading':
            downloading || opening || revealing || (temporary && !outgoing),
        }"
      >
        <RefreshRight v-if="canResend || canResume" />
        <Close v-else-if="cancelled" />
        <Loading
          v-else-if="
            downloading || opening || revealing || (temporary && !outgoing)
          "
        />
        <WarningFilled v-else-if="send?.phase === 'failed' || temporary" />
        <CaretRight v-else-if="ready" />
        <Download v-else />
      </span>
      <span v-if="!filePlaceholder" class="video-message-duration">{{
        duration
      }}</span>
      <span v-if="downloading" class="video-message-state">下载中</span>
      <span
        v-else-if="video && !ready && !send && !temporary && !cancelled"
        class="video-message-state"
        >下载</span
      >
      <span v-else-if="opening" class="video-message-state">准备播放</span>
      <span v-else-if="revealing" class="video-message-state"
        >正在定位文件</span
      >
    </button>
    <div v-if="send && !cancelled" class="video-message-upload" role="status">
      <span>{{ uploadLabel }}</span>
      <span
        >{{ formatBytes(send.uploadedBytes) }} /
        {{ formatBytes(send.totalBytes) }}</span
      >
    </div>
    <div
      v-else-if="temporary && !cancelled"
      class="video-message-upload"
      role="status"
    >
      <span>{{
        outgoing
          ? localResumable
            ? '待继续发送'
            : '等待原设备完成上传'
          : '等待发送方完成上传'
      }}</span>
      <span>{{ metadata?.fileName }}</span>
    </div>
    <p v-if="send?.error" class="video-message-error" role="status">
      {{ send.error }}
    </p>
    <p v-if="error" class="video-message-error" role="status">{{ error }}</p>
    <p v-if="dragStatus" class="video-message-error" role="status">
      {{ dragStatus }}
    </p>
    <button
      v-if="posterFailed && video"
      type="button"
      class="video-poster-retry"
      @click="loadPoster"
    >
      重载封面
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import { useMessageDeletionMenu } from './message-delete-menu';
const deletionMenu = useMessageDeletionMenu();
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import {
  Download,
  Loading,
  CaretRight,
  VideoCamera,
  WarningFilled,
  Close,
  Document,
  RefreshRight,
  RefreshLeft,
  FolderOpened,
} from '@element-plus/icons-vue';
import { ElProgress } from 'element-plus';
import 'element-plus/es/components/progress/style/css';
import type { Message } from '../../../../shared/storage/database';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';
import type { VideoMessageApi } from '../../../../shared/media/video/video';
import { parseVideoContent } from '../../../../shared/media/video/video';
import type { VideoSendView } from '../../../services/media/video/video-outbox';
import { parseUploadPlaceholder } from '../../../../shared/chat/messages/upload-placeholder';
import { useMessageDrag } from './useMessageDrag';
import { useMessageCopy } from './useMessageCopy';
import { replyMenuItem } from './reply-menu';

const props = withDefaults(
  defineProps<{
    message: Message;
    readOnly?: boolean;
    send?: VideoSendView;
    outgoing?: boolean;
    allowResend?: boolean;
    canRecall?: boolean;
    showReply?: boolean;
    recalling?: boolean;
  }>(),
  {
    readOnly: false,
    outgoing: false,
    allowResend: false,
    canRecall: false,
    showReply: false,
    recalling: false,
  },
);
const video = computed(() => parseVideoContent(props.message.content));
const ready = ref(false);
const { draggable, dragStatus, prepareDrag, startDrag, guardDragClick } =
  useMessageDrag(
    () =>
      video.value &&
      props.message.messageType === 'video' &&
      !props.readOnly &&
      !props.send &&
      ready.value
        ? {
            kind: 'video',
            conversationId: props.message.conversationId,
            messageId: props.message.id,
          }
        : null,
    () => props.message.content,
    () => {
      void refresh();
    },
  );
const emit = defineEmits<{ cancel: []; resend: []; recall: []; reply: [] }>();
const placeholder = computed(() =>
  parseUploadPlaceholder(props.message.content),
);
const cancelled = computed(
  () => props.message.messageType === 'upload-cancelled',
);
const filePlaceholder = computed(() => placeholder.value?.targetType === 6);
const temporary = computed(() => props.message.messageType === 'temporary');
const metadata = computed(() => video.value ?? placeholder.value);
const localSource = ref(false);
const localResumable = ref(false);
const canResend = computed(
  () =>
    cancelled.value &&
    props.outgoing &&
    props.allowResend &&
    (Boolean(props.send) || localResumable.value) &&
    !filePlaceholder.value &&
    !props.readOnly,
);
const canResume = computed(
  () =>
    temporary.value &&
    !props.send &&
    props.outgoing &&
    props.allowResend &&
    localResumable.value &&
    !props.readOnly,
);
const canActivate = computed(
  () =>
    canResend.value ||
    canResume.value ||
    (!cancelled.value &&
      !props.send &&
      !temporary.value &&
      !downloading.value &&
      !opening.value &&
      !revealing.value &&
      Boolean(video.value) &&
      (ready.value || !props.readOnly)),
);
const percentage = computed(() =>
  props.send
    ? Math.min(
        100,
        Math.floor((props.send.uploadedBytes * 100) / props.send.totalBytes),
      )
    : 0,
);
const uploadLabel = computed((): string => {
  switch (props.send?.phase) {
    case 'queued':
      return '等待上传';
    case 'validating':
      return '正在校验视频';
    case 'uploading':
      return '已上传';
    case 'finalizing':
      return '正在合并并保存';
    case 'confirming':
      return '等待消息确认';
    case 'failed':
      return '发送未完成';
    case 'canceling':
      return '正在取消发送';
    case 'cancel-failed':
      return '取消未确认，请重试取消';
    default:
      return '视频上传中';
  }
});

/** 按二进制单位显示实际上传量，保留小数便于对比大视频进度。 */
const formatBytes = (bytes: number): string => {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
};
const downloading = ref(false);
const opening = ref(false);
const revealing = ref(false);
const posterUrl = ref('');
const posterFailed = ref(false);
const error = ref('');
let version = 0;
let disposed = false;
let menu: ContextMenuInstance | undefined;
const { copyMenuItem } = useMessageCopy();

/** 虚拟列表复用、授权变化或窗口失焦时关闭菜单，避免操作旧消息。 */
const closeVideoMenu = (): void => {
  menu?.closeMenu();
  menu = undefined;
};

/** 聊天和历史共用视频菜单，定位与取消发送各自保留权限限制。 */
const showVideoMenu = (event: MouseEvent): void => {
  event.preventDefault();
  event.stopPropagation();
  closeVideoMenu();
  if (filePlaceholder.value) return;
  const id = props.message.id;
  const target = request();
  const current = version;
  const canCancel =
    props.outgoing &&
    props.allowResend &&
    temporary.value &&
    Boolean(props.send || localSource.value);
  menu = ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    onClose: (): void => {
      menu = undefined;
    },
    items: [
      ...(video.value && props.message.messageType === 'video'
        ? [
            copyMenuItem(
              { ...target, kind: 'video' },
              () =>
                !disposed &&
                current === version &&
                !props.readOnly &&
                ready.value &&
                !downloading.value,
            ),
          ]
        : []),
      {
        label: '在文件夹中显示',
        icon: h(FolderOpened, { style: { width: '16px', height: '16px' } }),
        disabled:
          !(window.historyDesktop ?? window.desktop) ||
          (!video.value && !props.send && !localSource.value) ||
          revealing.value ||
          downloading.value ||
          opening.value,
        onClick: (): void => {
          void revealVideo(target);
        },
      },
      ...(canCancel
        ? [
            {
              label:
                props.send?.phase === 'cancel-failed'
                  ? '重试取消发送'
                  : '取消发送',
              icon: h(Close, { style: { width: '16px', height: '16px' } }),
              disabled: props.readOnly || props.send?.phase === 'canceling',
              onClick: (): void => {
                if (
                  !disposed &&
                  props.message.id === id &&
                  props.message.conversationId === target.conversationId &&
                  !props.readOnly &&
                  temporary.value &&
                  props.send?.phase !== 'canceling'
                )
                  emit('cancel');
              },
            },
          ]
        : []),
      ...(props.showReply && !props.readOnly
        ? [
            replyMenuItem(() => {
              if (
                !disposed &&
                current === version &&
                props.showReply &&
                !props.readOnly
              )
                emit('reply');
            }),
          ]
        : []),
      ...(props.canRecall
        ? [
            {
              label: '撤回消息',
              icon: h(RefreshLeft, {
                style: { width: '16px', height: '16px' },
              }),
              disabled: props.recalling,
              onClick: (): void => {
                if (!disposed && props.canRecall && !props.recalling)
                  emit('recall');
              },
            },
          ]
        : []),
      ...deletionMenu(target),
    ],
  });
};
/** 异步定位只影响原卡片，渲染进程从不接收或传递文件路径。 */
const revealVideo = async (target: ImagePreviewRequest): Promise<void> => {
  if (
    disposed ||
    revealing.value ||
    props.message.id !== target.messageId ||
    props.message.conversationId !== target.conversationId
  )
    return;
  const current = version;
  revealing.value = true;
  error.value = '';
  try {
    const bridge = api();
    if (typeof bridge.showVideoInFolder !== 'function')
      throw new Error('请重启程序以加载视频菜单接口');
    await bridge.showVideoInFolder(target);
    if (disposed || current !== version) return;
    if (video.value) ready.value = true;
  } catch (failure) {
    if (!disposed && current === version)
      error.value =
        failure instanceof Error ? failure.message : '无法定位视频文件';
  } finally {
    if (!disposed && current === version) revealing.value = false;
  }
};
const dimensions = computed(() => {
  if (filePlaceholder.value) return { width: '220px', height: '96px' };
  const ratio =
    (metadata.value?.thumbWidth ?? 160) / (metadata.value?.thumbHeight ?? 240);
  return {
    width: `${ratio < 1 ? Math.max(100, Math.round(248 * ratio)) : 220}px`,
    height: `${ratio < 1 ? 248 : Math.max(96, Math.round(220 / ratio))}px`,
  };
});
const duration = computed(() => {
  const seconds = Math.floor((metadata.value?.duration ?? 0) / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
});
const label = computed((): string => {
  switch (true) {
    case cancelled.value:
      return canResend.value ? '重新发送视频' : '已取消发送';
    case Boolean(props.send):
      return uploadLabel.value;
    case temporary.value:
      return canResume.value ? '继续发送视频' : '等待发送方完成上传';
    case !video.value:
      return '视频不可用';
    case revealing.value:
      return '正在定位视频文件';
    case opening.value:
      return '正在准备播放';
    case downloading.value:
      return '正在下载视频';
    case ready.value:
      return '播放视频';
    case props.readOnly:
      return '视频未缓存，重新登录后可下载';
    default:
      return '下载视频';
  }
});

/** 历史窗口使用其绑定会话桥接，浏览器不伪造原生播放能力。 */
const api = (): VideoMessageApi => {
  const bridge = window.historyDesktop ?? window.desktop;
  if (!bridge) throw new Error('请在桌面客户端中下载和播放视频');
  return bridge;
};
/** 仅传递消息标识，资源地址始终由主进程解析。 */
const request = (): { conversationId: string; messageId: string } => ({
  conversationId: props.message.conversationId,
  messageId: props.message.id,
});
/** 单独读取封面，加载卡片不会请求视频正文。 */
const loadPoster = async (): Promise<void> => {
  const current = version;
  posterFailed.value = false;
  if (!video.value) return;
  try {
    const data = await api().readVideoPoster(request());
    if (disposed || current !== version) return;
    if (posterUrl.value) URL.revokeObjectURL(posterUrl.value);
    posterUrl.value = URL.createObjectURL(
      new Blob([new Uint8Array(data.bytes)], { type: data.contentType }),
    );
  } catch {
    if (!disposed && current === version) posterFailed.value = true;
  }
};
/** 首次点击只下载；完成后下一次点击才打开独立窗口。 */
const activate = async (): Promise<void> => {
  if (canResend.value || canResume.value) {
    emit('resend');
    return;
  }
  if (
    !video.value ||
    Boolean(props.send) ||
    temporary.value ||
    downloading.value ||
    opening.value ||
    revealing.value ||
    (!ready.value && props.readOnly)
  )
    return;
  const current = version;
  error.value = '';
  try {
    if (ready.value) {
      opening.value = true;
      await api().openVideo(request());
      return;
    }
    downloading.value = true;
    await api().downloadVideo(request());
    if (!disposed && current === version) ready.value = true;
  } catch (failure) {
    if (!disposed && current === version) {
      error.value =
        failure instanceof Error ? failure.message : '下载或播放失败，请重试';
      if (!opening.value) ready.value = false;
    }
  } finally {
    if (!disposed && current === version) {
      downloading.value = false;
      opening.value = false;
    }
  }
};
/** 虚拟列表复用卡片时撤销上一条封面及迟到状态。 */
const refresh = async (): Promise<void> => {
  const current = ++version;
  if (posterUrl.value) URL.revokeObjectURL(posterUrl.value);
  posterUrl.value = '';
  error.value = metadata.value ? '' : '视频信息不完整';
  ready.value = false;
  downloading.value = false;
  opening.value = false;
  revealing.value = false;
  localSource.value = false;
  localResumable.value = false;
  if ((temporary.value || cancelled.value) && !props.send) {
    if (!window.desktop && !window.historyDesktop) return;
    try {
      const saved = await api().readVideoUpload(request());
      if (disposed || current !== version || !saved) return;
      localSource.value = true;
      localResumable.value = saved.canResume;
      posterUrl.value = URL.createObjectURL(
        new Blob([new Uint8Array(saved.poster)], { type: 'image/jpeg' }),
      );
    } catch (failure) {
      if (!disposed && current === version)
        error.value =
          failure instanceof Error ? failure.message : '读取本机封面失败';
    }
    return;
  }
  if (!video.value || props.send) return;
  void loadPoster();
  try {
    const cached = await api().videoStatus(request());
    if (!disposed && current === version) ready.value = cached;
  } catch (failure) {
    if (!disposed && current === version)
      error.value =
        failure instanceof Error ? failure.message : '读取视频状态失败';
  }
};
// 逐项比较实际值，避免上传进度快照替换时误关菜单或重复加载封面。
watch(
  [
    () => props.message.id,
    () => props.message.content,
    () => props.message.conversationId,
    () => props.message.messageType,
    () => props.readOnly,
    () => props.outgoing,
    () => props.send?.phase === 'canceling',
    () => props.send?.phase === 'cancel-failed',
  ],
  closeVideoMenu,
);
onMounted(() => {
  if (!window.contextMenuHost) window.addEventListener('blur', closeVideoMenu);
});
watch(
  [
    () => props.message.id,
    () => props.message.content,
    () => props.message.conversationId,
    () => props.message.messageType,
    () => Boolean(props.send),
  ],
  refresh,
  { immediate: true, flush: 'sync' },
);
onBeforeUnmount(() => {
  disposed = true;
  closeVideoMenu();
  window.removeEventListener('blur', closeVideoMenu);
  version++;
  if (posterUrl.value) URL.revokeObjectURL(posterUrl.value);
});
</script>

<style scoped>
.video-message {
  max-width: 100%;
  width: fit-content;
}
.video-message-card {
  position: relative;
  display: block;
  max-width: 100%;
  padding: 0;
  overflow: hidden;
  border: 1px solid #dedee2;
  border-radius: 5px;
  background: #e4e4e7;
  color: white;
  cursor: pointer;
}
.video-message-card img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
}
.video-message-placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #9a9aa0;
}
.video-message-placeholder svg {
  width: 48px;
  height: 48px;
}
.video-message-action {
  position: absolute;
  top: calc(50% - 20px);
  left: calc(50% - 20px);
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border: 1px solid #fff;
  border-radius: 50%;
  background: #0005;
}
.video-message-action svg {
  width: 27px;
  height: 27px;
}
.video-message-progress {
  position: absolute;
  top: calc(50% - 22px);
  left: calc(50% - 22px);
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: #0008;
  display: grid;
  place-items: center;
}
.video-message-progress > span {
  position: absolute;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.video-message-upload {
  display: grid;
  gap: 2px;
  max-width: 220px;
  margin: 5px 0 0;
  font-size: 11px;
  line-height: 16px;
  color: #68686e;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
}
.video-message-duration {
  position: absolute;
  bottom: 7px;
  right: 7px;
  font-size: 12px;
  line-height: 18px;
  text-shadow: 0 1px 3px #000;
  background: #0004;
  border-radius: 2px;
  padding: 0 3px;
}
.video-message-state {
  position: absolute;
  bottom: 32px;
  inset-inline: 0;
  text-align: center;
  font-size: 12px;
  text-shadow: 0 1px 3px #000;
}
.video-message-error {
  max-width: 220px;
  margin: 5px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #b54141;
  overflow-wrap: anywhere;
}
.video-poster-retry {
  border: 0;
  background: none;
  color: #666;
  font-size: 12px;
  padding: 3px 0;
  cursor: pointer;
}
.video-message-card[aria-disabled='true'] {
  cursor: default;
}
.video-message-card:focus-visible {
  outline: 2px solid #078b5d;
  outline-offset: 3px;
}
</style>
