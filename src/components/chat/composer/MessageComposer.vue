<template>
  <div v-if="groupRemoved" class="chat-composer-unavailable" role="status">
    <el-icon><Warning /></el-icon>
    <span>无法在已退出的群聊中发送消息</span>
  </div>
  <form
    v-else
    ref="composerPanel"
    class="chat-composer"
    :class="{
      'chat-composer--images': imageDrafts.length,
      'chat-composer--files':
        (fileDrafts.length || videoDrafts.length) && !imageDrafts.length,
      'chat-composer--dragging': dragDepth > 0,
      'chat-composer--resizing': resizing,
      'chat-composer--reply': Boolean(replyMessage),
      'chat-composer--scrollable': composerHeight >= maximumHeight,
    }"
    :style="{ height: `${composerHeight}px` }"
    :data-media-drop-room="roomId"
    :data-media-drop-enabled="!imageSelectionDisabled"
    @submit.prevent="emit('send')"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div
      ref="resizeHandle"
      class="composer-resize-handle"
      role="separator"
      tabindex="0"
      aria-label="调整输入区高度"
      aria-orientation="horizontal"
      :aria-valuemin="minimumHeight"
      :aria-valuemax="maximumHeight"
      :aria-valuenow="composerHeight"
      @pointerdown="startResize"
      @pointermove="moveResize"
      @pointerup="stopResize"
      @pointercancel="stopResize"
      @lostpointercapture="stopResize"
      @keydown="onResizeKeydown"
      @dblclick="resetHeight"
    ></div>
    <div
      v-if="imageDrafts.length || videoDrafts.length || fileDrafts.length"
      class="composer-image-strip"
      aria-label="待发送附件"
    >
      <div
        v-for="image in imageDrafts"
        :key="image.id"
        class="composer-image-item"
      >
        <el-image
          :src="image.previewUrl"
          :alt="image.fileName"
          role="button"
          tabindex="0"
          :aria-label="`预览 ${image.fileName}`"
          fit="contain"
          draggable="false"
          @dragstart.prevent
          @click="emit('previewImage', image.id)"
          @keydown.enter.prevent="emit('previewImage', image.id)"
          @keydown.space.prevent="emit('previewImage', image.id)"
        >
          <template #error
            ><span class="composer-image-error">预览失败</span></template
          >
        </el-image>
        <button
          type="button"
          class="composer-image-remove"
          title="移除图片"
          :aria-label="`移除 ${image.fileName}`"
          :disabled="sending || uploadingImage || fileBusy"
          @click="emit('removeImage', image.id)"
        >
          <el-icon :size="14"><Close /></el-icon>
        </button>
      </div>
      <FileAttachmentCard
        v-for="video in videoDraftViews"
        :key="video.id"
        class="composer-file-item"
        :file-name="video.fileName"
        :file-size="video.fileSize"
        :title="video.title"
      >
        <template v-if="video.processing !== 'ready'" #detail>
          <span class="composer-draft-state" role="status">{{
            video.label
          }}</span>
        </template>
        <template #icon>
          <img
            v-if="video.processing === 'ready'"
            class="composer-video-poster"
            :src="video.posterUrl"
            :alt="video.fileName"
            draggable="false"
          />
          <DraftPreparationProgress
            v-else
            :phase="video.processing"
            :progress="video.processingProgress"
          />
        </template>
        <button
          type="button"
          class="composer-file-remove"
          title="移除视频"
          :aria-label="`移除 ${video.fileName}`"
          :disabled="readOnly || sending || uploadingImage"
          @click="emit('removeVideo', video.id)"
        >
          <Close />
        </button>
      </FileAttachmentCard>
      <FileAttachmentCard
        v-for="file in fileDrafts"
        :key="file.id"
        class="composer-file-item"
        :file-name="file.fileName"
        :file-size="file.fileSize"
        :title="file.processingError || file.fileName"
      >
        <template v-if="file.processing !== 'ready'" #detail>
          <span class="composer-draft-state" role="status">{{
            file.processing === 'failed' ? '准备失败' : '正在读取'
          }}</span>
        </template>
        <template v-if="file.processing !== 'ready'" #icon>
          <DraftPreparationProgress
            :phase="file.processing"
            :progress="file.processingProgress"
          />
        </template>
        <button
          type="button"
          class="composer-file-remove"
          title="移除附件"
          :aria-label="`移除 ${file.fileName}`"
          :disabled="readOnly || sending || uploadingImage"
          @click="emit('removeFile', file.id)"
        >
          <Close />
        </button>
      </FileAttachmentCard>
    </div>
    <textarea
      ref="composer"
      v-model="draft"
      aria-label="消息内容"
      :placeholder="fileDrafts.length || videoDrafts.length ? '' : '输入消息'"
      maxlength="10000"
      :disabled="readOnly || sending || loadingMessages || initializationFailed"
      @input="scheduleContentMeasurement"
      @keydown="onComposerKeydown"
    ></textarea>
    <ReplyDraftPreview
      v-if="replyMessage"
      :key="`${replyMessage.conversationId}:${replyMessage.id}`"
      :message="replyMessage"
      :sender="replySender ?? ''"
      @cancel="emit('cancelReply')"
    />
    <div
      class="chat-composer-bottom"
      :class="{ 'chat-composer-bottom--recording': voiceRecordingActive }"
    >
      <div v-show="!voiceRecordingActive" class="chat-composer-tools">
        <el-popover
          v-model:visible="emojiOpen"
          placement="top"
          :width="520"
          :popper-style="{ maxWidth: 'calc(100vw - 24px)' }"
          trigger="click"
          @show="emit('loadEmojis')"
          ><template #reference
            ><button
              type="button"
              class="chat-small-button"
              title="表情"
              aria-label="表情"
            >
              <img
                :src="emojiButtonIcon"
                alt=""
                width="22"
                height="22"
                draggable="false"
              /></button
          ></template>
          <div ref="emojiPanel" class="emoji-panel">
            <el-tabs v-model="emojiTab" class="emoji-tabs">
              <el-tab-pane label="收藏" name="images">
                <p v-if="emojiLoading" class="emoji-list-status" role="status">
                  正在加载...
                </p>
                <div v-if="emojiError" class="emoji-list-status" role="alert">
                  {{ emojiError }}
                </div>
                <div class="emoji-image-grid" @dragstart.prevent>
                  <button
                    v-for="emoji in userEmojis"
                    :key="emoji.imgId"
                    type="button"
                    class="emoji-image-item"
                    title="发送表情包"
                    :aria-label="`发送表情包 ${emoji.imgId}`"
                    :aria-disabled="
                      emojiSendDisabled || busyEmojiId === emoji.imgId
                    "
                    :aria-busy="busyEmojiId === emoji.imgId"
                    @click="sendImageEmoji(emoji)"
                    @contextmenu.prevent.stop="showEmojiMenu($event, emoji)"
                  >
                    <el-image
                      :src="emoji.url"
                      :alt="`表情包 ${emoji.imgId}`"
                      fit="contain"
                      loading="lazy"
                      draggable="false"
                    >
                      <template #placeholder>
                        <span class="emoji-image-placeholder">加载中</span>
                      </template>
                      <template #error>
                        <span class="emoji-image-placeholder">加载失败</span>
                      </template>
                    </el-image>
                    <el-icon
                      v-if="busyEmojiId === emoji.imgId"
                      class="emoji-operation-spinner is-loading"
                      :aria-label="
                        emojiOperation === 'delete' ? '正在删除' : '正在移动'
                      "
                      ><Loading
                    /></el-icon>
                  </button>
                </div>
              </el-tab-pane>
              <el-tab-pane label="表情" name="text">
                <div class="chat-emojis">
                  <button
                    v-for="emoji in emojis"
                    :key="emoji"
                    type="button"
                    :aria-label="emoji"
                    @click="insertEmoji(emoji)"
                  >
                    {{ emoji }}
                  </button>
                </div>
              </el-tab-pane>
            </el-tabs>
          </div>
        </el-popover>
        <button
          type="button"
          class="chat-small-button"
          :title="uploadingImage ? '正在发送' : '发送文件'"
          aria-label="发送文件"
          :disabled="mediaButtonDisabled"
          :aria-disabled="imageSelectionDisabled"
          @click="emit('chooseFiles')"
        >
          <el-icon :size="22" :class="{ 'is-loading': uploadingImage }">
            <Loading v-if="uploadingImage" />
            <FolderOpened v-else />
          </el-icon>
        </button>
        <button
          type="button"
          class="chat-small-button"
          :title="isDesktop ? '截图' : '截图需使用桌面客户端'"
          aria-label="截图"
          :disabled="mediaButtonDisabled"
          :aria-disabled="imageSelectionDisabled"
          @click="emit('captureScreenshot')"
        >
          <el-icon :size="21"><Scissor /></el-icon>
        </button>
        <el-popover
          v-model:visible="screenshotOptionsOpen"
          placement="top-start"
          :width="168"
          :show-arrow="false"
          :popper-style="{ padding: '4px', borderRadius: '6px' }"
          :disabled="mediaButtonDisabled"
          transition=""
          trigger="click"
        >
          <button
            type="button"
            class="screenshot-option"
            :disabled="imageSelectionDisabled"
            @click="captureWithoutHiding"
          >
            不隐藏窗口截图
          </button>
          <template #reference>
            <button
              type="button"
              class="chat-small-button screenshot-options-button"
              title="截图选项"
              aria-label="截图选项"
              aria-haspopup="dialog"
              :aria-expanded="screenshotOptionsOpen"
              :disabled="mediaButtonDisabled"
              :aria-disabled="imageSelectionDisabled"
            >
              <el-icon :size="12"><ArrowDown /></el-icon>
            </button>
          </template>
        </el-popover>
        <span class="chat-unavailable-tool" title="语音输入暂未接入">
          <button
            type="button"
            class="chat-small-button"
            aria-label="语音输入暂未接入"
            disabled
          >
            <el-icon :size="21"><Microphone /></el-icon>
          </button>
        </span>
      </div>
      <div class="chat-send-row">
        <VoiceRecorder
          :room-id="roomId"
          :disabled="
            readOnly ||
            !isDesktop ||
            !canSendMedia ||
            sending ||
            uploadingImage ||
            initializationFailed ||
            fileBusy
          "
          :submit="sendVoice"
          @active-change="voiceRecordingActive = $event"
        />
        <el-button
          v-show="!voiceRecordingActive"
          native-type="submit"
          type="primary"
          :loading="sending"
          :title="sendButtonTitle"
          :disabled="
            readOnly ||
            sending ||
            uploadingImage ||
            (!draft.trim() &&
              !imageDrafts.length &&
              !videoDrafts.length &&
              !fileDrafts.length) ||
            loadingMessages ||
            initializationFailed ||
            fileBusy ||
            videoDrafts.some((video) => !isReadyVideoDraft(video)) ||
            fileDrafts.some((file) => file.processing !== 'ready')
          "
          >发送</el-button
        >
      </div>
    </div>
  </form>
