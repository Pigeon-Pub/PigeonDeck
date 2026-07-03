/* ============================================================
   region-select.ts — 长按框选区域批注
   蓝图 §4.2（长按检测）+ §5.2（区域框选）
   长按 ≥300ms → 拖拽实时金框 → 松手弹区域批注面板 → 保存入 Store
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, RegionData } from '../state/annotations';
import { History } from '../state/history';
import { Settings } from '../state/settings';
import { PanelManager } from './panel';
import { buildSelector, isVisible, findScrollableAncestor } from '../shared/dom-utils';
import { t } from './i18n';

/** 长按阈值默认值（ms）；实际用 settings.longPressMs（阶段 11 接入） */
const LONG_PRESS_MS = 300;
/** 最小区域尺寸（px）：宽或高小于此值视为误触 */
const MIN_REGION = 6;
/** Scope 选择器上限：短而有用（逻辑8：避免过长文本） */
const MAX_SCOPE = 10;
/** 收集元素时的最小「主要落在区域内」占比（排除只横跨区域的大祖先） */
const SCOPE_OVERLAP_MIN = 0.5;

/** 区域批注面板的 SVG 图标（与 panel.ts ICONS.trash 相同） */
const ICON_TRASH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`;

export interface RegionSelectOptions {
  controller: Controller;
  store: AnnotationStore;
  history: History;
  overlayLayer: HTMLElement;
  panelLayer: HTMLElement;
  panel: PanelManager;
  settings: Settings;
  /** 内联富文本编辑中返回 true → 编辑期间不启动区域框选 */
  isInlineEditing?: () => boolean;
}

export class RegionSelectManager {
  private controller: Controller;
  private store: AnnotationStore;
  private history: History;
  private overlayLayer: HTMLElement;
  private panelLayer: HTMLElement;
  private panel: PanelManager;
  private settings: Settings;
  private shadowHost: Element;
  private isInlineEditing: () => boolean;

  // 长按状态
  private pressTimer: ReturnType<typeof setTimeout> | null = null;

  // 框选状态
  private selecting = false;
  private liveBox: HTMLElement | null = null;

  // 区域面板
  private regionPanelEl: HTMLElement | null = null;

  private unsubscribeController: () => void;
  private active = false;

  constructor(opts: RegionSelectOptions) {
    this.controller = opts.controller;
    this.store = opts.store;
    this.history = opts.history;
    this.overlayLayer = opts.overlayLayer;
    this.panelLayer = opts.panelLayer;
    this.panel = opts.panel;
    this.settings = opts.settings;
    this.isInlineEditing = opts.isInlineEditing ?? (() => false);
    this.shadowHost = (opts.overlayLayer.getRootNode() as ShadowRoot).host;

    this.unsubscribeController = this.controller.subscribe(() => this.syncActive());
    this.syncActive();

    window.addEventListener('mousedown', this.onMouseDown, true);
  }

  destroy(): void {
    this.unsubscribeController();
    window.removeEventListener('mousedown', this.onMouseDown, true);
    this.cancelPress();
    this.endSelecting();
    this.closeRegionPanel();
  }

  // ---- 模式联动 ----

  private syncActive(): void {
    const { expanded, mode } = this.controller.getState();
    const next = expanded && mode === 'annotate';
    if (!next && this.active) {
      this.cancelPress();
      this.endSelecting();
      this.closeRegionPanel();
    }
    this.active = next;
  }

  // ---- 自身 UI 判定 ----

  private isOwnUi(ev: Event): boolean {
    return ev.composedPath().includes(this.shadowHost);
  }

  // ---- 长按检测 ----

  private onMouseDown = (ev: MouseEvent): void => {
    if (!this.active || this.isOwnUi(ev)) return;
    // 内联富文本编辑中：长按拖拽属于选字，不启动区域框选
    if (this.isInlineEditing()) return;

    const target = ev.target;
    if (
      !(target instanceof Element) ||
      target === document.documentElement ||
      target === document.body
    ) return;

    const startX = ev.clientX;
    const startY = ev.clientY;

    // 长按定时器：到时仍按下则进入框选（时长读实时 settings，回退默认）
    const longPress = this.settings.longPressMs > 0 ? this.settings.longPressMs : LONG_PRESS_MS;
    this.pressTimer = setTimeout(() => {
      this.pressTimer = null;
      this.startSelecting(startX, startY);
    }, longPress);

    // mouseup 在 300ms 内：取消（是单击，交给 PanelManager）
    const onUp = (): void => {
      window.removeEventListener('mouseup', onUp, true);
      this.cancelPress();
    };
    window.addEventListener('mouseup', onUp, true);
  };

  private cancelPress(): void {
    if (this.pressTimer !== null) {
      clearTimeout(this.pressTimer);
      this.pressTimer = null;
    }
  }

  // ---- 框选阶段 ----

  private startSelecting(startX: number, startY: number): void {
    if (this.selecting || this.isInlineEditing()) return;
    this.selecting = true;

    // 通知 PanelManager 取消待定的单击延迟
    this.panel.cancelPendingOpen();

    // 在 overlay 层建实时金框
    const box = document.createElement('div');
    box.className = 'pd-region';
    box.setAttribute('data-testid', 'pd-region-live');
    Object.assign(box.style, {
      display: 'block',
      left: `${startX}px`,
      top: `${startY}px`,
      width: '0px',
      height: '0px',
      // 实时金框半透明，区别于持久区域框
      opacity: '0.85',
      pointerEvents: 'none',
    });
    this.overlayLayer.appendChild(box);
    this.liveBox = box;

    const onMove = (ev: MouseEvent): void => {
      ev.preventDefault();
      const x = Math.min(startX, ev.clientX);
      const y = Math.min(startY, ev.clientY);
      const w = Math.abs(ev.clientX - startX);
      const h = Math.abs(ev.clientY - startY);
      Object.assign(box.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${w}px`,
        height: `${h}px`,
      });
    };

    const onUp = (ev: MouseEvent): void => {
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('mouseup', onUp, true);
      this.finishSelecting(startX, startY, ev.clientX, ev.clientY);
    };

    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('mouseup', onUp, true);
  }

  private endSelecting(): void {
    this.selecting = false;
    if (this.liveBox) {
      this.liveBox.remove();
      this.liveBox = null;
    }
  }

  private finishSelecting(x0: number, y0: number, x1: number, y1: number): void {
    const vpX = Math.min(x0, x1);
    const vpY = Math.min(y0, y1);
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);

    this.endSelecting();

    if (w < MIN_REGION || h < MIN_REGION) {
      // 太小视为误触，不建区域
      return;
    }

    // 文档坐标
    const docRect = {
      x: vpX + window.scrollX,
      y: vpY + window.scrollY,
      w,
      h,
    };

    // 收集框内可见元素
    const vpRect = { x: vpX, y: vpY, w, h };
    const elements = this.collectElements(vpRect);

    // 嵌套滚动容器跟随：查区域中心元素的最近可滚动祖先，记录选择器 + 创建时滚动量。
    // 无可滚动祖先则不写这三字段，区域仅随 window 滚动（旧行为）。
    const region: RegionData = { docRect, elements };
    const centerEl = this.centerPageElement(vpX + w / 2, vpY + h / 2, elements);
    const scroller = centerEl ? findScrollableAncestor(centerEl) : null;
    if (scroller) {
      region.scrollSelector = buildSelector(scroller);
      region.scrollLeft = scroller.scrollLeft;
      region.scrollTop = scroller.scrollTop;
    }

    const viewportPos = { x: Math.round(vpX), y: Math.round(vpY), w: Math.round(w), h: Math.round(h) };

    // 抑制松手后触发的 click
    this.panel.suppressNextClick();

    // 打开区域批注面板
    this.openRegionPanel(viewportPos, region);
  }

  /**
   * 区域中心的页面元素（用于查最近可滚动祖先）。
   * elementFromPoint 命中自身 Shadow 宿主或空时，回退到首个收集到的元素。
   */
  private centerPageElement(cx: number, cy: number, elements: string[]): Element | null {
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== this.shadowHost) return hit;
    for (const sel of elements) {
      try {
        const el = document.querySelector(sel);
        if (el) return el;
      } catch {
        // 非法选择器：跳过
      }
    }
    return null;
  }

  /**
   * 收集区域内可见元素的选择器（逻辑8：短而有用）。
   * ① 相交且「主要落在区域内」（交集 ≥ 元素自身面积的 SCOPE_OVERLAP_MIN）——
   *    排除只是横跨区域的大祖先（如 main/section）。
   * ② 去除被其它保留元素包含的后代（保留外层/容器，丢冗余后代）。
   * ③ 上限 MAX_SCOPE；全部落空时回退最小面积的相交元素，保证非空。
   * 迭代按文档顺序，结果确定。
   */
  private collectElements(vpRect: { x: number; y: number; w: number; h: number }): string[] {
    const rx0 = vpRect.x;
    const ry0 = vpRect.y;
    const rx1 = vpRect.x + vpRect.w;
    const ry1 = vpRect.y + vpRect.h;

    const intersecting: Element[] = [];
    const primary: Element[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      const ix = Math.min(rx1, r.right) - Math.max(rx0, r.left);
      const iy = Math.min(ry1, r.bottom) - Math.max(ry0, r.top);
      if (ix <= 0 || iy <= 0) continue;
      intersecting.push(el);
      const area = r.width * r.height;
      if (area <= 0 || (ix * iy) / area >= SCOPE_OVERLAP_MIN) primary.push(el);
    }

    // 保留外层：丢掉被其它保留元素包含的后代
    let outer = primary.filter((el) => !primary.some((o) => o !== el && o.contains(el)));

    // 全部落空（区域比所有相交元素都小）：回退最小面积的相交元素，保证 Scope 非空
    if (outer.length === 0 && intersecting.length > 0) {
      const smallest = intersecting.reduce((a, b) => {
        const ra = a.getBoundingClientRect();
        const rb = b.getBoundingClientRect();
        return ra.width * ra.height <= rb.width * rb.height ? a : b;
      });
      outer = [smallest];
    }

    const selectors: string[] = [];
    const seen = new Set<string>();
    for (const el of outer) {
      if (selectors.length >= MAX_SCOPE) break;
      const sel = buildSelector(el);
      if (!seen.has(sel)) {
        seen.add(sel);
        selectors.push(sel);
      }
    }
    return selectors;
  }

  // ---- 区域批注面板 ----

  private openRegionPanel(
    viewportPos: { x: number; y: number; w: number; h: number },
    region: RegionData
  ): void {
    this.closeRegionPanel();

    const panel = document.createElement('div');
    panel.className = 'pd-surface rpanel';
    panel.setAttribute('data-testid', 'pd-region-panel');
    panel.style.position = 'absolute';

    const textarea = document.createElement('textarea');
    textarea.className = 'rin';
    textarea.setAttribute('data-testid', 'pd-region-note');
    textarea.placeholder = t('region_note_placeholder');
    textarea.rows = 1;
    panel.appendChild(textarea);

    const row = document.createElement('div');
    row.className = 'rrow';

    const btnDelete = document.createElement('button');
    btnDelete.className = 'pd-iconbtn danger';
    btnDelete.setAttribute('aria-label', t('menu_delete_annotation'));
    btnDelete.title = t('menu_delete_annotation');
    btnDelete.innerHTML = ICON_TRASH;
    btnDelete.addEventListener('click', () => this.closeRegionPanel());
    row.appendChild(btnDelete);

    const btnSave = document.createElement('button');
    btnSave.className = 'pd-btn primary';
    btnSave.setAttribute('data-testid', 'pd-region-save');
    btnSave.textContent = t('panel_save');
    btnSave.addEventListener('click', () => {
      this.saveRegionPanel(textarea.value, viewportPos, region);
    });
    row.appendChild(btnSave);

    panel.appendChild(row);
    this.panelLayer.appendChild(panel);
    this.regionPanelEl = panel;

    // 定位面板：锚定区域右下角附近，夹紧视口
    this.positionRegionPanel(viewportPos);

    textarea.focus();

    // 点外部关闭（面板/自身 UI 内不关）
    const onOutside = (ev: MouseEvent): void => {
      const path = ev.composedPath();
      if (path.includes(panel) || path.includes(this.shadowHost as EventTarget)) return;
      window.removeEventListener('mousedown', onOutside, true);
      this.closeRegionPanel();
    };
    window.addEventListener('mousedown', onOutside, true);
  }

  private positionRegionPanel(vpRect: { x: number; y: number; w: number; h: number }): void {
    const panel = this.regionPanelEl;
    if (!panel) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const { offsetWidth: pw, offsetHeight: ph } = panel;
    const GAP = 8;
    // 锚右下角
    let left = vpRect.x + vpRect.w + GAP;
    let top = vpRect.y + vpRect.h + GAP;
    // 夹紧视口
    if (left + pw > vw - GAP) left = Math.max(GAP, vw - pw - GAP);
    if (top + ph > vh - GAP) top = Math.max(GAP, vh - ph - GAP);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  private saveRegionPanel(
    note: string,
    viewportPos: { x: number; y: number; w: number; h: number },
    region: RegionData
  ): void {
    const added = this.store.add({
      kind: 'region',
      selector: '',
      elementType: 'other',
      summary: `region ${viewportPos.w}×${viewportPos.h}`,
      note: note.trim(),
      changes: [],
      viewportPos,
      region,
    });
    this.history.push({
      label: 'annotation:add',
      apply: () => this.store.restore(added),
      revert: () => this.store.remove(added.id),
    });
    this.closeRegionPanel();
  }

  closeRegionPanel(): void {
    if (this.regionPanelEl) {
      this.regionPanelEl.remove();
      this.regionPanelEl = null;
    }
  }
}
