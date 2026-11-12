// Adapted from jietuba main/stitch/scroll_window.py (MIT, Copyright (c) 2025 JYAARU).
// Reference: 329dea1c6bcd1601a6c9c0689fac7934f61dd2d4. License: public/licenses/jietuba-MIT.txt.
export interface ScrollPreviewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScrollPreviewLayout {
  panel: ScrollPreviewRect | null;
  toolbar: ScrollPreviewRect | null;
}

/** 将坐标限制在可用屏幕范围内，避免窄小空白区出现负坐标。 */
const clamp = (value: number, minimum: number, maximum: number): number =>
  Math.max(minimum, Math.min(value, Math.max(minimum, maximum)));

/** 检查两个矩形是否占用同一片区域，贴边不算相交。 */
const intersects = (
  left: ScrollPreviewRect,
  right: ScrollPreviewRect,
): boolean =>
  left.x < right.x + right.width &&
  left.x + left.width > right.x &&
  left.y < right.y + right.height &&
  left.y + left.height > right.y;

/** 从可用区域扣除提示条及其间距，预览不能覆盖提示或进入穿透选区。 */
const excludeToolbar = (
  area: ScrollPreviewRect,
  toolbar: ScrollPreviewRect | null,
): ScrollPreviewRect[] => {
  if (!toolbar) return [area];
  const reserved = {
    x: toolbar.x - 14,
    y: toolbar.y - 14,
    width: toolbar.width + 28,
    height: toolbar.height + 28,
  };
  if (!intersects(area, reserved)) return [area];
  return [
    { ...area, height: Math.min(area.height, reserved.y - area.y) },
    {
      ...area,
      y: Math.max(area.y, reserved.y + reserved.height),
      height:
        area.y + area.height - Math.max(area.y, reserved.y + reserved.height),
    },
    { ...area, width: Math.min(area.width, reserved.x - area.x) },
    {
      ...area,
      x: Math.max(area.x, reserved.x + reserved.width),
      width:
        area.x + area.width - Math.max(area.x, reserved.x + reserved.width),
    },
  ].filter((part) => part.width > 0 && part.height > 0);
};

/** 纵向预览优先贴选区右侧、底边对齐，再回退左、上、下；长图增长时重新定位。 */
export const getScrollPreviewLayout = (
  capture: ScrollPreviewRect,
  viewport: { width: number; height: number },
  image: { width: number; height: number },
): ScrollPreviewLayout => {
  const margin = 14;
  const right = capture.x + capture.width;
  const bottom = capture.y + capture.height;
  const toolbarWidth = Math.min(380, viewport.width - margin * 2);
  const toolbarHeight = 44;
  const centerX = clamp(
    capture.x + (capture.width - toolbarWidth) / 2,
    margin,
    viewport.width - toolbarWidth - margin,
  );
  const centerY = clamp(
    capture.y + (capture.height - toolbarHeight) / 2,
    margin,
    viewport.height - toolbarHeight - margin,
  );
  const toolbar =
    [
      { x: centerX, y: capture.y - toolbarHeight - margin },
      { x: centerX, y: bottom + margin },
      { x: capture.x - toolbarWidth - margin, y: centerY },
      { x: right + margin, y: centerY },
    ]
      .map((point) => ({
        ...point,
        width: toolbarWidth,
        height: toolbarHeight,
      }))
      .find(
        (rect) =>
          rect.width > 0 &&
          rect.x >= margin &&
          rect.y >= margin &&
          rect.x + rect.width <= viewport.width - margin &&
          rect.y + rect.height <= viewport.height - margin &&
          !intersects(rect, capture),
      ) ?? null;
  const areas = [
    {
      side: 'right',
      x: right + margin,
      y: margin,
      width: viewport.width - right - margin * 2,
      height: viewport.height - margin * 2,
    },
    {
      side: 'left',
      x: margin,
      y: margin,
      width: capture.x - margin * 2,
      height: viewport.height - margin * 2,
    },
    {
      side: 'top',
      x: margin,
      y: margin,
      width: viewport.width - margin * 2,
      height: capture.y - margin * 2,
    },
    {
      side: 'bottom',
      x: margin,
      y: bottom + margin,
      width: viewport.width - margin * 2,
      height: viewport.height - bottom - margin * 2,
    },
  ];
  // 先保持参考模板 190px 宽；屏幕边缘空间不足时才收窄，始终不覆盖选区。
  for (const minimum of [190, 48]) {
    for (const area of areas) {
      const spaces = excludeToolbar(area, toolbar).filter(
        (part) => part.width >= minimum && part.height >= minimum,
      );
      spaces.sort(
        (left, rightArea) =>
          Math.min(190, rightArea.width) *
            Math.min(viewport.height - 60, rightArea.height) -
          Math.min(190, left.width) *
            Math.min(viewport.height - 60, left.height),
      );
      for (const space of spaces) {
        const width = Math.floor(Math.min(190, space.width));
        const height = Math.floor(
          Math.min(
            Math.max(
              width,
              Math.round((image.height * width) / Math.max(1, image.width)),
            ),
            viewport.height - 60,
            16384,
            space.height,
          ),
        );
        if (height < 48) continue;
        const x =
          area.side === 'right'
            ? space.x
            : area.side === 'left'
              ? space.x + space.width - width
              : clamp(
                  capture.x + (capture.width - width) / 2,
                  space.x,
                  space.x + space.width - width,
                );
        const y =
          area.side === 'top'
            ? space.y + space.height - height
            : area.side === 'bottom'
              ? space.y
              : clamp(
                  bottom - height,
                  space.y,
                  space.y + space.height - height,
                );
        return {
          toolbar,
          panel: { x: Math.round(x), y: Math.round(y), width, height },
        };
      }
    }
  }
  return { toolbar, panel: null };
};

/** 当前画面接近预览边缘时才移动视口，保留最多 24px 余量并支持回滚。 */
export const followScrollPreview = (
  previous: number,
  total: number,
  length: number,
  start: number,
  end: number,
): number => {
  if (total <= length) return 0;
  if (end - start >= length) return Math.round(clamp(start, 0, total - length));
  let offset = Math.min(previous, total - length);
  const margin = Math.min(
    24,
    Math.max(0, Math.floor((length - (end - start)) / 2)),
  );
  if (start < offset + margin) offset = start - margin;
  else if (end > offset + length - margin) offset = end + margin - length;
  return Math.round(clamp(offset, 0, total - length));
};
