/* ============================================================
   panel.ts — 批注面板 / 批注卡片 / 位号圆右键菜单（渲染进 panel 层）
   - 批注模式 capture 段拦截 click/mousedown，阻止页面默认行为（如链接跳转）
   - 单击页面元素 → 弹出批注面板（textarea + 底栏），四向翻转避让视口
   - 点位号圆 → 展开/收起批注卡片；放不下时 .pd-connector 虚线连回位号圆
   - 右键位号圆 → 上下文菜单（修改批注 / 删除批注）
   视觉配方：base.css（.pd-surface/.panel/.pfoot/.acard/.pd-menu）
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, Annotation } from '../state/annotations';
import { Settings } from '../state/settings';
import { Overlay } from './overlay';
import { t } from './i18n';
import {
  buildSelector,
  classifyElement,
  getElementSummary,
} from '../shared/dom-utils';

/* ---- SVG 图标（Lucide 风格，与 preview parts 07/26 一致） ---- */
const ICONS = {
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  editSquare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`,
} as const;

const PANEL_WIDTH = 330; // preview part 11
const PLACE_GAP = 10;
const EDGE_MARGIN = 8;

/** 四向放置结果 */
interface Placement {
  left: number;
  top: number;
  /** 是否在不裁剪的前提下贴近了锚点（false = 兜底夹紧，需画连线） */
  fits: boolean;
}

/**
 * 四向翻转放置：按 右 → 下 → 左 → 上 依次尝试，
 * 都放不下时夹紧在视口内（fits=false）。
 */
function placeNear(anchor: DOMRect, w: number, h: number, gap = PLACE_GAP): Placement {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const clampTop = (top: number): number =>
    Math.max(EDGE_MARGIN, Math.min(top, vh - h - EDGE_MARGIN));
  const clampLeft = (left: number): number =>
    Math.max(EDGE_MARGIN, Math.min(left, vw - w - EDGE_MARGIN));

  // 右
  if (anchor.right + gap + w <= vw - EDGE_MARGIN && h <= vh - EDGE_MARGIN * 2) {
    return { left: anchor.right + gap, top: clampTop(anchor.top), fits: true };
  }
  // 下
  if (anchor.bottom + gap + h <= vh - EDGE_MARGIN && w <= vw - EDGE_MARGIN * 2) {
    return { left: clampLeft(anchor.left), top: anchor.bottom + gap, fits: true };
  }
  // 左
  if (anchor.left - gap - w >= EDGE_MARGIN && h <= vh - EDGE_MARGIN * 2) {
    return { left: anchor.left - gap - w, top: clampTop(anchor.top), fits: true };
  }
  // 上
  if (anchor.top - gap - h >= EDGE_MARGIN && w <= vw - EDGE_MARGIN * 2) {
    return { left: clampLeft(anchor.left), top: anchor.top - gap - h, fits: true };
  }
  // 兜底：夹紧
  return { left: clampLeft(anchor.right + gap), top: clampTop(anchor.top), fits: false };
}

/** 底栏 meta 文案：#位号 · 元素类型 · x,y(px) */
function metaText(number: number, elementType: string, x: number, y: number): string {
  return `#${number} · ${elementType} · ${x},${y}px`;
}

/** 打开的卡片记录 */
interface OpenCard {
  annotation: Annotation;
  el: HTMLElement;
  connector: SVGSVGElement | null;
}

export class PanelManager {
  private controller: Controller;
  private store: AnnotationStore;
  private overlay: Overlay;
  private root: HTMLElement; // panel 层根容器
  private settings: Settings;
  private shadowHost: Element;

  // 批注面板（一次一个）
  private panelEl: HTMLElement | null = null;
  private panelTarget: Element | null = null;
  private panelExisting: Annotation | null = null;

  // 批注卡片（可多个并存）
  private cards: Map<string, OpenCard> = new Map();

  // 上下文菜单（一次一个）
  private menuEl: HTMLElement | null = null;

  // 跟随刷新
  private rafId: number | null = null;

  private active = false;
  private unsubscribeStore: () => void;
  private unsubscribeController: () => void;

  constructor(
    controller: Controller,
    store: AnnotationStore,
    overlay: Overlay,
    panelLayer: HTMLElement,
    settings: Settings
  ) {
    this.controller = controller;
    this.store = store;
    this.overlay = overlay;
    this.root = panelLayer;
    this.settings = settings;
    this.shadowHost = (panelLayer.getRootNode() as ShadowRoot).host;

    this.unsubscribeController = controller.subscribe(() => this.syncActive());
    this.syncActive();

    this.unsubscribeStore = store.subscribe(() => this.syncCards());

    // capture 段拦截：批注模式下接管页面点击
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('click', this.onClick, true);

    // 面板/卡片跟随目标元素
    window.addEventListener('scroll', this.scheduleReposition, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleReposition);
  }

