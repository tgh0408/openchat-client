// Adapted from jietuba / longstitch (MIT), Copyright (c) 2025 JYAARU.
// Source: 329dea1c6bcd1601a6c9c0689fac7934f61dd2d4, src/{hash,lcs,session}.rs.
// License: public/licenses/jietuba-MIT.txt. Port notes: ./README.md.
import { createScrollComposite } from './screenshot-composite';
import type {
  ScrollCompositeEdit,
  ScrollPreviewSlice,
} from './screenshot-composite';

import { computeScrollRowHashes } from './screenshot-features';
import type {
  ScrollFrameSignature,
  ScrollRowHashes as RowHashes,
} from './screenshot-features';
import { matchScrollColumns } from './screenshot-columns';
export { createScrollSignature } from './screenshot-features';
export type { ScrollFrameSignature } from './screenshot-features';

type FullFrameSignature = ScrollFrameSignature & RowHashes;
export interface ScrollStitchDiagnostics {
  fastMatches: number;
  fallbackAttempts: number;
  hashedPixels: number;
}
export type ScrollHeading = 'up' | 'down';
type HashKind = 'exact' | 'coarse';
interface Placement {
  startI: number;
  startJ: number;
  length: number;
}
export interface ScrollStitchStep {
  top: number;
  movement: number;
  changed: boolean;
}
export interface ScrollStitchSession {
  push: (
    frame: ScrollFrameSignature,
    heading?: ScrollHeading,
  ) => ScrollStitchStep | undefined;
  height: () => number;
  revision: () => number;
  diagnostics: () => ScrollStitchDiagnostics;
  bitmap: () => Uint8Array;
  preview: (slice?: ScrollPreviewSlice) => {
    bitmap: Uint8Array;
    width: number;
    height: number;
  };
  clear: () => void;
}

/** 统计行指纹次数，只有双方唯一的行才能提供强定位证据。 */
const occurrences = (rows: readonly number[]): Map<number, number> => {
  const counts = new Map<number, number>();
  for (const row of rows) counts.set(row, (counts.get(row) ?? 0) + 1);
  return counts;
};

/** 按长度及位置固定排序，同样的帧始终产生同样的候选顺序。 */
const comparePlacements = (left: Placement, right: Placement): number =>
  right.length - left.length ||
  right.startI - left.startI ||
  left.startJ - right.startJ;

/** 查找最长连续公共行段；每个位移保留最长段，避免空白行产生无界候选。 */
const overlapCandidates = (
  result: readonly number[],
  frame: readonly number[],
  start: number,
  hashStart: number,
): Placement[] => {
  const minimum = Math.max(
    1,
    Math.floor(Math.min(result.length, frame.length) * 0.01),
  );
  const positions = new Map<number, number[]>();
  for (let index = 0; index < result.length; index += 1) {
    const hash = result[index]!;
    const list = positions.get(hash);
    if (list) list.push(index);
    else positions.set(hash, [index]);
  }
  const bestByOffset = new Map<number, Placement>();
  for (let j = 0; j < frame.length; j += 1) {
    for (const i of positions.get(frame[j]!) ?? []) {
      if (i > 0 && j > 0 && result[i - 1] === frame[j - 1]) continue;
      let length = 0;
      while (
        i + length < result.length &&
        j + length < frame.length &&
        result[i + length] === frame[j + length]
      )
        length += 1;
      if (length < minimum) continue;
      const candidate = { startI: i + start, startJ: j + hashStart, length };
      const offset = candidate.startI - candidate.startJ;
      const previous = bestByOffset.get(offset);
      if (!previous || comparePlacements(candidate, previous) < 0)
        bestByOffset.set(offset, candidate);
    }
  }
  const selected: Placement[] = [];
  for (const candidate of [...bestByOffset.values()].sort(comparePlacements)) {
    if (
      selected.some(
        (used) =>
          Math.min(
            used.startI + used.length,
            candidate.startI + candidate.length,
          ) -
            Math.max(used.startI, candidate.startI) >
          candidate.length / 2,
      )
    )
      continue;
    selected.push(candidate);
    if (selected.length === 32) break;
  }
  return selected;
};

