/* ============================================================
   panel.ts — 批注面板 / 批注卡片 / 位号圆右键菜单（渲染进 panel 层）
   - 批注模式 capture 段拦截 click/mousedown，阻止页面默认行为（如链接跳转）
   - 单击页面元素 → 弹出批注面板（textarea + 修改栏 + 高级样式 + 底栏）
   - 修改栏按元素类型智能切换；控件与高级样式双入口单源（fields.ts）
   - 控件改动即时预览 → StyleChange 记录；保存写入 store + 撤销历史；
     未保存关面板（点外部）回滚本次会话预览
   - 面板长度动画：切分区/展开收起高级样式时 height px→auto 过渡（190ms）
   - 点位号圆 → 展开/收起批注卡片（含「调整项：原值 → 新值」行）
   - 右键位号圆 → 上下文菜单（修改批注 / 删除批注）
   视觉配方：base.css（.pd-surface/.panel/.pfoot/.acard/.pd-menu/.modbox/.advbox）
   ============================================================ */

import { Controller } from './controller';
import {
  AnnotationStore,
  Annotation,
  mergeChanges,
  RICHTEXT_DOM_CSSPROP,
} from '../state/annotations';
import { History } from '../state/history';
import { Settings } from '../state/settings';
import { Overlay } from './overlay';
import { t } from './i18n';
import {
  buildSelector,
  classifyElement,
  getElementSummary,
} from '../shared/dom-utils';
import type { ElementType } from '../shared/dom-utils';
import {
  FieldsSession,
  ControlContext,
  FIELD_DEFS,
  modbarRows,
  autoModbarRows,
  modbarTitleKey,
  renderRows,
} from './fields';
import { createAdvancedBox } from './advanced-styles';
import { closeAllPopovers } from './popover';
import { pushEsc } from './esc-stack';
import { SelectionResolver } from './selection';
import { SelectionBox } from './selection-box';
import { Toast } from './toast';
import { applyChangesTo } from './change-apply';
import { htmlToText, srcSummary, truncateValue } from './annotation-summary';
import { makeDraggableByHandle } from './floating-drag';

/* ---- SVG 图标（Lucide 风格，与 preview parts 07/11/26/35 一致） ---- */
const ICONS = {
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`,
  pencil: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>`,
  editSquare: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>`,
  chevR: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>`,
  chevD: `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`,
  info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
} as const;

const PANEL_WIDTH = 330; // preview part 11
const PLACE_GAP = 10;
const EDGE_MARGIN = 8;
/** 文本元素单击延迟（ms）：给 dblclick 让出时间窗口 */
const SINGLE_CLICK_DELAY = 250;
/** 需要给 dblclick 让窗口的元素类型（text=内联编辑，image/video=替换） */
const DELAYED_TYPES: ReadonlySet<ElementType> = new Set<ElementType>(['text', 'image', 'video']);

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

/** 底栏 meta 文案：#位号 · 元素类型/区域标签 · x,y(px) */
function metaText(number: number, elementType: string, x: number, y: number, isRegion = false): string {
  const typeLabel = isRegion ? t('region_label') : elementType;
  return `#${number} · ${typeLabel} · ${x},${y}px`;
}




interface OpenCard {
  annotation: Annotation;
  el: HTMLElement;
  connector: SVGSVGElement | null;
}

/** 高度过渡代际标记：同元素被新一轮动画接管时，旧一轮的 rAF/收尾一律作废 */
const heightAnimGen = new WeakMap<HTMLElement, number>();

/**
 * 元素高度柔和过渡（design-system §1.5 例外条款）——可靠 FLIP：
 * 快照旧高 h0 → 变更内容 → 量新高 h1 → 显式 h0px 起点（回流提交）→ 下一帧起 h1px 显式终点，
 * 走 `.panel/.acard { transition: height }` 的 190ms 过渡；过渡结束（或 280ms 兜底）后清回
 * 自然高度并调用 after（重定位）。用显式 px→px 而非 px→auto，且把 after 推迟到过渡结束——
 * 旧实现设 height:auto 后同步 positionPanel() 读 offsetHeight 强制回流，起终值被合并到同一帧、
 * 过渡从不触发（这是上一轮动画“看不到”的根因）。
 * after 在过渡结束后回调（用于重定位）。h0===h1（含 jsdom offsetHeight=0）时直接跳过动画。
 */
