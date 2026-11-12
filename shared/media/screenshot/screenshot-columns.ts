import type { ScrollFrameSignature } from './screenshot-features';

export interface ScrollColumnMatch {
  offset: number;
  seam: number | undefined;
}
interface Candidate {
  offset: number;
  error: number;
}

/** 将三组灰度均值量化为定位键，重复行不会作为唯一定位证据。 */
const rowKey = (columns: Float32Array, row: number): number =>
  Math.floor(columns[row * 3]! / 4) * 4096 +
  Math.floor(columns[row * 3 + 1]! / 4) * 64 +
  Math.floor(columns[row * 3 + 2]! / 4);

/** 统计每个采样行的唯一位置，出现多次时标为不可定位。 */
const uniqueRows = (
  columns: Float32Array,
  start: number,
  end: number,
): Map<number, number> => {
  const rows = new Map<number, number>();
  for (let row = start; row < end; row += 1) {
    const key = rowKey(columns, row);
    rows.set(key, rows.has(key) ? -1 : row);
  }
  return rows;
};

/** 比较对齐后的三个灰度组，右侧滚动条不参与匹配。 */
const sameRow = (
  left: Float32Array,
  i: number,
  right: Float32Array,
  j: number,
): boolean => {
  for (let group = 0; group < 3; group += 1)
    if (Math.abs(left[i * 3 + group]! - right[j * 3 + group]!) > 0.25)
      return false;
  return true;
};

/** 排除相邻帧中位置不变的窄固定栏；整屏相同或固定部分过大时不推断。 */
const contentRange = (
  previous: ScrollFrameSignature,
  current: ScrollFrameSignature,
): [number, number] => {
  const height = current.height;
  let top = 0;
  let bottom = 0;
  while (top < height && sameRow(previous.columns, top, current.columns, top))
    top += 1;
  if (top < height) {
    while (
      bottom < height - top &&
      sameRow(
        previous.columns,
        height - 1 - bottom,
        current.columns,
        height - 1 - bottom,
      )
    )
      bottom += 1;
  }
  if ((top + bottom) * 2 >= height) {
    top = 0;
    bottom = 0;
  }
  const margin = Math.floor(height * 0.08);
  return [Math.max(margin, top), height - Math.max(margin, bottom)];
};

/** 先搜索上次位移附近，再检查唯一行提出的其他候选；候选数量和 MAD 行数均有上限。 */
const estimateOffset = (
  previous: ScrollFrameSignature,
  current: ScrollFrameSignature,
  prediction: number,
): number | undefined => {
  const [start, end] = contentRange(previous, current);
  const before = uniqueRows(previous.columns, start, end);
  const after = uniqueRows(current.columns, start, end);
  const votes = new Map<number, number[]>();
  const maximum = Math.floor(current.height * 0.7);
  for (const [key, row] of after) {
    const oldRow = before.get(key);
    if (row < 0 || oldRow === undefined || oldRow < 0) continue;
    const offset = oldRow - row;
    if (Math.abs(offset) > maximum) continue;
    const positions = votes.get(offset);
    if (positions) positions.push(row);
    else votes.set(offset, [row]);
  }
  const plausible = [...votes.entries()].filter(
    ([, positions]) => positions.length >= 6,
  );
  // 证据过少或候选过多时不猜位置，交给完整指纹回退。
  if (!plausible.length || plausible.length > 32) return undefined;
  plausible.sort((left, right) => right[1].length - left[1].length);
  const offsets = new Set<number>();
  for (let distance = 0; distance <= 24; distance += 1) {
    for (const offset of [prediction + distance, prediction - distance])
      if ((votes.get(offset)?.length ?? 0) >= 6) offsets.add(offset);
  }
  for (const [offset] of plausible) offsets.add(offset);
  const candidates: Candidate[] = [];
  for (const offset of offsets) {
    const first = Math.max(start, start - offset);
    const last = Math.min(end, end - offset);
    if (last - first < Math.max(32, current.height * 0.15)) continue;
    const anchors = votes
      .get(offset)!
      .filter((row) => row >= first && row < last);
    if (
      anchors.length < 6 ||
      Math.max(...anchors) - Math.min(...anchors) < (last - first) * 0.35
    )
      continue;
    const errors = [0, 0, 0];
    const count = Math.min(96, last - first);
    for (let sample = 0; sample < count; sample += 1) {
      const row = first + Math.floor(((sample + 0.5) * (last - first)) / count);
      for (let group = 0; group < 3; group += 1)
        errors[group] =
          errors[group]! +
          Math.abs(
            previous.columns[(row + offset) * 3 + group]! -
              current.columns[row * 3 + group]!,
          );
    }
    if (errors.some((error) => error / count > 1.5)) continue;
    candidates.push({
      offset,
      error: errors.reduce((sum, error) => sum + error, 0) / (count * 3),
    });
  }
  candidates.sort((left, right) => left.error - right.error);
  const best = candidates[0];
  if (!best) return undefined;
  if (
    candidates.slice(1).some((candidate) => candidate.error <= best.error + 0.5)
  )
    return undefined;
  return best.offset;
};