/** 保留已拼长图的行索引与当前帧位置，回滚只定位，两端新内容才扩展。 */
export const createScrollStitchSession = (
  width: number,
  frameHeight: number,
  options: { fastMatching?: boolean } = {},
): ScrollStitchSession => {
  const composite = createScrollComposite(width, frameHeight);
  let rows: RowHashes = { exact: [], coarse: [] };
  let position = 0;
  let lastMove: ScrollHeading | undefined;
  let reference: ScrollFrameSignature | undefined;
  let settledBars: [number, number] | undefined;
  let version = 0;
  let profiles = new Float32Array(0);
  let rowsCurrent = false;
  let prediction = 0;
  let stripHashes = new WeakMap<Uint8Array, RowHashes>();
  const metrics: ScrollStitchDiagnostics = {
    fastMatches: 0,
    fallbackAttempts: 0,
    hashedPixels: 0,
  };

  /** 仅回退阶段计算完整指纹，并记录真实扫描像素数供隔离回归和性能对照。 */
  const hashPixels = (bitmap: Uint8Array): RowHashes => {
    metrics.hashedPixels +=
      (bitmap.length / (width * 4)) * (width - Math.floor(width / 10));
    return computeScrollRowHashes(bitmap, width);
  };

  /** 当前帧第一次需要完整匹配时才计算行指纹，同一帧内复用结果。 */
  const frameHashes = (frame: ScrollFrameSignature): RowHashes => {
    frame.hashes ??= hashPixels(frame.bitmap);
    return frame.hashes;
  };

  /** 按未变化的像素片段缓存旧长图指纹，快速路径从不触发此步骤。 */
  const ensureRows = (): void => {
    if (rowsCurrent) return;
    const next: RowHashes = { exact: [], coarse: [] };
    composite.visitStrips((strip) => {
      let hashes = stripHashes.get(strip);
      if (!hashes) {
        hashes = hashPixels(strip);
        stripHashes.set(strip, hashes);
      }
      next.exact.push(...hashes.exact);
      next.coarse.push(...hashes.coarse);
    });
    rows = next;
    rowsCurrent = true;
  };

  /** 同步更新轻量列索引与分段像素，尺寸失败时不改变原索引和基准。 */
  const applyPixels = (
    frame: ScrollFrameSignature,
    edit: ScrollCompositeEdit,
  ): void => {
    const nextHeight = edit.headRows + edit.keep + frameHeight - edit.skip;
    const next = new Float32Array(nextHeight * 3);
    next.set(frame.columns.subarray(0, edit.headRows * 3));
    next.set(
      profiles.subarray(edit.headCut * 3, (edit.headCut + edit.keep) * 3),
      edit.headRows * 3,
    );
    next.set(
      frame.columns.subarray(edit.skip * 3),
      (edit.headRows + edit.keep) * 3,
    );
    composite.apply(frame.bitmap, edit);
    profiles = next;
    rows = { exact: [], coarse: [] };
    rowsCurrent = false;
    version += 1;
  };

  /** 相邻帧同位置完全不变的连续边缘可作为固定栏，整屏不动时不推断。 */
  const fixedBars = (frame: readonly number[]): [number, number] => {
    const lastFrame = reference ? frameHashes(reference).exact : [];
    if (lastFrame.length !== frame.length) return [0, 0];
    let top = 0;
    let bottom = 0;
    while (top < frame.length && frame[top] === lastFrame[top]) top += 1;
    if (top === frame.length) return [0, 0];
    while (
      bottom < frame.length - top &&
      frame[frame.length - 1 - bottom] === lastFrame[frame.length - 1 - bottom]
    )
      bottom += 1;
    return (top + bottom) * 2 >= frame.length ? [0, 0] : [top, bottom];
  };

  /** 优先邻近位置，再搜索已有长图；平均色回退必须有八行唯一证据。 */
  const locateBy = (
    frame: RowHashes,
    kind: HashKind,
    bars: [number, number],
    heading?: ScrollHeading,
  ): Placement | undefined => {
    const result = rows[kind];
    const hashStart = bars[0];
    const hashEnd = frameHeight - bars[1];
    const hashes = frame[kind].slice(hashStart, hashEnd);
    if (!hashes.length) return undefined;
    const counts = occurrences(hashes);
    const unique = [...counts.values()].filter((count) => count === 1).length;
    const needed = Math.min(8, Math.max(1, Math.floor(unique / 2)));
    const bottom = Math.min(position + frameHeight, result.length);
    const near: [number, number] = [
      Math.max(0, bottom - hashes.length * 2),
      Math.min(result.length, bottom + hashes.length),
    ];

    /** 在指定范围内核对连续段的唯一行证据，方向只用于候选排序。 */
    const search = (range: [number, number]): Placement | undefined => {
      const start = Math.max(
        range[0],
        Math.floor(frameHeight * (heading === 'up' ? 0.05 : 0.15)),
      );
      const end = range[1];
      if (start >= end) return undefined;
      const region = result.slice(start, end);
      const rangeCounts = occurrences(region);
      const candidates = overlapCandidates(region, hashes, start, hashStart);
      const longest = candidates[0]?.length ?? 0;
      /** 根据最近移动方向选择合理候选，不让短噪声段优先于长重叠。 */
      const preferred = (candidate: Placement): boolean => {
        const top = candidate.startI - candidate.startJ;
        return (
          longest <= candidate.length * 5 &&
          (heading === 'down'
            ? top >= position
            : heading === 'up'
              ? top <= position
              : true)
        );
      };
      const ordered = [
        ...candidates.filter(preferred),
        ...candidates.filter((candidate) => !preferred(candidate)),
      ];
      return ordered.find((candidate) => {
        let evidence = 0;
        for (let k = 0; k < candidate.length; k += 1) {
          const hash = result[candidate.startI + k]!;
          if (rangeCounts.get(hash) === 1 && counts.get(hash) === 1)
            evidence += 1;
        }
        const enough =
          kind === 'exact'
            ? Math.min(needed, Math.max(1, Math.floor(candidate.length / 2)))
            : 8;
        if (evidence >= enough) return true;
        if (kind !== 'exact') return false;
        const top = candidate.startI - candidate.startJ;
        const first = Math.max(hashStart, -top);
        const last = Math.min(hashEnd, result.length - top);
        return (
          candidate.length * 2 >= Math.max(0, last - first) &&
          (evidence >= 2 || candidate.length * 4 >= hashes.length)
        );
      });
    };
    return (
      search(near) ??
      (near[0] === 0 && near[1] === result.length
        ? undefined
        : search([0, result.length]))
    );
  };

  /** 先像素精确匹配，再使用量化色彩匹配，拒绝没有充分重叠的帧。 */
  const locate = (
    frame: RowHashes,
    bars: [number, number],
    heading?: ScrollHeading,
  ): { placement: Placement; kind: HashKind } | undefined => {
    for (const kind of ['exact', 'coarse'] as const) {
      const placement = locateBy(frame, kind, bars, heading);
      if (placement) return { placement, kind };
    }
    return undefined;
  };

  /** 边缘至少连续十六行且含四种内容一致时保留旧像素，避免悬停状态污染。 */
  const edgeHolds = (
    frame: RowHashes,
    kind: HashKind,
    top: number,
    atEnd: boolean,
  ): boolean => {
    const result = rows[kind];
    const hashes = frame[kind];
    const distinct = new Set<number>();
    let count = 0;
    while (count < result.length) {
      const row = atEnd ? result.length - 1 - count : count;
      const other = row - top;
      if (other < 0 || other >= frameHeight || result[row] !== hashes[other])
        break;
      distinct.add(result[row]!);
      count += 1;
    }
    return count >= 16 && distinct.size >= 4;
  };

  /** 从需要扩展的一端向内寻找可靠接缝，跳过已被滚动内容替代的旧固定栏。 */
  const agreementFromEdge = (
    frame: RowHashes,
    kind: HashKind,
    top: number,
    atEnd: boolean,
  ): number | undefined => {
    const low = Math.max(top, 0);
    const high = Math.min(top + frameHeight, rows[kind].length);
    let run = 0;
    for (let index = 0; index < high - low; index += 1) {
      const row = atEnd ? high - 1 - index : low + index;
      if (rows[kind][row] !== frame[kind][row - top]) {
        run = 0;
        continue;
      }
      run += 1;
      if (run < 16) continue;
      const from = atEnd ? row : row - 15;
      if (new Set(rows[kind].slice(from, from + 16)).size >= 4)
        return atEnd ? from + 16 : from;
    }
    return undefined;
  };

  /** 同步提交像素和行索引，尺寸超限时不丢失此前已确认的长图。 */
  const apply = (
    frame: FullFrameSignature,
    edit: ScrollCompositeEdit,
  ): void => {
    const next: RowHashes = { exact: [], coarse: [] };
    for (const kind of ['exact', 'coarse'] as const) {
      next[kind] = frame[kind]
        .slice(0, edit.headRows)
        .concat(
          rows[kind].slice(edit.headCut, edit.headCut + edit.keep),
          frame[kind].slice(edit.skip),
        );
    }
    applyPixels(frame, edit);
    rows = next;
    rowsCurrent = true;
  };

  /** 根据定位结果延伸或替换长图边缘，内部回滚只更新位置。 */
  const commit = (
    frame: FullFrameSignature,
    placement: Placement,
    kind: HashKind,
  ): ScrollStitchStep => {
    const length = rows.exact.length;
    const top = placement.startI - placement.startJ;
    const movement = top - position;
    const nextMove = movement ? (movement > 0 ? 'down' : 'up') : lastMove;
    const before = version;
    if (top < 0) {
      const seam = edgeHolds(frame, kind, top, false)
        ? 0
        : (agreementFromEdge(frame, kind, top, false) ?? placement.startI);
      apply(frame, {
        headCut: seam,
        headRows: seam - top,
        keep: length - seam,
        skip: frameHeight,
      });
    } else if (top + frameHeight > length) {
      const seam = edgeHolds(frame, kind, top, true)
        ? length
        : (agreementFromEdge(frame, kind, top, true) ??
          placement.startI + placement.length);
      apply(frame, { headCut: 0, headRows: 0, keep: seam, skip: seam - top });
    } else {
      const atEnd =
        top + frameHeight === length && !(top === 0 && nextMove === 'up');
      if (atEnd && !edgeHolds(frame, kind, top, true)) {
        const seam = agreementFromEdge(frame, kind, top, true);
        if (seam !== undefined && seam < length)
          apply(frame, {
            headCut: 0,
            headRows: 0,
            keep: seam,
            skip: seam - top,
          });
      } else if (top === 0 && !atEnd && !edgeHolds(frame, kind, top, false)) {
        const seam = agreementFromEdge(frame, kind, top, false);
        if (seam !== undefined && seam > 0)
          apply(frame, {
            headCut: seam,
            headRows: seam,
            keep: length - seam,
            skip: frameHeight,
          });
      }
    }
    position = Math.max(0, top);
    lastMove = nextMove;
    return { top: position, movement, changed: version !== before };
  };

  /** 优先列采样及局部像素复核，只有失败才构建完整指纹；失败不移动预测或已确认基准。 */
  const push = (
    frame: ScrollFrameSignature,
    heading?: ScrollHeading,
  ): ScrollStitchStep | undefined => {
    if (
      frame.width !== width ||
      frame.height !== frameHeight ||
      frame.bitmap.length !== width * frameHeight * 4
    )
      throw new Error('前后截图尺寸不一致');
    if (!composite.height()) {
      applyPixels(frame, { headCut: 0, headRows: 0, keep: 0, skip: 0 });
      reference = frame;
      return { top: 0, movement: 0, changed: true };
    }
    if (options.fastMatching !== false && reference) {
      const expected =
        heading === 'up'
          ? -Math.abs(prediction)
          : heading === 'down'
            ? Math.abs(prediction)
            : prediction;
      const fast = matchScrollColumns(
        reference,
        frame,
        position,
        profiles,
        expected,
        composite.readRow,
      );
      if (fast) {
        const top = position + fast.offset;
        const length = composite.height();
        const before = version;
        if (fast.seam !== undefined) {
          if (top < 0)
            applyPixels(frame, {
              headCut: fast.seam,
              headRows: fast.seam - top,
              keep: length - fast.seam,
              skip: frameHeight,
            });
          else
            applyPixels(frame, {
              headCut: 0,
              headRows: 0,
              keep: fast.seam,
              skip: fast.seam - top,
            });
        }
        position = Math.max(0, top);
        if (fast.offset) {
          prediction = fast.offset;
          lastMove = fast.offset > 0 ? 'down' : 'up';
        }
        reference = frame;
        metrics.fastMatches += 1;
        return {
          top: position,
          movement: fast.offset,
          changed: version !== before,
        };
      }
    }
    metrics.fallbackAttempts += 1;
    ensureRows();
    const full: FullFrameSignature = { ...frame, ...frameHashes(frame) };
    if (full.exact.every((hash, row) => hash === rows.exact[position + row])) {
      reference = frame;
      return { top: position, movement: 0, changed: false };
    }
    let bars = fixedBars(full.exact);
    let found = locate(full, bars, heading ?? lastMove);
    if (!found && settledBars) {
      const retry: [number, number] = [
        Math.min(bars[0], settledBars[0]),
        Math.min(bars[1], settledBars[1]),
      ];
      if (retry[0] !== bars[0] || retry[1] !== bars[1]) {
        bars = retry;
        found = locate(full, bars, heading ?? lastMove);
      }
    }
    if (!found) return undefined;
    const step = commit(full, found.placement, found.kind);
    if (step.movement) {
      settledBars = bars;
      prediction = step.movement;
    }
    reference = frame;
    return step;
  };

  /** 清除像素、位置和指纹，取消后的任务不保留屏幕内容。 */
  const clear = (): void => {
    composite.clear();
    rows = { exact: [], coarse: [] };
    position = 0;
    lastMove = undefined;
    reference = undefined;
    settledBars = undefined;
    version = 0;
    profiles = new Float32Array(0);
    rowsCurrent = false;
    prediction = 0;
    stripHashes = new WeakMap<Uint8Array, RowHashes>();
    metrics.fastMatches = 0;
    metrics.fallbackAttempts = 0;
    metrics.hashedPixels = 0;
  };
  /** 内容修订号也覆盖高度不变的懒加载边缘更新。 */
  const revision = (): number => version;
  /** 只返回统计副本，不暴露图像、账号或可变内部状态。 */
  const diagnostics = (): ScrollStitchDiagnostics => ({ ...metrics });
  return {
    push,
    height: composite.height,
    revision,
    diagnostics,
    bitmap: composite.bitmap,
    preview: composite.preview,
    clear,
  };
};
