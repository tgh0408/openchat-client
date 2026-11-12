<template>
  <div
    class="file-message"
    :tabindex="file ? 0 : undefined"
    :aria-label="metadata?.fileName"
    @contextmenu="showFileMenu"
    @keydown="onMenuKeydown"
  >
    <FileAttachmentCard
      :draggable="draggable"
      @pointerdown="prepareDrag"
      @dragstart="startDrag"
      @click.capture="guardDragClick"
      :file-name="metadata?.fileName ?? '文件不可用'"
      :file-size="metadata?.fileSize ?? 0"
    >
      <button
        v-if="canDownload || canResume"
        type="button"
        class="file-message-icon-action"
        :aria-label="
          canResume
            ? message.messageType === 'upload-cancelled'
              ? '重新发送'
              : '继续发送'
            : operation === 'download'
              ? '正在下载文件'
              : '下载文件'
        "
        :aria-busy="operation === 'download'"
        :disabled="busy || checking"
        :draggable="false"
        @pointerdown.stop
        @dragstart.stop.prevent
        @click.stop="
          canResume ? emit('retry') : operate('download', request(), version)
        "
      >
        <Loading v-if="operation === 'download'" class="is-downloading" />
        <RefreshRight v-else-if="canResume" />
        <Download v-else />
      </button>
    </FileAttachmentCard>
    <div
      v-if="showProgress || label || canCancel || canDownload"
      class="file-message-status"
    >
      <el-progress
        v-if="showProgress"
        class="file-message-progress"
        type="circle"
        :width="20"
        :stroke-width="2"
        :percentage="percentage"
        :show-text="false"
        color="#078b5d"
        :aria-label="label"
      />
      <span v-if="label" class="file-message-label" :title="label">{{
        label
      }}</span>
      <div class="file-message-actions">
        <button
          v-if="canDownload"
          class="file-message-download"
          type="button"
          :disabled="busy || checking"
          :draggable="false"
          @pointerdown.stop
          @dragstart.stop.prevent
          @click.stop="operate('download', request(), version)"
        >
          {{ operation === 'download' ? '下载中' : '下载' }}
        </button>
        <button
          v-if="canCancel"
          type="button"
          :title="send?.phase === 'cancel-failed' ? '重试取消发送' : '取消发送'"
          :aria-label="
            send?.phase === 'cancel-failed' ? '重试取消发送' : '取消发送'
          "
          :disabled="send?.phase === 'canceling'"
          @click="emit('cancel')"
        >
          <Close />
        </button>
      </div>
    </div>
    <p v-if="send?.error || error" role="status">{{ send?.error || error }}</p>
    <p v-if="dragStatus" role="status">{{ dragStatus }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed, h, ref, watch, onBeforeUnmount } from 'vue';
import {
  Download,
  Loading,
  FolderOpened,
  RefreshRight,
  RefreshLeft,
  Close,
} from '@element-plus/icons-vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import { useMessageDeletionMenu } from './message-delete-menu';
const deletionMenu = useMessageDeletionMenu();
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import { ElProgress } from 'element-plus';
import 'element-plus/es/components/progress/style/css';
import FileAttachmentCard from '../attachments/FileAttachmentCard.vue';
import type { Message } from '../../../../shared/storage/database';
import { parseFileContent } from '../../../../shared/media/file/file-message';
import { parseUploadPlaceholder } from '../../../../shared/chat/messages/upload-placeholder';
import type { VideoSendView } from '../../../services/media/video/video-outbox';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';
import { useMessageDrag } from './useMessageDrag';
import { useMessageCopy } from './useMessageCopy';
import { replyMenuItem } from './reply-menu';

const props = withDefaults(
  defineProps<{
    message: Message;
    send?: VideoSendView;
    readOnly?: boolean;
    outgoing?: boolean;
    allowSend?: boolean;
    showCancelledLabel?: boolean;
    canRecall?: boolean;
    showReply?: boolean;
    recalling?: boolean;
  }>(),
  {
    readOnly: false,
    outgoing: false,
    allowSend: false,
    showCancelledLabel: true,
    canRecall: false,
    showReply: false,
    recalling: false,
  },
);
const emit = defineEmits<{ retry: []; cancel: []; recall: []; reply: [] }>();
const file = computed(() => parseFileContent(props.message.content));
const ready = ref(false);
const expired = ref(false);
const checking = ref(false);
const { draggable, dragStatus, prepareDrag, startDrag, guardDragClick } =
  useMessageDrag(
    () =>
      file.value &&
      props.message.messageType === 'file' &&
      !props.readOnly &&
      !props.send &&
      ready.value &&
      !busy.value &&
      !checking.value
        ? {
            kind: 'file',
            conversationId: props.message.conversationId,
            messageId: props.message.id,
          }
        : null,
    () => props.message.content,
    () => {
      void refresh();
    },
  );
