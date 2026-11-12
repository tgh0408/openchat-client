import DiffMatchPatch from 'diff-match-patch';
import type { OcrTextRange } from './image-ocr';

interface TextChange {
  sourceStart: number;
  sourceEnd: number;
  targetStart: number;
  targetEnd: number;
  equal: boolean;
}

/** 避免替换区间插值后把 UTF-16 代理对从中间截断。 */
const alignCharacter = (text: string, offset: number, end: boolean): number => {
  const current = text.charCodeAt(offset);
  const previous = text.charCodeAt(offset - 1);
  if (
    current >= 0xdc00 &&
    current <= 0xdfff &&
    previous >= 0xd800 &&
    previous <= 0xdbff
  )
    return offset + (end ? 1 : -1);
  return offset;
};

/** 缓存一次文本版本的 diff，图片拖选时只映射偏移；替换段合并以保留修订后的选区。 */
export const createOcrSelectionMapper = (
  source: string,
  target: string,
): ((range: OcrTextRange) => OcrTextRange) => {
  const engine = new DiffMatchPatch();
  engine.Diff_Timeout = 0.05;
  const differences = engine.diff_main(source, target);
  engine.diff_cleanupSemantic(differences);
  const changes: TextChange[] = [];
  let sourceOffset = 0;
  let targetOffset = 0;
  for (const [operation, text] of differences) {
    const equal = operation === 0;
    const last = changes[changes.length - 1];
    const change: TextChange =
      !equal && last && !last.equal
        ? last
        : {
            sourceStart: sourceOffset,
            sourceEnd: sourceOffset,
            targetStart: targetOffset,
            targetEnd: targetOffset,
            equal,
          };
    if (change !== last) changes.push(change);
    if (operation !== 1) sourceOffset += text.length;
    if (operation !== -1) targetOffset += text.length;
    change.sourceEnd = sourceOffset;
    change.targetEnd = targetOffset;
  }

  /** 起点跳过边界新增文字，终点停在新增文字前；删除区间折叠到删除位置。 */
  const mapOffset = (raw: number, end: boolean): number => {
    const offset = Math.max(0, Math.min(source.length, raw));
    for (const change of changes) {
      const length = change.sourceEnd - change.sourceStart;
      if (length === 0) {
        if (offset === change.sourceStart && end) return change.targetStart;
        continue;
      }
      if (offset < change.sourceEnd || (offset === change.sourceEnd && end)) {
        const relative = Math.max(0, offset - change.sourceStart);
        const mapped = change.equal
          ? change.targetStart + relative
          : change.targetStart +
            (relative / length) * (change.targetEnd - change.targetStart);
        return alignCharacter(
          target,
          end ? Math.ceil(mapped) : Math.floor(mapped),
          end,
        );
      }
    }
    return target.length;
  };

  return (range: OcrTextRange): OcrTextRange => {
    const start = mapOffset(Math.min(range.start, range.end), false);
    const end = mapOffset(Math.max(range.start, range.end), true);
    return { start, end: Math.max(start, end) };
  };
};
