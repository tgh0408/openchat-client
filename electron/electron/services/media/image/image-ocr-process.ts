import { randomUUID } from 'node:crypto';
import { parseImageOcrResult } from '../../../../shared/media/image/image-ocr';
import type {
  ImageOcrResult,
  ImageOcrProvider,
  ImageOcrExecution,
} from '../../../../shared/media/image/image-ocr';
import { IMAGE_OCR_LIMITS } from '../../../../shared/media/image/image-ocr-process';
import type {
  ImageOcrMetrics,
  ImageOcrPreference,
  ImageOcrProcessRequest,
} from '../../../../shared/media/image/image-ocr-process';

export interface ImageOcrTransport {
  postMessage: (message: ImageOcrProcessRequest) => void;
  kill: () => boolean;
  onMessage: (listener: (message: unknown) => void) => void;
  onExit: (listener: (code: number) => void) => void;
  onError: (listener: () => void) => void;
}

interface ClientOptions {
  spawn: (preference: ImageOcrPreference) => ImageOcrTransport;
  preference?: ImageOcrPreference;
  timeoutMs?: number;
  gpuTimeoutMs?: number;
  idleMs?: number;
  exitTimeoutMs?: number;
  onMetrics?: (metrics: ImageOcrMetrics) => void;
  onFallback?: (reason: string) => void;
  onExecution?: (value: ImageOcrExecution) => void;
}

interface Pending {
  request: ImageOcrProcessRequest;
  sent: boolean;
  provider?: ImageOcrProvider;
  finish: (error?: Error, result?: ImageOcrResult) => void;
  armTimer: (gpu: boolean) => void;
}

interface ProcessState {
  transport: ImageOcrTransport;
  preference: ImageOcrPreference;
  ready: boolean;
  stopping: boolean;
  exited: boolean;
  exit: Promise<void>;
  pending?: Pending;
  idleTimer?: ReturnType<typeof setTimeout>;
}

export interface ImageOcrProcessClient {
  recognize: (
    bytes: Uint8Array,
    signal: AbortSignal,
  ) => Promise<ImageOcrResult>;
  stop: () => void;
}

/** 校验并复制固定指标字段，拒绝任意子进程对象进入应用日志。 */
const parseMetrics = (value: unknown): ImageOcrMetrics => {
  if (!value || typeof value !== 'object') throw new Error('识别统计无效');
  const data = value as Record<string, unknown>;
  const provider = data.provider;
  if (
    typeof data.modelReused !== 'boolean' ||
    (provider !== 'cpu' &&
      provider !== 'dml' &&
      provider !== 'cuda' &&
      provider !== 'coreml')
  )
    throw new Error('识别统计无效');
  /** 只接受有限的非负计时、计数及尺寸。 */
  const number = (key: string): number => {
    const item = data[key];
    if (typeof item !== 'number' || !Number.isFinite(item) || item < 0)
      throw new Error('识别统计无效');
    return item;
  };
  return {
    modelReused: data.modelReused,
    provider,
    modelInitMs: number('modelInitMs'),
    decodeMs: number('decodeMs'),
    detectionMs: number('detectionMs'),
    recognitionMs: number('recognitionMs'),
    totalMs: number('totalMs'),
    width: number('width'),
    height: number('height'),
    cropWidth: number('cropWidth'),
    cropHeight: number('cropHeight'),
    boxes: number('boxes'),
    processPeakRssBytes: number('processPeakRssBytes'),
  };
};

