// Full-row fingerprints adapted from jietuba / longstitch (MIT), Copyright (c) 2025 JYAARU.
// License: public/licenses/jietuba-MIT.txt.
export interface ScrollRowHashes {
  exact: number[];
  coarse: number[];
}

export interface ScrollFrameSignature {
  width: number;
  height: number;
  bitmap: Uint8Array;
  columns: Float32Array;
  hashes?: ScrollRowHashes;
}

/** 每行只读取三组三列，按 BGR 转灰度后取组均值，不遍历整帧或预先计算完整哈希。 */
export const createScrollSignature = (
  bitmap: Uint8Array,
  width: number,
  height: number,
): ScrollFrameSignature => {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width < 64 ||
    height < 96 ||
    width * height > 40_000_000 ||
    bitmap.length !== width * height * 4
  )
    throw new Error('滚动截图选区至少为 64 × 96 像素，且不能超过 4000 万像素');
  const columns = new Float32Array(height * 3);
  const effective = width - Math.max(1, Math.floor(width / 10));
  const centers = [0.2, 0.5, 0.8].map((ratio) =>
    Math.min(effective - 2, Math.max(1, Math.floor(effective * ratio))),
  );
  for (let y = 0; y < height; y += 1) {
    for (let group = 0; group < 3; group += 1) {
      let total = 0;
      for (let dx = -1; dx <= 1; dx += 1) {
        const index = (y * width + centers[group]! + dx) * 4;
        total +=
          bitmap[index]! * 0.114 +
          bitmap[index + 1]! * 0.587 +
          bitmap[index + 2]! * 0.299;
      }
      columns[y * 3 + group] = total / 3;
    }
  }
  return { width, height, bitmap, columns };
};

/** 回退时才计算指定像素片段的完整行指纹；忽略 alpha 和右侧滚动条，不修改原图。 */
export const computeScrollRowHashes = (
  bitmap: Uint8Array,
  width: number,
): ScrollRowHashes => {
  const height = bitmap.length / (width * 4);
  const exact: number[] = [];
  const coarse: number[] = [];
  const effective = width - Math.max(1, Math.floor(width / 10));
  for (let y = 0; y < height; y += 1) {
    let hashA = 2166136261;
    let hashB = 5381;
    let blue = 0;
    let green = 0;
    let red = 0;
    for (let x = 0; x < effective; x += 1) {
      const index = (y * width + x) * 4;
      blue += bitmap[index]!;
      green += bitmap[index + 1]!;
      red += bitmap[index + 2]!;
      for (let channel = 0; channel < 3; channel += 1) {
        const value = bitmap[index + channel]!;
        hashA = Math.imul(hashA ^ value, 16777619);
        hashB = Math.imul(hashB, 33) ^ value;
      }
    }
    exact.push((hashA >>> 0) * 2097152 + (hashB & 0x1fffff));
    coarse.push(
      Math.floor(blue / effective / 8) * 1024 +
        Math.floor(green / effective / 8) * 32 +
        Math.floor(red / effective / 8),
    );
  }
  return { exact, coarse };
};
