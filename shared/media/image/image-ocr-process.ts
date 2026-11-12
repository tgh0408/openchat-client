import type {
  ImageOcrExecution,
  ImageOcrResult,
  ImageOcrProvider,
} from './image-ocr';

/** auto 仅用于尚无本机记录时的一次自动选择，已选后端直接传入子进程。 */
export type ImageOcrPreference = 'auto' | ImageOcrProvider;

/** 推理基准与裁剪预算；不通过页面参数放宽资源限制。 */
export const IMAGE_OCR_LIMITS = {
  detectionSide: 960,
  cropSide: 2000,
  recognitionHeight: 48,
  recognitionWidth: 3200,
  maxBoxes: 1000,
  maxPixels: 40_000_000,
  timeoutMs: 120_000,
  gpuTimeoutMs: 45_000,
  idleMs: 60_000,
} as const;

/** 仅记录阶段耗时、尺寸和进程内存，不记录图片内容或识别文字。 */
export interface ImageOcrMetrics {
  modelReused: boolean;
  provider: ImageOcrProvider;
  modelInitMs: number;
  decodeMs: number;
  detectionMs: number;
  recognitionMs: number;
  totalMs: number;
  width: number;
  height: number;
  cropWidth: number;
  cropHeight: number;
  boxes: number;
  processPeakRssBytes: number;
}

export interface ImageOcrProcessRequest {
  type: 'recognize';
  id: string;
  bytes: Uint8Array;
}

export type ImageOcrProcessResponse =
  | { type: 'ready' }
  | { type: 'provider'; id: string; provider: ImageOcrProvider }
  | { type: 'failure'; id: string; error: string; retryable: boolean }
  | {
      type: 'result';
      id: string;
      result: ImageOcrResult;
      metrics: ImageOcrMetrics;
      execution?: ImageOcrExecution;
      retire: boolean;
    };