function animateHeight(el: HTMLElement, mutate: () => void, after?: () => void): void {
  const h0 = el.offsetHeight;
  mutate();
  el.style.height = 'auto';
  const h1 = el.offsetHeight;
  if (h0 === h1) {
    el.style.height = '';
    after?.();
    return;
  }
  const gen = (heightAnimGen.get(el) ?? 0) + 1;
  heightAnimGen.set(el, gen);
  el.style.height = `${h0}px`;
  void el.offsetHeight; // 提交起点高度
  requestAnimationFrame(() => {
    if (heightAnimGen.get(el) !== gen) return; // 被新一轮接管
    el.style.height = `${h1}px`;
    let done = false;
    const finish = (): void => {
      if (done || heightAnimGen.get(el) !== gen) return;
      done = true;
      el.removeEventListener('transitionend', onEnd);
      el.style.height = ''; // 清回自然高度（auto）
      after?.();
    };
    const onEnd = (ev: TransitionEvent): void => {
      if (ev.target === el && ev.propertyName === 'height') finish();
    };
    el.addEventListener('transitionend', onEnd);
    setTimeout(finish, 280); // transitionend 未触发（缩减动效/被打断）时的兜底
  });
}


export class PanelManager {
  private controller: Controller;
  private store: AnnotationStore;
  private overlay: Overlay;
  private root: HTMLElement; // panel 层根容器
  private settings: Settings;
  private history: History;
  private shadowHost: Element;
  private toast: Toast;
  private feedbackLayer: HTMLElement; // feedback 层根（页内取色器覆盖层挂载点）
  private resolver: SelectionResolver | null = null;
  /** 区域批注编辑委派（main.ts 注入 → RegionSelectManager.editRegion）。 */
  private regionEditor: ((annotation: Annotation) => void) | null = null;
  /**
   * 交互式选中框（八向句柄缩放）：批注模式单击元素时随面板一同出现，
   * 句柄缩放并入该元素标注 + 撤销历史（与移动模式同一 SelectionBox 组件）。
   * 缩放提交后回调刷新 panelExisting，使随后保存并入同一标注而非新建重复项。
   */
  private selbox: SelectionBox;

  // 批注面板（一次一个）
  private panelEl: HTMLElement | null = null;
  private panelTarget: Element | null = null;
  private panelExisting: Annotation | null = null;
  /**
   * 面板拖拽偏移（相对锚点自动放置位置的 dx/dy）：用户拖动顶部把手后记录，
   * scroll/resize 重定位时在锚点基准上叠加它，保持用户拖到的位置不回弹。
   * 每次打开面板重置为 null。
   */
  private panelDragOffset: { dx: number; dy: number } | null = null;
  /**
   * 粒度会话的稳定原始命中元素：+/- 粒度胶囊始终以它 + 累加 offset 解析目标，
   * 避免用"已被上次 +/- 移动过的 panelTarget"复合叠加导致过冲。
   * 仅在新鲜单击/编辑打开时更新；re-point 打开保持不变。
   */
  private granHitEl: HTMLElement | null = null;
  // 本次面板会话的字段状态（双入口单源）；保存后置空，未保存关面板回滚
  private session: FieldsSession | null = null;
  private panelCommitted = false;

  // 批注卡片（可多个并存）
  private cards: Map<string, OpenCard> = new Map();

  // 上下文菜单（一次一个）
  private menuEl: HTMLElement | null = null;

  // 跟随刷新
  private rafId: number | null = null;

  // 单击延迟：文本元素单击等待 dblclick 抢占
  private pendingOpenTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOpenTarget: Element | null = null;

  // 内联编辑拦截豁免：当前编辑元素（DirectEditManager 设置）
  private inlineEditEl: HTMLElement | null = null;

  // 区域框选完成后抑制一次 click（避免松手触发元素面板）
  private suppressClick = false;

  private active = false;
  // 挂起全页事件拦截（打开原生取色器等系统级浮层期间）：capture 段一律放行，见 suspendInterception。
  private suspended = false;
  /** 面板打开期间压入 Esc 栈的弹出函数（F8b：Esc 先取消选中/关面板，再由 shortcuts 退出模式）。 */
  private escPop: (() => void) | undefined;
  private unsubscribeStore: () => void;
  private unsubscribeController: () => void;

  constructor(
    controller: Controller,
    store: AnnotationStore,
    overlay: Overlay,
    panelLayer: HTMLElement,
    settings: Settings,
    history: History,
    toast: Toast,
    overlayLayer: HTMLElement,
    feedbackLayer: HTMLElement
  ) {
    this.controller = controller;
    this.store = store;
    this.overlay = overlay;
    this.root = panelLayer;
    this.settings = settings;
    this.history = history;
    this.toast = toast;
    this.feedbackLayer = feedbackLayer;
    this.shadowHost = (panelLayer.getRootNode() as ShadowRoot).host;

    // 选中框挂在 overlay 层（与移动模式一致；句柄 pointer-events:auto 可拖，边框穿透）。
    // 缩放提交后刷新 panelExisting，避免保存时对同元素新建重复标注。
    this.selbox = new SelectionBox({
      store,
      history,
      overlayLayer,
      onAfterResize: (el) => this.onSelboxResize(el),
    });

    this.unsubscribeController = controller.subscribe(() => this.syncActive());
    this.syncActive();

    this.unsubscribeStore = store.subscribe(() => this.syncCards());

    // capture 段拦截：批注模式下接管页面点击
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('click', this.onClick, true);
    // 批注模式下右键空白处：吞掉浏览器原生菜单 + 关闭面板/菜单（见 onContextMenu）
    window.addEventListener('contextmenu', this.onContextMenu, true);

    // 面板/卡片跟随目标元素
    window.addEventListener('scroll', this.scheduleReposition, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleReposition);
  }