/** 诊断日志仅接受固定摘要结构；无效诊断不影响有效识别结果。 */
const parseExecution = (value: unknown): ImageOcrExecution | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const data = value as Record<string, unknown>;
  const {
    execution,
    provider,
    completed,
    sessions,
    profiledSessions,
    unknownKernels,
    completeProfile,
    kernels,
  } = data;
  if (
    (execution !== 'cpu' &&
      execution !== 'gpu' &&
      execution !== 'mixed' &&
      execution !== 'unknown') ||
    (provider !== 'cpu' &&
      provider !== 'dml' &&
      provider !== 'cuda' &&
      provider !== 'coreml') ||
    typeof completed !== 'boolean' ||
    typeof completeProfile !== 'boolean' ||
    typeof sessions !== 'number' ||
    typeof profiledSessions !== 'number' ||
    typeof unknownKernels !== 'number' ||
    ![sessions, profiledSessions, unknownKernels].every(
      (item) => Number.isSafeInteger(item) && item >= 0,
    ) ||
    !kernels ||
    typeof kernels !== 'object'
  )
    return undefined;
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(kernels)) {
    if (
      !/^[A-Za-z][A-Za-z0-9_]{0,46}ExecutionProvider$/.test(key) ||
      typeof count !== 'number' ||
      !Number.isSafeInteger(count) ||
      count < 0
    )
      return undefined;
    counts[key] = count;
  }
  return {
    execution,
    provider,
    completed,
    sessions,
    profiledSessions,
    unknownKernels,
    completeProfile,
    kernels: counts,
  };
};
/** 管理唯一 OCR 子进程，旧进程退出前不创建替代进程，取消不会等待原生推理返回。 */
export const createImageOcrProcessClient = (
  options: ClientOptions,
): ImageOcrProcessClient => {
  let current: ProcessState | undefined;
  let running = false;
  let generation = 0;
  let selectedPreference: ImageOcrPreference = options.preference ?? 'auto';
  const timeoutMs = options.timeoutMs ?? IMAGE_OCR_LIMITS.timeoutMs;
  const gpuTimeoutMs = options.gpuTimeoutMs ?? IMAGE_OCR_LIMITS.gpuTimeoutMs;
  const retryableErrors = new WeakSet<Error>();

  /** 标记可触发一次 CPU 重试的 GPU 异常；取消和输入拒绝不降级重试。 */
  const failure = (
    state: ProcessState,
    message: string,
    retryable: boolean,
  ): Error => {
    const error = new Error(message);
    if (
      retryable &&
      state.preference !== 'cpu' &&
      state.pending?.provider !== 'cpu'
    )
      retryableErrors.add(error);
    return error;
  };

  /** 先封闭旧进程，再拒绝任务；即使 kill 失败也不允许并行新进程。 */
  const retire = (state: ProcessState, error?: Error): void => {
    if (state.stopping || state.exited) return;
    state.stopping = true;
    clearTimeout(state.idleTimer);
    state.pending?.finish(error ?? new Error('文字识别已取消'));
    try {
      state.transport.kill();
    } catch {
      /* 等待退出事件；等待方有独立上限。 */
    }
  };

  /** 子进程就绪后发送一次原始编码字节，不在父进程解码或重新编码。 */
  const dispatch = (state: ProcessState): void => {
    const job = state.pending;
    if (!state.ready || state.stopping || !job || job.sent) return;
    job.sent = true;
    try {
      state.transport.postMessage(job.request);
    } catch {
      retire(state, failure(state, '文字识别进程通信失败，请重试', true));
    }
  };

  /** 为新进程绑定事件；旧进程的迟到消息不能完成新请求。 */
  const launch = (preference: ImageOcrPreference): ProcessState => {
    // 未收到首次选择结果就取消时，本次运行保守使用 CPU，不再次启动自动探测。
    if (preference === 'auto') selectedPreference = 'cpu';
    const transport = options.spawn(preference);
    let exited!: () => void;
    const state: ProcessState = {
      transport,
      preference,
      ready: false,
      stopping: false,
      exited: false,
      exit: new Promise<void>((resolve) => {
        exited = resolve;
      }),
    };
    current = state;
    transport.onExit((): void => {
      state.exited = true;
      clearTimeout(state.idleTimer);
      state.pending?.finish(
        failure(state, '文字识别进程意外退出，请重试', true),
      );
      if (current === state) current = undefined;
      exited();
    });
    transport.onError((): void =>
      retire(state, failure(state, '文字识别进程发生原生错误，请重试', true)),
    );
    transport.onMessage((value: unknown): void => {
      if (
        current !== state ||
        state.stopping ||
        state.exited ||
        !value ||
        typeof value !== 'object'
      )
        return;
      const message = value as Record<string, unknown>;
      if (message.type === 'ready') {
        state.ready = true;
        dispatch(state);
        return;
      }
      const job = state.pending;
      if (!job || message.id !== job.request.id) return;
      if (message.type === 'provider') {
        const provider = message.provider;
        if (
          provider === 'cpu' ||
          provider === 'dml' ||
          provider === 'cuda' ||
          provider === 'coreml'
        ) {
          job.provider = provider;
          selectedPreference = provider;
          job.armTimer(provider !== 'cpu');
        }
        return;
      }
      if (message.type === 'failure') {
        const text =
          typeof message.error === 'string' && message.error.length <= 100
            ? message.error
            : '文字识别失败';
        retire(state, failure(state, text, message.retryable === true));
        return;
      }
      if (message.type !== 'result') return;
      try {
        const result = parseImageOcrResult(message.result);
        const metrics = parseMetrics(message.metrics);
        selectedPreference = metrics.provider;
        options.onMetrics?.(metrics);
        const execution = parseExecution(message.execution);
        if (execution) options.onExecution?.(execution);
        job.finish(undefined, result);
        if (message.retire === true) retire(state);
        else
          state.idleTimer = setTimeout(
            () => retire(state),
            options.idleMs ?? IMAGE_OCR_LIMITS.idleMs,
          );
      } catch {
        retire(state, failure(state, '文字识别进程返回无效结果', true));
      }
    });
    return state;
  };

  /** 有界等待已终止进程退出；等待期间仍响应图片切换和授权撤销。 */
  const waitForExit = async (
    state: ProcessState,
    signal: AbortSignal,
  ): Promise<void> => {
    signal.throwIfAborted();
    if (state.exited) return;
    await new Promise<void>((resolve, reject): void => {
      /** 撤销等待监听器并且只完成一次。 */
      const finish = (error?: Error): void => {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        if (error) reject(error);
        else resolve();
      };
      /** 取消等待不能触发 CPU 回退或创建新进程。 */
      const cancel = (): void => finish(new Error('文字识别已取消'));
      const timer = setTimeout(
        () => finish(new Error('旧识别进程仍在退出，请稍后重试')),
        options.exitTimeoutMs ?? 5000,
      );
      signal.addEventListener('abort', cancel, { once: true });
      void state.exit.then(() => finish());
      if (signal.aborted) cancel();
    });
  };

  /** 执行单次进程尝试，总截止时间同时覆盖启动、解码、推理与 GPU 回退。 */
  const attempt = (
    state: ProcessState,
    bytes: Uint8Array,
    signal: AbortSignal,
    deadline: number,
  ): Promise<ImageOcrResult> =>
    new Promise<ImageOcrResult>((resolve, reject): void => {
      clearTimeout(state.idleTimer);
      let settled = false;
      let timer: ReturnType<typeof setTimeout>;
      const gpuDeadline = Math.min(deadline, Date.now() + gpuTimeoutMs);
      /** 所有完成路径立即释放任务监听器；无需等待原生调用主动返回。 */
      const finish = (error?: Error, result?: ImageOcrResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
        state.pending = undefined;
        if (error) reject(error);
        else if (result) resolve(result);
      };
      /** 取消只销毁当前进程，不将取消当作 GPU 失败。 */
      const cancel = (): void => retire(state, new Error('文字识别已取消'));
      /** GPU 首次尝试预留 CPU 回退时间；直接 CPU 使用总截止时间。 */
      const armTimer = (gpu: boolean): void => {
        clearTimeout(timer);
        timer = setTimeout(
          () =>
            retire(
              state,
              failure(state, '文字识别超时，请裁剪图片后重试', gpu),
            ),
          Math.max(1, (gpu ? gpuDeadline : deadline) - Date.now()),
        );
      };
      state.pending = {
        request: { type: 'recognize', id: randomUUID(), bytes },
        sent: false,
        finish,
        armTimer,
      };
      armTimer(state.preference !== 'cpu');
      signal.addEventListener('abort', cancel, { once: true });
      if (signal.aborted) cancel();
      else dispatch(state);
    });

  /** 串行识别；GPU 错误、崩溃或超时后最多用全新 CPU 进程重试一次。 */
  const recognize = async (
    bytes: Uint8Array,
    signal: AbortSignal,
  ): Promise<ImageOcrResult> => {
    signal.throwIfAborted();
    if (running) throw new Error('其他图片正在识别，请稍后重试');
    running = true;
    const version = generation;
    const deadline = Date.now() + timeoutMs;
    try {
      if (current?.stopping) await waitForExit(current, signal);
      signal.throwIfAborted();
      if (version !== generation) throw new Error('文字识别已取消');
      const state = current ?? launch(selectedPreference);
      try {
        return await attempt(state, bytes, signal, deadline);
      } catch (error) {
        signal.throwIfAborted();
        if (
          version !== generation ||
          !(error instanceof Error) ||
          !retryableErrors.has(error)
        )
          throw error;
        selectedPreference = 'cpu';
        options.onFallback?.(error.message);
        await waitForExit(state, signal);
        signal.throwIfAborted();
        if (version !== generation) throw new Error('文字识别已取消');
        if (Date.now() >= deadline)
          throw new Error('文字识别超时，请裁剪图片后重试');
        return await attempt(launch('cpu'), bytes, signal, deadline);
      }
    } finally {
      running = false;
    }
  };

  /** 退出账号、关闭窗口或应用退出时撤销在途任务和复用会话。 */
  const stop = (): void => {
    generation++;
    if (current) retire(current);
  };
  return { recognize, stop };
};
