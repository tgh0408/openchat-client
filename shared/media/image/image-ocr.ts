/** 图片识别只返回文本和原图像素坐标，不包含文件路径或账号信息。 */
export interface ImageOcrLine {
  text: string;
  start: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageOcrResult {
  text: string;
  lines: ImageOcrLine[];
  width: number;
  height: number;
}

export interface OcrTextRange {
  start: number;
  end: number;
}

export const MAX_OCR_TEXT_LENGTH = 100_000;

/** 校验持久化的原始识别结果，避免损坏的文字偏移或坐标进入预览层。 */
export const parseImageOcrResult = (value: unknown): ImageOcrResult => {
  if (!value || typeof value !== 'object')
    throw new Error('图片识别缓存格式无效');
  const result = value as Record<string, unknown>;
  const { text, width, height, lines } = result;
  if (
    typeof text !== 'string' ||
    text.length > MAX_OCR_TEXT_LENGTH ||
    typeof width !== 'number' ||
    typeof height !== 'number' ||
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width * height > 40_000_000 ||
    !Array.isArray(lines) ||
    lines.length > 5000
  )
    throw new Error('图片识别缓存格式无效');
  const parsed: ImageOcrLine[] = [];
  let offset = 0;
  for (const item of lines as unknown[]) {
    if (!item || typeof item !== 'object')
      throw new Error('图片识别缓存文字区域无效');
    const line = item as Record<string, unknown>;
    const { text: content, start, x, y, width: w, height: h } = line;
    if (
      typeof content !== 'string' ||
      !content.length ||
      start !== offset ||
      text.slice(offset, offset + content.length) !== content ||
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof w !== 'number' ||
      typeof h !== 'number' ||
      ![x, y, w, h].every(Number.isFinite) ||
      x < 0 ||
      y < 0 ||
      w <= 0 ||
      h <= 0 ||
      x + w > width ||
      y + h > height
    )
      throw new Error('图片识别缓存文字区域无效');
    parsed.push({ text: content, start: offset, x, y, width: w, height: h });
    offset += content.length + 1;
  }
  if (parsed.map((line) => line.text).join('\n') !== text)
    throw new Error('图片识别缓存文本无效');
  return { text, width, height, lines: parsed };
};

export type ImageOcrProvider = 'cpu' | 'dml' | 'cuda' | 'coreml';

/** 仅汇总 ONNX 内核执行事件，不把配置的优先后端当作实际执行证明。 */
export interface ImageOcrExecution {
  execution: 'cpu' | 'gpu' | 'mixed' | 'unknown';
  provider: ImageOcrProvider;
  completed: boolean;
  sessions: number;
  profiledSessions: number;
  kernels: Record<string, number>;
  unknownKernels: number;
  completeProfile: boolean;
}