  destroy(): void {
    this.unsubscribeStore();
    this.unsubscribeController();
    window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('contextmenu', this.onContextMenu, true);
    window.removeEventListener('scroll', this.scheduleReposition, true);
    window.removeEventListener('resize', this.scheduleReposition);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.cancelPendingOpen();
    this.closePanel();
    this.closeMenu();
    for (const id of [...this.cards.keys()]) this.closeCard(id);
    this.selbox.destroy();
  }

  // ---- 模式联动 ----

  private syncActive(): void {
    const { expanded, mode } = this.controller.getState();
    const next = expanded && mode === 'annotate';
    if (this.active && !next) {
      // 退出批注交互：关面板/菜单（卡片是已保存内容的 UI，保留）
      this.cancelPendingOpen();
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
    if (this.suspended) return; // 取色器等系统浮层期间不干预页面事件（F18）
    const path = ev.composedPath();
    // 浮层（下拉/调色盘）内点击不算"面板外部"（浮层自身管理关闭）
    const inPopover = path.some(
      (n) => n instanceof HTMLElement && n.hasAttribute('data-pd-popover')
    );
    // 选中框句柄内点击不算"面板外部"：句柄在 overlay 层（非 panelEl），是面板会话的
    // 直接操作件，缩放期间必须保持面板打开。
    const inSelbox = path.some(
      (n) => n instanceof HTMLElement && n.classList.contains('pd-selbox')
    );
    const inOwnUi = this.isOwnUi(ev);

    // 菜单外点击 → 关菜单
    if (this.menuEl && !path.includes(this.menuEl)) {
      this.closeMenu();
    }

    // 面板外点击 → 关面板（放弃未保存内容，回滚本次会话预览）
    if (this.panelEl && !path.includes(this.panelEl) && !inPopover && !inSelbox && !inOwnUi) {
      this.closePanel();
    }

    if (!this.active || inOwnUi) return;

    // 内联编辑豁免：落在正在编辑元素上的事件直接放行
    if (this.inlineEditEl && path.includes(this.inlineEditEl)) return;

    // 批注模式：阻止页面自身的 mousedown 行为（焦点/选区/页面脚本）
    ev.preventDefault();
    ev.stopPropagation();
  };

  private onClick = (ev: MouseEvent): void => {
    if (this.suspended) return; // 取色器等系统浮层期间不干预页面事件（F18）
    if (!this.active || this.isOwnUi(ev)) return;

    // 区域框选松手后抑制该次 click，避免误开元素面板
    if (this.suppressClick) {
      this.suppressClick = false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    // 内联编辑豁免：落在正在编辑元素上的点击直接放行
    if (this.inlineEditEl && ev.composedPath().includes(this.inlineEditEl)) return;

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

    // text/image/video：延迟打开，给 dblclick 让出 250ms 时间窗口
    if (DELAYED_TYPES.has(classifyElement(target))) {
      this.pendingOpenTarget = target;
      this.pendingOpenTimer = setTimeout(() => {
        this.pendingOpenTimer = null;
        // 重新校验：仍 active、target 仍 isConnected
        if (!this.active) return;
        if (!this.pendingOpenTarget?.isConnected) return;
        const hit = this.pendingOpenTarget;
        this.pendingOpenTarget = null;
        this.openFromHit(hit);
      }, SINGLE_CLICK_DELAY);
      return;
    }

    this.openFromHit(target);
  };

  /**
   * 批注模式右键：吞掉浏览器原生菜单并关闭已开的面板/菜单。
   * - 仅批注模式（this.active = expanded && annotate）生效；其余模式不干预原生菜单。
   * - 自身 UI（含位号圆——位号圆有自己的 contextmenu 处理）一律放行：isOwnUi 命中即 return，
   *   让位号圆的右键菜单照常弹出（overlay.ts 中 pin 自带 preventDefault）。
   */
  private onContextMenu = (ev: MouseEvent): void => {
    if (this.suspended) return; // 取色器等系统浮层期间不干预页面事件（F18）
    if (!this.active) return;
    if (this.isOwnUi(ev)) return;
    // 空白/页面元素右键：抑制原生菜单，等效"点外部"关闭当前面板/菜单
    ev.preventDefault();
    this.closeMenu();
    this.closePanel();
  };

  /**
   * 新鲜单击打开面板：记录稳定原始命中元素（granHitEl，供 +/- 复用）。
   * 若已有记忆偏移（用户此前用 +/- 调过粒度，offset≠0），按 §4.3 相对偏移记忆
   * 从原始命中元素解析目标；offset==0 时保持点中元素本身（不改默认批注粒度）。
   */
  private openFromHit(hit: Element): void {
    let panelTarget: Element = hit;
    let granHit: HTMLElement | null = null;
    if (this.resolver && hit instanceof HTMLElement) {
      granHit = hit;
      // 仅当有记忆偏移时才经解析器改变粒度，避免改动默认批注行为
      if (this.resolver.getOffset() !== 0) {
        panelTarget = this.resolver.resolve(hit);
      }
    }
    const existing = this.store.getBySelector(buildSelector(panelTarget));
    this.openPanel(panelTarget, existing ?? null, granHit);
  }

  /**
   * 粒度 +/- 调整并重指向：offset 累加后，始终从「稳定原始命中元素」granHitEl
   * （非已被上次 +/- 移动过的 panelTarget）+ 累加 offset 解析新目标，避免复合过冲。
   * re-point 打开时不覆盖 granHitEl（openPanel 第三参传 null）。
   */
  private adjustGranularity(delta: 1 | -1): void {
    if (!this.resolver) return;
    const hitEl = this.granHitEl ?? (this.panelTarget instanceof HTMLElement ? this.panelTarget : null);
    if (!hitEl) return;
    this.resolver.adjustOffset(delta);
    const newTarget = this.resolver.resolve(hitEl);
    this.panelCommitted = true; // 阻止 closePanel 回滚已存内容
    this.closePanel();
    const newExisting = this.store.getBySelector(buildSelector(newTarget));
    this.openPanel(newTarget, newExisting ?? null, null); // 不覆盖 granHitEl
  }

  // ---- 批注面板 ----

  /** 注入 SelectionResolver（main.ts 在实例化后调用） */
  setResolver(resolver: SelectionResolver): void {
    this.resolver = resolver;
  }

  /**
   * 注入区域批注编辑器（main.ts 在 RegionSelectManager 实例化后调用）。
   * 卡片/位号圆菜单编辑一条 region 标注时委派它打开可编辑的区域面板（F16）。
   */
  setRegionEditor(fn: (annotation: Annotation) => void): void {
    this.regionEditor = fn;
  }

  /** 批注模式当前选中元素（Overlay F6 用：hover 命中它时跳过高亮）。无选中返回 null。 */
  getSelectedTarget(): Element | null {
    return this.panelTarget;
  }

  /** 取消待定的单击延迟（dblclick 触发直接编辑时调用） */
  cancelPendingOpen(): void {
    if (this.pendingOpenTimer !== null) {
      clearTimeout(this.pendingOpenTimer);
      this.pendingOpenTimer = null;
    }
    this.pendingOpenTarget = null;
  }

  /** 区域框选松手后抑制一次 click，避免误开元素批注面板 */
  suppressNextClick(): void {
    this.suppressClick = true;
  }

  /**
   * 挂起批注模式的全页事件拦截（打开页内取色器覆盖层等全页浮层前调用），返回恢复函数。
   * 挂起期间 capture 段 mousedown/click/contextmenu 全部放行，避免用户在覆盖层上拾取像素的
   * 点击被 preventDefault/stopPropagation 吞掉或被误判为「面板外点击」而关闭面板（F18）。
   */
  private suspendInterception(): () => void {
    this.suspended = true;
    return () => {
      this.suspended = false;
    };
  }

  /** 内联编辑豁免：DirectEditManager 进入/退出编辑时设置 */
  setInlineEditActive(el: HTMLElement | null): void {
    this.inlineEditEl = el;
  }

  /** 是否正处于内联富文本编辑（供 RegionSelectManager 编辑时屏蔽框选） */
  isInlineEditing(): boolean {
    return this.inlineEditEl != null;
  }

  /**
   * 打开批注面板（existing 非空 = 修改已有批注，预填内容）。
   * granHit：本次是否作为新的粒度会话原始命中元素记录（新鲜单击/编辑=true；
   * +/- 重指向打开=false，保持既有 granHitEl 不被覆盖）。
   */
  openPanel(target: Element, existing: Annotation | null, granHit: HTMLElement | null = null): void {
    this.closePanel();
    this.closeMenu();

    // 新鲜单击/编辑打开：记录稳定原始命中元素（re-point 传 null 不覆盖）
    if (granHit) {
      this.granHitEl = granHit;
    }

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

    // 顶部拖拽把手：抓住它可拖动面板（建议3）
    panel.appendChild(this.buildPanelDragHandle(panel));

    const body = document.createElement('div');
    body.className = 'pbody pd-scroll';
    const textarea = document.createElement('textarea');
    textarea.className = 'pd-textarea';
    textarea.setAttribute('data-testid', 'pd-panel-note');
    textarea.placeholder = t('panel_note_placeholder');
    textarea.value = existing?.note ?? '';
    // Ctrl/Cmd+Enter 保存（普通 Enter 仍换行）（建议1）
    textarea.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        this.savePanel();
      }
    });
    body.appendChild(textarea);

