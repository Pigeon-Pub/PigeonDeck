/* ============================================================
   selection-box.ts — 交互式选中框（八向句柄缩放）
   批注模式（PanelManager）与移动模式（MoveManager）共用的选中框组件：
   - 渲染选中框 `.pd-selbox` + 8 个句柄 `.h`（data-testid pd-selbox / pd-handle-*）
   - 句柄拖拽改尺寸 → StyleChange → 撤销历史（并入该元素的标注，无则新建）
   - 订阅 scroll / resize / history → 选中框跟随元素矩形（移动/撤销/重做后归位）
   自身不感知模式：拥有者调用 select()/clear()；缩放提交后回调 onAfterResize。
   （原逻辑从 move.ts 抽出，逐值保持一致以不回归移动模式行为。）
   ============================================================ */

import { Annotation, AnnotationStore, StyleChange, mergeChanges } from '../state/annotations';
import { History } from '../state/history';
import { Settings } from '../state/settings';
import { buildSelector } from '../shared/dom-utils';
import { applyChangesTo } from './change-apply';
import { deletionRuntime } from './deletion-runtime';
import { matchCombo } from './shortcuts';

/** 八向句柄方位 */
type HandleDir = 'tl' | 'tr' | 'bl' | 'br' | 'tm' | 'bm' | 'ml' | 'mr';

/** 哪些维度受该方位影响 */
const HANDLE_DIMS: Record<HandleDir, { w: boolean; h: boolean; wNeg: boolean; hNeg: boolean }> = {
  tl: { w: true,  h: true,  wNeg: true,  hNeg: true  },
  tr: { w: true,  h: true,  wNeg: false, hNeg: true  },
  bl: { w: true,  h: true,  wNeg: true,  hNeg: false },
  br: { w: true,  h: true,  wNeg: false, hNeg: false },
  tm: { w: false, h: true,  wNeg: false, hNeg: true  },
  bm: { w: false, h: true,  wNeg: false, hNeg: false },
  ml: { w: true,  h: false, wNeg: true,  hNeg: false },
  mr: { w: true,  h: false, wNeg: false, hNeg: false },
};

/** 按 selector 查找目标元素（仅唯一命中才返回） */
function resolveTarget(selector: string): HTMLElement | null {
  try {
    const matches = document.querySelectorAll(selector);
    if (matches.length === 1 && matches[0] instanceof HTMLElement) return matches[0];
    return null;
  } catch {
    return null;
  }
}

export interface SelectionBoxOptions {
  store: AnnotationStore;
  history: History;
  overlayLayer: HTMLElement;
  /** 设置（读 shortcuts.delete 绑定；共享引用，改绑即时生效）。 */
  settings: Settings;
  /** Allow an owner to distinguish programmatic focus from active editing. */
  allowDeleteFromEditable?: (node: Element) => boolean;
  /** Let the owner close UI tied to the element before it is detached. */
  onBeforeDelete?: () => void;
  /** 句柄缩放提交后回调（拥有者可据此同步自身状态，如面板刷新已有标注引用） */
  onAfterResize?: (el: HTMLElement) => void;
}

export class SelectionBox {
  private store: AnnotationStore;
  private history: History;
  private overlayLayer: HTMLElement;
  private settings: Settings;
  private allowDeleteFromEditable?: (node: Element) => boolean;
  private onBeforeDelete?: () => void;
  private onAfterResize?: (el: HTMLElement) => void;

  // 当前选中
  private selectedEl: HTMLElement | null = null;
  private selboxEl: HTMLElement | null = null;

  // 句柄缩放拖拽状态
  private dragging = false;
  private dragDir: HandleDir | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private origW = 0;
  private origH = 0;

  // 跟随刷新
  private rafId: number | null = null;
  private unsubscribeHistory: () => void;

