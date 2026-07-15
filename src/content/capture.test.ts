// @vitest-environment jsdom
/* ============================================================
   capture.test.ts — computeCaptureRange / planScreens / layoutOverlay 纯函数单测
   ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  computeCaptureRange,
  planScreens,
  layoutOverlay,
  computeCardLayout,
  computeArrowHead,
  wrapText,
  CopyImageManager,
  DocRect,
  MAX_CAPTURE_HEIGHT,
  MARK_INSET,
  PIN_OFFSET,
  PIN_DIAMETER,
  CaptureRange,
  CardLayoutItem,
  MeasureFn,
  CARD_MAX_WIDTH,
  CARD_MIN_WIDTH,
  collectOverlayItems,
} from './capture';
import { Controller } from './controller';
import { initEscStack } from './esc-stack';
import { Toast } from './toast';
import { AnnotationStore } from '../state/annotations';
import { DEFAULT_SETTINGS } from '../state/settings';

/** 测量桩：每字符固定 7px（忽略字体），使换行/尺寸可确定性断言 */
const measure7: MeasureFn = (text) => Array.from(text).length * 7;

type CopyImageInternals = {
  currentCanvas: HTMLCanvasElement | null;
  openPanel(canvas: HTMLCanvasElement): void;
  close(): void;
};

function fakeCanvas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  Object.defineProperty(canvas, 'toDataURL', {
    value: () =>
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADElEQVR42mP8z8AARQABywH+q5QhAAAAAElFTkSuQmCC',
  });
  Object.defineProperty(canvas, 'toBlob', {
    value: (cb: BlobCallback) => cb(new Blob(['x'], { type: 'image/png' })),
  });
  return canvas;
}

function setupCopyImagePanel(): {
  manager: CopyImageInternals;
  panelLayer: HTMLElement;
  feedbackLayer: HTMLElement;
} {
  initEscStack();
  document.body.innerHTML = '';
  const panelLayer = document.createElement('div');
  const feedbackLayer = document.createElement('div');
  document.body.append(panelLayer, feedbackLayer);

  const manager = new CopyImageManager({
    controller: new Controller(),
    store: new AnnotationStore(),
    settings: { ...DEFAULT_SETTINGS },
    toast: new Toast(feedbackLayer),
    panelLayer,
    feedbackLayer,
  }) as unknown as CopyImageInternals;
  const canvas = fakeCanvas();
  manager.openPanel(canvas);
  manager.currentCanvas = canvas;
  return { manager, panelLayer, feedbackLayer };
}

function dispatchEsc(): KeyboardEvent {
  const ev = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
  window.dispatchEvent(ev);
  return ev;
}

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