    // ---- 修改栏（按元素类型智能切换）+ 高级样式区 ----
    // 任意 Element 都构建修改栏 + 高级样式：SVG <rect> 等非 HTMLElement 也走此路径（F19）。
    // getComputedStyle 与 .style 对 SVGElement 同样可用，按 HTMLElement 处理。
    {
      const styleTarget = target as HTMLElement;
      this.session = new FieldsSession(styleTarget);
      this.panelCommitted = false;
      const ctx: ControlContext = {
        popoverRoot: this.root,
        suspendInterception: () => this.suspendInterception(),
        feedbackRoot: this.feedbackLayer,
      };
      // 建议7：修改栏卡片可隐藏（settings.showModbar=false）→ 仅保留说明 + 高级样式
      const modbox = this.settings.showModbar
        ? this.buildModbox(styleTarget, elementType, ctx)
        : undefined;
      if (modbox) body.appendChild(modbox);
      // 高级样式展开时隐藏普通修改栏（逻辑2，贴 preview part 12 的展开布局），收起恢复；
      // modbox 缺省时 buildAdvSlot 内部对其存在性做守卫
      body.appendChild(this.buildAdvSlot(elementType, ctx, modbox));
    }
    panel.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'pfoot';

    const lead = document.createElement('div');
    lead.className = 'lead';

