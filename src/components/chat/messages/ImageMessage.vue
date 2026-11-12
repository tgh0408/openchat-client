<template>
  <div ref="container" class="message-image" @contextmenu="showImageMenu">
    <div
      class="message-image-frame"
      :draggable="draggable"
      @pointerdown="prepareDrag"
      @dragstart="startDrag"
      @click.capture="guardDragClick"
      role="button"
      :tabindex="ready ? 0 : -1"
      :aria-label="`预览${image?.fileName ?? '图片'}`"
      :aria-disabled="!ready || opening"
      @click="openPreview"
      @keydown.enter.prevent="openPreview"
      @keydown.space.prevent="openPreview"
    >
      <el-image
        v-if="displaySource"
        :key="`${displaySource}:${attempt}`"
        :src="displaySource"
        :alt="image?.fileName ?? '图片'"
        fit="contain"
        loading="lazy"
        draggable="false"
      >
        <template #placeholder>
          <span class="message-image-status" role="status">
            <el-icon :size="32"><Picture /></el-icon>
            <span>加载中...</span>
          </span>
        </template>
        <template #error>
          <div class="message-image-status">
            <el-icon :size="32"><Picture /></el-icon>
            <span>图片加载失败</span>
            <button
              type="button"
              title="重新加载图片"
              aria-label="重新加载图片"
              @keydown.stop
              @click.stop="downloadImage"
            >
              <el-icon :size="18"><Refresh /></el-icon>
            </button>
          </div>
        </template>
      </el-image>
      <div v-else-if="image?.url" class="message-image-status" role="status">
        <el-icon :size="32"><Picture /></el-icon>
        <span>{{
          readError ||
          (downloading
            ? '正在加载图片…'
            : loading
              ? '正在读取本地图片…'
              : autoDownload
                ? '等待加载图片…'
                : image.fileName)
        }}</span>
        <el-icon
          v-if="autoDownload && downloading"
          class="is-loading"
          :size="18"
          ><Loading
        /></el-icon>
        <button
          v-if="!loading && !(autoDownload && downloading)"
          type="button"
          class="message-image-download"
          :title="
            downloading
              ? '正在下载图片'
              : readError
                ? '重试加载图片'
                : '下载图片'
          "
          :aria-label="
            downloading
              ? '正在下载图片'
              : readError
                ? '重试加载图片'
                : '下载图片'
          "
          :disabled="downloading"
          :draggable="false"
          @pointerdown.stop
          @dragstart.stop.prevent
          @keydown.stop
          @click.stop="downloadImage"
        >
          <el-icon :size="18" :class="{ 'is-loading': downloading }"
            ><Loading v-if="downloading" /><Download v-else
          /></el-icon>
          <span>{{
            downloading ? '下载中' : readError ? '重试' : '下载'
          }}</span>
        </button>
      </div>
      <span v-else class="message-image-status" role="status">
        <el-icon :size="32"><Picture /></el-icon>
        <span>图片不可用</span>
      </span>
    </div>
    <p v-if="previewError" class="message-image-preview-error" role="alert">
      {{ previewError }}
    </p>
    <p v-if="dragStatus" class="message-image-preview-error" role="status">
      {{ dragStatus }}
    </p>
    <EmojiCollectionFeedback
      :text="emojiFeedback"
      :pending="addingEmoji"
      :failed="emojiFailed"
    />
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowReactive,
  watch,
} from 'vue';
import { ElIcon, ElImage } from 'element-plus';
import {
  FolderOpened,
  Refresh,
  RefreshLeft,
  Star,
  Download,
  Loading,
  Picture,
} from '@element-plus/icons-vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import type { MenuItem } from '@imengyu/vue3-context-menu';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/image/style/css';
import { parseImageContent } from '../../../../shared/media/image/image';
import type { StoredImageContent } from '../../../../shared/media/image/image';
import type { ImagePreviewRequest } from '../../../../shared/windows/image-preview';
import { useImageFileSource } from '../../../services/media/image/image-file-source';
import { requestBrowserMessageDownload } from '../../../services/chat/messages/message-download';
import { useMessageDrag } from './useMessageDrag';
import { useMessageCopy } from './useMessageCopy';
import { replyMenuItem } from './reply-menu';
import { useMessageDeletionMenu } from './message-delete-menu';
const deletionMenu = useMessageDeletionMenu();
import { useEmojiCollection } from '../composer/useEmojiCollection';
import EmojiCollectionFeedback from '../feedback/EmojiCollectionFeedback.vue';

