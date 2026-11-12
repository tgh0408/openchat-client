import { onBeforeUnmount, ref } from 'vue';
import type { Ref } from 'vue';
import type { LocalImageData } from '../../../../shared/media/image/image';

interface ImageFileSource {
  source: Ref<string>;
  clear: () => void;
  load: (read: () => Promise<LocalImageData>) => Promise<void>;
}

/** 页面仅持有可撤销的 Blob 地址，不开放 file:// 或任意文件系统路径。 */
export const useImageFileSource = (): ImageFileSource => {
  const source = ref('');
  let version = 0;

  /** 图片切换、组件离开或账号关闭时释放字节并忽略迟到读取。 */
  const clear = (): void => {
    version++;
    if (source.value) URL.revokeObjectURL(source.value);
    source.value = '';
  };

  /** 主进程验证并读取完成后才发布新图片，始终保留原始动画数据。 */
  const load = async (read: () => Promise<LocalImageData>): Promise<void> => {
    clear();
    const request = version;
    const image = await read();
    if (request !== version) return;
    source.value = URL.createObjectURL(
      new Blob([new Uint8Array(image.bytes)], { type: image.contentType }),
    );
  };
  onBeforeUnmount(clear);
  return { source, clear, load };
};