  destroy(): void {
    this.unsubscribeStore();
    this.unsubscribeController();
    window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('scroll', this.scheduleReposition, true);
    window.removeEventListener('resize', this.scheduleReposition);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.closePanel();
    this.closeMenu();
    for (const id of [...this.cards.keys()]) this.closeCard(id);
  }

  // ---- 模式联动 ----

  private syncActive(): void {
    const { expanded, mode } = this.controller.getState();
    const next = expanded && mode === 'annotate';
    if (this.active && !next) {
      // 退出批注交互：关面板/菜单（卡片是已保存内容的 UI，保留）
      this.closePanel();
      this.closeMenu();
    }
    this.active = next;
  }

  // ---- 事件拦截 ----

  private isOwnUi(ev: Event): boolean {
    return ev.composedPath().includes(this.shadowHost);
  }

  private onMouseDown = (ev: MouseEvent): void => {
    const path = ev.composedPath();

    // 菜单外点击 → 关菜单
    if (this.menuEl && !path.includes(this.menuEl)) {
      this.closeMenu();
    }

    // 面板外点击 → 关面板（放弃未保存内容）
    if (this.panelEl && !path.includes(this.panelEl)) {
      this.closePanel();
    }

    if (!this.active || this.isOwnUi(ev)) return;

    // 批注模式：阻止页面自身的 mousedown 行为（焦点/选区/页面脚本）
    ev.preventDefault();
    ev.stopPropagation();
  };

  private onClick = (ev: MouseEvent): void => {
    if (!this.active || this.isOwnUi(ev)) return;

    // 批注模式：拦截页面默认行为（链接跳转/按钮提交）
    ev.preventDefault();
    ev.stopPropagation();

    const target = ev.target;
    if (
      !(target instanceof Element) ||
      target === document.documentElement ||
      target === document.body
    ) {
      return;
    }

    // 已有标注的元素 → 预填面板
    const selector = buildSelector(target);
    const existing = this.store.getBySelector(selector);
    this.openPanel(target, existing ?? null);
  };

  // ---- 批注面板 ----

  /** 打开批注面板（existing 非空 = 修改已有批注，预填内容） */
  openPanel(target: Element, existing: Annotation | null): void {
    this.closePanel();
    this.closeMenu();

    const rect = target.getBoundingClientRect();
    const number = existing ? existing.number : this.store.peekNextNumber();
    const elementType = existing ? existing.elementType : classifyElement(target);
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);

    const panel = document.createElement('div');
    panel.className = 'pd-surface panel';
    panel.setAttribute('data-testid', 'pd-panel');
    panel.style.position = 'absolute';
    panel.style.width = `${PANEL_WIDTH}px`;

    const body = document.createElement('div');
    body.className = 'pbody';
    const textarea = document.createElement('textarea');
    textarea.className = 'pd-textarea';
    textarea.setAttribute('data-testid', 'pd-panel-note');
    textarea.placeholder = t('panel_note_placeholder');
    textarea.value = existing?.note ?? '';
    body.appendChild(textarea);
    panel.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'pfoot';

    const lead = document.createElement('div');
    lead.className = 'lead';
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = metaText(number, elementType, x, y);
    lead.appendChild(meta);
    foot.appendChild(lead);

    const acts = document.createElement('div');
    acts.className = 'acts';

    if (existing) {
      const btnDelete = document.createElement('button');
      btnDelete.className = 'pd-iconbtn danger';
      btnDelete.setAttribute('data-testid', 'pd-panel-delete');
      btnDelete.setAttribute('aria-label', t('menu_delete_annotation'));
      btnDelete.innerHTML = ICONS.trash;
      btnDelete.addEventListener('click', () => {
        this.store.remove(existing.id);
        this.closePanel();
      });
      acts.appendChild(btnDelete);
    }

    const btnSave = document.createElement('button');
    btnSave.className = 'pd-btn primary';
    btnSave.setAttribute('data-testid', 'pd-panel-save');
    btnSave.textContent = t('panel_save');
    btnSave.addEventListener('click', () => this.savePanel());
    acts.appendChild(btnSave);

    foot.appendChild(acts);
    panel.appendChild(foot);

    this.root.appendChild(panel);
    this.panelEl = panel;
    this.panelTarget = target;
    this.panelExisting = existing;

