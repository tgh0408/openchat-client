export type VoiceRecordingStage = 'microphone' | 'waveform' | 'recorder';

/** 按录音启动阶段解释原生异常，避免把分析器或编码器失败误报为麦克风故障。 */
export const describeVoiceRecordingError = (
  reason: unknown,
  stage: VoiceRecordingStage,
): string => {
  const name = reason instanceof Error ? reason.name : 'UnknownError';
  const code = /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'UnknownError';
  switch (stage) {
    case 'waveform':
      return `麦克风已获取，但音频分析器启动失败（${code}），请检查默认音频输出设备后重试`;
    case 'recorder':
      return `录音编码器启动失败（${code}），请重启客户端后重试`;
    case 'microphone':
      switch (name) {
        case 'NotAllowedError':
        case 'PermissionDeniedError':
          return '麦克风访问被拒绝，请检查系统麦克风与桌面应用权限，并确认当前账号已登录';
        case 'NotFoundError':
        case 'DevicesNotFoundError':
          return '未找到可用麦克风，请连接设备并检查系统默认输入设备';
        case 'NotReadableError':
        case 'TrackStartError':
          return '无法读取麦克风，设备可能被独占或驱动异常；请关闭其他录音软件并检查默认输入设备';
        case 'AbortError':
          return '麦克风启动被中断，请重新连接设备后重试';
        case 'OverconstrainedError':
          return '麦克风不支持当前录音参数，请检查输入设备';
        case 'SecurityError':
          return '当前页面的麦克风访问被安全策略禁止';
        case 'NotSupportedError':
          return '当前页面不支持麦克风采集，请在桌面客户端中录音';
        default:
          return `麦克风采集启动失败（${code}），请检查输入设备后重试`;
      }
  }
};