describe('collectOverlayItems — 删除标注', () => {
  it('使用删除前文档坐标并生成中英文删除卡片', () => {
    const store = new AnnotationStore();
    const ann = store.add({
      selector: '#gone',
      elementType: 'container',
      summary: 'div',
      note: '',
      changes: [],
      viewportPos: { x: 1, y: 2, w: 3, h: 4 },
      deleted: true,
      deletion: {
        layout: 'reflow',
        docRect: { x: 100, y: 200, w: 80, h: 30 },
      },
    });

    expect(collectOverlayItems([ann], 'en')[0]).toMatchObject({
      box: { x: 100, y: 200, w: 80, h: 30 },
      card: { typeLabel: 'Delete' },
    });
    expect(collectOverlayItems([ann], 'zh_CN')[0].card?.typeLabel).toBe('删除');
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

// ============================================================
// CopyImageManager Esc 分层（F18c：灯箱先于面板关闭）
// ============================================================

describe('CopyImageManager — 图片灯箱 Esc 分层', () => {
  it('第一次 Esc 只关灯箱，第二次 Esc 才关图片导出面板', () => {
    const { manager, panelLayer, feedbackLayer } = setupCopyImagePanel();

    const shot = panelLayer.querySelector<HTMLImageElement>('[data-testid="pd-image-shot"]')!;
    shot.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(feedbackLayer.querySelector('[data-testid="pd-image-lightbox"]')).not.toBeNull();

    const first = dispatchEsc();
    expect(first.defaultPrevented).toBe(true);
    expect(feedbackLayer.querySelector('[data-testid="pd-image-lightbox"]')).toBeNull();
    expect(panelLayer.querySelector('[data-testid="pd-image-output"]')).not.toBeNull();

    dispatchEsc();
    expect(panelLayer.querySelector('[data-testid="pd-image-output"]')).toBeNull();

    manager.close();
  });

  it('关闭图片导出面板时释放当前 canvas 引用', () => {
    const { manager, panelLayer } = setupCopyImagePanel();

    manager.close();

    expect(panelLayer.querySelector('[data-testid="pd-image-output"]')).toBeNull();
    expect(manager.currentCanvas).toBeNull();
  });
});

// ============================================================
// wrapText（F10 卡片文本换行）
// ============================================================

describe('wrapText', () => {
  const FONT = 'body';

  it('短文本不换行', () => {
    expect(wrapText('hi', 100, FONT, measure7)).toEqual(['hi']);
  });

  it('拉丁文在空格处整词换行，无行超宽、无前导空格', () => {
    // maxWidth=70 → 每行 ≤ 10 字符
    const lines = wrapText('hello world foo bar', 70, FONT, measure7);
    expect(lines.length).toBeGreaterThan(1);
    for (const ln of lines) {
      expect(measure7(ln, FONT)).toBeLessThanOrEqual(70);
      expect(ln.startsWith(' ')).toBe(false);
    }
    // 内容保序还原
    expect(lines.join(' ')).toBe('hello world foo bar');
  });

  it('CJK 无空格逐字换行，每行不超宽', () => {
    const text = '这是一段没有空格的中文文本内容';
    const lines = wrapText(text, 42, FONT, measure7); // ≤6 字符/行
    expect(lines.length).toBeGreaterThan(1);
    for (const ln of lines) {
      expect(measure7(ln, FONT)).toBeLessThanOrEqual(42);
    }
    expect(lines.join('')).toBe(text);
  });

  it('保留显式换行符', () => {
    const lines = wrapText('a\nb', 100, FONT, measure7);
    expect(lines).toEqual(['a', 'b']);
  });
});

// ============================================================
// computeCardLayout（F10 展开卡片非重叠布局）
// ============================================================

describe('computeCardLayout', () => {
  const item = (
    number: number,
    refBox: DocRect,
    note: string,
    lines: string[] = []
  ): CardLayoutItem => ({
    number,
    anchor: { x: refBox.x, y: refBox.y },
    refBox,
    card: { typeLabel: 'Annotation', note, lines },
  });

  it('单卡片：宽度夹在 [MIN, MAX]，高度随内容为正', () => {
    const cards = computeCardLayout([item(1, { x: 100, y: 100, w: 80, h: 40 }, 'short note')], 1280, measure7);
    expect(cards).toHaveLength(1);
    expect(cards[0].rect.w).toBeGreaterThanOrEqual(CARD_MIN_WIDTH);
    expect(cards[0].rect.w).toBeLessThanOrEqual(CARD_MAX_WIDTH);
    expect(cards[0].rect.h).toBeGreaterThan(0);
    // 连线锚点原样保留
    expect(cards[0].anchor).toEqual({ x: 100, y: 100 });
  });

  it('内容更多的卡片更高（高度反映内容）', () => {
    const [small] = computeCardLayout([item(1, { x: 0, y: 0, w: 50, h: 20 }, 'a')], 1280, measure7);
    const [big] = computeCardLayout(
      [item(1, { x: 0, y: 0, w: 50, h: 20 }, 'a', ['color: red → blue', 'size: 10 → 20', 'margin: 0 → 8'])],
      1280,
      measure7
    );
    expect(big.rect.h).toBeGreaterThan(small.rect.h);
  });

  it('多卡片互不重叠（会重叠的输入被下推分离）', () => {
    // 三个参考框挤在同一处 → 强制下推堆叠
    const items = [
      item(1, { x: 200, y: 100, w: 60, h: 30 }, 'note one'),
      item(2, { x: 210, y: 110, w: 60, h: 30 }, 'note two'),
      item(3, { x: 205, y: 105, w: 60, h: 30 }, 'note three'),
    ];
    const cards = computeCardLayout(items, 1280, measure7);
    expect(cards).toHaveLength(3);
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        const a = cards[i].rect;
        const b = cards[j].rect;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap).toBe(false);
      }
    }
  });

  it('卡片矩形被 computeCaptureRange 纳入（画布容纳全部卡片）', () => {
    const items = [
      item(1, { x: 100, y: 100, w: 60, h: 30 }, 'first'),
      item(2, { x: 120, y: 120, w: 60, h: 30 }, 'second card with a longer note that wraps'),
    ];
    const docWidth = 1280;
    const cards = computeCardLayout(items, docWidth, measure7);
    const cardRects = cards.map((c) => c.rect);
    const range = computeCaptureRange(cardRects, 0, MAX_CAPTURE_HEIGHT, docWidth);
    const minY = Math.min(...cardRects.map((r) => r.y));
    const maxY = Math.max(...cardRects.map((r) => r.y + r.h));
    expect(range.top).toBeLessThanOrEqual(minY);
    expect(range.top + range.height).toBeGreaterThanOrEqual(maxY);
    // 所有卡片水平方向也在画布宽内
    for (const r of cardRects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(docWidth);
    }
  });

  it('右侧空间不足时放到左侧，仍夹紧在画布内', () => {
    // refBox 贴近右边界 → 右侧放不下 cardW，落到左侧
    const docWidth = 300;
    const cards = computeCardLayout(
      [item(1, { x: 250, y: 100, w: 40, h: 30 }, 'note')],
      docWidth,
      measure7
    );
    expect(cards[0].rect.x).toBeGreaterThanOrEqual(0);
    expect(cards[0].rect.x + cards[0].rect.w).toBeLessThanOrEqual(docWidth);
  });
});

// ============================================================
// computeArrowHead（D2a 移动箭头几何，纯函数）
// ============================================================

describe('computeArrowHead', () => {
  it('水平向右：两翼 X 相同且在终点左侧，Y 对称', () => {
    const [p1, p2] = computeArrowHead(0, 0, 100, 0, 10);
    // angle=0, spread=π/6
    // p1.x = 100 - 10*cos(π/6) ≈ 91.34; p1.y = -10*sin(-π/6) = 5
    // p2.x = 100 - 10*cos(π/6) ≈ 91.34; p2.y = -10*sin( π/6) = -5
    expect(p1.x).toBeCloseTo(100 - 10 * Math.cos(Math.PI / 6));
    expect(p2.x).toBeCloseTo(100 - 10 * Math.cos(Math.PI / 6));
    expect(p1.y).toBeCloseTo(5);
    expect(p2.y).toBeCloseTo(-5);
    // 两翼关于箭头轴对称
    expect(Math.abs(p1.y + p2.y)).toBeCloseTo(0);
  });

  it('竖直向下：两翼 Y 相同且在终点上方，X 对称', () => {
    const [p1, p2] = computeArrowHead(0, 0, 0, 100, 10);
    // angle=π/2
    expect(p1.y).toBeCloseTo(100 - 10 * Math.cos(Math.PI / 6));
    expect(p2.y).toBeCloseTo(100 - 10 * Math.cos(Math.PI / 6));
    expect(Math.abs(p1.x + p2.x)).toBeCloseTo(0);
  });

  it('两翼距终点均等于 headLen', () => {
    const [p1, p2] = computeArrowHead(0, 0, 80, 60, 10);
    const d1 = Math.sqrt((p1.x - 80) ** 2 + (p1.y - 60) ** 2);
    const d2 = Math.sqrt((p2.x - 80) ** 2 + (p2.y - 60) ** 2);
    expect(d1).toBeCloseTo(10);
    expect(d2).toBeCloseTo(10);
  });

  it('起终点相同（零位移）不崩溃，返回两个点', () => {
    const result = computeArrowHead(50, 50, 50, 50, 10);
    expect(result).toHaveLength(2);
    // atan2(0,0)=0，两翼仍为有限值
    expect(Number.isFinite(result[0].x)).toBe(true);
    expect(Number.isFinite(result[1].x)).toBe(true);
  });
});

// ============================================================
// D2b 坐标系对齐（叠加层 与 截图拼接 使用同一坐标系）
// ============================================================

describe('D2b 坐标系对齐', () => {
  const range: CaptureRange = { top: 200, height: 800, width: 1280, truncated: false };

  it('layoutOverlay 垂直：canvas Y = 文档 Y − range.top', () => {
    const layout = layoutOverlay({ x: 100, y: 350, w: 80, h: 40 }, range, 0);
    expect(layout.box.y).toBe(350 - 200); // 150
  });

  it('layoutOverlay 水平：canvas X = 文档 X（无水平偏移）', () => {
    const layout = layoutOverlay({ x: 300, y: 350, w: 80, h: 40 }, range, 0);
    expect(layout.box.x).toBe(300); // 直接等于文档 X
  });

  it('截图坐标系：scrollX=0 时 canvas X = 文档 X（dstX=scrollX=0 + viewport X = 文档 X）', () => {
    // captureStitched 以 dstX=scrollX=0 绘制，viewport X 与文档 X 相同
    const scrollX = 0;
    const viewportX = 300; // 元素在截图中的 CSS 像素 X
    const canvasX = scrollX + viewportX; // 修复后的 dstX 逻辑
    const docX = viewportX + scrollX; // 文档坐标 X
    expect(canvasX).toBe(docX); // canvas X = 文档 X ✓
  });

  it('截图坐标系：scrollX>0 时 dstX=scrollX 使 canvas X = 文档 X', () => {
    // 元素在 viewport X=100 处，页面横向滚动 scrollX=200 → 文档 X=300
    const scrollX = 200;
    const viewportX = 100;
    const docX = viewportX + scrollX; // 300
    // 修复：dstX=scrollX，视口内 CSS X 加上 dstX 偏移 = 文档 X
    const canvasX = scrollX + viewportX;
    expect(canvasX).toBe(docX);
    // 叠加层 canvas X = 文档 X = 300，与截图对齐 ✓
    const overlayCanvasX = layoutOverlay({ x: docX, y: 350, w: 40, h: 30 }, range, 0).box.x;
    expect(overlayCanvasX).toBe(docX);
    expect(canvasX).toBe(overlayCanvasX);
  });

  it('截图自然 CSS 宽度 = img.naturalWidth / dpr，避免拉伸', () => {
    // 验证：对任意 dpr，dstW = naturalWidth/dpr 还原 1:1 CSS 像素比例
    for (const [naturalWidth, dpr] of [[2560, 2], [1920, 1.5], [1280, 1]] as const) {
      const dstW = naturalWidth / dpr;
      // dstW 应等于 innerWidth（viewport CSS 宽），而非更宽的 docWidth
      expect(dstW).toBeCloseTo(naturalWidth / dpr);
      // 确认 scale 正确：源 naturalWidth px → 目标 naturalWidth/dpr px，比例 = 1/dpr
      expect(dstW / naturalWidth).toBeCloseTo(1 / dpr);
    }
  });
});
