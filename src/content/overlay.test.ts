// @vitest-environment jsdom
/* ============================================================
   overlay.test.ts — 持久标注框抑制（R5）
   单击已标注元素重新选中时，PanelManager 调 setSuppressedMark(id) 隐藏该标注
   自己的持久标注框 + 位号，避免与八句柄选中框重叠成双框；setSuppressedMark(null)
   恢复。此处直接驱动 Overlay，验证抑制/恢复只影响被抑制那一条。
   ============================================================ */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Overlay } from './overlay';
import { Controller } from './controller';
import { AnnotationStore } from '../state/annotations';
import { DEFAULT_SETTINGS } from '../state/settings';

// jsdom 无 ResizeObserver：Overlay.observeTarget 需要它，提供最小 stub。
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

// rAF 微任务化：scheduleRefresh 的回调延到微任务执行，flush() 后可同步断言。
function stubRuntime(): void {
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    queueMicrotask(() => cb(0));
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function markVisible(layer: HTMLElement, testid: string): boolean {
  const el = layer.querySelector<HTMLElement>(`[data-testid="${testid}"]`);
  return !!el && el.style.display !== 'none';
}

function setup(): { overlay: Overlay; layer: HTMLElement; annId: string } {
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const layer = document.createElement('div');
  shadow.appendChild(layer);
  document.body.appendChild(host);

  // 目标元素：给非零矩形，使 refresh 会绘制其标注框（jsdom 默认全 0）。
  const target = document.createElement('div');
  target.id = 'tgt';
  document.body.appendChild(target);
  const rect = {
    x: 10, y: 20, left: 10, top: 20, right: 110, bottom: 70, width: 100, height: 50,
    toJSON() {},
  } as DOMRect;
  target.getBoundingClientRect = () => rect;
  target.getClientRects = () => [rect] as unknown as DOMRectList;

  const store = new AnnotationStore();
  const ann = store.add({
    selector: '#tgt',
    elementType: 'container',
    summary: 'div',
    note: '已有标注',
    changes: [],
    viewportPos: { x: 10, y: 20, w: 100, h: 50 },
  });

  const overlay = new Overlay(new Controller(), store, layer, { ...DEFAULT_SETTINGS });
  return { overlay, layer, annId: ann.id };
}

describe('Overlay.setSuppressedMark — 抑制持久标注框（R5）', () => {
  let overlay: Overlay | null = null;

  beforeEach(() => {
    stubRuntime();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
    vi.unstubAllGlobals();
  });

  it('默认绘制持久标注框 + 位号', async () => {
    const s = setup();
    overlay = s.overlay;
    await flush();
    expect(markVisible(s.layer, 'pd-markbox')).toBe(true);
    expect(markVisible(s.layer, 'pd-pin')).toBe(true);
  });

  it('setSuppressedMark(id) 隐藏该标注自己的框 + 位号', async () => {
    const s = setup();
    overlay = s.overlay;
    await flush();
    s.overlay.setSuppressedMark(s.annId);
    await flush();
    expect(markVisible(s.layer, 'pd-markbox')).toBe(false);
    expect(markVisible(s.layer, 'pd-pin')).toBe(false);
  });

  it('setSuppressedMark(null) 恢复框 + 位号', async () => {
    const s = setup();
    overlay = s.overlay;
    await flush();
    s.overlay.setSuppressedMark(s.annId);
    await flush();
    s.overlay.setSuppressedMark(null);
    await flush();
    expect(markVisible(s.layer, 'pd-markbox')).toBe(true);
    expect(markVisible(s.layer, 'pd-pin')).toBe(true);
  });

  it('已删除目标断连后按文档坐标显示占位框，并跟随窗口滚动', async () => {
    vi.stubGlobal('scrollX', 10);
    vi.stubGlobal('scrollY', 20);
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const layer = document.createElement('div');
    shadow.appendChild(layer);
    document.body.appendChild(host);
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
        docRect: { x: 110, y: 220, w: 80, h: 30 },
      },
    });

    overlay = new Overlay(new Controller(), store, layer, { ...DEFAULT_SETTINGS });
    await flush();

    const rect = overlay.getTargetRect(ann.id);
    expect(rect).not.toBeNull();
    expect({ x: rect?.x, y: rect?.y, w: rect?.width, h: rect?.height }).toEqual({
      x: 100,
      y: 200,
      w: 80,
      h: 30,
    });
    expect(overlay.getUnresolvedCount()).toBe(0);
    expect(markVisible(layer, 'pd-markbox')).toBe(true);
    expect(markVisible(layer, 'pd-pin')).toBe(true);
  });
});