const props = withDefaults(
  defineProps<{
    content: string;
    conversationId: string;
    messageId: string;
    canRecall?: boolean;
    showReply?: boolean;
    recalling?: boolean;
    canAddEmoji?: boolean;
    autoDownload?: boolean;
  }>(),
  {
    canRecall: false,
    showReply: false,
    recalling: false,
    canAddEmoji: false,
    autoDownload: true,
  },
);
const emit = defineEmits<{ recall: []; reply: [] }>();
const container = ref<HTMLElement>();
const attempt = ref(0);
const visible = ref(false);
const readError = ref('');
const browserSource = ref('');
const ready = ref(false);
const loading = ref(false);
const downloading = ref(false);
const fileSource = useImageFileSource();
const api = window.historyDesktop ?? window.desktop;
let observer: IntersectionObserver | undefined;
let readVersion = 0;
const opening = ref(false);
const previewError = ref('');
const revealing = ref(false);
const {
  addingEmoji,
  emojiFeedback,
  emojiFailed,
  finishEmojiFeedback,
  addEmoji,
} = useEmojiCollection(() =>
  props.canAddEmoji
    ? { conversationId: props.conversationId, messageId: props.messageId }
    : null,
);
let menu: ContextMenuInstance | undefined;
const { copyMenuItem } = useMessageCopy();
let disposed = false;
const image = computed((): StoredImageContent | null =>
  parseImageContent(props.content),
);
const displaySource = computed((): string =>
  api ? fileSource.source.value : browserSource.value,
);
const { draggable, dragStatus, prepareDrag, startDrag, guardDragClick } =
  useMessageDrag(
    () =>
      image.value?.url && ready.value && !loading.value && !downloading.value
        ? {
            kind: 'image',
            conversationId: props.conversationId,
            messageId: props.messageId,
          }
        : null,
    () => props.content,
    () => {
      void reload();
    },
  );

/** 关闭当前图片的菜单，防止虚拟列表复用后操作旧消息。 */
const closeImageMenu = (): void => {
  menu?.closeMenu();
  menu = undefined;
};

