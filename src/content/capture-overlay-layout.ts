import type { CaptureRange, DocRect } from './capture-range';

export const MARK_INSET = 3;
export const PIN_OFFSET = 11;
export const PIN_DIAMETER = 22;

export interface OverlayLayout {
  box: { x: number; y: number; w: number; h: number };
  pin: { x: number; y: number; d: number };
}

export function layoutOverlay(
  docRect: DocRect,
  range: CaptureRange,
  inset: number
): OverlayLayout {
  const bx = docRect.x - inset;
  const by = docRect.y - range.top - inset;
  const bw = docRect.w + inset * 2;
  const bh = docRect.h + inset * 2;
  return {
    box: { x: bx, y: by, w: bw, h: bh },
    pin: { x: bx - PIN_OFFSET, y: by - PIN_OFFSET, d: PIN_DIAMETER },
  };
}
