export interface DocRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CaptureRange {
  top: number;
  height: number;
  width: number;
  truncated: boolean;
}

export const MAX_CAPTURE_HEIGHT = 14000;

export function computeCaptureRange(
  rects: DocRect[],
  padding: number,
  maxHeight: number,
  docWidth: number
): CaptureRange {
  if (rects.length === 0) {
    return { top: 0, height: 0, width: docWidth, truncated: false };
  }
  const minY = Math.min(...rects.map((r) => r.y)) - padding;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + padding;
  const top = Math.max(0, minY);
  let height = Math.max(0, maxY - top);
  let truncated = false;
  if (height > maxHeight) {
    height = maxHeight;
    truncated = true;
  }
  return { top, height, width: docWidth, truncated };
}

export function planScreens(
  rangeTop: number,
  rangeHeight: number,
  viewportH: number
): number[] {
  if (rangeHeight <= 0 || viewportH <= 0) return [];
  if (rangeHeight <= viewportH) {
    return [Math.max(0, rangeTop)];
  }
  const rangeBottom = rangeTop + rangeHeight;
  const screens: number[] = [];
  let y = rangeTop;
  while (y + viewportH < rangeBottom) {
    screens.push(y);
    y += viewportH;
  }
  const lastY = Math.max(0, rangeBottom - viewportH);
  if (screens.length === 0 || screens[screens.length - 1] !== lastY) {
    screens.push(lastY);
  }
  return screens;
}