</template>

<script setup lang="ts">
import {
  computed,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue';
import ContextMenu from '../../../services/context-menu/context-menu';
import type { ContextMenuInstance } from '../../../services/context-menu/context-menu';
import { waitForScreenshotPaint } from '../../../pages/screenshot/screenshot-paint';
import {
  ElButton,
  ElIcon,
  ElPopover,
  ElTabs,
  ElTabPane,
  ElImage,
} from 'element-plus';
import 'element-plus/es/components/button/style/css';
import 'element-plus/es/components/icon/style/css';
import 'element-plus/es/components/popover/style/css';
import 'element-plus/es/components/tabs/style/css';
import 'element-plus/es/components/tab-pane/style/css';
import 'element-plus/es/components/image/style/css';
import type { UserEmoji } from '../../../../shared/chat/emoji';
import type { ComposerImageDraft } from '../../../../shared/media/image/image';
import type {
  ComposerVideoItem,
  PreparingVideoDraft,
} from '../../../../shared/media/video/video';
import { isReadyVideoDraft } from '../../../../shared/media/video/video';
import type { ComposerFileDraft } from '../../../../shared/media/file/file-message';
import FileAttachmentCard from '../attachments/FileAttachmentCard.vue';
import DraftPreparationProgress from './DraftPreparationProgress.vue';
import VoiceRecorder from './VoiceRecorder.vue';
import ReplyDraftPreview from './ReplyDraftPreview.vue';
import type { Message } from '../../../../shared/storage/database';
import emojis from '../../../assets/emojis.json';
import emojiButtonIcon from '../../../assets/emoji-button.png';
import {
  FolderOpened,
  Microphone,
  Scissor,
  Loading,
  Close,
  ArrowDown,
  Delete,
  Top,
  Warning,
} from '@element-plus/icons-vue';

const props = defineProps<{
  sendVoice: (
    roomId: string,
    bytes: Uint8Array<ArrayBufferLike>,
  ) => Promise<void>;
  roomId: string;
  replyMessage?: Message | null;
  replySender?: string;
  imageDrafts: ComposerImageDraft[];
  videoDrafts: ComposerVideoItem[];
  fileDrafts: ComposerFileDraft[];
  sending: boolean;
  readOnly: boolean;
  groupRemoved?: boolean;
  loadingMessages: boolean;
  initializationFailed: boolean;
  fileBusy: boolean;
  isDesktop: boolean;
  userEmojis: UserEmoji[];
  emojiLoading: boolean;
  emojiError: string;
  busyEmojiId: string;
  emojiOperation: 'delete' | 'front';
  canSendEmojis: boolean;
  canSendMedia: boolean;
  uploadingImage: boolean;
}>();
const emit = defineEmits<{
  (event: 'send'): void;
  (event: 'cancelReply'): void;
  (event: 'sendEmoji', emoji: UserEmoji): void;
  (event: 'captureScreenshot', hideWindow?: boolean): void;
  (event: 'removeVideo', id: string): void;
  (event: 'removeFile', id: string): void;
  (event: 'removeImage', id: string): void;
  (event: 'previewImage', id: string): void;
  (event: 'chooseFiles'): void;
  (event: 'loadEmojis'): void;
  (event: 'deleteEmoji', emoji: UserEmoji): void;
  (event: 'frontEmoji', emoji: UserEmoji): void;
}>();
const emojiTab = ref('images');
const emojiOpen = ref(false);
const emojiPanel = ref<HTMLDivElement>();
let emojiMenu: ContextMenuInstance | undefined;
const screenshotOptionsOpen = ref(false);

/** 面板关闭、滚动或授权变化时清理收藏右键菜单。 */
const closeEmojiMenu = (): void => {
  emojiMenu?.closeMenu();
  emojiMenu = undefined;
};

/** 复用聊天菜单主题，菜单挂在面板内以免点击删除先触发浮层外部关闭。 */
const showEmojiMenu = (event: MouseEvent, emoji: UserEmoji): void => {
  closeEmojiMenu();
  const panel = emojiPanel.value;
  if (
    !panel ||
    !emojiOpen.value ||
    props.readOnly ||
    !props.isDesktop ||
    !props.userEmojis.some((item) => item.imgId === emoji.imgId)
  )
    return;
  const bounds = panel.getBoundingClientRect();
  const roomId = props.roomId;
  const currentMenu = ContextMenu.showContextMenu({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
    getContainer: panel,
    theme: 'mac',
    customClass: 'chat-context-menu',
    minWidth: 180,
    items: [
      {
        label: '移到最前',
        icon: h(Top, { style: { width: '16px', height: '16px' } }),
        divided: 'down',
        disabled:
          Boolean(props.busyEmojiId) ||
          props.userEmojis[0]?.imgId === emoji.imgId,
        onClick: (): void => {
          if (
            !props.readOnly &&
            !props.busyEmojiId &&
            emojiOpen.value &&
            roomId === props.roomId &&
            props.userEmojis.some((item) => item.imgId === emoji.imgId)
          )
            emit('frontEmoji', emoji);
          closeEmojiMenu();
        },
      },
      {
        label: '删除表情包',
        icon: h(Delete, { style: { width: '16px', height: '16px' } }),
        customClass: 'chat-context-menu-danger',
        disabled: Boolean(props.busyEmojiId),
        onClick: (): void => {
          if (
            !props.readOnly &&
            !props.busyEmojiId &&
            emojiOpen.value &&
            roomId === props.roomId &&
            props.userEmojis.some((item) => item.imgId === emoji.imgId)
          )
            emit('deleteEmoji', emoji);
          closeEmojiMenu();
        },
      },
    ],
    onClose: (): void => {
      if (emojiMenu === currentMenu) emojiMenu = undefined;
    },
  });
  emojiMenu = currentMenu;
};

watch(
  () => [
    emojiOpen.value,
    emojiTab.value,
    props.roomId,
    props.readOnly,
    props.userEmojis,
    props.busyEmojiId,
  ],
  closeEmojiMenu,
  { flush: 'sync' },
);

/** 显示实际准备阶段，不将封面解析表示成已知百分比。 */
const videoDraftLabel = (video: ComposerVideoItem): string => {
  if (isReadyVideoDraft(video)) return '';
  switch (video.processing) {
    case 'hashing':
      return '正在读取';
    case 'preview':
      return '正在解析';
    case 'failed':
      return '解析失败';
  }
};

/** 保留完整文件名和错误原因供鼠标悬停查看。 */
const videoDraftTitle = (video: ComposerVideoItem): string => {
  if (isReadyVideoDraft(video)) return video.fileName;
  return `${video.fileName}\n${video.processingError || videoDraftLabel(video)}`;
};

interface VideoDraftView {
  id: string;
  fileName: string;
  fileSize: number;
  posterUrl: string;
  processing: 'ready' | PreparingVideoDraft['processing'];
  processingProgress: number;
  label: string;
  title: string;
}

/** 在脚本中收窄草稿类型，模板只读取字段完整的展示对象。 */
const videoDraftViews = computed((): VideoDraftView[] =>
  props.videoDrafts.map((video): VideoDraftView => {
    const common = {
      id: video.id,
      fileName: video.fileName,
      fileSize: video.fileSize,
      label: videoDraftLabel(video),
      title: videoDraftTitle(video),
    };
    if (isReadyVideoDraft(video)) {
      return {
        ...common,
        posterUrl: video.posterUrl,
        processing: 'ready',
        processingProgress: 100,
      };
    }
    return {
      ...common,
      posterUrl: '',
      processing: video.processing,
      processingProgress: video.processingProgress,
    };
  }),
);
const voiceRecordingActive = ref(false);
let screenshotRequest = 0;
const dragDepth = ref(0);
const composerPanel = ref<HTMLFormElement>();
const resizeHandle = ref<HTMLDivElement>();
const requestedHeight = ref<number | null>(null);
const contentHeight = ref(0);
const availableHeight = ref(800);
const resizing = ref(false);
let resizeObserver: ResizeObserver | undefined;
let resizePointer: number | undefined;
let resizeStartY = 0;
let resizeStartHeight = 0;
let contentMeasureFrame: number | undefined;
const hasMediaDrafts = computed((): boolean => props.imageDrafts.length > 0);
const replyHeightDelta = computed((): number =>
  props.replyMessage && props.replyMessage.messageType !== 'text' ? 48 : 0,
);
const minimumHeight = computed((): number => {
  if (hasMediaDrafts.value) return 180 + replyHeightDelta.value;
  const base = props.fileDrafts.length || props.videoDrafts.length ? 132 : 100;
  return base + replyHeightDelta.value;
});
const maximumHeight = computed((): number =>
  Math.max(minimumHeight.value, Math.min(480, availableHeight.value - 120)),
);
const composerHeight = computed((): number =>
  Math.max(
    minimumHeight.value,
    Math.min(
      maximumHeight.value,
      Math.max(
        (requestedHeight.value ?? (hasMediaDrafts.value ? 246 : 132)) +
          replyHeightDelta.value,
        contentHeight.value,
      ),
    ),
  ),
);

/** 按消息区与输入区的总高度限制拖动范围，给消息列表保留可见空间。 */
const measureAvailableHeight = (): void => {
  const panel = composerPanel.value;
  const messages = panel?.previousElementSibling;
  if (!panel || !messages || panel.getClientRects().length === 0) return;
  availableHeight.value = Math.floor(
    panel.getBoundingClientRect().height +
      messages.getBoundingClientRect().height,
  );
};

/** 测量正文自然高度，保留附件、引用和工具栏占用，并恢复光标所在的滚动位置。 */
const measureContentHeight = (): void => {
  contentMeasureFrame = undefined;
  const panel = composerPanel.value;
  const input = composer.value;
  if (!panel || !input || panel.getClientRects().length === 0) return;
  measureAvailableHeight();
  const occupiedHeight =
    panel.getBoundingClientRect().height - input.getBoundingClientRect().height;
  const { height, flex, overflowY } = input.style;
  const scrollTop = input.scrollTop;
  // 暂时收起正文才能测得删除文字后的自然高度；测量期间不改变草稿或选区。
  input.style.flex = 'none';
  input.style.height = '0px';
  input.style.overflowY = 'hidden';
  const naturalHeight = input.scrollHeight;
  input.style.height = height;
  input.style.flex = flex;
  input.style.overflowY = overflowY;
  input.scrollTop = scrollTop;
  contentHeight.value = Math.ceil(occupiedHeight + naturalHeight);
};

/** 合并输入与布局变化，在下一帧统一计算高度，避免尺寸观察器内重复布局。 */
const scheduleContentMeasurement = (): void => {
  if (contentMeasureFrame !== undefined) return;
  contentMeasureFrame = window.requestAnimationFrame(measureContentHeight);
};

/** 夹紧拖动高度，只保存基础高度，使媒体引用移除后恢复原有输入空间。 */
const setComposerHeight = (height: number): void => {
  requestedHeight.value =
    Math.max(
      minimumHeight.value,
      Math.min(maximumHeight.value, Math.round(height)),
    ) - replyHeightDelta.value;
};

/** 捕获主指针，使拖出上边框后仍可连续调整输入区。 */
const startResize = (event: PointerEvent): void => {
  if (!event.isPrimary || event.button !== 0 || resizePointer !== undefined)
    return;
  const handle = resizeHandle.value;
  if (!handle) return;
  event.preventDefault();
  measureAvailableHeight();
  resizeStartY = event.clientY;
  resizeStartHeight = composerHeight.value;
  handle.setPointerCapture(event.pointerId);
  resizePointer = event.pointerId;
  resizing.value = true;
  handle.focus({ preventScroll: true });
};

/** 上移边框增高输入区，下移缩小；消息列表由原有弹性布局同步调整。 */
const moveResize = (event: PointerEvent): void => {
  if (event.pointerId !== resizePointer) return;
  setComposerHeight(resizeStartHeight + resizeStartY - event.clientY);
  resizeStartY = event.clientY;
  resizeStartHeight = composerHeight.value;
};

/** 松开、取消或窗口失焦时释放捕获，避免残留拖动状态。 */
const stopResize = (): void => {
  const pointer = resizePointer;
  const handle = resizeHandle.value;
  resizePointer = undefined;
  resizing.value = false;
  if (pointer === undefined || !handle || !handle.hasPointerCapture(pointer))
    return;
  handle.releasePointerCapture(pointer);
};

/** 双击分隔线恢复当前草稿类型的默认高度。 */
const resetHeight = (): void => {
  stopResize();
  requestedHeight.value = null;
};

/** 为分隔线提供方向键和边界键操作，不触发输入表单发送。 */
const onResizeKeydown = (event: KeyboardEvent): void => {
  switch (event.key) {
    case 'ArrowUp':
      setComposerHeight(composerHeight.value + 16);
      break;
    case 'ArrowDown':
      setComposerHeight(composerHeight.value - 16);
      break;
    case 'Home':
      setComposerHeight(minimumHeight.value);
      break;
    case 'End':
      setComposerHeight(maximumHeight.value);
      break;
    default:
      return;
  }
  event.preventDefault();
};

onMounted((): void => {
  const panel = composerPanel.value;
  if (!panel) return;
  measureAvailableHeight();
  resizeObserver = new ResizeObserver((): void => {
    measureAvailableHeight();
    scheduleContentMeasurement();
  });
  resizeObserver.observe(panel);
  if (composer.value) resizeObserver.observe(composer.value);
  if (panel.parentElement) resizeObserver.observe(panel.parentElement);
  if (panel.previousElementSibling)
    resizeObserver.observe(panel.previousElementSibling);
  scheduleContentMeasurement();
  window.addEventListener('blur', stopResize);
  if (!window.contextMenuHost) window.addEventListener('blur', closeEmojiMenu);
  window.addEventListener('resize', closeEmojiMenu);
  window.addEventListener('scroll', closeEmojiMenu, true);
});

watch(() => props.roomId, stopResize);

const emojiSendDisabled = computed(
  (): boolean =>
    props.readOnly ||
    !props.canSendEmojis ||
    props.groupRemoved ||
    props.sending ||
    props.loadingMessages ||
    props.initializationFailed ||
    props.fileBusy,
);
const imageSelectionDisabled = computed(
  (): boolean =>
    emojiSendDisabled.value ||
    !props.canSendMedia ||
    !props.isDesktop ||
    props.uploadingImage,
);
/** 控制文件和截图工具的稳定按钮状态，不随会话加载过程短暂变化。 */
const mediaButtonDisabled = computed(
  (): boolean =>
    props.readOnly ||
    !props.canSendMedia ||
    !props.isDesktop ||
    props.groupRemoved ||
    props.sending ||
    props.initializationFailed ||
    props.fileBusy ||
    props.uploadingImage,
);

const sendButtonTitle = computed((): string => {
  switch (true) {
    case props.canSendEmojis:
      return '发送消息';
    case props.isDesktop:
      return '保存到本地，不发送到服务器';
    default:
      return '暂存到内存，不发送到服务器';
  }
});

/** 仅对可接收的原生文件拖入显示高亮。 */
const onDragEnter = (event: DragEvent): void => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  if (!imageSelectionDisabled.value) dragDepth.value++;
};

