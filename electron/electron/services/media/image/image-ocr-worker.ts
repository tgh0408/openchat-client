import path from 'node:path';
import type { ImageOcrProvider } from '../../../../shared/media/image/image-ocr';
import { mkdtemp } from 'node:fs/promises';
import { InferenceSession, listSupportedBackends } from 'onnxruntime-node';
import { MAX_IMAGE_BYTES } from '../../../../shared/media/image/image';
import { IMAGE_OCR_LIMITS } from '../../../../shared/media/image/image-ocr-process';
import type {
  ImageOcrProcessRequest,
  ImageOcrProcessResponse,
} from '../../../../shared/media/image/image-ocr-process';
import { IMAGE_OCR_MODEL_FILES } from '../../../../shared/media/image/image-ocr-models';
import { assertImageOcrAssets } from '../../../../shared/runtime/node/image-ocr-assets';
import { ImageOcrEngine } from './image-ocr-engine';
import { startOcrProfiling, cleanOcrProfiles } from './image-ocr-profiling';

const port = process.parentPort;
if (!port) throw new Error('OCR 必须在独立 utility 进程中启动');
const directory = process.env.OPENCHAT_OCR_MODEL_DIRECTORY;
if (!directory || !path.isAbsolute(directory))
  throw new Error('OCR 模型目录必须由主进程指定');

/** 已选后端直接使用；仅首次 auto 请求查询本平台 GPU 支持列表。 */
const chooseProvider = (): ImageOcrProvider => {
  const saved = process.env.OPENCHAT_OCR_PROVIDER;
  if (
    saved === 'cpu' ||
    saved === 'dml' ||
    saved === 'cuda' ||
    saved === 'coreml'
  )
    return saved;
  try {
    const names = new Set(
      listSupportedBackends().map((backend) => backend.name),
    );
    const gpu =
      process.platform === 'win32'
        ? 'dml'
        : process.platform === 'linux'
          ? 'cuda'
          : process.platform === 'darwin'
            ? 'coreml'
            : undefined;
    if (gpu && names.has(gpu)) return gpu;
  } catch {
    /* 后端探测失败时仍可使用 CPU。 */
  }
  return 'cpu';
};
const provider = chooseProvider();
const profiling = process.env.OPENCHAT_OCR_PROFILE === '1';
let busy = false;
let engine: ImageOcrEngine | undefined;

/** 只通过父进程端口发送结果，原生组件日志不进入应用日志。 */
const send = (message: ImageOcrProcessResponse): void =>
  port.postMessage(message);

/** 校验父进程内部协议，拒绝路径、空字节及过大的编码图片。 */
const parseRequest = (value: unknown): ImageOcrProcessRequest => {
  if (
    !value ||
    typeof value !== 'object' ||
    !('type' in value) ||
    value.type !== 'recognize' ||
    !('id' in value) ||
    typeof value.id !== 'string' ||
    value.id.length > 64 ||
    !('bytes' in value) ||
    !(value.bytes instanceof Uint8Array) ||
    !value.bytes.byteLength ||
    value.bytes.byteLength > MAX_IMAGE_BYTES
  )
    throw new Error('识别请求无效');
  return { type: 'recognize', id: value.id, bytes: value.bytes };
};

/** 按需加载模型；成功任务复用会话，SDK 图片缓存不参与此流程。 */
const recognize = async (request: ImageOcrProcessRequest): Promise<void> => {
  let profileDirectory: string | undefined;
  let profiler: ReturnType<typeof startOcrProfiling> | undefined;
  const originalError = console.error;
  let inferenceFailed = false;
  send({ type: 'provider', id: request.id, provider });
  try {
    await assertImageOcrAssets(directory);
    if (profiling) {
      const temp = process.env.TMPDIR;
      if (temp) {
        profileDirectory = await mkdtemp(path.join(temp, 'ocr-profile-')).catch(
          () => undefined,
        );
        if (profileDirectory)
          profiler = startOcrProfiling(
            profileDirectory,
            provider,
            InferenceSession,
          );
      }
    }
    engine ??= new ImageOcrEngine({
      model: {
        detection: path.join(directory, IMAGE_OCR_MODEL_FILES.detection),
        recognition: path.join(directory, IMAGE_OCR_MODEL_FILES.recognition),
        charactersDictionary: path.join(
          directory,
          IMAGE_OCR_MODEL_FILES.charactersDictionary,
        ),
      },
      detection: { maxSideLength: IMAGE_OCR_LIMITS.detectionSide },
      recognition: {
        charactersDictionary: [],
        imageHeight: IMAGE_OCR_LIMITS.recognitionHeight,
        strategy: 'per-box',
        minimumConfidence: 0.5,
        maxCropSourceSideLength: IMAGE_OCR_LIMITS.cropSide,
        recBatchSize: 1,
      },
      processing: { engine: 'opencv' },
      session: {
        executionProviders: provider === 'cpu' ? ['cpu'] : [provider, 'cpu'],
        executionMode: 'sequential',
        enableMemPattern: provider !== 'dml',
        /** SDK 内部降级后交还父进程，使用全新 CPU 进程重试。 */
        onSessionFallback: (): void => {
          throw new Error('GPU 会话需要降级');
        },
        intraOpNumThreads: 4,
        interOpNumThreads: 1,
        graphOptimizationLevel: 'all',
      },
      debugging: { debug: false, verbose: false },
    });
    // SDK 部分异常只打印错误并返回空数组，不能把它缓存为无文字结果。
    console.error = (): void => {
      inferenceFailed = true;
    };
    const { result, metrics } = await engine.recognizeBounded(
      request.bytes,
      provider,
    );
    if (inferenceFailed) throw new Error('识别组件报告失败');
    const execution = profiler ? await profiler.finish(true) : undefined;
    profiler = undefined;
    if (profiling) {
      await engine.destroy();
      engine = undefined;
      if (profileDirectory)
        await cleanOcrProfiles(profileDirectory).catch(() => undefined);
      profileDirectory = undefined;
    }
    send({
      type: 'result',
      id: request.id,
      result,
      metrics,
      execution,
      retire: profiling,
    });
  } catch (error) {
    // 错误后由父进程销毁整个进程，避免复用部分初始化或原生异常后的会话。
    const allowed = new Set([
      '图片超过 4000 万像素，请裁剪后识别',
      '图片文字区域过多，请裁剪后分段识别',
      '图片文字过多，请裁剪后分段识别',
    ]);
    send({
      type: 'failure',
      id: request.id,
      retryable: !(error instanceof Error && allowed.has(error.message)),
      error:
        error instanceof Error && allowed.has(error.message)
          ? error.message
          : '文字识别失败，请检查本地模型和图片后重试',
    });
  } finally {
    console.error = originalError;
    busy = false;
  }
};

port.on('message', (event: Electron.MessageEvent): void => {
  try {
    const request = parseRequest(event.data);
    if (busy) {
      send({
        type: 'failure',
        id: request.id,
        error: '其他图片正在识别，请稍后重试',
        retryable: false,
      });
      return;
    }
    busy = true;
    void recognize(request);
  } catch {
    process.exit(1);
  }
});
send({ type: 'ready' });