  constructor(opts: SelectionBoxOptions) {
    this.store = opts.store;
    this.history = opts.history;
    this.overlayLayer = opts.overlayLayer;
    this.settings = opts.settings;
    this.allowDeleteFromEditable = opts.allowDeleteFromEditable;
    this.onBeforeDelete = opts.onBeforeDelete;
    this.onAfterResize = opts.onAfterResize;

    // 撤销/重做改动 el.style.transform 或重父后，选中框必须跟随（move.ts Bug1/显示15）。
    this.unsubscribeHistory = opts.history.subscribe(() => this.scheduleReposition());
    window.addEventListener('scroll', this.scheduleReposition, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleReposition);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  destroy(): void {
    this.unsubscribeHistory();
    window.removeEventListener('scroll', this.scheduleReposition, true);
    window.removeEventListener('resize', this.scheduleReposition);
    window.removeEventListener('keydown', this.onKeyDown, true);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.clear();
  }

  /** 当前选中元素（拥有者读取，如移动模式判定本体拖拽） */
  getSelected(): HTMLElement | null {
    return this.selectedEl;
  }

  /** 是否正在句柄缩放拖拽（拥有者据此屏蔽其它交互，如 hover 高亮） */
  isResizing(): boolean {
    return this.dragging;
  }

  /** 选中元素并渲染选中框（替换旧选中） */
  select(el: HTMLElement): void {
    this.clear();
    this.selectedEl = el;
    this.render();
  }

  /** 清除选中框（含进行中的缩放拖拽） */
  clear(): void {
    if (this.dragging) this.endDrag();
    this.selboxEl?.remove();
    this.selboxEl = null;
    this.selectedEl = null;
  }

  private render(): void {
    if (!this.selectedEl) return;
    const rect = this.selectedEl.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    const box = document.createElement('div');
    box.className = 'pd-selbox';
    box.setAttribute('data-testid', 'pd-selbox');

    // 定位：overlay 层是 fixed inset:0，直接用 viewport 坐标
    box.style.left = `${rect.left}px`;
    box.style.top = `${rect.top}px`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;

    // 八向句柄
    const dirs: HandleDir[] = ['tl', 'tr', 'bl', 'br', 'tm', 'bm', 'ml', 'mr'];
    for (const dir of dirs) {
      const h = document.createElement('span');
      h.className = `h ${dir}`;
      h.setAttribute('data-testid', `pd-handle-${dir}`);
      h.addEventListener('mousedown', (e) => this.onHandleMouseDown(e, dir), true);
      box.appendChild(h);
    }

    this.overlayLayer.appendChild(box);
    this.selboxEl = box;
  }

  /** 按选中元素当前矩形重定位选中框；元素断连则清除 */
  reposition(): void {
    if (!this.selboxEl || !this.selectedEl) return;
    if (!this.selectedEl.isConnected) {
      this.clear();
      return;
    }
    const rect = this.selectedEl.getBoundingClientRect();
    this.selboxEl.style.left = `${rect.left}px`;
    this.selboxEl.style.top = `${rect.top}px`;
    this.selboxEl.style.width = `${rect.width}px`;
    this.selboxEl.style.height = `${rect.height}px`;
  }

  private scheduleReposition = (): void => {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.reposition();
    });
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (ev.defaultPrevented || !matchCombo(ev, this.settings.shortcuts.delete) || !this.selectedEl?.isConnected) return;
    if (ev.composedPath().some((node) => this.isEditable(node))) return;

    const el = this.selectedEl;
    if (!el.parentNode) return;
    const selector = buildSelector(el);
    const annotation = this.store.getBySelector(selector);
    const rect = el.getBoundingClientRect();
    const deletion = {
      layout: this.settings.deletionLayout,
      docRect: {
        x: Math.round(rect.x + window.scrollX),
        y: Math.round(rect.y + window.scrollY),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      },
    };
    let deletedRecord: Annotation | undefined = annotation
      ? { ...annotation, deleted: true, deletion }
      : undefined;

    const remove = (): void => {
      if (deletedRecord) {
        if (annotation) this.store.remove(annotation.id);
        this.store.restore(deletedRecord);
      } else {
        deletedRecord = this.store.add({
          selector,
          elementType: 'container',
          summary: el.tagName.toLowerCase(),
          note: '',
          changes: [],
          viewportPos: {
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            w: Math.round(rect.width),
            h: Math.round(rect.height),
          },
          deleted: true,
          deletion,
        });
      }
      deletionRuntime.capture(deletedRecord.id, el);
      deletionRuntime.apply(deletedRecord.id, deletedRecord.deletion!.layout);
    };
    const restore = (): void => {
      if (!deletedRecord) return;
      deletionRuntime.restore(deletedRecord.id);
      this.store.remove(deletedRecord.id);
      if (annotation) this.store.restore(annotation);
    };

