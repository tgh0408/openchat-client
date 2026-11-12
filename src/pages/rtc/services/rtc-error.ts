import {
  ApiResponseError,
  getRequestErrorMessage,
} from '../../../../shared/api/api-error';

export type RtcErrorDevice = 'camera' | 'microphone' | 'speaker' | 'media';

/** 读取跨窗口异常及普通错误对象，不依赖同一执行环境的 Error 原型。 */
const readErrorField = (cause: unknown, key: string): string => {
  if (typeof cause !== 'object' || cause === null) return '';
  const value: unknown = Reflect.get(cause, key);
  return typeof value === 'string' ? value : '';
};

/** 诊断只保留错误文本，隐藏连接地址、令牌和认证头。 */
const redactRtcError = (message: string): string =>
  message
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>]+/gi, '[连接地址已隐藏]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [已隐藏]')
    .replace(
      /\b(access_token|token|authorization|password)\s*[:=]\s*["']?[^&\s"',;]+/gi,
      '$1=[已隐藏]',
    )
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[令牌已隐藏]',
    )
    .slice(0, 2048);

/** 按当前操作选择设备名称，不把入会阶段的未知采集错误归咎于摄像头。 */
const readDeviceLabel = (device: RtcErrorDevice): string => {
  switch (device) {
    case 'camera':
      return '摄像头';
    case 'microphone':
      return '麦克风';
    case 'speaker':
      return '扬声器';
    default:
      return '音视频设备';
  }
};

/** 将采集、播放及连接异常转换为中文，保留原始诊断但不在界面展示未知英文。 */
export const readRtcError = (
  cause: unknown,
  fallback: string,
  device: RtcErrorDevice = 'media',
): string => {
  const name = readErrorField(cause, 'name');
  const original =
    typeof cause === 'string' ? cause : readErrorField(cause, 'message');
  const message = original
    .replace(/^Error invoking remote method '[^']+':\s*/i, '')
    .replace(/^Error:\s*/i, '')
    .trim();
  console.error(
    `RTC 操作失败 (${device}): ${redactRtcError(name)}: ${redactRtcError(original)}`,
  );
  // 主进程请求错误已经使用后端文案，不再按设备异常关键词改写。
  if (cause instanceof ApiResponseError)
    return getRequestErrorMessage(cause, fallback);
  if (
    name === 'IpcRequestError' ||
    /^Error invoking remote method '[^']+':/i.test(original)
  )
    return getRequestErrorMessage(cause, fallback);

  // 部分 Chromium/IPC 异常只保留 message，优先识别明确的采集源。
  if (
    /could not start video source|failed to start video source/i.test(message)
  )
    return '无法启动摄像头，请检查是否被其他程序占用、设备连接及驱动是否正常';
  if (
    /could not start audio source|failed to start audio source/i.test(message)
  )
    return '无法启动麦克风，请检查是否被其他程序占用、设备连接及驱动是否正常';

  const label = readDeviceLabel(device);
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return `无法访问${label}，请检查系统权限及应用访问权限`;
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return `未找到可用的${label}，请检查设备连接或选择其他设备`;
    case 'NotReadableError':
    case 'TrackStartError':
      return `无法启动${label}，请检查是否被其他程序占用、设备连接及驱动是否正常`;
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return `${label}不支持当前采集要求，请选择其他设备`;
    case 'AbortError':
      return `${label}操作已中断，请检查设备连接后重试`;
    case 'NotSupportedError':
    case 'DeviceUnsupportedError':
      return `当前环境不支持此${label}操作，请检查设备驱动或更新客户端`;
    case 'InvalidStateError':
      return '通话页面或设备状态已失效，请关闭通话窗口后重试';
    case 'ConnectionError':
      switch (readErrorField(cause, 'reasonName')) {
        case 'NotAllowed':
          return '通话连接授权失败，请重新登录后重试';
        case 'Timeout':
          return '连接通话服务器超时，请检查网络后重试';
        case 'Cancelled':
          return '通话连接已取消，请重新发起通话';
        case 'LeaveRequest':
          return '已断开通话连接，请重新发起通话';
        case 'InternalError':
          return '通话服务器发生异常，请稍后重试';
        case 'ServiceNotFound':
          return '通话服务不可用，请联系管理员检查服务配置';
        default:
          return '无法连接通话服务器，请检查网络或联系管理员检查服务配置';
      }
    case 'NegotiationError':
      return '音视频连接协商失败，请检查网络或联系管理员检查通话服务';
    case 'PublishTrackError':
    case 'TrackInvalidError':
      return '音视频发送失败，请检查设备状态后重新接听或发起通话';
    case 'UnsupportedServer':
      return '通话服务器版本不兼容，请联系管理员';
    case 'UnexpectedConnectionState':
    case 'SignalReconnectError':
      return '通话连接已中断，请检查网络后重新发起通话';
    case 'TimeoutError':
      return '通话操作超时，请检查网络及设备后重试';
    default:
      break;
  }
  if (
    /permission denied|permission dismissed|permission.*denied by system/i.test(
      message,
    )
  )
    return `无法访问${label}，请检查系统权限及应用访问权限`;
  if (/requested device not found|device not found/i.test(message))
    return `未找到可用的${label}，请检查设备连接或选择其他设备`;
  if (
    /failed to fetch|fetch failed|networkerror|network request failed/i.test(
      message,
    )
  )
    return '通话网络请求失败，请检查网络连接后重试';
  if (/timed out|timeout/i.test(message))
    return '通话操作超时，请检查网络及设备后重试';
  if (
    /could not establish|could not connect|websocket.*(?:failed|error)/i.test(
      message,
    )
  )
    return '无法连接通话服务器，请检查网络或联系管理员检查服务配置';
  if (/[\u3400-\u9fff]/u.test(message)) return redactRtcError(message);
  return fallback;
};