    this.positionPanel();
    textarea.focus();
  }

  private positionPanel(): void {
    if (!this.panelEl || !this.panelTarget) return;
    if (!this.panelTarget.isConnected) {
      this.closePanel();
      return;
    }
    const anchor = this.panelTarget.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = this.panelEl;
    const pos = placeNear(anchor, w, h);
    this.panelEl.style.left = `${pos.left}px`;
    this.panelEl.style.top = `${pos.top}px`;
  }

  private savePanel(): void {
    if (!this.panelEl || !this.panelTarget) return;
    const textarea = this.panelEl.querySelector<HTMLTextAreaElement>('.pd-textarea')!;
    const note = textarea.value.trim();
    const target = this.panelTarget;
    const rect = target.getBoundingClientRect();
    const viewportPos = {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };

    let saved: Annotation | undefined;
    if (this.panelExisting) {
      saved = this.store.update(this.panelExisting.id, {
        note,
        summary: getElementSummary(target),
        viewportPos,
      });
    } else {
      saved = this.store.add({
        selector: buildSelector(target),
        elementType: classifyElement(target),
        summary: getElementSummary(target),
        note,
        changes: [],
        viewportPos,
      });
    }
    this.closePanel();

    // 卡片默认展开设置
    if (saved && this.settings.cardDefaultExpanded && !this.cards.has(saved.id)) {
      this.openCard(saved);
    }
  }

  closePanel(): void {
    if (!this.panelEl) return;
    this.panelEl.remove();
    this.panelEl = null;
    this.panelTarget = null;
    this.panelExisting = null;
  }

  // ---- 批注卡片 ----

  /** 位号圆点击：展开/收起卡片（Overlay hook 接入） */
  togglePinCard = (annotation: Annotation): void => {
    if (this.cards.has(annotation.id)) {
      this.closeCard(annotation.id);
    } else {
      this.openCard(annotation);
    }
  };

  openCard(annotation: Annotation): void {
    if (this.cards.has(annotation.id)) return;

    const card = document.createElement('div');
    card.className = 'pd-surface acard';
    card.setAttribute('data-testid', 'pd-card');
    card.setAttribute('data-number', String(annotation.number));
    this.renderCardContent(card, annotation);
    this.root.appendChild(card);

    const open: OpenCard = { annotation, el: card, connector: null };
    this.cards.set(annotation.id, open);
    this.positionCard(open);
  }

  private renderCardContent(card: HTMLElement, annotation: Annotation): void {
    card.innerHTML = '';

    // 上半：批注文本（有批注时显示）
    if (annotation.note) {
      const note = document.createElement('div');
      note.className = 'note';
      note.setAttribute('data-testid', 'pd-card-note');
      note.textContent = annotation.note;
      card.appendChild(note);
    }

    // 下半：调整项区（本任务 changes 恒空，隐藏）

    // 底栏：#位号·类型·位置 + 删除/修改
    const foot = document.createElement('div');
    foot.className = 'foot';

    const meta = document.createElement('span');
    meta.className = 'meta';
    const { x, y } = annotation.viewportPos;
    meta.textContent = metaText(annotation.number, annotation.elementType, x, y);
    foot.appendChild(meta);

    const acts = document.createElement('span');
    acts.className = 'acts';

    const btnDelete = document.createElement('button');
    btnDelete.className = 'pd-iconbtn danger';
    btnDelete.setAttribute('data-testid', 'pd-card-delete');
    btnDelete.title = t('menu_delete_annotation');
    btnDelete.setAttribute('aria-label', t('menu_delete_annotation'));
    btnDelete.innerHTML = ICONS.trash;
    btnDelete.addEventListener('click', () => this.store.remove(annotation.id));
    acts.appendChild(btnDelete);

    const btnEdit = document.createElement('button');
    btnEdit.className = 'pd-iconbtn';
    btnEdit.setAttribute('data-testid', 'pd-card-edit');
    btnEdit.title = t('menu_edit_annotation');
    btnEdit.setAttribute('aria-label', t('menu_edit_annotation'));
    btnEdit.innerHTML = ICONS.pencil;
    btnEdit.addEventListener('click', () => this.editAnnotation(annotation));
    acts.appendChild(btnEdit);

    foot.appendChild(acts);
    card.appendChild(foot);
  }

  /** 用位号圆当前视口位置为锚点放置卡片；放不下画虚线连回 */
  private positionCard(open: OpenCard): void {
    const pinRect = this.overlay.getPinRect(open.annotation.id);
    if (!pinRect) {
      // 目标元素消失 → 隐藏卡片（数据保留）
      open.el.style.display = 'none';
      this.removeConnector(open);
      return;
    }
    open.el.style.display = 'block';
    const { offsetWidth: w, offsetHeight: h } = open.el;
    const pos = placeNear(pinRect, w, h);
    open.el.style.left = `${pos.left}px`;
    open.el.style.top = `${pos.top}px`;

    if (!pos.fits) {
      this.drawConnector(open, pinRect, pos, w, h);
    } else {
      this.removeConnector(open);
    }
  }

  /** 兜底放置时的虚线连线：位号圆中心 → 卡片最近角 */
  private drawConnector(
    open: OpenCard,
    pinRect: DOMRect,
    pos: { left: number; top: number },
    w: number,
    h: number
  ): void {
    const x1 = pinRect.left + pinRect.width / 2;
    const y1 = pinRect.top + pinRect.height / 2;
    const x2 = Math.abs(pos.left - x1) < Math.abs(pos.left + w - x1) ? pos.left : pos.left + w;
    const y2 = Math.abs(pos.top - y1) < Math.abs(pos.top + h - y1) ? pos.top : pos.top + h;

    const minX = Math.min(x1, x2);
    const minY = Math.min(y1, y2);
    const boxW = Math.max(1, Math.abs(x2 - x1));
    const boxH = Math.max(1, Math.abs(y2 - y1));

    if (!open.connector) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.classList.add('pd-connector');
      svg.setAttribute('data-testid', 'pd-connector');
      svg.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'line'));
      this.root.appendChild(svg);
      open.connector = svg;
    }
    const svg = open.connector;
    svg.style.left = `${minX}px`;
    svg.style.top = `${minY}px`;
    svg.setAttribute('width', String(boxW));
    svg.setAttribute('height', String(boxH));
    const line = svg.querySelector('line')!;
    line.setAttribute('x1', String(x1 - minX));
    line.setAttribute('y1', String(y1 - minY));
    line.setAttribute('x2', String(x2 - minX));
    line.setAttribute('y2', String(y2 - minY));
  }

  private removeConnector(open: OpenCard): void {
    open.connector?.remove();
    open.connector = null;
  }

  closeCard(id: string): void {
    const open = this.cards.get(id);
    if (!open) return;
    this.removeConnector(open);
    open.el.remove();
    this.cards.delete(id);
  }

  /** store 变化时同步卡片：删除的关掉，更新的重渲染 */
  private syncCards(): void {
    for (const [id, open] of [...this.cards]) {
      const current = this.store.getById(id);
      if (!current) {
        this.closeCard(id);
        continue;
      }
      if (current !== open.annotation) {
        open.annotation = current;
        this.renderCardContent(open.el, current);
        this.positionCard(open);
      }
    }
  }

  // ---- 上下文菜单 ----

  /** 位号圆右键：删除/修改菜单（Overlay hook 接入） */
  openPinMenu = (annotation: Annotation, pinEl: HTMLElement): void => {
    this.closeMenu();

    const menu = document.createElement('div');
    menu.className = 'pd-menu';
    menu.setAttribute('data-testid', 'pd-menu');
    menu.style.position = 'absolute';

    const itemEdit = document.createElement('button');
    itemEdit.className = 'pd-menu-item';
    itemEdit.setAttribute('data-testid', 'pd-menu-edit');
    itemEdit.innerHTML = `${ICONS.editSquare}${t('menu_edit_annotation')}`;
    itemEdit.addEventListener('click', () => {
      this.closeMenu();
      this.editAnnotation(annotation);
    });
    menu.appendChild(itemEdit);

    const sep = document.createElement('div');
    sep.className = 'pd-menu-sep';
    menu.appendChild(sep);

    const itemDelete = document.createElement('button');
    itemDelete.className = 'pd-menu-item danger';
    itemDelete.setAttribute('data-testid', 'pd-menu-delete');
    itemDelete.innerHTML = `${ICONS.trash}${t('menu_delete_annotation')}`;
    itemDelete.addEventListener('click', () => {
      this.closeMenu();
      this.store.remove(annotation.id);
    });
    menu.appendChild(itemDelete);

    this.root.appendChild(menu);
    this.menuEl = menu;

    // 菜单从位号圆上弹（preview part 26），放不下四向翻转
    const pinRect = pinEl.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = menu;
    const vw = window.innerWidth;
    let left = pinRect.left - 10;
    let top = pinRect.top - PLACE_GAP - h;
    if (top < EDGE_MARGIN || left + w > vw - EDGE_MARGIN) {
      const pos = placeNear(pinRect, w, h);
      left = pos.left;
      top = pos.top;
    }
    menu.style.left = `${Math.max(EDGE_MARGIN, left)}px`;
    menu.style.top = `${top}px`;
  };

  closeMenu(): void {
    if (!this.menuEl) return;
    this.menuEl.remove();
    this.menuEl = null;
  }

  /** 修改批注：重新定位目标元素后打开预填面板 */
  private editAnnotation(annotation: Annotation): void {
    let target: Element | null = null;
    try {
      const matches = document.querySelectorAll(annotation.selector);
      if (matches.length === 1) target = matches[0];
    } catch {
      target = null;
    }
    if (!target) return;
    this.openPanel(target, annotation);
  }

  // ---- 跟随刷新 ----

  private scheduleReposition = (): void => {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.positionPanel();
      for (const open of this.cards.values()) {
        this.positionCard(open);
      }
    });
  };
}
