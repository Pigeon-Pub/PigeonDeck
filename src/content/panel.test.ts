// @vitest-environment jsdom
/* ============================================================
   panel.test.ts — PanelManager 单元测试
   N4：内容高度变化不重定位面板（animatePanelHeight 不调 positionPanel）
   N5：单击已开面板目标元素 toggle 关闭；点击不同目标切换；dblclick 不 toggle
   ============================================================ */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PanelManager } from './panel';
import { Controller } from './controller';
import { AnnotationStore } from '../state/annotations';
import { History } from '../state/history';
import { DEFAULT_SETTINGS } from '../state/settings';
import type { Overlay } from './overlay';
import type { Toast } from './toast';
import { deletionRuntime } from './deletion-runtime';

// ---- 最小 Overlay / Toast mock（只需实例方法，不需真实布局） ----
function makeOverlay(): Overlay {
  return {
    setSuppressedMark: vi.fn(),
    getTargetRect: vi.fn(() => null),
    getPinRect: vi.fn(() => null),
  } as unknown as Overlay;
}

function makeToast(): Toast {
  return { show: vi.fn() } as unknown as Toast;
}

// ---- 测试上下文 ----
interface Ctx {
  manager: PanelManager;
  panelLayer: HTMLElement;
  store: AnnotationStore;
  toast: Toast;
  /** 页面元素 A（无 id 重复问题） */
  target: HTMLElement;
  /** 页面元素 B（用于"点不同目标"测试） */
  otherTarget: HTMLElement;
}

function makeFakeRect(x: number): DOMRect {
  return {
    x, y: 50, left: x, top: 50, right: x + 100, bottom: 100, width: 100, height: 50,
    toJSON: () => ({}),
  } as DOMRect;
}

function setupCtx(): Ctx {
  // Shadow DOM（模拟扩展挂载）
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'open' });
  const panelLayer = document.createElement('div');
  const overlayLayer = document.createElement('div');
  const feedbackLayer = document.createElement('div');
  shadow.appendChild(panelLayer);
  shadow.appendChild(overlayLayer);
  shadow.appendChild(feedbackLayer);
  document.body.appendChild(host);

  // 页面目标元素（非 Shadow DOM 内）
  const target = document.createElement('div');
  target.id = 'pd-test-target';
  const rect0 = makeFakeRect(100);
  target.getBoundingClientRect = () => rect0;
  target.getClientRects = () =>
    ({ length: 1, item: () => rect0, [0]: rect0 }) as unknown as DOMRectList;
  document.body.appendChild(target);

  const otherTarget = document.createElement('div');
  otherTarget.id = 'pd-other-target';
  const rect1 = makeFakeRect(300);
  otherTarget.getBoundingClientRect = () => rect1;
  otherTarget.getClientRects = () =>
    ({ length: 1, item: () => rect1, [0]: rect1 }) as unknown as DOMRectList;
  document.body.appendChild(otherTarget);

  const controller = new Controller();
  controller.expand(); // expanded + annotate → this.active = true

  const store = new AnnotationStore();
  const toast = makeToast();
  const manager = new PanelManager(
    controller,
    store,
    makeOverlay(),
    panelLayer,
    { ...DEFAULT_SETTINGS },
    new History(),
    toast,
    overlayLayer,
    feedbackLayer,
  );

  return { manager, panelLayer, store, toast, target, otherTarget };
}

/** 派发能被 window capture 捕获的鼠标事件（composed=true 穿越 shadow boundary） */
function fire(el: HTMLElement, type: 'mousedown' | 'click'): void {
  el.dispatchEvent(
    new MouseEvent(type, { bubbles: true, cancelable: true, composed: true }),
  );
}

// ---- 全局 jsdom 补丁 ----
beforeEach(() => {
  deletionRuntime.reset();
  // SelectionBox 用到 ResizeObserver
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
  // animateHeight / scheduleReposition 用到 rAF
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    queueMicrotask(() => cb(0));
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  document.body.innerHTML = '';
});

describe('Delete in annotate mode', () => {
  it('deletes the selected element while the note only has automatic focus', () => {
    const { manager, panelLayer, target } = setupCtx();
    manager.openPanel(target, null);
    const textarea = panelLayer.querySelector<HTMLTextAreaElement>('[data-testid="pd-panel-note"]')!;
    expect((textarea.getRootNode() as ShadowRoot).activeElement).toBe(textarea);

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );

    expect(target.isConnected).toBe(true);
    expect(target.style.opacity).toBe('0');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).toBeNull();
    manager.destroy();
  });

  it('keeps the selected element after the user starts editing the note', () => {
    const { manager, panelLayer, target } = setupCtx();
    manager.openPanel(target, null);
    const textarea = panelLayer.querySelector<HTMLTextAreaElement>('[data-testid="pd-panel-note"]')!;
    textarea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, composed: true }));

    textarea.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
        cancelable: true,
        composed: true,
      }),
    );

    expect(target.isConnected).toBe(true);
    manager.destroy();
  });
});