    // +/- 粒度胶囊：仅智能块基准（defaultGranularity==='smart'）显示（裁决12 #3）
    if (this.resolver && this.settings.defaultGranularity === 'smart') {
      const capsule = document.createElement('div');
      capsule.className = 'pd-gran-capsule';
      capsule.setAttribute('data-testid', 'pd-gran-capsule');

      const btnMinus = document.createElement('button');
      btnMinus.className = 'step-btn';
      btnMinus.setAttribute('data-testid', 'pd-gran-minus');
      btnMinus.setAttribute('aria-label', t('gran_narrow'));
      btnMinus.textContent = '−';
      btnMinus.addEventListener('click', () => {
        this.adjustGranularity(-1);
      });

      const btnPlus = document.createElement('button');
      btnPlus.className = 'step-btn';
      btnPlus.setAttribute('data-testid', 'pd-gran-plus');
      btnPlus.setAttribute('aria-label', t('gran_widen'));
      btnPlus.textContent = '+';
      btnPlus.addEventListener('click', () => {
        this.adjustGranularity(1);
      });

      capsule.appendChild(btnMinus);
      capsule.appendChild(btnPlus);
      lead.appendChild(capsule);
    }

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
        this.closePanel(); // 先回滚本次会话预览
        this.deleteAnnotation(existing);
      });
      acts.appendChild(btnDelete);
    }

    // 取消：无边框黑字文本按钮，置于保存左侧；点击 = closePanel（回滚未保存预览）（建议4）
    const btnCancel = document.createElement('button');
    btnCancel.className = 'pd-btn ghost';
    btnCancel.setAttribute('data-testid', 'pd-btn-cancel');
    btnCancel.textContent = t('panel_cancel');
    btnCancel.addEventListener('click', () => this.closePanel());
    acts.appendChild(btnCancel);

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

    // R5：选中已有标注重新编辑时，隐藏它自己的持久标注框/位号，避免与八句柄选中框
    // 重叠成双框（此处只抑制这一条，其余标注的框照常）。closePanel 恢复。
    this.overlay.setSuppressedMark(existing ? existing.id : null);

    // 交互式选中框随面板出现（元素目标；区域批注不走 openPanel 故无框）。
    // 句柄缩放直接改该元素尺寸 → 并入标注 + 撤销历史。
    if (target instanceof HTMLElement) {
      this.selbox.select(target);
    } else {
      this.selbox.clear();
    }

    this.positionPanel();
    textarea.focus();

    // F8b：面板打开期间接管 Esc —— 先取消选中（关面板 + 清八句柄框，语义同点外部），
    // 弹栈后再按一次 Esc 才轮到 shortcuts 退出模式。
    this.escPop?.();
    this.escPop = pushEsc(() => this.closePanel());
  }

  /**
   * 句柄缩放提交后（SelectionBox 已把 width/height 并入该元素标注 + 撤销历史）：
   * 若面板正为同一元素打开，刷新 panelExisting 指向刚新建/更新的标注，
   * 使随后「保存」并入同一条而非对同元素新建重复标注。
   */
  private onSelboxResize = (el: HTMLElement): void => {
    if (this.panelEl && this.panelTarget === el) {
      const fresh = this.store.getBySelector(buildSelector(el));
      if (fresh) {
        this.panelExisting = fresh;
        // R5：句柄缩放刚为该元素新建/命中标注 → 面板仍开着，随即抑制其持久框，
        // 避免与选中框重叠成双框（新鲜单击未标注元素后缩放的场景）。
        this.overlay.setSuppressedMark(fresh.id);
      }
    }
  };

  private positionPanel(): void {
    if (!this.panelEl || !this.panelTarget) return;
    if (!this.panelTarget.isConnected) {
      this.closePanel();
      return;
    }
    const anchor = this.panelTarget.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = this.panelEl;
    const pos = placeNear(anchor, w, h);
    // 用户拖过 → 在自动放置基准上叠加拖拽偏移，保持拖到的位置不回弹
    const left = pos.left + (this.panelDragOffset?.dx ?? 0);
    const top = pos.top + (this.panelDragOffset?.dy ?? 0);
    this.panelEl.style.left = `${left}px`;
    this.panelEl.style.top = `${top}px`;
  }

  /**
   * 顶部拖拽把手：克制的一条横向抓杆（建议3）。
   * 指针拖动改面板绝对位置，并记录相对"锚点自动放置基准"的偏移 dx/dy，
   * 供 scroll/resize 重定位（positionPanel）叠加，避免拖后回弹到锚点。
   */
  private buildPanelDragHandle(panel: HTMLElement): HTMLElement {
    const handle = document.createElement('div');
    handle.className = 'pd-panel-drag';
    handle.setAttribute('data-testid', 'pd-panel-drag');

    // 复用通用拖拽助手；onDrag 记录相对锚点自动放置基准的偏移，供 scroll/resize 重定位保持
    makeDraggableByHandle(panel, handle, (left, top) => {
      if (!this.panelTarget) return;
      const base = placeNear(
        this.panelTarget.getBoundingClientRect(),
        panel.offsetWidth,
        panel.offsetHeight
      );
      this.panelDragOffset = { dx: left - base.left, dy: top - base.top };
    });
    return handle;
  }

  // ---- 修改栏 + 高级样式区 ----

  /** 修改栏：按元素类型智能切换；陌生元素 = autonote + computed 自动列控件（「自动」角标） */
  private buildModbox(target: HTMLElement, elementType: ElementType, ctx: ControlContext): HTMLElement {
    const modbox = document.createElement('div');
    modbox.className = 'modbox';
    modbox.setAttribute('data-testid', 'pd-modbox');

    const head = document.createElement('div');
    head.className = 'modbox-h';
    head.textContent = t(modbarTitleKey(elementType));
    modbox.appendChild(head);

    const isAuto = elementType === 'other';
    if (isAuto) {
      const note = document.createElement('div');
      note.className = 'autonote';
      note.setAttribute('data-testid', 'pd-autonote');
      note.innerHTML = ICONS.info;
      note.appendChild(
        document.createTextNode(t('modbar_autonote').replace('{tag}', target.tagName.toLowerCase()))
      );
      modbox.appendChild(note);
    }

    const rows = isAuto ? autoModbarRows(target) : modbarRows(elementType);
    renderRows(modbox, this.session!, rows, ctx, { auto: isAuto });
    return modbox;
  }

  /** 高级样式折叠槽：收起 = .adv 行；展开 = .adv-head + advbox；切换走高度动画 */
  private buildAdvSlot(elementType: ElementType, ctx: ControlContext, modbox?: HTMLElement): HTMLElement {
    const slot = document.createElement('div');

    const renderCollapsed = (): void => {
      slot.innerHTML = '';
      if (modbox) modbox.style.display = ''; // 收起 → 恢复普通修改栏
      const adv = document.createElement('div');
      adv.className = 'adv';
      adv.setAttribute('data-testid', 'pd-adv-toggle');
      const title = document.createElement('span');
      title.textContent = t('adv_title');
      adv.appendChild(title);
      const r = document.createElement('span');
      r.className = 'r';
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent =
        elementType === 'other'
          ? t('adv_auto_meta')
          : ['adv_cat_typography', 'adv_cat_size', 'adv_cat_appearance', 'adv_cat_debug']
              .map((k) => t(k))
              .join(' · ');
      r.appendChild(meta);
      r.insertAdjacentHTML('beforeend', ICONS.chevR);
      adv.appendChild(r);
      adv.addEventListener('click', () => {
        this.animatePanelHeight(() => renderExpanded());
      });
      slot.appendChild(adv);
    };

    const renderExpanded = (): void => {
      slot.innerHTML = '';
      if (modbox) modbox.style.display = 'none'; // 展开 → 隐藏普通修改栏
      const head = document.createElement('div');
      head.className = 'adv-head';
      head.setAttribute('data-testid', 'pd-adv-toggle');
      const title = document.createElement('span');
      title.textContent = t('adv_title');
      head.appendChild(title);
      head.insertAdjacentHTML('beforeend', ICONS.chevD);
      head.addEventListener('click', () => {
        this.animatePanelHeight(() => renderCollapsed());
      });
      slot.appendChild(head);
      slot.appendChild(
        createAdvancedBox({
          session: this.session!,
          ctx,
          animate: (mutate) => this.animatePanelHeight(mutate),
        })
      );
    };

    renderCollapsed();
    return slot;
  }

  /**
   * 面板长度柔和动画（design-system §1.5 例外条款）：
   * 快照旧高 → 变更内容 → 设回旧高强制回流 → height:auto，
   * 由 interpolate-size: allow-keywords 完成 px→auto 的 190ms 过渡。
   */
  private animatePanelHeight(mutate: () => void): void {
    const panel = this.panelEl;
    if (!panel) {
      mutate();
      return;
    }
    animateHeight(panel, mutate, () => this.positionPanel());
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

    // 本次会话的样式修改（同属性已合并），并入已有记录
    const sessionChanges = this.session?.getChanges() ?? [];

    let saved: Annotation | undefined;
    if (this.panelExisting) {
      const before = this.panelExisting;
      const patch = {
        note,
        summary: getElementSummary(target),
        viewportPos,
        changes: mergeChanges(before.changes, sessionChanges),
      };
      saved = this.store.update(before.id, patch);
      if (saved) {
        const after = saved;
        this.history.push({
          label: 'annotation:update',
          apply: () => {
            applyChangesTo(this.resolveBySelector(after.selector), sessionChanges, 'new');
            this.store.update(after.id, {
              note: after.note,
              summary: after.summary,
              viewportPos: after.viewportPos,
              changes: after.changes,
            });
          },
          revert: () => {
            applyChangesTo(this.resolveBySelector(after.selector), sessionChanges, 'old');
            this.store.update(before.id, {
              note: before.note,
              summary: before.summary,
              viewportPos: before.viewportPos,
              changes: before.changes,
            });
          },
        });
      }
    } else {
      // 新建批注空内容守卫（逻辑13）：既无批注说明、又无任何样式修改 → 不落盘，
      // 轻提示并保持面板打开，让用户补充（不算"已保存"关闭）。
      if (!note && sessionChanges.length === 0) {
        this.toast.show(t('toast_empty_annotation'));
        return;
      }
      saved = this.store.add({
        selector: buildSelector(target),
        elementType: classifyElement(target),
        summary: getElementSummary(target),
        note,
        changes: sessionChanges,
        viewportPos,
      });
      const added = saved;
      this.history.push({
        label: 'annotation:add',
        apply: () => {
          applyChangesTo(this.resolveBySelector(added.selector), added.changes, 'new');
          this.store.restore(added);
        },
        revert: () => {
          applyChangesTo(this.resolveBySelector(added.selector), added.changes, 'old');
          this.store.remove(added.id);
        },
      });
    }

    this.panelCommitted = true;
    this.closePanel();

    // 卡片默认展开设置
    if (saved && this.settings.cardDefaultExpanded && !this.cards.has(saved.id)) {
      this.openCard(saved);
    }
  }

  closePanel(): void {
    if (!this.panelEl) return;
    this.escPop?.();
    this.escPop = undefined;
    closeAllPopovers();
    this.selbox.clear();
    // R5：恢复被抑制的持久标注框/位号（选中结束 → 双框风险消失）。
    this.overlay.setSuppressedMark(null);
    // 未保存 → 回滚本次会话的预览改动
    if (this.session && !this.panelCommitted) {
      this.session.rollback();
    }
    this.session = null;
    this.panelCommitted = false;
    this.panelDragOffset = null;
    this.panelEl.remove();
    this.panelEl = null;
    this.panelTarget = null;
    this.panelExisting = null;
  }

  /** 删除标注：回退其已保存的样式修改 + 移动 DOM 效果 + 移除记录 + 进撤销历史 */
  private deleteAnnotation(annotation: Annotation): void {
    // 删除移动过的元素时一并回退其移动 DOM 效果（transform），撤销时再复原到「移动态」，
    // 与清空（clear.ts）一致。重父移动（reparent）的元素靠 DOM 结构定位，不叠加 transform
    // （否则会在容器内二次偏移），保持嵌入现状即可。
    const move = annotation.move;
    const applyTransform = !!move && !move.reparent;

    const doDelete = (): void => {
      const el = this.resolveBySelector(annotation.selector);
      applyChangesTo(el, annotation.changes, 'old');
      if (applyTransform && el instanceof HTMLElement) el.style.transform = '';
      this.store.remove(annotation.id);
    };
    const undoDelete = (): void => {
      const el = this.resolveBySelector(annotation.selector);
      applyChangesTo(el, annotation.changes, 'new');
      if (applyTransform && move && el instanceof HTMLElement) {
        el.style.transform = `translate(${move.dx}px, ${move.dy}px)`;
      }
      this.store.restore(annotation);
    };

    doDelete();
    this.history.push({ label: 'annotation:delete', apply: doDelete, revert: undoDelete });
  }

  /** 按选择器唯一定位目标元素（定位不到返回 null，不乱改页面） */
  private resolveBySelector(selector: string): Element | null {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 ? matches[0] : null;
    } catch {
      return null;
    }
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

    // 下半：调整项区（有修改时显示，pd-diff 精简格式：原值 → 新值）
    // F21：富文本 DOM 还原载体（cssProp==='richtext'）不展示；富文本格式修改由 richText[] 呈现。
    const displayChanges = annotation.changes.filter((c) => c.cssProp !== RICHTEXT_DOM_CSSPROP);
    const richRows = annotation.richText ?? [];
    if (displayChanges.length > 0 || richRows.length > 0) {
      if (annotation.note) {
        const hr = document.createElement('div');
        hr.className = 'hr';
        card.appendChild(hr);
      }
      const mods = document.createElement('div');
      mods.className = 'mods';
      mods.setAttribute('data-testid', 'pd-card-mods');
      for (const change of displayChanges) {
        const row = document.createElement('div');
        row.className = 'mod';
        const k = document.createElement('span');
        k.className = 'k';
        const def = FIELD_DEFS[change.prop];
        // 富文本纯文本内容修改（cssProp='html'/'text'）/ 媒体替换（cssProp='src'）：友好标签 + 精简值
        const isHtml = change.cssProp === 'html';
        const isText = change.cssProp === 'text';
        const isSrc = change.cssProp === 'src';
        if (isHtml || isText) {
          k.textContent = t('rt_content_change');
        } else if (isSrc) {
          k.textContent = t('replace_media_change');
        } else {
          k.textContent = def ? t(def.labelKey) : change.prop;
        }
        row.appendChild(k);
        const diff = document.createElement('span');
        diff.className = 'pd-diff';
        const format = (v: string): string =>
          isHtml ? htmlToText(v) : isSrc ? srcSummary(v) : v;
        diff.appendChild(document.createTextNode(truncateValue(format(change.oldValue))));
        const arrow = document.createElement('i');
        arrow.textContent = '→';
        diff.appendChild(arrow);
        const to = document.createElement('b');
        to.textContent = truncateValue(format(change.newValue));
        diff.appendChild(to);
        row.appendChild(diff);
        mods.appendChild(row);
      }
      // 结构化富文本修改：每条一行预生成 summary（与导出/图卡共用同一措辞）
      for (const rc of richRows) {
        const row = document.createElement('div');
        row.className = 'mod';
        row.setAttribute('data-testid', 'pd-card-richtext');
        const line = document.createElement('span');
        line.className = 'pd-diff';
        line.textContent = rc.summary;
        row.appendChild(line);
        mods.appendChild(row);
      }
      card.appendChild(mods);
    }

    // 底栏：#位号·类型·位置 + 删除/修改
    const foot = document.createElement('div');
    foot.className = 'foot';

    const meta = document.createElement('span');
    meta.className = 'meta';
    const { x, y } = annotation.viewportPos;
    meta.textContent = metaText(annotation.number, annotation.elementType, x, y, annotation.kind === 'region');
    foot.appendChild(meta);

    const acts = document.createElement('span');
    acts.className = 'acts';

    const btnDelete = document.createElement('button');
    btnDelete.className = 'pd-iconbtn danger';
    btnDelete.setAttribute('data-testid', 'pd-card-delete');
    btnDelete.title = t('menu_delete_annotation');
    btnDelete.setAttribute('aria-label', t('menu_delete_annotation'));
    btnDelete.innerHTML = ICONS.trash;
    btnDelete.addEventListener('click', () => this.deleteAnnotation(annotation));
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

  /** 卡片放在被批注元素旁（不遮挡元素本体）；放不下画虚线连回位号圆 */
  private positionCard(open: OpenCard): void {
    // 锚点用元素完整外框（非 22px 位号圆），placeNear 右→下→左→上 均落在元素之外，
    // 保证被批注元素始终可见（批注展开不再遮挡元素）。
    const targetRect = this.overlay.getTargetRect(open.annotation.id);
    const pinRect = this.overlay.getPinRect(open.annotation.id);
    if (!targetRect || !pinRect) {
      // 目标元素消失 → 隐藏卡片（数据保留）
      open.el.style.display = 'none';
      this.removeConnector(open);
      return;
    }
    open.el.style.display = 'block';
    const { offsetWidth: w, offsetHeight: h } = open.el;
    const pos = placeNear(targetRect, w, h);
    open.el.style.left = `${pos.left}px`;
    open.el.style.top = `${pos.top}px`;

    if (!pos.fits) {
      // 兜底夹紧时，虚线仍连回位号圆（视觉锚点）
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
        // F20：内容变更引起卡片长度变化时走高度过渡（与面板一致），随后重定位
        animateHeight(
          open.el,
          () => this.renderCardContent(open.el, current),
          () => this.positionCard(open)
        );
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
      this.deleteAnnotation(annotation);
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
    // 区域批注（selector=''）不走 resolveBySelector，改路由回可编辑的区域面板（F16）
    if (annotation.kind === 'region') {
      this.closeMenu();
      this.regionEditor?.(annotation);
      return;
    }
    const target = this.resolveBySelector(annotation.selector);
    if (!target) return;
    // 编辑打开：以该标注目标作为粒度会话原始命中元素（+/- 从它起算）
    this.openPanel(target, annotation, target instanceof HTMLElement ? target : null);
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
