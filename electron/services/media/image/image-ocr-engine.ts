import { PaddleOcrService } from 'ppu-paddle-ocr';
import type { Box } from 'ppu-paddle-ocr';
import type { InferenceSession } from 'onnxruntime-node';
import { imageSize } from 'image-size';
import type {
  ImageOcrLine,
  ImageOcrResult,
  ImageOcrProvider,
} from '../../../../shared/media/image/image-ocr';
import { MAX_OCR_TEXT_LENGTH } from '../../../../shared/media/image/image-ocr';
import { IMAGE_OCR_LIMITS } from '../../../../shared/media/image/image-ocr-process';
import type { ImageOcrMetrics } from '../../../../shared/media/image/image-ocr-process';

export interface ImageOcrEngineResult {
  result: ImageOcrResult;
  metrics: ImageOcrMetrics;
}

/** SDK 未显式释放输出张量；解码和后处理完成后及时归还原生内存。 */
const withTensorCleanup = async <T>(
  session: InferenceSession,
  operation: () => Promise<T>,
): Promise<T> => {
  const original = session.run;
  const outputs: InferenceSession.ReturnType[] = [];
  session.run = new Proxy(original, {
    /** 保留两种 run 重载的调用语义，只追踪本次推理的返回张量。 */
    apply: (
      target: typeof original,
      receiver: unknown,
      args: unknown[],
    ): Promise<InferenceSession.ReturnType> => {
      const pending: Promise<InferenceSession.ReturnType> = Reflect.apply(
        target,
        receiver,
        args,
      );
      return pending.then((value) => {
        outputs.push(value);
        return value;
      });
    },
  });
  try {
    return await operation();
  } finally {
    session.run = original;
    for (const tensor of new Set(
      outputs.flatMap((output) => Object.values(output)),
    ))
      tensor.dispose();
  }
};
/** 复用 SDK 的模型与解码器，逐框执行以限制同时存活的裁剪及张量。 */
export class ImageOcrEngine extends PaddleOcrService {
  /** 将检测框约束到裁剪源画布，拒绝异常坐标。 */
  private boundBox = (box: Box, width: number, height: number): Box => {
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite))
      throw new Error('识别区域无效');
    const x = Math.max(0, Math.floor(box.x));
    const y = Math.max(0, Math.floor(box.y));
    const right = Math.min(width, Math.ceil(box.x + box.width));
    const bottom = Math.min(height, Math.ceil(box.y + box.height));
    if (right <= x || bottom <= y) throw new Error('识别区域无效');
    return { x, y, width: right - x, height: bottom - y };
  };

  /** 在独立进程中解码一次，缩小裁剪源并将结果映射回解码后的原图坐标。 */
  recognizeBounded = async (
    bytes: Uint8Array,
    provider: ImageOcrProvider,
  ): Promise<ImageOcrEngineResult> => {
    const started = performance.now();
    const dimensions = imageSize(bytes);
    if (
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width * dimensions.height > IMAGE_OCR_LIMITS.maxPixels
    )
      throw new Error('图片超过 4000 万像素，请裁剪后识别');
    const modelReused = this.isInitialized();
    await this.initialize();
    const initialized = performance.now();
    if (
      !this.detector ||
      !this.recognitor ||
      !this.detectionSession ||
      !this.recognitionSession
    )
      throw new Error('识别模型初始化失败');
    const source = await this.platform.canvas.prepareCanvas(bytes);
    let canvas = source;
    try {
      const { width, height } = source;
      if (!width || !height || width * height > IMAGE_OCR_LIMITS.maxPixels)
        throw new Error('图片超过 4000 万像素，请裁剪后识别');
      const scale = Math.min(
        1,
        IMAGE_OCR_LIMITS.cropSide / Math.max(width, height),
      );
      if (scale < 1) {
        canvas = this.platform.createCanvas(
          Math.max(1, Math.round(width * scale)),
          Math.max(1, Math.round(height * scale)),
        );
        canvas
          .getContext('2d')
          .drawImage(source, 0, 0, canvas.width, canvas.height);
        source.width = 1;
        source.height = 1;
      }
      const cropWidth = canvas.width;
      const cropHeight = canvas.height;
      const decoded = performance.now();
      const detector = this.detector;
      const recognitor = this.recognitor;
      const boxes = await withTensorCleanup(this.detectionSession, () =>
        detector.run(canvas),
      );
      if (boxes.length > IMAGE_OCR_LIMITS.maxBoxes)
        throw new Error('图片文字区域过多，请裁剪后分段识别');
      const ordered = boxes.map((box) =>
        this.boundBox(box, cropWidth, cropHeight),
      );
      ordered.sort((a, b) => a.y - b.y || a.x - b.x);
      const detected = performance.now();
      const lines: ImageOcrLine[] = [];
      let text = '';
      for (const box of ordered) {
        const vertical = box.height / box.width >= 1.5;
        const ratioLimit =
          IMAGE_OCR_LIMITS.recognitionWidth /
          IMAGE_OCR_LIMITS.recognitionHeight;
        // 超长区域先压缩长边；SDK 后续的旋转和 48px 高度归一化仍沿用原逻辑。
        const crop = this.platform.createCanvas(
          Math.max(
            1,
            Math.floor(
              vertical
                ? box.width
                : Math.min(box.width, box.height * ratioLimit),
            ),
          ),
          Math.max(
            1,
            Math.floor(
              vertical
                ? Math.min(box.height, box.width * ratioLimit)
                : box.height,
            ),
          ),
        );
        try {
          crop
            .getContext('2d')
            .drawImage(
              canvas,
              box.x,
              box.y,
              box.width,
              box.height,
              0,
              0,
              crop.width,
              crop.height,
            );
          const recognized = await withTensorCleanup(
            this.recognitionSession,
            () =>
              recognitor.run(
                crop,
                [{ x: 0, y: 0, width: crop.width, height: crop.height }],
                this.options.recognition?.charactersDictionary,
                'per-box',
                { recBatchSize: 1 },
              ),
          );
          const value = recognized
            .map((item) => item.text.trim())
            .filter(Boolean)
            .join(' ');
          if (!value) continue;
          if (
            text.length + value.length + (lines.length ? 1 : 0) >
            MAX_OCR_TEXT_LENGTH
          )
            throw new Error('图片文字过多，请裁剪后分段识别');
          if (lines.length) text += '\n';
          const x = Math.min(width, (box.x * width) / cropWidth);
          const y = Math.min(height, (box.y * height) / cropHeight);
          lines.push({
            text: value,
            start: text.length,
            x,
            y,
            width: Math.min(width - x, (box.width * width) / cropWidth),
            height: Math.min(height - y, (box.height * height) / cropHeight),
          });
          text += value;
        } finally {
          crop.width = 1;
          crop.height = 1;
        }
      }
      const finished = performance.now();
      return {
        result: { text, lines, width, height },
        metrics: {
          modelReused,
          provider,
          modelInitMs: initialized - started,
          decodeMs: decoded - initialized,
          detectionMs: detected - decoded,
          recognitionMs: finished - detected,
          totalMs: finished - started,
          width,
          height,
          cropWidth,
          cropHeight,
          boxes: boxes.length,
          processPeakRssBytes: process.resourceUsage().maxRSS * 1024,
        },
      };
    } finally {
      canvas.width = 1;
      canvas.height = 1;
      source.width = 1;
      source.height = 1;
    }
  };
}
