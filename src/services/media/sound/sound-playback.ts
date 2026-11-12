interface SoundPlaybackQueue {
  enqueue: (source: string) => boolean;
  clear: () => void;
  dispose: () => void;
}

/** 预加载并复用播放器；串行队列容量为两条，包含正在播放的音效。 */
export const createSoundPlaybackQueue = (
  preloadSources: readonly string[] = [],
): SoundPlaybackQueue => {
  const queue: string[] = [];
  const players = new Map<string, HTMLAudioElement>();
  let active: { audio: HTMLAudioElement } | undefined;
  let preloadTimer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  /** 提前加载音效资源并缓存播放器，后续播放不再重新创建或移除来源。 */
  const getPlayer = (source: string): HTMLAudioElement => {
    const cached = players.get(source);
    if (cached) return cached;
    const audio = new Audio();
    audio.preload = 'auto';
    audio.src = source;
    players.set(source, audio);
    audio.load();
    return audio;
  };

  /** 停止当前音效并解除事件绑定，保留已加载资源供下次播放。 */
  const releaseActive = (): void => {
    const audio = active?.audio;
    active = undefined;
    if (!audio) return;
    audio.onended = null;
    audio.onerror = null;
    audio.pause();
  };

  /** 只播放队首，结束或失败后释放名额并继续下一条。 */
  const playNext = (): void => {
    const source = queue[0];
    if (disposed || active || source === undefined) return;
    const audio = getPlayer(source);
    const playback = { audio };
    active = playback;

    /** 仅结束本次播放，忽略清空队列后迟到的错误或完成事件。 */
    const finish = (): void => {
      if (active !== playback) return;
      releaseActive();
      queue.shift();
      playNext();
    };

    /** 播放失败时跳过当前音效，不阻塞消息处理或无限重试。 */
    const fail = (): void => {
      if (active !== playback) return;
      console.warn('提示音播放失败，已跳过本次音效。');
      finish();
    };

    audio.onended = finish;
    audio.onerror = fail;
    try {
      if (audio.error) audio.load();
      audio.currentTime = 0;
      void audio.play().catch(fail);
    } catch {
      fail();
    }
  };

  /** 满两条时丢弃新增音效，空闲时立即开始播放。 */
  const enqueue = (source: string): boolean => {
    if (disposed || queue.length >= 2) return false;
    queue.push(source);
    playNext();
    return true;
  };

  /** 退出账号时停止声音并清空等待项，保留预加载资源。 */
  const clear = (): void => {
    queue.length = 0;
    releaseActive();
  };

  /** 页面卸载时释放全部播放器，拒绝迟到的入队和播放回调。 */
  const dispose = (): void => {
    disposed = true;
    clearTimeout(preloadTimer);
    preloadTimer = undefined;
    clear();
    for (const audio of players.values()) {
      audio.removeAttribute('src');
      audio.load();
    }
    players.clear();
  };

  /** 让工作台先完成首帧，再在下一轮事件循环预加载音效资源。 */
  if (preloadSources.length) {
    preloadTimer = setTimeout((): void => {
      preloadTimer = undefined;
      if (disposed) return;
      for (const source of preloadSources) getPlayer(source);
    }, 0);
  }

  return { enqueue, clear, dispose };
};
