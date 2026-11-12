export interface ScrollPreviewSlice {
  width: number;
  height: number;
  offset: number;
}

export interface ScrollCompositeEdit {
  headCut: number;
  headRows: number;
  keep: number;
  skip: number;
}

export interface ScrollComposite {
  height: () => number;
  apply: (bitmap: Uint8Array, edit: ScrollCompositeEdit) => void;
  bitmap: () => Uint8Array;
  readRow: (row: number) => Uint8Array;
  visitStrips: (visit: (strip: Uint8Array) => void) => void;
  preview: (slice?: ScrollPreviewSlice) => {
    bitmap: Uint8Array;
    width: number;
    height: number;
  };
  clear: () => void;
}

/** 分段保存原始像素，支持两端延伸和固定栏替换，所有边界在修改前校验。 */
export const createScrollComposite = (
  width: number,
  frameHeight: number,
): ScrollComposite => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(frameHeight) ||
    width < 64 ||
    frameHeight < 96 ||
    width * frameHeight > 40_000_000
  )
    throw new Error('滚动截图尺寸无效');
  const rowBytes = width * 4;
  const strips: Uint8Array[] = [];
  let totalHeight = 0;
  let stripStarts: number[] = [];

  /** 原子校验拼接计划后裁掉旧边缘，再保存新帧中需要的行。 */
  const apply = (bitmap: Uint8Array, edit: ScrollCompositeEdit): void => {
    const { headCut, headRows, keep, skip } = edit;
    if (
      bitmap.length !== rowBytes * frameHeight ||
      ![headCut, headRows, keep, skip].every(Number.isSafeInteger) ||
      headCut < 0 ||
      headCut > totalHeight ||
      headRows < 0 ||
      headRows > frameHeight ||
      keep < 0 ||
      keep > totalHeight - headCut ||
      skip < 0 ||
      skip > frameHeight
    )
      throw new Error('滚动截图接缝无效');
    const nextHeight = headRows + keep + frameHeight - skip;
    if (nextHeight > 30000 || nextHeight * width > 40_000_000)
      throw new Error(
        '已达到长截图上限（高度 30000 像素或总计 4000 万像素）。',
      );
    // 先分配新片段，分配失败时仍保留原有内容。
    const head = new Uint8Array(bitmap.subarray(0, headRows * rowBytes));
    const tail = new Uint8Array(bitmap.subarray(skip * rowBytes));
    // 只对本次真正保存的新增像素规范 alpha，不再逐帧扫描全部图像。
    for (const strip of [head, tail])
      for (let index = 3; index < strip.length; index += 4) strip[index] = 255;
    let remaining = headCut;
    while (remaining > 0) {
      const first = strips.shift()!;
      const rows = first.length / rowBytes;
      if (rows > remaining) strips.unshift(first.slice(remaining * rowBytes));
      remaining = Math.max(0, remaining - rows);
    }
    let retained = totalHeight - headCut;
    while (strips.length && retained > keep) {
      const last = strips.pop()!;
      const start = retained - last.length / rowBytes;
      if (start < keep) strips.push(last.slice(0, (keep - start) * rowBytes));
      retained = Math.max(start, keep);
    }
    if (head.length) strips.unshift(head);
    if (tail.length) strips.push(tail);
    totalHeight = nextHeight;
    let start = 0;
    stripStarts = strips.map((strip) => {
      const offset = start;
      start += strip.length / rowBytes;
      return offset;
    });
  };

  /** 二分定位已有像素行，供局部复核使用，不合并或复制整张长图。 */
  const readRow = (row: number): Uint8Array => {
    if (!Number.isInteger(row) || row < 0 || row >= totalHeight)
      throw new Error('长截图读取范围无效');
    let left = 0;
    let right = strips.length - 1;
    while (left < right) {
      const middle = Math.ceil((left + right) / 2);
      if (stripStarts[middle]! <= row) left = middle;
      else right = middle - 1;
    }
    const offset = (row - stripStarts[left]!) * rowBytes;
    return strips[left]!.subarray(offset, offset + rowBytes);
  };

  /** 只读遍历片段，允许回退匹配按片段缓存指纹，避免重算未变的旧内容。 */
  const visitStrips = (visit: (strip: Uint8Array) => void): void => {
    for (const strip of strips) visit(strip);
  };
  /** 结束采集时才一次性合并原始像素，不改变图片分辨率。 */
  const bitmap = (): Uint8Array => {
    const result = new Uint8Array(totalHeight * rowBytes);
    let position = 0;
    for (const strip of strips) {
      result.set(strip, position);
      position += strip.length;
    }
    return result;
  };

  /** 直接从片段生成有界缩略图，不为预览复制整张长图。 */
  const preview = (
    slice?: ScrollPreviewSlice,
  ): { bitmap: Uint8Array; width: number; height: number } => {
    if (!totalHeight) throw new Error('长截图尚未就绪');
    if (
      slice &&
      (!Number.isInteger(slice.width) ||
        !Number.isInteger(slice.height) ||
        !Number.isInteger(slice.offset) ||
        slice.width < 1 ||
        slice.width > 190 ||
        slice.height < 1 ||
        slice.height > 16384 ||
        slice.offset < 0)
    )
      throw new Error('滚动截图预览范围无效');
    const scale = slice
      ? slice.width / width
      : Math.min(1, 360 / width, 640 / totalHeight);
    const previewWidth = Math.max(1, Math.round(width * scale));
    const scaledHeight = Math.max(1, Math.round(totalHeight * scale));
    const previewHeight = Math.min(scaledHeight, slice?.height ?? scaledHeight);
    const offset = Math.min(
      slice?.offset ?? 0,
      Math.max(0, scaledHeight - previewHeight),
    );
    const result = new Uint8Array(previewWidth * previewHeight * 4);
    let stripIndex = 0;
    let stripTop = 0;
    for (let row = 0; row < previewHeight; row += 1) {
      const sourceRow = Math.min(
        totalHeight - 1,
        Math.floor(((offset + row) * totalHeight) / scaledHeight),
      );
      while (sourceRow >= stripTop + strips[stripIndex]!.length / rowBytes) {
        stripTop += strips[stripIndex]!.length / rowBytes;
        stripIndex += 1;
      }
      const strip = strips[stripIndex]!;
      for (let column = 0; column < previewWidth; column += 1) {
        const source =
          (sourceRow - stripTop) * rowBytes +
          Math.floor((column * width) / previewWidth) * 4;
        result.set(
          strip.subarray(source, source + 4),
          (row * previewWidth + column) * 4,
        );
      }
    }
    return { bitmap: result, width: previewWidth, height: previewHeight };
  };

  /** 取消、结束或授权失效后释放本任务全部像素。 */
  const clear = (): void => {
    strips.length = 0;
    totalHeight = 0;
    stripStarts = [];
  };
  /** 读取已确认的长图高度，不暴露内部片段。 */
  const height = (): number => totalHeight;
  return { height, apply, bitmap, readRow, visitStrips, preview, clear };
};
