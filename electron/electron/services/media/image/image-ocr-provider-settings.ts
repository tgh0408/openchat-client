import type { StoredOcrProvider } from '../../../../shared/storage/database';
import type { ImageOcrProvider } from '../../../../shared/media/image/image-ocr';
import type { ImageOcrPreference } from '../../../../shared/media/image/image-ocr-process';

/** 缓存按连续 72 小时计算，不依赖本地时区或自然日边界。 */
export const OCR_PROVIDER_CACHE_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;

interface ProviderSettings {
  read: () => StoredOcrProvider | null;
  save: (provider: ImageOcrProvider, checkedAt: string) => void;
  now?: () => number;
  forceCpu: boolean;
  onSaveError: () => void;
}

export interface ImageOcrProviderSelection {
  initialize: () => ImageOcrPreference;
  confirm: (provider: ImageOcrProvider) => void;
}

/** 每次运行只读一次设置；已确认选择变更时才写库，测速覆盖不污染保存结果。 */
export const createImageOcrProviderSelection = (
  settings: ProviderSettings,
): ImageOcrProviderSelection => {
  let initialized = false;
  let preference: ImageOcrPreference = 'auto';
  let attempted: ImageOcrProvider | null = null;
  const now = settings.now ?? Date.now;

  /** 启动只检查一次持久化选择与三天时效；空时间、无效时间及未来时间均重新判断。 */
  const initialize = (): ImageOcrPreference => {
    if (initialized) return preference;
    const stored = settings.forceCpu ? null : settings.read();
    const checkedAt = stored ? Date.parse(stored.checkedAt) : NaN;
    const age = now() - checkedAt;
    const fresh =
      Number.isFinite(checkedAt) &&
      age >= 0 &&
      age <= OCR_PROVIDER_CACHE_MAX_AGE_MS;
    preference = settings.forceCpu
      ? 'cpu'
      : fresh && stored
        ? stored.provider
        : 'auto';
    // 过期后即使再次选中相同后端，也必须写入本次真实判断时间。
    attempted = fresh && stored ? stored.provider : null;
    initialized = true;
    return preference;
  };

  /** 仅成功识别或明确 GPU 降级确认后端；相同结果不重复写入数据库。 */
  const confirm = (provider: ImageOcrProvider): void => {
    initialize();
    if (settings.forceCpu) return;
    preference = provider;
    if (attempted === provider) return;
    attempted = provider;
    try {
      settings.save(provider, new Date(now()).toISOString());
    } catch {
      settings.onSaveError();
    }
  };
  return { initialize, confirm };
};
