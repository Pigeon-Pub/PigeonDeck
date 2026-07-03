/* ============================================================
   capture.test.ts — computeCaptureRange / planScreens / layoutOverlay 纯函数单测
   ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  computeCaptureRange,
  planScreens,
  layoutOverlay,
  DocRect,
  MAX_CAPTURE_HEIGHT,
  MARK_INSET,
  PIN_OFFSET,
  PIN_DIAMETER,
  CaptureRange,
} from './capture';

// ============================================================
// computeCaptureRange
// ============================================================

describe('computeCaptureRange', () => {
  it('空矩形列表时返回 height:0', () => {
    const r = computeCaptureRange([], 20, MAX_CAPTURE_HEIGHT, 1280);
    expect(r.height).toBe(0);
    expect(r.truncated).toBe(false);
    expect(r.width).toBe(1280);
  });

  it('单个矩形，padding 扩展上下边界', () => {
    const rects: DocRect[] = [{ x: 0, y: 100, w: 200, h: 50 }];
    const r = computeCaptureRange(rects, 20, MAX_CAPTURE_HEIGHT, 1280);
    // minY = 100 - 20 = 80, maxY = 150 + 20 = 170
    expect(r.top).toBe(80);
    expect(r.height).toBe(90); // 170 - 80
    expect(r.truncated).toBe(false);
  });

  it('顶端 clamp ≥ 0（padding 扩展超出文档顶部）', () => {
    const rects: DocRect[] = [{ x: 0, y: 10, w: 200, h: 50 }];
    const r = computeCaptureRange(rects, 40, MAX_CAPTURE_HEIGHT, 1280);
    // minY = 10 - 40 = -30 → clamp 0; maxY = 60 + 40 = 100
    expect(r.top).toBe(0);
    expect(r.height).toBe(100);
  });

  it('多矩形时取全局 min/max', () => {
    const rects: DocRect[] = [
      { x: 0, y: 200, w: 100, h: 50 }, // top 200, bottom 250
      { x: 0, y: 500, w: 100, h: 80 }, // top 500, bottom 580
      { x: 0, y: 100, w: 100, h: 30 }, // top 100, bottom 130
    ];
    const r = computeCaptureRange(rects, 10, MAX_CAPTURE_HEIGHT, 1280);
    // minY = 100 - 10 = 90, maxY = 580 + 10 = 590
    expect(r.top).toBe(90);
    expect(r.height).toBe(500); // 590 - 90
  });

  it('超过 maxHeight 时截断并置 truncated=true', () => {
    const rects: DocRect[] = [{ x: 0, y: 0, w: 100, h: 5000 }];
    const r = computeCaptureRange(rects, 0, 3000, 1280);
    expect(r.height).toBe(3000);
    expect(r.truncated).toBe(true);
  });

  it('恰好等于 maxHeight 时不截断', () => {
    const rects: DocRect[] = [{ x: 0, y: 0, w: 100, h: 3000 }];
    const r = computeCaptureRange(rects, 0, 3000, 1280);
    expect(r.height).toBe(3000);
    expect(r.truncated).toBe(false);
  });

  it('width 取自传入 docWidth', () => {
    const rects: DocRect[] = [{ x: 0, y: 0, w: 100, h: 100 }];
    const r = computeCaptureRange(rects, 0, MAX_CAPTURE_HEIGHT, 1920);
    expect(r.width).toBe(1920);
  });
});

// ============================================================
// planScreens
// ============================================================

describe('planScreens', () => {
  it('单屏：rangeHeight <= viewportH 时返回 [rangeTop]', () => {
    const screens = planScreens(200, 600, 800);
    expect(screens).toEqual([200]);
  });

  it('单屏：rangeTop=0, rangeHeight < viewportH', () => {
    const screens = planScreens(0, 500, 800);
    expect(screens).toEqual([0]);
  });

  it('两屏：末屏对齐范围底', () => {
    // rangeTop=0, height=1200, viewportH=800
    // 屏1: y=0 (0-800), 屏2末: y=max(0,1200-800)=400 (400-1200)
    const screens = planScreens(0, 1200, 800);
    expect(screens).toEqual([0, 400]);
  });

  it('整除三屏：无重叠末屏', () => {
    // rangeTop=0, height=2400, viewportH=800
    // 屏1:0, 屏2:800, 末屏:1600（恰好等于 screens[-1]，不重复）
    const screens = planScreens(0, 2400, 800);
    expect(screens).toEqual([0, 800, 1600]);
  });

  it('非整除多屏：末屏补上', () => {
    // rangeTop=0, height=2000, viewportH=800
    // while: y=0 push 0, y=800; y=800 push 800, y=1600; y=1600+800=2400>=2000 exit
    // lastY = 2000-800 = 1200
    const screens = planScreens(0, 2000, 800);
    expect(screens).toEqual([0, 800, 1200]);
  });

  it('rangeTop 非零时，末屏对齐范围底', () => {
    // rangeTop=300, height=1000, viewportH=800
    // 单屏 (1000 <= 800? no)
    // while: y=300, 300+800=1100 < 1300, push 300, y=1100; 1100+800=1900>=1300 exit
    // lastY = max(0, 1300-800)=500
    const screens = planScreens(300, 1000, 800);
    expect(screens).toEqual([300, 500]);
  });

  it('rangeHeight=0 时返回空数组', () => {
    expect(planScreens(0, 0, 800)).toEqual([]);
  });

  it('viewportH=0 时返回空数组', () => {
    expect(planScreens(0, 1000, 0)).toEqual([]);
  });

  it('大 rangeTop 时 lastY 不低于 0', () => {
    // rangeTop=100, height=400, viewportH=800（单屏）
    const screens = planScreens(100, 400, 800);
    expect(screens).toEqual([100]);
  });
});

// ============================================================
// layoutOverlay
// ============================================================

describe('layoutOverlay', () => {
  const range: CaptureRange = { top: 100, height: 2000, width: 1280, truncated: false };

  it('元素框：inset 外扩 + Y 减 range.top', () => {
    const docRect: DocRect = { x: 200, y: 300, w: 100, h: 50 };
    const layout = layoutOverlay(docRect, range, MARK_INSET);
    // box: x=200-3=197, y=300-100-3=197, w=100+6=106, h=50+6=56
    expect(layout.box).toEqual({ x: 197, y: 197, w: 106, h: 56 });
  });

  it('位号圆贴框左上角，偏移 PIN_OFFSET，直径 PIN_DIAMETER', () => {
    const docRect: DocRect = { x: 200, y: 300, w: 100, h: 50 };
    const layout = layoutOverlay(docRect, range, MARK_INSET);
    // pin: x=197-11=186, y=197-11=186, d=22
    expect(layout.pin).toEqual({ x: 186, y: 186, d: PIN_DIAMETER });
  });

  it('区域框：inset=0 时 box 等于文档矩形（Y 减 top）', () => {
    const docRect: DocRect = { x: 50, y: 500, w: 300, h: 200 };
    const layout = layoutOverlay(docRect, range, 0);
    expect(layout.box).toEqual({ x: 50, y: 400, w: 300, h: 200 });
    // pin 仍按 box 左上角偏移
    expect(layout.pin).toEqual({ x: 50 - PIN_OFFSET, y: 400 - PIN_OFFSET, d: PIN_DIAMETER });
  });

  it('range.top=0 时 Y 不偏移', () => {
    const zeroRange: CaptureRange = { top: 0, height: 1000, width: 800, truncated: false };
    const docRect: DocRect = { x: 10, y: 20, w: 40, h: 40 };
    const layout = layoutOverlay(docRect, zeroRange, 0);
    expect(layout.box).toEqual({ x: 10, y: 20, w: 40, h: 40 });
  });
});