describe('saving after media replacement', () => {
  it('uses the replacement record created after the panel opened', () => {
    const { manager, panelLayer, store, toast, target } = setupCtx();
    manager.openPanel(target, null);
    store.add({
      selector: '#pd-test-target',
      elementType: 'image',
      summary: 'image',
      note: '',
      changes: [{
        prop: 'replaceMedia',
        cssProp: 'src',
        oldValue: 'old.png',
        newValue: 'new.png',
      }],
      viewportPos: { x: 100, y: 50, w: 100, h: 50 },
    });

    panelLayer.querySelector<HTMLButtonElement>('[data-testid="pd-panel-save"]')!.click();

    expect(toast.show).not.toHaveBeenCalled();
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).toBeNull();
    expect(store.getAll()[0].changes).toHaveLength(1);
    manager.destroy();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

// ============================================================
// N4：内容高度变化不重定位面板
// ============================================================

describe('N4 — 展开/收起高级样式不重定位面板', () => {
  it('展开高级样式后 positionPanel 不被 animatePanelHeight 调用', () => {
    const { manager, panelLayer, target } = setupCtx();

    manager.openPanel(target, null);
    const panel = panelLayer.querySelector<HTMLElement>('[data-testid="pd-panel"]')!;
    expect(panel).not.toBeNull();

    // 记录初始位置
    const left0 = panel.style.left;
    const top0 = panel.style.top;

    // 监视私有 positionPanel（jsdom offsetHeight=0 → animateHeight 同步走 after 路径，
    // 旧代码会立刻调 positionPanel，新代码不会）
    const spy = vi.spyOn(
      manager as unknown as { positionPanel(): void },
      'positionPanel',
    );
    spy.mockClear();

    const advToggle = panel.querySelector<HTMLElement>('[data-testid="pd-adv-toggle"]')!;
    expect(advToggle).not.toBeNull();
    advToggle.click(); // 触发 animatePanelHeight

    expect(spy).not.toHaveBeenCalled();       // N4 核心：不被重定位
    expect(panel.style.left).toBe(left0);     // 位置不变
    expect(panel.style.top).toBe(top0);

    manager.destroy();
  });

  it('收起高级样式后 positionPanel 也不被调用', () => {
    const { manager, panelLayer, target } = setupCtx();
    manager.openPanel(target, null);
    const panel = panelLayer.querySelector<HTMLElement>('[data-testid="pd-panel"]')!;

    // 先展开
    panel.querySelector<HTMLElement>('[data-testid="pd-adv-toggle"]')!.click();

    const left0 = panel.style.left;
    const top0 = panel.style.top;

    const spy = vi.spyOn(
      manager as unknown as { positionPanel(): void },
      'positionPanel',
    );
    spy.mockClear();

    // 再收起（展开后 data-testid 相同，仍指向新 toggle）
    panel.querySelector<HTMLElement>('[data-testid="pd-adv-toggle"]')!.click();

    expect(spy).not.toHaveBeenCalled();
    expect(panel.style.left).toBe(left0);
    expect(panel.style.top).toBe(top0);

    manager.destroy();
  });
});

// ============================================================
// N5：单击同目标 toggle 关闭面板
// ============================================================

describe('N5 — 单击同目标元素 toggle 关闭', () => {
  it('面板打开后第二次单击同目标保持关闭（toggle off）', () => {
    const { manager, panelLayer, target } = setupCtx();

    // 首次：直接调用 openPanel 模拟第一次单击已完成、面板已打开
    manager.openPanel(target, null);
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).not.toBeNull();

    // 第二次单击：mousedown 关闭面板、记录 target 为 closedTarget
    fire(target, 'mousedown');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).toBeNull();

    // click → openFromHit → target === closedTarget → toggle，保持关闭
    fire(target, 'click');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).toBeNull();

    manager.destroy();
  });

  it('单击不同目标：关闭旧面板后打开新目标面板', () => {
    const { manager, panelLayer, target, otherTarget } = setupCtx();

    manager.openPanel(target, null);
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).not.toBeNull();

    // mousedown on otherTarget → 关闭 target 面板，_mousedownClosedTarget = target
    fire(otherTarget, 'mousedown');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).toBeNull();

    // click on otherTarget → otherTarget !== target → 打开 otherTarget 面板
    fire(otherTarget, 'click');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).not.toBeNull();

    manager.destroy();
  });

  it('cancelPendingOpen 清空 toggle 状态，后续 click 正常打开面板', () => {
    const { manager, panelLayer, target } = setupCtx();

    manager.openPanel(target, null);
    // mousedown 关闭并记录 _mousedownClosedTarget = target
    fire(target, 'mousedown');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).toBeNull();

    // 模拟 dblclick 取消（DirectEditManager 调用 cancelPendingOpen）
    manager.cancelPendingOpen();

    // click：_mousedownClosedTarget 已清空 → 正常打开
    fire(target, 'click');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).not.toBeNull();

    manager.destroy();
  });

  it('面板未打开时单击目标正常打开（无 toggle 误触）', () => {
    const { manager, panelLayer, target } = setupCtx();

    // 无面板：mousedown → _mousedownClosedTarget = null（面板未关闭）
    fire(target, 'mousedown');
    // click → openFromHit → closedTarget = null → 正常打开
    fire(target, 'click');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).not.toBeNull();

    manager.destroy();
  });

  it('dblclick 场景：pendingOpenTimer 被取消后同目标 click 仍可打开（不被 toggle 误抑制）', () => {
    vi.useFakeTimers();
    const { manager, panelLayer, target } = setupCtx();

    // 面板未打开状态下触发 DELAYED_TYPE 模拟（直接操纵 _mousedownClosedTarget 模拟 dblclick 后的状态）
    // 方案：先通过 mousedown 记录 closedTarget，再 cancelPendingOpen 清空，验证后续 click 可打开
    manager.openPanel(target, null);
    fire(target, 'mousedown'); // _mousedownClosedTarget = target
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).toBeNull();

    // dblclick → cancelPendingOpen
    manager.cancelPendingOpen();

    // 250ms 后 click：因为 _mousedownClosedTarget 已清空，应正常打开
    vi.advanceTimersByTime(300);
    fire(target, 'click');
    expect(panelLayer.querySelector('[data-testid="pd-panel"]')).not.toBeNull();

    manager.destroy();
  });
});