const metadata = computed(
  () => file.value ?? parseUploadPlaceholder(props.message.content),
);
const operation = ref<'download' | 'save' | 'reveal' | null>(null);
const busy = computed((): boolean => operation.value !== null);
const error = ref('');
const canDownload = computed((): boolean =>
  Boolean(
    file.value &&
    props.message.messageType === 'file' &&
    !props.send &&
    !props.readOnly &&
    !ready.value &&
    !expired.value &&
    (window.historyDesktop ?? window.desktop),
  ),
);
let menu: ContextMenuInstance | undefined;
const { copyMenuItem } = useMessageCopy();
let version = 0;
let disposed = false;
const showProgress = computed(
  (): boolean =>
    Boolean(props.send) &&
    props.send?.phase !== 'cancelled' &&
    props.message.messageType !== 'upload-cancelled',
);
const percentage = computed((): number => {
  const send = props.send;
  if (!send || send.totalBytes <= 0) return 0;
  return Math.max(
    0,
    Math.min(100, Math.floor((send.uploadedBytes * 100) / send.totalBytes)),
  );
});
const canCancel = computed(
  () =>
    props.message.messageType === 'temporary' &&
    props.outgoing &&
    props.allowSend &&
    !props.readOnly,
);
const canResume = computed(
  () =>
    props.outgoing &&
    props.allowSend &&
    !props.readOnly &&
    ['temporary', 'upload-cancelled'].includes(props.message.messageType) &&
    (!props.send || props.send.phase === 'failed'),
);
const label = computed((): string => {
  if (props.message.messageType === 'upload-cancelled')
    return props.showCancelledLabel ? '已取消发送' : '';
  switch (operation.value) {
    case 'save':
      return '正在另存为';
    case 'reveal':
      return '正在定位文件';
  }
  switch (props.send?.phase) {
    case 'queued':
      return '等待上传';
    case 'validating':
      return '正在校验文件';
    case 'uploading':
      return `已上传 ${percentage.value}%`;
    case 'finalizing':
      return '正在合并文件';
    case 'confirming':
      return '等待消息确认';
    case 'failed':
      return '发送未完成';
    case 'canceling':
      return '正在取消发送';
    case 'cancel-failed':
      return '取消未确认';
    default:
      if (expired.value) return '文件已过期';
      if (checking.value) return '正在检查本地文件';
      return props.message.messageType === 'temporary'
        ? '等待原设备完成上传'
        : '';
  }
});

/** 只传会话和消息标识，主进程从已授权消息读取资源。 */
const request = (): { conversationId: string; messageId: string } => ({
  conversationId: props.message.conversationId,
  messageId: props.message.id,
});
/** 菜单只操作打开时绑定的消息，组件复用后不执行旧操作。 */
const operate = async (
  action: 'download' | 'save' | 'reveal',
  target: ImagePreviewRequest,
  current: number,
): Promise<void> => {
  const bridge = window.historyDesktop ?? window.desktop;
  if (
    !bridge ||
    disposed ||
    current !== version ||
    busy.value ||
    !file.value ||
    (props.readOnly && (action !== 'reveal' || !ready.value)) ||
    (action === 'download' ? expired.value || checking.value : !ready.value)
  )
    return;
  operation.value = action;
  error.value = '';
  try {
    let saved = true;
    switch (action) {
      case 'download':
        if (typeof bridge.downloadFile !== 'function')
          throw new Error('请重启程序以加载文件下载接口');
        await bridge.downloadFile(target);
        break;
      case 'save':
        if (typeof bridge.saveFileAs !== 'function')
          throw new Error('请重启程序以加载文件另存为接口');
        saved = await bridge.saveFileAs(target);
        break;
      case 'reveal':
        await bridge.showFileInFolder(target);
        break;
    }
    if (saved && !disposed && current === version) {
      ready.value = true;
      expired.value = false;
      dragStatus.value = '';
    }
  } catch (failure) {
    if (!disposed && current === version) {
      error.value = failure instanceof Error ? failure.message : '文件操作失败';
      if (error.value.includes('文件已过期')) {
        expired.value = true;
        ready.value = false;
        error.value = '';
      } else if (error.value.includes('本地文件不存在')) {
        await refresh();
      }
    }
  } finally {
    if (!disposed && current === version) operation.value = null;
  }
};

/** 关闭旧消息的菜单，不因发送进度刷新而干扰当前菜单。 */
const closeFileMenu = (): void => {
  menu?.closeMenu();
  menu = undefined;
};