/** 主聊天与历史共用 mac 菜单，只向各自受控桥接提交消息标识。 */
const showImageMenu = (event: MouseEvent): void => {
  event.preventDefault();
  event.stopPropagation();
  closeImageMenu();
  const request = {
    conversationId: props.conversationId,
    messageId: props.messageId,
  };
  const items = shallowReactive<MenuItem[]>([
    ...(image.value?.url
      ? [
          copyMenuItem(
            { ...request, kind: 'image' },
            () =>
              !disposed &&
              request.conversationId === props.conversationId &&
              request.messageId === props.messageId,
          ),
        ]
      : []),
    {
      label: '在文件夹中显示',
      icon: h(FolderOpened, { style: { width: '16px', height: '16px' } }),
      disabled: !api || !ready.value || revealing.value,
      onClick: () => {
        void revealImage(request);
      },
    },
    ...(props.showReply
      ? [
          replyMenuItem(() => {
            if (
              !disposed &&
              props.showReply &&
              request.conversationId === props.conversationId &&
              request.messageId === props.messageId
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
  ]);
  items.push(...deletionMenu(request));
  const currentMenu = ContextMenu.showContextMenu({
    x: event.clientX,
    y: event.clientY,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    onClose: (): void => {
      if (menu === currentMenu) menu = undefined;
    },
    items,
  });
  menu = currentMenu;
  if (
    window.desktop &&
    !window.historyDesktop &&
    props.canAddEmoji &&
    !addingEmoji.value
  )
    void updateEmojiMenu(request, currentMenu, items);
};

/** 确认未收藏才追加菜单项，不让已收藏项闪现或旧响应重开已关闭菜单。 */
const updateEmojiMenu = async (
  request: ImagePreviewRequest,
  currentMenu: ContextMenuInstance,
  items: MenuItem[],
): Promise<void> => {
  /** 菜单和异步状态必须仍属于原图片，切换或关闭后不再更新。 */
  const isCurrent = (): boolean =>
    !disposed &&
    menu === currentMenu &&
    !currentMenu.isClosed() &&
    props.canAddEmoji &&
    props.conversationId === request.conversationId &&
    props.messageId === request.messageId;
  try {
    if (typeof window.desktop?.isImageEmojiCollected !== 'function')
      throw new Error('请重启程序以加载表情收藏状态接口');
    const collected = await window.desktop.isImageEmojiCollected(request);
    if (!isCurrent() || collected || addingEmoji.value) return;
    // 追加到末尾，避免异步结果改变鼠标下方已有菜单项的位置。
    items.push({
      label: '添加到表情',
      icon: h(Star, { style: { width: '16px', height: '16px' } }),
      onClick: (): void => {
        void addEmoji(request);
      },
    });
    await nextTick();
    if (isCurrent()) currentMenu.getMenuRef()?.adjustPosition();
  } catch (error) {
    if (isCurrent())
      finishEmojiFeedback(
        error instanceof Error ? error.message : '查询表情收藏状态失败',
        true,
      );
  }
};

/** 定位过程中禁止重复触发，旧组件的异步错误不影响新消息。 */
const revealImage = async (request: {
  conversationId: string;
  messageId: string;
}): Promise<void> => {
  if (!api || !ready.value || revealing.value || disposed) return;
  revealing.value = true;
  previewError.value = '';
  try {
    if (typeof api.showImageInFolder !== 'function')
      throw new Error('请重启程序以加载图片菜单接口');
    await api.showImageInFolder(request);
  } catch (error) {
    if (
      !disposed &&
      props.conversationId === request.conversationId &&
      props.messageId === request.messageId
    )
      previewError.value =
        error instanceof Error ? error.message : '无法定位图片文件';
  } finally {
    revealing.value = false;
  }
};

/** 优先展示本地图片，允许下载时由受控接口补齐缺失缓存。 */
const loadImage = async (download: boolean): Promise<void> => {
  const version = ++readVersion;
  attempt.value++;
  readError.value = '';
  ready.value = false;
  loading.value = false;
  downloading.value = false;
  fileSource.clear();
  browserSource.value = '';
  if (!visible.value || !image.value?.url) return;
  loading.value = !download;
  downloading.value = download;
  if (!api) {
    loading.value = false;
    if (!download) return;
    try {
      const authorization = await requestBrowserMessageDownload(
        props.messageId,
        props.conversationId,
      );
      if (version === readVersion && !disposed)
        browserSource.value = authorization.downloadUrl;
    } catch (error) {
      if (version === readVersion)
        readError.value =
          error instanceof Error ? error.message : '图片读取失败';
    } finally {
      if (version === readVersion && !disposed) downloading.value = false;
    }
    return;
  }
  const request = {
    conversationId: props.conversationId,
    messageId: props.messageId,
  };
  try {
    const data = download
      ? await api.readMessageImage(request)
      : await api.readLocalMessageImage(request);
    if (disposed || version !== readVersion || !data) return;
    await fileSource.load(async () => data);
    if (!disposed && version === readVersion) ready.value = true;
  } catch (error) {
    if (!disposed && version === readVersion)
      readError.value = error instanceof Error ? error.message : '图片读取失败';
  } finally {
    if (!disposed && version === readVersion) {
      loading.value = false;
      downloading.value = false;
    }
  }
};

/** 图片进入可见区域后自动补齐缺失缓存，聊天与历史记录使用同一策略。 */
const reload = async (): Promise<void> => loadImage(props.autoDownload);

/** 显式下载成功后再开放预览和拖动，失败保留下载重试入口。 */
const downloadImage = async (): Promise<void> => {
  if (loading.value || downloading.value || disposed) return;
  await loadImage(true);
};

/** 只传递已落库消息标识，图片 URL 与会话权限由主进程再次读取和验证。 */
const openPreview = async (): Promise<void> => {
  if (!image.value?.url || !ready.value || opening.value) return;
  if (!api) {
    previewError.value = '独立图片预览需要 Electron 客户端';
    return;
  }
  opening.value = true;
  previewError.value = '';
  try {
    await api.openImagePreview({
      conversationId: props.conversationId,
      messageId: props.messageId,
    });
  } catch (error) {
    previewError.value =
      error instanceof Error ? error.message : '打开图片预览失败';
  } finally {
    opening.value = false;
  }
};

watch(
  () => [
    props.conversationId,
    props.messageId,
    props.content,
    props.canAddEmoji,
  ],
  () => {
    closeImageMenu();
  },
  { flush: 'sync' },
);
watch(
  () => [
    props.conversationId,
    props.messageId,
    props.content,
    props.autoDownload,
  ],
  () => {
    void reload();
  },
  { flush: 'sync' },
);
watch(visible, (value) => {
  if (
    value &&
    !ready.value &&
    !loading.value &&
    !downloading.value &&
    !readError.value &&
    !displaySource.value
  )
    void reload();
});
onMounted(() => {
  if (!window.contextMenuHost) window.addEventListener('blur', closeImageMenu);
  observer = new IntersectionObserver(
    (entries) => {
      visible.value = entries.some((entry) => entry.isIntersecting);
    },
    { rootMargin: '100px' },
  );
  if (container.value) observer.observe(container.value);
});
onBeforeUnmount(() => {
  disposed = true;
  closeImageMenu();
  window.removeEventListener('blur', closeImageMenu);
  readVersion++;
  observer?.disconnect();
});
</script>

<style scoped>
.message-image {
  width: 240px;
  max-width: 100%;
  min-width: 0;
}
.message-image-frame {
  width: 100%;
  aspect-ratio: 4 / 3;
  cursor: default;
}
.message-image-frame:focus-visible {
  outline: 2px solid #078b5d;
  outline-offset: 2px;
}
.message-image-preview-error {
  margin: 4px 0 0;
  font-size: 12px;
  color: #b42318;
  overflow-wrap: anywhere;
}
.message-image .el-image {
  display: block;
  width: 100%;
  height: 100%;
  border-radius: 4px;
}
.message-image-status {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
  padding: 12px;
  border-radius: 4px;
  background: #f2f3f5;
  color: #757575;
  font-size: 12px;
  text-align: center;
  overflow-wrap: anywhere;
}
.message-image-status button {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid #dcdcdc;
  border-radius: 4px;
  background: #fff;
  color: #666;
  cursor: pointer;
}
.message-image-status .message-image-download {
  display: flex;
  width: auto;
  height: 30px;
  gap: 5px;
  padding: 0 9px;
  color: #078b5d;
}
.message-image-download:disabled {
  cursor: default;
  color: #757575;
}
</style>