/** 禁止默认打开文件，仅在当前会话可发送时显示复制光标。 */
const onDragOver = (event: DragEvent): void => {
  const transfer = event.dataTransfer;
  if (!transfer || !transfer.types.includes('Files')) return;
  event.preventDefault();
  transfer.dropEffect = imageSelectionDisabled.value ? 'none' : 'copy';
};

/** 子元素之间移动时平衡进入计数，避免高亮闪烁。 */
const onDragLeave = (event: DragEvent): void => {
  if (event.dataTransfer?.types.includes('Files'))
    dragDepth.value = Math.max(0, dragDepth.value - 1);
};

/** 文件读取交给隔离 preload；组件只负责清除拖放视觉状态。 */
const onDrop = (event: DragEvent): void => {
  if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
  dragDepth.value = 0;
};

watch(
  () => [props.roomId, imageSelectionDisabled.value],
  (): void => {
    dragDepth.value = 0;
    screenshotOptionsOpen.value = false;
    screenshotRequest++;
  },
);

const draft = defineModel<string, string, string, string>('draft', {
  required: true,
});
const composer = ref<HTMLTextAreaElement>();

watch(
  () => [
    draft.value,
    props.roomId,
    props.replyMessage,
    props.imageDrafts.length,
    props.videoDrafts.length,
    props.fileDrafts.length,
    voiceRecordingActive.value,
    composerHeight.value,
  ],
  scheduleContentMeasurement,
  { flush: 'post' },
);