/** 聊天与历史共用文件菜单，不向页面返回保存路径或文件字节。 */
const openFileMenu = (x: number, y: number): void => {
  closeFileMenu();
  const bridge = window.historyDesktop ?? window.desktop;
  const target = request();
  const current = version;
  const unavailable = !bridge || !file.value || busy.value;
  menu = ContextMenu.showContextMenu({
    x,
    y,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    onClose: () => {
      menu = undefined;
    },
    items: [
      ...(file.value && props.message.messageType === 'file'
        ? [
            copyMenuItem(
              { ...target, kind: 'file' },
              () =>
                !disposed &&
                current === version &&
                !props.readOnly &&
                ready.value &&
                !checking.value &&
                !busy.value,
            ),
          ]
        : []),
      {
        label: '另存为',
        icon: h(Download, { style: { width: '16px', height: '16px' } }),
        disabled: unavailable || props.readOnly || !ready.value,
        onClick: () => {
          void operate('save', target, current);
        },
      },
      {
        label: '在文件夹中显示',
        icon: h(FolderOpened, { style: { width: '16px', height: '16px' } }),
        disabled: unavailable || !ready.value,
        onClick: () => {
          void operate('reveal', target, current);
        },
      },
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
                if (
                  !disposed &&
                  current === version &&
                  props.canRecall &&
                  !props.recalling
                )
                  emit('recall');
              },
            },
          ]
        : []),
      ...deletionMenu(target),
    ],
  });
};

/** 使用右键打开文件操作菜单。 */
const showFileMenu = (event: MouseEvent): void => {
  event.preventDefault();
  event.stopPropagation();
  openFileMenu(event.clientX, event.clientY);
};

/** 支持菜单键及 Shift+F10，按钮自身键盘操作保持不变。 */
const onMenuKeydown = (event: KeyboardEvent): void => {
  if (
    event.target !== event.currentTarget ||
    !(event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) ||
    !(event.currentTarget instanceof HTMLElement)
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  const bounds = event.currentTarget.getBoundingClientRect();
  openFileMenu(bounds.left + 12, bounds.top + 12);
};

/** 虚拟列表复用时查询本地和远端状态，不自动下载正文。 */
const refresh = async (): Promise<void> => {
  closeFileMenu();
  const current = ++version;
  ready.value = false;
  expired.value = false;
  checking.value = false;
  operation.value = null;
  error.value = '';
  if (!file.value) return;
  const bridge = window.historyDesktop ?? window.desktop;
  if (!bridge) {
    return;
  }
  try {
    checking.value = true;
    const cached = await bridge.fileStatus(request());
    if (!disposed && current === version) {
      ready.value = cached === 'local';
      expired.value = cached === 'expired';
    }
  } catch (failure) {
    if (!disposed && current === version) {
      ready.value = false;
      error.value =
        failure instanceof Error ? failure.message : '本地文件检查失败';
    }
  } finally {
    if (!disposed && current === version) checking.value = false;
  }
};
watch(
  [
    () => props.message.id,
    () => props.message.content,
    () => props.message.conversationId,
    () => Boolean(props.send),
  ],
  refresh,
  { immediate: true, flush: 'sync' },
);
watch(() => props.readOnly, closeFileMenu);
onBeforeUnmount(() => {
  closeFileMenu();
  disposed = true;
  version++;
});
</script>

<style scoped>
.file-message {
  width: 228px;
  max-width: 100%;
  min-width: 0;
}
.file-message:focus-visible {
  outline: 2px solid #078b5d;
  outline-offset: 2px;
  border-radius: 3px;
}
.file-message-status {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 24px;
  margin-top: 4px;
}
.file-message-label {
  min-width: 0;
  overflow-wrap: anywhere;
  font-size: 11px;
  line-height: 16px;
  color: #707076;
}
.file-message-progress {
  flex: 0 0 20px;
  height: 20px;
}
.file-message-progress :deep(.el-progress-circle__track) {
  stroke: #d8ddda;
}
.file-message-actions {
  display: flex;
  gap: 2px;
  margin-left: auto;
  flex-shrink: 0;
}
.file-message button {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 3px;
  border: 0;
  border-radius: 3px;
  background: none;
  cursor: pointer;
  flex-shrink: 0;
  color: #467967;
}
.file-message button:hover:not(:disabled) {
  background: #e5eee8;
}
.file-message button:focus-visible {
  outline: 2px solid #078b5d;
  outline-offset: 2px;
}
.file-message button:disabled {
  color: #aaa;
  cursor: default;
}
.file-message button svg {
  width: 19px;
  height: 19px;
}
.file-message .file-message-download {
  width: auto;
  min-width: 38px;
  padding: 3px 6px;
  font-size: 12px;
}
.file-message .file-message-icon-action {
  position: absolute;
  top: 16px;
  right: 12px;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: #0009;
  color: #fff;
}
.file-message .file-message-icon-action:hover:not(:disabled) {
  background: #000b;
}
.file-message .file-message-icon-action:disabled {
  color: #fffc;
}
.file-message-icon-action .is-downloading {
  animation: file-download-spin 1s linear infinite;
}
@keyframes file-download-spin {
  to {
    transform: rotate(360deg);
  }
}
.file-message p {
  color: #b54141;
  font-size: 12px;
  overflow-wrap: anywhere;
  margin: 4px 0;
}
</style>
