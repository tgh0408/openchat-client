import type { ScrollScreenshotProgress } from '../../../shared/media/screenshot/screenshot';
import {
  getScrollPreviewLayout,
  followScrollPreview,
} from '../../../shared/media/screenshot/screenshot-preview';
import { desktopCapturer, nativeImage, screen } from 'electron';
import type { Display, Point, Rectangle } from 'electron';
import { MAX_IMAGE_BYTES } from '../../../shared/media/image/image';
import {
  createScrollSignature,
  createScrollStitchSession,
} from '../../../shared/media/screenshot/screenshot-stitch';
import type { ScrollHeading } from '../../../shared/media/screenshot/screenshot-stitch';
import {
  createScreenshotInput,
  isScreenshotPointerInside,
} from './screenshot-input';

interface ScrollCaptureOptions {
  display: Display;
  crop: Rectangle;
  imageSize: { width: number; height: number };
  isMaskPoint: (point: Point) => boolean;
  validate: () => void;
  progress: (progress: Omit<ScrollScreenshotProgress, 'requestId'>) => void;
  dismissed: () => void;
  complete: (png: Uint8Array | undefined, message: string) => void;
}

export interface ScrollCapture {
  start: () => void;
  finish: () => void;
  cancel: () => void;
}

/** 串行采集并立即尝试匹配，持续滚动不重置等待；仅结束时补采静止尾帧。 */
export const createScrollCapture = async (
  options: ScrollCaptureOptions,
): Promise<ScrollCapture> => {
  const { display, crop, imageSize } = options;
  const composite = createScrollStitchSession(crop.width, crop.height);
  const input = await createScreenshotInput();
  const bounds: Rectangle = {
    x: display.bounds.x + (crop.x / imageSize.width) * display.bounds.width,
    y: display.bounds.y + (crop.y / imageSize.height) * display.bounds.height,
    width: (crop.width / imageSize.width) * display.bounds.width,
    height: (crop.height / imageSize.height) * display.bounds.height,
  };
  const center = {
    x: Math.round(bounds.x + bounds.width / 2),
    y: Math.round(bounds.y + bounds.height / 2),
  };
  let heading: ScrollHeading | undefined;
  let lastColumns: Float32Array | undefined;
  let target: ReturnType<typeof input.target> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let finishTimer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let started = false;
  let endingAt = 0;
  let activeAt = Date.now();
  let mismatchSince: number | undefined;
  let preview = '';
  let frameTop = 0;
  let publishedFrameTop = -1;
  let previewOffset = 0;
  let publishedRevision = -1;
  let publishedMessage = '';
  const readyMessage = '在选区内向上或向下滚动，自动拼接；回滚不会重复追加。';

  /** 内容或当前帧位置变化时发送可见预览片段，回滚也更新绿框，不传输整张长图。 */
  const report = (message: string, warning: boolean = false): void => {
    const height = composite.height();
    const revision = composite.revision();
    if (
      revision === publishedRevision &&
      frameTop === publishedFrameTop &&
      message === publishedMessage
    )
      return;
    const layout = getScrollPreviewLayout(
      {
        ...bounds,
        x: bounds.x - display.bounds.x,
        y: bounds.y - display.bounds.y,
      },
      display.bounds,
      { width: crop.width, height: height || crop.height },
    );
    const panel = layout.panel;
    if (height && panel) {
      const scale = panel.width / crop.width;
      const previousOffset = previewOffset;
      previewOffset = followScrollPreview(
        previewOffset,
        Math.max(1, Math.round(height * scale)),
        panel.height,
        frameTop * scale,
        (frameTop + crop.height) * scale,
      );
      if (
        revision !== publishedRevision ||
        frameTop !== publishedFrameTop ||
        previousOffset !== previewOffset ||
        !preview
      ) {
        const thumbnail = composite.preview({
          width: panel.width,
          height: panel.height,
          offset: previewOffset,
        });
        preview = nativeImage
          .createFromBitmap(
            Buffer.from(
              thumbnail.bitmap.buffer,
              thumbnail.bitmap.byteOffset,
              thumbnail.bitmap.byteLength,
            ),
            {
              width: thumbnail.width,
              height: thumbnail.height,
              scaleFactor: 1,
            },
          )
          .toDataURL();
      }
    } else {
      preview = '';
      previewOffset = 0;
    }
    options.validate();
    options.progress({
      width: crop.width,
      height,
      frameTop,
      frameHeight: crop.height,
      previewOffset,
      layout,
      preview,
      message,
      warning,
    });
    publishedRevision = revision;
    publishedFrameTop = frameTop;
    publishedMessage = message;
  };

  /** 同步撤销监听和定时器，停止后的异步抓屏结果只能丢弃。 */
  const stop = (): void => {
    stopped = true;
    clearTimeout(timer);
    clearTimeout(deadline);
    clearTimeout(finishTimer);
    input.stop();
    heading = undefined;
    lastColumns = undefined;
    preview = '';
  };

  /** 取消或授权失效时释放全部像素，不生成图片或更新剪贴板。 */
  const cancel = (): void => {
    stop();
    composite.clear();
  };

  /** 正常结束才编码交付；没有二次确认时，异常不能静默交付不完整图片。 */
  const finish = (failure?: Error): void => {
    if (stopped) return;
    stop();
    try {
      options.validate();
      if (failure) throw failure;
      if (!composite.height()) throw new Error('未获取到可用长截图，请重试');
      const bitmap = composite.bitmap();
      const height = composite.height();
      composite.clear();
      const png = nativeImage
        .createFromBitmap(
          Buffer.from(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength),
          {
            width: crop.width,
            height,
            scaleFactor: 1,
          },
        )
        .toPNG();
      if (!png.length || png.length > MAX_IMAGE_BYTES)
        throw new Error('长截图超过 50 MiB，请缩小选区或减少滚动长度');
      options.validate();
      options.complete(new Uint8Array(png), '');
    } catch (error) {
      options.complete(
        undefined,
        error instanceof Error ? error.message : '长截图生成失败',
      );
    } finally {
      composite.clear();
    }
  };

  /** 当前采样完成后才安排下一次抓屏，退出期间也沿用同一个串行任务。 */
  const schedule = (): void => {
    if (!stopped)
      timer = setTimeout(
        () => {
          void sample();
        },
        endingAt || Date.now() - activeAt < 1000 ? 100 : 300,
      );
  };

  /** 每帧直接交给增量拼接会话，匹配成功立即更新，输入只决定采样节奏和方向。 */
  const sample = async (): Promise<void> => {
    if (stopped || !started) return;
    try {
      options.validate();
      if (!target || !input.unchanged(target, center))
        throw new Error('目标窗口已移动或被遮挡，滚动截图已停止，请重新截图。');
      if (endingAt && Date.now() >= endingAt) {
        finish(new Error('最后画面未能确认，未生成长截图，请重新截图'));
        return;
      }
      if (
        composite.height() &&
        !endingAt &&
        !isScreenshotPointerInside(bounds)
      ) {
        report('已暂停采集：移回选区继续滚动，单击遮罩完成截图。');
        return;
      }
      if (
        isScreenshotPointerInside(bounds) &&
        !input.unchanged(target, screen.getCursorScreenPoint())
      )
        throw new Error('鼠标下方窗口已变化，停止采集');
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: imageSize,
        fetchWindowIcons: false,
      });
      if (stopped) return;
      options.validate();
      if (!input.unchanged(target, center))
        throw new Error('目标窗口已变化，停止采集');
      const source = sources.find(
        (candidate) => candidate.display_id === String(display.id),
      );
      const size = source?.thumbnail.getSize();
      if (
        !source ||
        !size ||
        size.width !== imageSize.width ||
        size.height !== imageSize.height
      )
        throw new Error('屏幕尺寸已变化或无法读取屏幕');
      const bitmap = source.thumbnail.crop(crop).toBitmap();
      const signature = createScrollSignature(bitmap, crop.width, crop.height);
      const unchanged =
        lastColumns !== undefined &&
        signature.columns.every(
          (value, index) => value === lastColumns?.[index],
        );
      if (!unchanged) activeAt = Date.now();
      lastColumns = signature.columns;
      const step = composite.push(signature, heading);
      if (!step) {
        mismatchSince ??= Date.now();
        if (Date.now() - mismatchSince >= 600)
          report('暂未找到可靠重叠，请滚回已截内容附近再缓慢滚动。', true);
        return;
      }
      if (step.changed || step.movement) activeAt = Date.now();
      mismatchSince = undefined;
      heading = undefined;
      frameTop = step.top;
      report(endingAt ? '正在补采最后画面，请稍候…' : readyMessage);
      if (endingAt && unchanged && !step.changed && step.movement === 0) {
        finish();
        return;
      }
    } catch (error) {
      if (!stopped)
        finish(error instanceof Error ? error : new Error('滚动截图失败'));
    } finally {
      schedule();
    }
  };

  /** 结束时补采惯性滚动的尾帧，两帧一致才交付，超时明确报告失败。 */
  const requestFinish = (): void => {
    if (stopped || !started || endingAt) return;
    endingAt = Date.now() + 1800;
    finishTimer = setTimeout(() => {
      finish(new Error('尾帧采集超时，未生成长截图，请重新截图'));
    }, 1800);
    try {
      report('正在结束采集并生成长截图，请稍候…');
    } catch (error) {
      finish(error instanceof Error ? error : new Error('滚动截图已失效'));
    }
  };

  /** 点击滚动截图后立即绑定目标并采集首帧；只监听必要操作，不记录按键内容，取消立即销毁整个截图任务。 */
  const start = (): void => {
    if (started || stopped) return;
    options.validate();
    target = input.target(center);
    started = true;
    input.listen(
      (): void => {
        if (stopped) return;
        cancel();
        options.dismissed();
      },
      (direction: ScrollHeading | undefined): void => {
        if (!stopped && isScreenshotPointerInside(bounds)) {
          activeAt = Date.now();
          heading = direction;
        }
      },
      (pressed: Point, released: Point): void => {
        if (
          !stopped &&
          options.isMaskPoint(pressed) &&
          options.isMaskPoint(released)
        )
          requestFinish();
      },
    );
    deadline = setTimeout(
      () => finish(new Error('已达到两分钟采集时限，请重新截图')),
      120_000,
    );
    void sample();
  };

  return { start, finish: requestFinish, cancel };
};