/** 草稿回填后聚焦输入区，将光标放到文本末尾。 */
const focus = (): void => {
  const input = composer.value;
  if (!input || input.disabled) return;
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
};

defineExpose({ focus });

/** 发送选中的收藏表情并关闭选择面板，文字草稿保持不变。 */
const sendImageEmoji = (emoji: UserEmoji): void => {
  if (emojiSendDisabled.value || props.busyEmojiId === emoji.imgId) return;
  emit('sendEmoji', emoji);
  emojiOpen.value = false;
};

/** 在草稿中插入表情并关闭选择面板，遵守消息长度限制。 */
const insertEmoji = (emoji: string): void => {
  if (
    props.readOnly ||
    props.sending ||
    draft.value.length + emoji.length > 10000
  )
    return;
  draft.value += emoji;
  emojiOpen.value = false;
  composer.value?.focus();
};

/** 使用不隐藏主窗口的方式发起截图，截图窗口仍由主进程创建和校验。 */
const captureWithoutHiding = async (): Promise<void> => {
  if (imageSelectionDisabled.value) return;
  const request = ++screenshotRequest;
  screenshotOptionsOpen.value = false;
  // 等菜单关闭后的画面完成绘制，避免快照包含弹出菜单。
  await nextTick();
  await waitForScreenshotPaint();
  if (request !== screenshotRequest || imageSelectionDisabled.value) return;
  emit('captureScreenshot', false);
};

