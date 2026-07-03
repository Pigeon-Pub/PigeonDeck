/* ============================================================
   region-select.ts — 长按框选区域批注
   蓝图 §4.2（长按检测）+ §5.2（区域框选）
   长按 ≥300ms → 拖拽实时金框 → 松手弹区域批注面板 → 保存入 Store
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore } from '../state/annotations';
import { History } from '../state/history';
import { Settings } from '../state/settings';
import { PanelManager } from './panel';
import { buildSelector, isVisible } from '../shared/dom-utils';
import { t } from './i18n';

/** 长按阈值默认值（ms）；实际用 settings.longPressMs（阶段 11 接入） */
const LONG_PRESS_MS = 300;
/** 最小区域尺寸（px）：宽或高小于此值视为误触 */
const MIN_REGION = 6;

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
    if (this.selecting) return;
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

    const viewportPos = { x: Math.round(vpX), y: Math.round(vpY), w: Math.round(w), h: Math.round(h) };

    // 抑制松手后触发的 click
    this.panel.suppressNextClick();

    // 打开区域批注面板
    this.openRegionPanel(viewportPos, docRect, elements);
  }

  /** 收集视口矩形内的可见元素选择器（上限 30） */
  private collectElements(vpRect: { x: number; y: number; w: number; h: number }): string[] {
    const selectors: string[] = [];
    const seen = new Set<string>();
    const candidates = document.body.querySelectorAll('*');
    for (const el of candidates) {
      if (selectors.length >= 30) break;
      if (!isVisible(el)) continue;
      const elRect = el.getBoundingClientRect();
      // 与区域视口矩形相交
      if (
        elRect.right < vpRect.x ||
        elRect.left > vpRect.x + vpRect.w ||
        elRect.bottom < vpRect.y ||
        elRect.top > vpRect.y + vpRect.h
      ) continue;
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
    docRect: { x: number; y: number; w: number; h: number },
    elements: string[]
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
      this.saveRegionPanel(textarea.value, viewportPos, docRect, elements);
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
    docRect: { x: number; y: number; w: number; h: number },
    elements: string[]
  ): void {
    const added = this.store.add({
      kind: 'region',
      selector: '',
      elementType: 'other',
      summary: `region ${viewportPos.w}×${viewportPos.h}`,
      note: note.trim(),
      changes: [],
      viewportPos,
      region: { docRect, elements },
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