    ev.preventDefault();
    ev.stopPropagation();
    this.clear();
    this.onBeforeDelete?.();
    remove();
    this.history.push({ label: 'delete:element', apply: remove, revert: restore });
  };

  private isEditable(node: EventTarget): boolean {
    return (
      node instanceof Element &&
      node.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])') &&
      !this.allowDeleteFromEditable?.(node)
    );
  }

  // ---- 句柄缩放拖拽 ----

  private onHandleMouseDown = (ev: MouseEvent, dir: HandleDir): void => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!this.selectedEl) return;

    this.dragging = true;
    this.dragDir = dir;
    this.dragStartX = ev.clientX;
    this.dragStartY = ev.clientY;

    const cs = window.getComputedStyle(this.selectedEl);
    this.origW = parseFloat(cs.width) || 0;
    this.origH = parseFloat(cs.height) || 0;

    window.addEventListener('mousemove', this.onDragMove, { capture: true });
    window.addEventListener('mouseup', this.onDragUp, { capture: true });
  };

  private onDragMove = (ev: MouseEvent): void => {
    if (!this.dragging || !this.selectedEl || !this.dragDir) return;
    ev.preventDefault();
    ev.stopPropagation();

    const dx = ev.clientX - this.dragStartX;
    const dy = ev.clientY - this.dragStartY;

    const dims = HANDLE_DIMS[this.dragDir];

    if (dims.w) {
      const newW = Math.max(0, this.origW + (dims.wNeg ? -dx : dx));
      this.selectedEl.style.width = `${newW}px`;
    }
    if (dims.h) {
      const newH = Math.max(0, this.origH + (dims.hNeg ? -dy : dy));
      this.selectedEl.style.height = `${newH}px`;
    }

    // 同步更新 selbox 位置/尺寸
    this.reposition();
  };

  private onDragUp = (ev: MouseEvent): void => {
    if (!this.dragging || !this.selectedEl || !this.dragDir) return;
    ev.preventDefault();
    ev.stopPropagation();

    const el = this.selectedEl;
    const dir = this.dragDir;
    const dims = HANDLE_DIMS[dir];

    const cs = window.getComputedStyle(el);
    const newW = parseFloat(cs.width) || 0;
    const newH = parseFloat(cs.height) || 0;

    // 构建 StyleChange（有变化才记录）
    const changes: StyleChange[] = [];
    if (dims.w && Math.abs(newW - this.origW) > 0.5) {
      changes.push({
        prop: 'width',
        cssProp: 'width',
        oldValue: `${this.origW}px`,
        newValue: `${newW}px`,
      });
    }
    if (dims.h && Math.abs(newH - this.origH) > 0.5) {
      changes.push({
        prop: 'height',
        cssProp: 'height',
        oldValue: `${this.origH}px`,
        newValue: `${newH}px`,
      });
    }

    if (changes.length > 0) {
      this.commitChanges(el, changes);
      this.onAfterResize?.(el);
    }

    this.endDrag();
  };

  private endDrag(): void {
    this.dragging = false;
    this.dragDir = null;
    window.removeEventListener('mousemove', this.onDragMove, true);
    window.removeEventListener('mouseup', this.onDragUp, true);
  }

  /** 将 StyleChange 并入标注 store + 推入撤销历史（句柄缩放用） */
  private commitChanges(el: HTMLElement, changes: StyleChange[]): void {
    const selector = buildSelector(el);
    const existing = this.store.getBySelector(selector);

    if (existing) {
      const before = existing;
      const merged = mergeChanges(before.changes, changes);
      const after = this.store.update(before.id, { changes: merged });
      if (after) {
        const afterSnap = after;
        this.history.push({
          label: 'move:resize',
          apply: () => {
            applyChangesTo(this.resolveEl(afterSnap.selector), changes, 'new');
            this.store.update(afterSnap.id, { changes: afterSnap.changes });
          },
          revert: () => {
            applyChangesTo(this.resolveEl(afterSnap.selector), changes, 'old');
            this.store.update(before.id, { changes: before.changes });
          },
        });
      }
    } else {
      const rect = el.getBoundingClientRect();
      const added = this.store.add({
        selector,
        elementType: 'container',
        summary: el.tagName.toLowerCase(),
        note: '',
        changes,
        viewportPos: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      });
      const addedSnap = added;
      this.history.push({
        label: 'move:resize',
        apply: () => {
          applyChangesTo(this.resolveEl(addedSnap.selector), changes, 'new');
          this.store.restore(addedSnap);
        },
        revert: () => {
          applyChangesTo(this.resolveEl(addedSnap.selector), changes, 'old');
          this.store.remove(addedSnap.id);
        },
      });
    }
  }

  private resolveEl(selector: string): HTMLElement | null {
    return resolveTarget(selector);
  }
}