onBeforeUnmount((): void => {
  closeEmojiMenu();
  window.removeEventListener('blur', closeEmojiMenu);
  window.removeEventListener('resize', closeEmojiMenu);
  window.removeEventListener('scroll', closeEmojiMenu, true);
  screenshotRequest++;
  stopResize();
  resizeObserver?.disconnect();
  if (contentMeasureFrame !== undefined)
    window.cancelAnimationFrame(contentMeasureFrame);
  window.removeEventListener('blur', stopResize);
});

/** 按显示顺序从末尾移除一个附件，沿用各类型移除按钮的忙碌限制。 */
const removeLastAttachment = (): void => {
  const file = props.fileDrafts[props.fileDrafts.length - 1];
  if (file) {
    emit('removeFile', file.id);
    return;
  }
  const video = props.videoDrafts[props.videoDrafts.length - 1];
  if (video) {
    emit('removeVideo', video.id);
    return;
  }
  const image = props.imageDrafts[props.imageDrafts.length - 1];
  if (image && !props.fileBusy) emit('removeImage', image.id);
};

/** 回退键在文字起点移除附件；保留文字编辑、输入法及回车发送行为。 */
const onComposerKeydown = (event: KeyboardEvent): void => {
  if (
    props.readOnly ||
    event.defaultPrevented ||
    event.isComposing ||
    event.keyCode === 229
  )
    return;
  switch (event.key) {
    case 'Backspace': {
      const input = composer.value;
      if (
        !input ||
        input.disabled ||
        input.selectionStart !== 0 ||
        input.selectionEnd !== 0 ||
        props.sending ||
        props.uploadingImage ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      event.preventDefault();
      if (!event.repeat) removeLastAttachment();
      return;
    }
    case 'Enter':
      if (event.shiftKey) return;
      event.preventDefault();
      emit('send');
      return;
    default:
      return;
  }
};
</script>

<style>
.emoji-panel {
  position: relative;
}
.emoji-image-item[aria-busy='true'] {
  position: relative;
}
.emoji-operation-spinner {
  position: absolute;
  inset: 0;
  margin: auto;
  color: #444;
  background: #fff;
}
.chat-composer {
  display: flex;
  flex-direction: column;
  height: 132px;
  flex-shrink: 0;
  min-width: 0;
  margin: 0 8px 8px;
  border: 1px solid #e1e1e4;
  border-radius: 8px;
  background: #fafafa;
  padding: 8px 10px;
  box-shadow: 0 1px 3px #00000005;
}
.chat-composer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  height: 32px;
  flex-shrink: 0;
}
.chat-composer-tools {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 32px;
}
.chat-composer textarea {
  flex: 1;
  min-height: 0;
  resize: none;
  overflow-y: hidden;
  width: 100%;
  padding: 2px 3px 8px;
  border: 0;
  outline: 0;
  background: transparent;
  color: #262626;
  font: inherit;
  font-size: 14px;
  line-height: 1.5;
}
.chat-composer--scrollable textarea {
  overflow-y: auto;
}
.chat-composer textarea::placeholder {
  color: #a1a1aa;
}
.chat-composer:focus-within {
  background: #fff;
  border-color: #c9c9cd;
}
.chat-send-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
  min-width: 0;
  flex-wrap: wrap;
}
.chat-unavailable-tool {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}
.chat-unavailable-tool .chat-small-button {
  pointer-events: none;
}
.chat-send-row .el-button {
  min-width: 54px;
  height: 30px;
  font-size: 13px;
  color: #07964e;
  background: #e9e9e9;
}
.chat-send-row .el-button:hover:not(:disabled) {
  background: #d8eddb;
}
.chat-send-row .el-button:disabled {
  color: #aaa;
}
.chat-emojis {
  display: grid;
  grid-template-columns: repeat(auto-fill, 40px);
  gap: 4px;
}
.chat-emojis button {
  width: 40px;
  height: 36px;
  background: transparent;
  border: 0;
  font-size: 22px;
  cursor: pointer;
}
.chat-emojis button:hover {
  background: #eee;
  border-radius: 4px;
}
@media (max-width: 560px) {
  .chat-composer {
    padding-inline: 8px;
  }
}
@media (max-width: 560px) {
  .chat-composer-tools {
    gap: 2px;
  }
}
@media (max-width: 560px) {
  .chat-composer-tools .chat-small-button {
    width: 28px;
  }
}
@media (max-width: 560px) {
  .chat-voice-tool {
    display: none;
  }
}
</style>