/** 在不同横纵位置复核十五块 RGB 像素，要求至少两个纵向区间提供真实纹理证据。 */
const verifyBlocks = (
  frame: ScrollFrameSignature,
  top: number,
  length: number,
  readRow: (row: number) => Uint8Array,
): boolean => {
  const margin = Math.floor(frame.height * 0.12);
  const first = Math.max(margin, -top);
  const last = Math.min(frame.height - margin, length - top);
  if (last - first < 24) return false;
  const effective = frame.width - Math.floor(frame.width / 10);
  const patchWidth = Math.min(16, Math.floor(effective / 6));
  let texturedBands = 0;
  let texturedBlocks = 0;
  for (let band = 0; band < 3; band += 1) {
    const y = Math.floor(first + ((band + 0.5) * (last - first)) / 3) - 3;
    let bandTexture = 0;
    for (const ratio of [0.08, 0.27, 0.46, 0.65, 0.84]) {
      const x = Math.max(
        0,
        Math.min(
          effective - patchWidth,
          Math.floor(effective * ratio) - Math.floor(patchWidth / 2),
        ),
      );
      let error = 0;
      let changed = 0;
      let texture = 0;
      for (let dy = 0; dy < 6; dy += 1) {
        const row = readRow(top + y + dy);
        for (let dx = 0; dx < patchWidth; dx += 1) {
          for (let channel = 0; channel < 3; channel += 1) {
            const original = row[(x + dx) * 4 + channel]!;
            const index = ((y + dy) * frame.width + x + dx) * 4 + channel;
            const value = frame.bitmap[index]!;
            const difference = Math.abs(original - value);
            error += difference;
            if (difference > 8) changed += 1;
            if (dy)
              texture += Math.abs(
                value - frame.bitmap[index - frame.width * 4]!,
              );
            if (dx) texture += Math.abs(value - frame.bitmap[index - 4]!);
          }
        }
      }
      const samples = 6 * patchWidth * 3;
      if (error / samples > 1.5 || changed / samples > 0.02) return false;
      if (texture / samples > 2) {
        texturedBlocks += 1;
        bandTexture += 1;
      }
    }
    if (bandTexture >= 2) texturedBands += 1;
  }
  return texturedBands >= 2 && texturedBlocks >= 4;
};

/** 接缝或边缘的少量完整 RGB 行额外复核，避免采样列之外的错行被直接拼入。 */
const verifyRows = (
  frame: ScrollFrameSignature,
  top: number,
  start: number,
  count: number,
  readRow: (row: number) => Uint8Array,
): boolean => {
  const effective = frame.width - Math.floor(frame.width / 10);
  for (let y = start; y < start + count; y += 1) {
    const row = readRow(y);
    let error = 0;
    let changed = 0;
    for (let x = 0; x < effective; x += 1) {
      for (let channel = 0; channel < 3; channel += 1) {
        const difference = Math.abs(
          row[x * 4 + channel]! -
            frame.bitmap[((y - top) * frame.width + x) * 4 + channel]!,
        );
        error += difference;
        if (difference > 8) changed += 1;
      }
    }
    if (error / (effective * 3) > 1 || changed / (effective * 3) > 0.01)
      return false;
  }
  return true;
};

/** 从扩展边缘向内找一致接缝，跳过固定栏；最多复核三个接缝，失败交回完整算法。 */
const findSeam = (
  frame: ScrollFrameSignature,
  top: number,
  result: Float32Array,
  readRow: (row: number) => Uint8Array,
  atEnd: boolean,
): number | undefined => {
  const first = Math.max(0, top);
  const last = Math.min(result.length / 3, top + frame.height);
  let run = 0;
  let verified = 0;
  for (let index = 0; index < last - first; index += 1) {
    const row = atEnd ? last - 1 - index : first + index;
    if (!sameRow(result, row, frame.columns, row - top)) {
      run = 0;
      continue;
    }
    run += 1;
    if (run < 16) continue;
    const from = atEnd ? row : row - 15;
    const keys = new Set<number>();
    for (let y = from; y < from + 16; y += 1) keys.add(rowKey(result, y));
    if (keys.size < 4) continue;
    const seam = atEnd ? from + 16 : from;
    if (verifyRows(frame, top, atEnd ? seam - 4 : seam, 4, readRow))
      return seam;
    if (++verified >= 3) return undefined;
  }
  return undefined;
};

/** 只接受无歧义的列位移和像素复核结果；不修改基准、已有像素或预测状态。 */
export const matchScrollColumns = (
  reference: ScrollFrameSignature,
  frame: ScrollFrameSignature,
  position: number,
  result: Float32Array,
  prediction: number,
  readRow: (row: number) => Uint8Array,
): ScrollColumnMatch | undefined => {
  const offset = estimateOffset(reference, frame, prediction);
  if (offset === undefined) return undefined;
  const top = position + offset;
  const length = result.length / 3;
  if (!verifyBlocks(frame, top, length, readRow)) return undefined;
  if (top < 0 || top + frame.height > length) {
    const seam = findSeam(frame, top, result, readRow, top >= 0);
    return seam === undefined ? undefined : { offset, seam };
  }
  // 同高度边缘变化（例如懒加载）必须交给完整算法处理，不能当成静止直接丢掉。
  if (top === 0 && !verifyRows(frame, top, 0, 8, readRow)) return undefined;
  if (
    top + frame.height === length &&
    !verifyRows(frame, top, length - 8, 8, readRow)
  )
    return undefined;
  return { offset, seam: undefined };
};
