<template>
  <div
    class="file-attachment-card"
    :title="hideFileName ? undefined : fileName"
  >
    <div class="file-attachment-details">
      <span
        v-if="!hideFileName"
        class="file-attachment-name"
        :aria-label="fileName"
      >
        <span class="file-attachment-name-start">{{ preview.nameStart }}</span>
        <span v-if="preview.nameEnd" class="file-attachment-name-end">{{
          preview.nameEnd
        }}</span>
      </span>
      <slot name="detail">
        <span class="file-attachment-size">{{ sizeLabel }}</span>
      </slot>
    </div>
    <slot name="icon">
      <span
        class="file-attachment-icon"
        :class="`file-attachment-icon--${preview.kind}`"
        aria-hidden="true"
      >
        <span
          v-if="preview.kind === 'archive'"
          class="file-attachment-zipper"
        ></span>
        <span v-else class="file-attachment-extension">{{
          preview.extension
        }}</span>
      </span>
    </slot>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  fileName: string;
  fileSize: number;
  hideFileName?: boolean;
}>();

/** 按扩展名统一附件图标外观，不参与上传类型判断。 */
const fileIconKind = (
  extension: string,
): 'archive' | 'document' | 'spreadsheet' | 'pdf' | 'media' | 'generic' => {
  switch (extension) {
    case 'ZIP':
    case 'RAR':
    case '7Z':
    case 'TAR':
    case 'GZ':
    case 'BZ2':
    case 'XZ':
    case 'TGZ':
      return 'archive';
    case 'DOC':
    case 'DOCX':
    case 'TXT':
    case 'RTF':
    case 'MD':
      return 'document';
    case 'XLS':
    case 'XLSX':
    case 'CSV':
      return 'spreadsheet';
    case 'PDF':
      return 'pdf';
    case 'MP4':
    case 'MKV':
    case 'AVI':
    case 'MOV':
    case 'WEBM':
    case 'PNG':
    case 'JPG':
    case 'JPEG':
    case 'GIF':
      return 'media';
    default:
      return 'generic';
  }
};

const sizeLabel = computed((): string => {
  const bytes = props.fileSize;
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)}G`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${bytes}B`;
});

const preview = computed(() => {
  const dot = props.fileName.lastIndexOf('.');
  const extension = dot > 0 ? props.fileName.slice(dot + 1).toUpperCase() : '';
  const characters = Array.from(props.fileName);
  // 尾部独立保留，前段按可用宽度省略，避免隐藏文件后缀。
  const tailLength = Math.min(12, Math.max(8, extension.length + 4));
  const split = characters.length > 22;
  return {
    nameStart: split
      ? characters.slice(0, -tailLength).join('')
      : props.fileName,
    nameEnd: split ? characters.slice(-tailLength).join('') : '',
    extension: /^[A-Z0-9]{1,4}$/.test(extension) ? extension : 'FILE',
    kind: fileIconKind(extension),
  };
});
</script>

<style scoped>
.file-attachment-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 16px;
  box-sizing: border-box;
  width: 228px;
  max-width: 100%;
  height: 60px;
  min-width: 0;
  padding: 10px;
  border-radius: 3px;
  background: #ededee;
}
.file-attachment-details {
  display: grid;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.file-attachment-name {
  display: flex;
  min-width: 0;
  font-size: 14px;
  line-height: 20px;
  color: #242424;
}
.file-attachment-name-start {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-attachment-name-end {
  flex-shrink: 0;
  max-width: 65%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.file-attachment-size {
  color: #a0a0a3;
  font-size: 12px;
  line-height: 16px;
  font-variant-numeric: tabular-nums;
}
.file-attachment-icon {
  position: relative;
  display: grid;
  align-items: end;
  justify-items: center;
  flex: 0 0 32px;
  height: 40px;
  padding-bottom: 7px;
  box-sizing: border-box;
  border-radius: 2px;
  clip-path: polygon(0 0, 21px 0, 100% 11px, 100% 100%, 0 100%);
  background: #969da7;
  color: #fff;
}
.file-attachment-icon::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  width: 11px;
  height: 11px;
  background: #ffffff55;
}
.file-attachment-icon--archive {
  background: #df902e;
}
.file-attachment-icon--document {
  background: #548bcc;
}
.file-attachment-icon--spreadsheet {
  background: #51a078;
}
.file-attachment-icon--pdf {
  background: #d76861;
}
.file-attachment-icon--media {
  background: #6d91ab;
}
.file-attachment-extension {
  font-size: 9px;
  line-height: 12px;
  font-weight: 600;
}
.file-attachment-zipper {
  position: absolute;
  top: 2px;
  left: 9px;
  width: 6px;
  height: 23px;
  background:
    repeating-linear-gradient(#fff 0 3px, transparent 3px 6px) left top / 3px
      100% no-repeat,
    repeating-linear-gradient(transparent 0 3px, #fff 3px 6px) right top / 3px
      100% no-repeat;
}
.file-attachment-zipper::after {
  content: '';
  position: absolute;
  top: 22px;
  left: 0;
  box-sizing: border-box;
  width: 6px;
  height: 8px;
  border: 2px solid #fff;
  border-radius: 1px;
}
</style>
