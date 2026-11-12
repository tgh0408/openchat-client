let stopCurrent: (() => void) | undefined;

/** 同一页面只播放一条语音，第二次点击或其他消息开始时停止旧播放。 */
export const claimVoicePlayback = (stop: () => void): void => {
  if (stopCurrent !== stop) stopCurrent?.();
  stopCurrent = stop;
};

/** 组件离开虚拟视口时释放播放归属。 */
export const releaseVoicePlayback = (stop: () => void): void => {
  if (stopCurrent === stop) stopCurrent = undefined;
};