<style scoped>
.chat-composer-unavailable {
  display: flex;
  flex: 0 0 130px;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  box-sizing: border-box;
  padding: 16px;
  border: 1px solid #dedede;
  border-radius: 8px;
  background: #fafafa;
  color: #999ba3;
  font-size: 13px;
  line-height: 20px;
  text-align: center;
  overflow-wrap: anywhere;
}
.chat-composer-bottom--recording {
  height: 36px;
}
.chat-composer-bottom--recording .chat-send-row {
  flex: 1;
}
.chat-composer {
  position: relative;
}
.composer-resize-handle {
  position: absolute;
  z-index: 1;
  top: -5px;
  right: 8px;
  left: 8px;
  height: 10px;
  cursor: ns-resize;
  touch-action: none;
  user-select: none;
  -webkit-app-region: no-drag;
}
.composer-resize-handle:focus-visible::after {
  position: absolute;
  top: 4px;
  right: 0;
  left: 0;
  height: 2px;
  background: #c9c9cd;
  content: '';
}
.composer-resize-handle:focus-visible {
  outline: none;
}
.chat-composer--resizing {
  user-select: none;
}
.composer-file-item {
  align-self: flex-start;
  flex: 0 0 228px;
}
.composer-file-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: 1px solid #d8d8da;
  border-radius: 50%;
  background: #fafafa;
  color: #777;
  opacity: 0;
  cursor: pointer;
  transition: opacity 120ms ease;
}
.composer-file-remove svg {
  width: 12px;
  height: 12px;
}
.composer-file-item:hover .composer-file-remove,
.composer-file-item:focus-within .composer-file-remove {
  opacity: 1;
}
.composer-file-remove:focus-visible {
  outline: 2px solid #078b5d;
  outline-offset: 2px;
}
.composer-file-remove:disabled {
  cursor: not-allowed;
  color: #b5b5b8;
}
@media (hover: none) {
  .composer-file-remove {
    opacity: 1;
  }
}
.chat-composer.chat-composer--files {
  display: grid;
  grid-template-columns: minmax(0, max-content) minmax(64px, 1fr);
  grid-template-rows: minmax(0, 1fr) auto;
  column-gap: 4px;
}
.chat-composer--files .composer-image-strip {
  grid-column: 1;
  grid-row: 1;
  align-self: start;
  min-width: 0;
  min-height: 68px;
  box-sizing: border-box;
  padding: 2px 3px 6px;
}
.chat-composer--files textarea {
  grid-column: 2;
  grid-row: 1;
  min-width: 0;
  padding: 2px 0 6px;
  caret-color: #078b5d;
}
.chat-composer--files .chat-composer-bottom {
  grid-column: 1 / -1;
  grid-row: 2;
}
.chat-composer--files.chat-composer--reply {
  grid-template-rows: minmax(0, 1fr) auto auto;
}
.chat-composer--files.chat-composer--reply .composer-reply {
  grid-column: 1 / -1;
  grid-row: 2;
}
.chat-composer--files.chat-composer--reply .chat-composer-bottom {
  grid-row: 3;
}
.chat-composer.chat-composer--dragging {
  border-color: #078b5d;
  background: #f0faf5;
  box-shadow: inset 0 0 0 1px #078b5d;
}
.composer-image-strip {
  display: flex;
  flex: 0 1 120px;
  gap: 8px;
  min-height: 64px;
  padding: 4px 0 8px;
  overflow-x: auto;
  overflow-y: hidden;
}
.composer-image-item {
  position: relative;
  display: flex;
  flex: 0 0 112px;
  flex-direction: column;
  min-height: 0;
  padding: 6px;
  border-radius: 4px;
  background: #eeeef0;
}
.composer-image-item .el-image {
  display: block;
  flex: 1;
  min-height: 0;
  width: 100%;
  cursor: zoom-in;
}
.composer-video-poster {
  display: block;
  flex: 0 0 40px;
  width: 40px;
  height: 40px;
  object-fit: contain;
}
.composer-draft-state {
  font-size: 11px;
  line-height: 16px;
  color: #67676c;
}
.composer-image-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 1px solid #ddd;
  border-radius: 50%;
  background: #fff;
  color: #555;
  cursor: pointer;
}
.composer-image-remove:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}
.composer-image-error {
  display: grid;
  place-items: center;
  height: 100%;
  color: #757575;
  font-size: 12px;
}
.emoji-tabs :deep(.el-tabs__header) {
  height: 40px;
  margin: 0 0 12px;
}
.emoji-tabs :deep(.el-tabs__content) {
  height: max(80px, min(460px, calc(100dvh - 200px)));
  overflow: hidden;
}
.emoji-tabs :deep(.el-tab-pane) {
  height: 100%;
  overflow-y: auto;
  scrollbar-gutter: stable;
}
.emoji-list-status {
  margin: 8px 0;
  font-size: 12px;
  overflow-wrap: anywhere;
}
.emoji-image-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}
.emoji-image-grid .el-image {
  display: block;
  width: 100%;
  aspect-ratio: 1;
  border-radius: 4px;
  background: inherit;
  cursor: inherit;
}
.emoji-image-item {
  display: block;
  min-width: 0;
  aspect-ratio: 1;
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 4px;
  background: #f5f5f5;
  cursor: pointer;
}
.emoji-image-item:hover:not([aria-disabled='true']),
.emoji-image-item:focus-visible {
  border-color: #078b5d;
  background: #eee;
  outline: none;
}
.emoji-image-item[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}
.emoji-image-placeholder {
  display: grid;
  place-items: center;
  height: 100%;
  font-size: 11px;
  color: #888;
}
.chat-composer-tools .chat-small-button.screenshot-options-button {
  width: 18px;
  margin-left: -5px;
}
.screenshot-option {
  display: block;
  width: 100%;
  padding: 9px 10px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: #303133;
  font-size: 13px;
  line-height: 18px;
  text-align: left;
  cursor: pointer;
}
.screenshot-option:hover:not(:disabled),
.screenshot-option:focus-visible {
  background: #f0f0f0;
  outline: none;
}
.screenshot-option:disabled {
  color: #a8abb2;
  cursor: not-allowed;
}
</style>
