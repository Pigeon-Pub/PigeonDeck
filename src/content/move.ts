/* ============================================================
   move.ts — MoveManager：移动模式选中 + 八向句柄缩放 + 拖拽移动
   蓝图 §4.3：
   - 单击选中 → 选中框 + 八向句柄
   - 句柄拖拽改尺寸 → StyleChange → 撤销历史（阶段 6a）
   - 元素本体拖拽移动 → transform:translate 预览 + 吸附参考线（阶段 6b）
     · 自动吸附到视口内可见块级元素（边缘/中心对齐，阈值 4px）
     · 参考线白/黑按页面背景亮度反色；显示对齐方位名称
     · Alt = free move（跳过吸附、无参考线、显 free hint）
     · 松手记 move 进标注（多次移动合并 initial→final），push 历史；不弹确认
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, StyleChange, MoveData, ViewportPos, mergeChanges } from '../state/annotations';
import { History } from '../state/history';
import { Settings } from '../state/settings';
import { SelectionResolver } from './selection';
import { buildSelector, isVisible } from '../shared/dom-utils';
import { snapDrag, Rect, Guide } from './snap';
import { pickDropTarget, pickInsertIndex, parseTranslate } from './embed';
import { t } from './i18n';

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

/** 吸附阈值（px，蓝图 §4.3） */
const SNAP_THRESHOLD = 4;
/** 位移小于此值视为点击（不记录移动，仅保留选中） */
const CLICK_SLOP = 2;
/** 候选块级元素上限（性能） */
const CANDIDATE_LIMIT = 20;
/** hover 高亮框相对目标外扩（与 overlay.ts 一致，preview part 06） */
const MARK_INSET = 3;

/** 语义标识 → i18n key */
function guideLabelKey(semantic: string): string {
  switch (semantic) {
    case 'align-left': return 'guide_align_left';
    case 'align-right': return 'guide_align_right';
    case 'align-top': return 'guide_align_top';
    case 'align-bottom': return 'guide_align_bottom';
    case 'align-center-h': return 'guide_align_center_h';
    case 'align-center-v': return 'guide_align_center_v';
    case 'align-x': return 'guide_align_x';
    case 'align-y': return 'guide_align_y';
    default: return 'guide_align_x';
  }
}

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

/** 应用样式变更到 HTMLElement（撤销/重做用） */
function applyChangesToEl(el: HTMLElement | null, changes: StyleChange[], dir: 'old' | 'new'): void {
  if (!el) return;
  for (const c of changes) {
    const value = dir === 'old' ? c.oldValue : c.newValue;
    el.style.setProperty(c.cssProp, value);
  }
}

/** DOMRect → snap.Rect（视口坐标） */
function toRect(r: DOMRect): Rect {
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

/** DOMRect → ViewportPos（整数） */
function toViewportPos(r: DOMRect): ViewportPos {
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}

/**
 * 页面背景亮度判定：亮背景返回 true（参考线用深色），暗背景返回 false（用浅色）。
 * 取 body computed backgroundColor，解析不出按亮处理。
 */
function isLightBackground(): boolean {
  const cs = window.getComputedStyle(document.body);
  const bg = cs.backgroundColor;
  const m = bg.match(/rgba?\(([^)]+)\)/);
  if (!m) return true;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  const [r, g, b, a] = [parts[0] ?? 255, parts[1] ?? 255, parts[2] ?? 255, parts[3] ?? 1];
  if (a === 0) return true; // 透明背景当亮处理
  // 相对亮度
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.5;
}

export class MoveManager {
  private controller: Controller;
  private store: AnnotationStore;
  private history: History;
  private resolver: SelectionResolver;
  private overlayLayer: HTMLElement;
  private settings: Settings;
  private shadowHost: Element;

  // 当前选中
  private selectedEl: HTMLElement | null = null;
  private selboxEl: HTMLElement | null = null;

  // hover 预览（未选中时鼠标悬浮 → 圆角高亮框，指向 click 将选中的元素）
  private hoverBoxEl: HTMLElement | null = null;
  private hoverTargetEl: HTMLElement | null = null;

  // 句柄缩放拖拽状态
  private dragging = false;
  private dragDir: HandleDir | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  private origW = 0;
  private origH = 0;

  // 本体移动拖拽状态（阶段 6b）
  private moving = false;
  private moveStartX = 0;
  private moveStartY = 0;
  private moveOrigRect: DOMRect | null = null; // 拖拽开始时元素视口矩形
  private moveDx = 0; // 最终吸附后位移（相对拖拽起点）
  private moveDy = 0;
  private moveFree = false; // 当前是否 free move（Alt）
  private moveSnapSemantic: string | null = null; // 最近一次吸附命中的语义（松手记录用）
  private movePreExistingMove: MoveData | null = null; // 拖拽前已有的 move 数据（合并用）
  private moveOrigInlineTransform = ''; // 拖拽前元素 inline transform（撤销复原 + 位移基准）
  private guideEls: HTMLElement[] = [];
  private freeHintEl: HTMLElement | null = null;

  // 拖放嵌入目标（默认拖拽，交互12）：指向拖放点下方可接收的容器
  private dropTargetEl: HTMLElement | null = null;
  private dropTargetBoxEl: HTMLElement | null = null;

  // 拖拽防误触阈值（settings.dragThreshold）：未达时长前不触发位移
  private moveArmed = false;
  private moveArmTimer: ReturnType<typeof setTimeout> | null = null;

  // 跟随刷新
  private rafId: number | null = null;

  private active = false;
  private unsubscribeController: () => void;
  private unsubscribeHistory: () => void;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    history: History;
    resolver: SelectionResolver;
    overlayLayer: HTMLElement;
    settings: Settings;
  }) {
    this.controller = opts.controller;
    this.store = opts.store;
    this.history = opts.history;
    this.resolver = opts.resolver;
    this.overlayLayer = opts.overlayLayer;
    this.settings = opts.settings;
    this.shadowHost = (opts.overlayLayer.getRootNode() as ShadowRoot).host;

    this.unsubscribeController = opts.controller.subscribe(() => this.syncActive());
    this.syncActive();

    // Bug1（显示15）：撤销/重做改动 el.style.transform 或重父后，选中框必须跟随。
    // scheduleReposition 原本只绑 scroll/resize；此处订阅 history，任一 push/undo/redo
    // 后重新按选中元素矩形定位选中框（元素已断连则清除选中）。
    this.unsubscribeHistory = opts.history.subscribe(() => this.scheduleReposition());

    // capture 段：移动模式接管 click/mousedown
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('mousemove', this.onHoverMove, true);
    window.addEventListener('scroll', this.scheduleReposition, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleReposition);
  }

  destroy(): void {
    this.unsubscribeController();
    this.unsubscribeHistory();
    window.removeEventListener('click', this.onClick, true);
    window.removeEventListener('mousedown', this.onMouseDown, true);
    window.removeEventListener('mousemove', this.onHoverMove, true);
    window.removeEventListener('scroll', this.scheduleReposition, true);
    window.removeEventListener('resize', this.scheduleReposition);
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.clearSelection();
  }

  // ---- 模式同步 ----

  private syncActive(): void {
    const { expanded, mode } = this.controller.getState();
    const next = expanded && mode === 'move';
    if (this.active && !next) {
      // 离开移动模式：清除选中
      this.clearSelection();
    }
    this.active = next;
  }

  private isOwnUi(ev: Event): boolean {
    return ev.composedPath().includes(this.shadowHost);
  }

  // ---- 事件处理 ----

  private onClick = (ev: MouseEvent): void => {
    if (!this.active || this.isOwnUi(ev)) return;

    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;

    // 排除 body/html（空白处点击 → 取消选中）
    if (target === document.body || target === document.documentElement) {
      this.clearSelection();
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    ev.preventDefault();
    ev.stopPropagation();

    // 若点击落在当前已选元素上（本体拖拽的 click 尾声）→ 不重新选中
    if (this.selectedEl && (target === this.selectedEl || this.selectedEl.contains(target))) {
      return;
    }

    // 解析选中目标
    const resolved = this.resolver.resolve(target);
    this.selectElement(resolved);
  };

  private onMouseDown = (ev: MouseEvent): void => {
    if (!this.active || this.isOwnUi(ev)) return;
    if (ev.target === document.body || ev.target === document.documentElement) return;

    // 阻止页面默认 mousedown（焦点/选区/链接等）
    ev.preventDefault();
    ev.stopPropagation();

    // 落在已选元素本体上 → 开始拖拽移动（句柄的 mousedown 已 stopPropagation 不到这）
    if (
      this.selectedEl &&
      ev.target instanceof Node &&
      (ev.target === this.selectedEl || this.selectedEl.contains(ev.target))
    ) {
      this.startMove(ev);
    }
  };

  // ---- 选中框 ----

  private selectElement(el: HTMLElement): void {
    this.clearSelection();
    this.selectedEl = el;
    this.renderSelbox();
  }

  private renderSelbox(): void {
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

  private clearSelection(): void {
    this.selboxEl?.remove();
    this.selboxEl = null;
    this.selectedEl = null;
    this.clearHover();
    this.clearDropTarget();
    if (this.dragging) {
      this.endDrag();
    }
    if (this.moving) {
      this.endMove();
    }
  }

  // ---- hover 预览（未选中/未拖拽时）----

  private onHoverMove = (ev: MouseEvent): void => {
    if (!this.active || this.dragging || this.moving) {
      this.clearHover();
      return;
    }
    if (this.isOwnUi(ev)) {
      this.clearHover();
      return;
    }
    const target = ev.target;
    if (
      !(target instanceof HTMLElement) ||
      target === document.body ||
      target === document.documentElement
    ) {
      this.clearHover();
      return;
    }
    // 指向 click 将实际选中的元素（应用当前粒度/偏移），与选中框一致
    const resolved = this.resolver.resolve(target);
    // 已选中的元素本身不再画 hover（已有句柄框）
    if (resolved === this.selectedEl) {
      this.clearHover();
      return;
    }
    this.hoverTargetEl = resolved;
    this.renderHover();
  };

  private renderHover(): void {
    const el = this.hoverTargetEl;
    if (!el || !el.isConnected) {
      this.clearHover();
      return;
    }
    const rect = el.getBoundingClientRect();
    if (!rect.width && !rect.height) {
      this.clearHover();
      return;
    }
    if (!this.hoverBoxEl) {
      const box = document.createElement('div');
      box.className = 'pd-hover';
      box.setAttribute('data-testid', 'pd-move-hover');
      this.overlayLayer.appendChild(box);
      this.hoverBoxEl = box;
    }
    // 与 overlay hover 一致：外扩 MARK_INSET，宽高减边框宽度×2（1.5px）
    this.hoverBoxEl.style.left = `${rect.left - MARK_INSET}px`;
    this.hoverBoxEl.style.top = `${rect.top - MARK_INSET}px`;
    this.hoverBoxEl.style.width = `${rect.width + MARK_INSET * 2 - 3}px`;
    this.hoverBoxEl.style.height = `${rect.height + MARK_INSET * 2 - 3}px`;
  }

  private clearHover(): void {
    this.hoverTargetEl = null;
    this.hoverBoxEl?.remove();
    this.hoverBoxEl = null;
  }

  private repositionSelbox(): void {
    if (!this.selboxEl || !this.selectedEl) return;
    if (!this.selectedEl.isConnected) {
      this.clearSelection();
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
      this.repositionSelbox();
      if (this.hoverTargetEl) this.renderHover();
    });
  };

  // ---- 句柄缩放拖拽（阶段 6a）----

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
    this.repositionSelbox();
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
    }

    this.endDrag();
  };

  private endDrag(): void {
    this.dragging = false;
    this.dragDir = null;
    window.removeEventListener('mousemove', this.onDragMove, true);
    window.removeEventListener('mouseup', this.onDragUp, true);
  }

  // ---- 本体拖拽移动（阶段 6b）----

  private startMove(ev: MouseEvent): void {
    if (!this.selectedEl) return;
    this.moving = true;
    this.moveStartX = ev.clientX;
    this.moveStartY = ev.clientY;
    this.moveDx = 0;
    this.moveDy = 0;
    this.moveFree = ev.altKey;
    this.moveSnapSemantic = null;
    this.moveOrigRect = this.selectedEl.getBoundingClientRect();
    this.moveOrigInlineTransform = this.selectedEl.style.transform;
    this.clearHover();

    // 记住已有 move（多次移动合并：保留最初 initialRect）
    const existing = this.store.getBySelector(buildSelector(this.selectedEl));
    this.movePreExistingMove = existing?.move ? { ...existing.move } : null;

    this.selectedEl.classList.add('pd-moving');

    // 拖拽防误触阈值（默认 0 = 立即启用，行为与既有一致）；>0 时延迟启用位移
    const threshold = this.settings.dragThreshold;
    this.moveArmed = threshold <= 0;
    if (!this.moveArmed) {
      this.moveArmTimer = setTimeout(() => {
        this.moveArmed = true;
        this.moveArmTimer = null;
      }, threshold);
    }

    window.addEventListener('mousemove', this.onMoveMove, { capture: true });
    window.addEventListener('mouseup', this.onMoveUp, { capture: true });
  }

  private onMoveMove = (ev: MouseEvent): void => {
    if (!this.moving || !this.selectedEl || !this.moveOrigRect) return;
    ev.preventDefault();
    ev.stopPropagation();

    // 未达防误触阈值：吞掉页面默认行为但不触发位移
    if (!this.moveArmed) return;

    this.moveFree = ev.altKey; // 实时监听 Alt
    const rawDx = ev.clientX - this.moveStartX;
    const rawDy = ev.clientY - this.moveStartY;

    // 位移基准 = 拖拽前 inline transform 的 translate 分量。
    // 普通连续位移时 = 上次 translate；嵌入后本次拖拽时 = 0（元素已由 DOM 定位），
    // 避免叠加历史位移导致跳位（交互12 混合场景）。
    const pre = parseTranslate(this.moveOrigInlineTransform);

    this.clearGuides();
    this.clearDropTarget();

    if (this.moveFree) {
      // free move：原始位移，无吸附、无参考线、无嵌入，显 free hint
      this.moveDx = rawDx;
      this.moveDy = rawDy;
      this.moveSnapSemantic = null;
      this.selectedEl.style.transform = `translate(${pre.x + rawDx}px, ${pre.y + rawDy}px)`;
      this.showFreeHint();
    } else {
      this.hideFreeHint();
      // dragged 矩形 = 拖拽起点视口矩形 + 本次原始位移
      const dragged: Rect = {
        left: this.moveOrigRect.left + rawDx,
        top: this.moveOrigRect.top + rawDy,
        width: this.moveOrigRect.width,
        height: this.moveOrigRect.height,
      };
      const candidates = this.collectCandidates();
      const snap = snapDrag(dragged, candidates, SNAP_THRESHOLD);
      this.moveDx = rawDx + snap.dx;
      this.moveDy = rawDy + snap.dy;
      this.moveSnapSemantic = snap.semantics.length > 0 ? snap.semantics[0] : null;
      this.selectedEl.style.transform = `translate(${pre.x + this.moveDx}px, ${pre.y + this.moveDy}px)`;
      // 参考线为次要对齐辅助；主行为是嵌入容器
      if (snap.guides.length > 0) this.renderGuides(snap.guides);
      // 交互12：检测拖放点下方可接收的容器并高亮
      this.renderDropTarget(this.findDropTarget(ev.clientX, ev.clientY));
    }

    this.repositionSelbox();
  };

  private onMoveUp = (ev: MouseEvent): void => {
    if (!this.moving || !this.selectedEl) return;
    ev.preventDefault();
    ev.stopPropagation();

    const el = this.selectedEl;
    const dx = this.moveDx;
    const dy = this.moveDy;
    const free = this.moveFree;
    const snapSemantic = this.moveSnapSemantic;
    const origRect = this.moveOrigRect;
    const preMove = this.movePreExistingMove;
    const origInlineTransform = this.moveOrigInlineTransform;
    // 仅默认（非 Alt）拖拽支持嵌入；捕获拖放点用于插入位置计算
    const dropTarget = free ? null : this.dropTargetEl;
    const dropX = ev.clientX;
    const dropY = ev.clientY;

    this.endMove();

    // 位移过小视为点击，不记录（保留选中）：复原拖拽前 transform
    if (Math.abs(dx) < CLICK_SLOP && Math.abs(dy) < CLICK_SLOP) {
      el.style.transform = origInlineTransform;
      return;
    }

    if (!origRect) return;

    if (dropTarget && dropTarget.isConnected && dropTarget !== el && !el.contains(dropTarget)) {
      // 交互12：拖放点上方有可接收容器 → 真正的 DOM 重父嵌入
      this.commitEmbed(el, dropTarget, dropX, dropY, origRect, preMove, origInlineTransform);
    } else {
      // 无嵌入目标 → 回退为 transform 位移（可预测：默认拖拽也保留自由重定位）
      this.commitMove(el, dx, dy, free, snapSemantic, origRect, preMove, origInlineTransform);
    }
  }

  private endMove(): void {
    this.moving = false;
    this.moveOrigRect = null;
    this.moveArmed = false;
    if (this.moveArmTimer !== null) {
      clearTimeout(this.moveArmTimer);
      this.moveArmTimer = null;
    }
    this.selectedEl?.classList.remove('pd-moving');
    this.clearGuides();
    this.clearDropTarget();
    this.hideFreeHint();
    window.removeEventListener('mousemove', this.onMoveMove, true);
    window.removeEventListener('mouseup', this.onMoveUp, true);
  }

  /**
   * 收集视口内可见块级元素矩形作吸附候选，排除自身/祖先/后代。
   * 上限 CANDIDATE_LIMIT。
   */
  private collectCandidates(): Rect[] {
    const self = this.selectedEl;
    if (!self) return [];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const out: Rect[] = [];

    const all = document.body.querySelectorAll<HTMLElement>('*');
    for (const el of all) {
      if (out.length >= CANDIDATE_LIMIT) break;
      if (el === self) continue;
      if (self.contains(el) || el.contains(self)) continue; // 排除祖先/后代
      if (this.shadowHost.contains(el)) continue; // 排除自身 UI
      if (!isVisible(el)) continue;
      const r = el.getBoundingClientRect();
      // 只取有意义尺寸、且在视口内可见的块
      if (r.width < 8 || r.height < 8) continue;
      if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
      out.push(toRect(r));
    }
    return out;
  }

  // ---- 拖放嵌入目标（交互12）----

  /**
   * 找拖放点下方可接收的容器：elementsFromPoint 命中栈 → 过滤为可见块级 HTMLElement
   * （排除 inline/隐藏）→ pickDropTarget 排除自身/祖先/后代/工具 UI，取最内层。
   */
  private findDropTarget(clientX: number, clientY: number): HTMLElement | null {
    const self = this.selectedEl;
    if (!self) return null;
    const stack = document.elementsFromPoint(clientX, clientY);
    const candidates: Element[] = [];
    for (const el of stack) {
      if (!(el instanceof HTMLElement)) continue;
      if (el === document.body || el === document.documentElement) continue;
      const disp = window.getComputedStyle(el).display;
      if (disp === 'inline' || disp === 'none' || disp === 'contents') continue;
      candidates.push(el);
    }
    const target = pickDropTarget(candidates, self, this.shadowHost);
    return target instanceof HTMLElement ? target : null;
  }

  private renderDropTarget(el: HTMLElement | null): void {
    this.dropTargetEl = el;
    if (!el) {
      this.dropTargetBoxEl?.remove();
      this.dropTargetBoxEl = null;
      return;
    }
    const rect = el.getBoundingClientRect();
    if (!this.dropTargetBoxEl) {
      const box = document.createElement('div');
      box.className = 'pd-drop-target';
      box.setAttribute('data-testid', 'pd-drop-target');
      this.overlayLayer.appendChild(box);
      this.dropTargetBoxEl = box;
    }
    this.dropTargetBoxEl.style.left = `${rect.left}px`;
    this.dropTargetBoxEl.style.top = `${rect.top}px`;
    this.dropTargetBoxEl.style.width = `${rect.width}px`;
    this.dropTargetBoxEl.style.height = `${rect.height}px`;
  }

  private clearDropTarget(): void {
    this.dropTargetEl = null;
    this.dropTargetBoxEl?.remove();
    this.dropTargetBoxEl = null;
  }

  /** 容器主轴是否水平（flex row / grid → 按 left 比较，否则按 top） */
  private isHorizontalFlow(container: HTMLElement): boolean {
    const cs = window.getComputedStyle(container);
    if (cs.display === 'flex' || cs.display === 'inline-flex') {
      return cs.flexDirection.startsWith('row');
    }
    if (cs.display === 'grid' || cs.display === 'inline-grid') return true;
    return false;
  }

  /** 按拖放点算插入参照节点（null = 追加到末尾）；排除被拖元素自身 */
  private computeInsertRef(container: HTMLElement, dragged: HTMLElement, clientX: number, clientY: number): Node | null {
    const horizontal = this.isHorizontalFlow(container);
    const children = Array.from(container.children).filter((c) => c !== dragged) as HTMLElement[];
    const starts = children.map((c) => {
      const r = c.getBoundingClientRect();
      return horizontal ? r.left : r.top;
    });
    const idx = pickInsertIndex(starts, horizontal ? clientX : clientY);
    return children[idx] ?? null;
  }

  // ---- 参考线渲染 ----

  private renderGuides(guides: Guide[]): void {
    const light = isLightBackground();
    // 反色：亮背景用深色线/标签，暗背景用浅色
    const lineColor = light ? '#23262e' : '#fdf6e6';

    let labelShown = false;
    for (const g of guides) {
      const line = document.createElement('div');
      line.className = `pd-guide ${g.orient}`;
      line.setAttribute('data-testid', 'pd-guide');
      if (g.orient === 'v') {
        line.style.left = `${g.pos}px`;
        line.style.top = `${g.start}px`;
        line.style.height = `${g.end - g.start}px`;
        line.style.borderLeftColor = lineColor;
      } else {
        line.style.top = `${g.pos}px`;
        line.style.left = `${g.start}px`;
        line.style.width = `${g.end - g.start}px`;
        line.style.borderTopColor = lineColor;
      }
      this.overlayLayer.appendChild(line);
      this.guideEls.push(line);

      // 只在第一条参考线旁显示语义标签（避免拥挤）
      if (!labelShown) {
        const label = document.createElement('div');
        label.className = 'pd-guide-label';
        label.setAttribute('data-testid', 'pd-guide-label');
        label.textContent = t(guideLabelKey(g.semantic));
        label.style.color = lineColor;
        if (g.orient === 'v') {
          label.style.left = `${g.pos + 6}px`;
          label.style.top = `${g.start}px`;
        } else {
          label.style.left = `${g.start}px`;
          label.style.top = `${g.pos + 6}px`;
        }
        this.overlayLayer.appendChild(label);
        this.guideEls.push(label);
        labelShown = true;
      }
    }
  }

  private clearGuides(): void {
    for (const el of this.guideEls) el.remove();
    this.guideEls = [];
  }

  private showFreeHint(): void {
    if (!this.selectedEl) return;
    const rect = this.selectedEl.getBoundingClientRect();
    if (!this.freeHintEl) {
      const hint = document.createElement('div');
      hint.className = 'pd-freehint';
      hint.setAttribute('data-testid', 'pd-freehint');
      hint.textContent = t('move_free_hint');
      this.overlayLayer.appendChild(hint);
      this.freeHintEl = hint;
    }
    // 显示在元素上方
    this.freeHintEl.style.left = `${rect.left}px`;
    this.freeHintEl.style.top = `${Math.max(0, rect.top - 22)}px`;
  }

  private hideFreeHint(): void {
    this.freeHintEl?.remove();
    this.freeHintEl = null;
  }

  // ---- 提交移动 ----

  /**
   * 松手后记录移动：多次移动合并（保留最初 initialRect，只更新 dx/dy/finalRect/snap）。
   * 撤销/重做用 el.style.transform 复原（参照句柄缩放 commitChanges）。
   * 位移基准取拖拽前 inline transform（嵌入后再拖拽时 = 0），dx/dy 记为 initial→final 净位移。
   */
  private commitMove(
    el: HTMLElement,
    dx: number,
    dy: number,
    free: boolean,
    snapSemantic: string | null,
    origRect: DOMRect,
    preMove: MoveData | null,
    origInlineTransform: string
  ): void {
    const selector = buildSelector(el);
    const existing = this.store.getBySelector(selector);

    // 合并：若本次拖拽前已有 move，initialRect 沿用最初；否则用本次拖拽起点矩形
    const initialRect: ViewportPos = preMove ? preMove.initialRect : toViewportPos(origRect);

    const finalRect: ViewportPos = {
      x: Math.round(origRect.x + dx),
      y: Math.round(origRect.y + dy),
      w: Math.round(origRect.width),
      h: Math.round(origRect.height),
    };

    const newMove: MoveData = {
      // 净视觉位移（initial→final），对纯 translate 等于 transform 值，对嵌入后微调亦自洽
      dx: finalRect.x - initialRect.x,
      dy: finalRect.y - initialRect.y,
      initialRect,
      finalRect,
      snap: snapSemantic,
      freeMove: free,
      // 保留既有嵌入上下文（嵌入后再自由微调时不丢失结构信息）
      reparent: preMove?.reparent,
    };

    // transform 新旧值（撤销/重做）：基准取拖拽前 inline transform，叠加本次位移
    const pre = parseTranslate(origInlineTransform);
    const newTransform = `translate(${pre.x + dx}px, ${pre.y + dy}px)`;
    const oldTransform = origInlineTransform;

    const applyTransform = (sel: string, transform: string): void => {
      const target = resolveTarget(sel);
      if (target) target.style.transform = transform;
    };

    if (existing) {
      const before = existing;
      const beforeMove = before.move ?? null;
      const after = this.store.update(before.id, { move: newMove });
      if (after) {
        const afterSnap = after;
        this.history.push({
          label: 'move:translate',
          apply: () => {
            applyTransform(afterSnap.selector, newTransform);
            this.store.update(afterSnap.id, { move: newMove });
          },
          revert: () => {
            applyTransform(afterSnap.selector, oldTransform);
            this.store.update(before.id, { move: beforeMove ?? undefined });
          },
        });
      }
    } else {
      const added = this.store.add({
        selector,
        elementType: 'container',
        summary: el.tagName.toLowerCase(),
        note: '',
        changes: [],
        viewportPos: toViewportPos(origRect),
        move: newMove,
      });
      const addedSnap = added;
      this.history.push({
        label: 'move:translate',
        apply: () => {
          applyTransform(addedSnap.selector, newTransform);
          this.store.restore(addedSnap);
        },
        revert: () => {
          applyTransform(addedSnap.selector, oldTransform);
          this.store.remove(addedSnap.id);
        },
      });
    }
  }

  /**
   * 交互12（Bug3）：默认拖拽把元素真正嵌入目标容器（DOM 重父）。
   * - 重父到目标容器、按拖放点插到最近子项前（否则追加），清空 transform（自然排布）。
   * - 撤销/重做用「捕获的元素引用」（抗选择器漂移）：revert 放回原父 + 原 transform，
   *   apply 重插目标容器 + 清 transform；两向都同步标注 selector 到元素当下位置。
   */
  private commitEmbed(
    el: HTMLElement,
    container: HTMLElement,
    clientX: number,
    clientY: number,
    origRect: DOMRect,
    preMove: MoveData | null,
    origInlineTransform: string
  ): void {
    const fromSelector = buildSelector(el); // 重父前选择器（当下位置）
    const toSelector = buildSelector(container); // 目标容器选择器（拖前 DOM，稳定）
    const existing = this.store.getBySelector(fromSelector);

    // 撤销用：捕获原始 DOM 位置（元素引用，不受选择器漂移影响）
    const originalParent = el.parentElement;
    if (!originalParent) return;
    const originalNextSibling = el.nextSibling;

    // 插入参照（重父前按拖放点计算）
    const insertRef = this.computeInsertRef(container, el, clientX, clientY);

    // 执行重父 + 清 transform（元素在容器内自然排布）
    container.insertBefore(el, insertRef);
    el.style.transform = '';
    this.repositionSelbox();

    const finalDomRect = el.getBoundingClientRect();
    const finalRect = toViewportPos(finalDomRect);
    const initialRect: ViewportPos = preMove ? preMove.initialRect : toViewportPos(origRect);
    const newSelector = buildSelector(el); // 重父后新位置选择器
    // 导出用原始选择器：优先沿用既有嵌入的 fromSelector（多次嵌入保留最初来源）
    const reparentFrom = preMove?.reparent?.fromSelector ?? fromSelector;

    const move: MoveData = {
      dx: finalRect.x - initialRect.x, // 纯嵌入的 dx/dy 记为视觉净位移（结构以 reparent 为准）
      dy: finalRect.y - initialRect.y,
      initialRect,
      finalRect,
      snap: null,
      freeMove: false,
      reparent: { fromSelector: reparentFrom, toSelector },
    };

    // 元素引用重插（插入参照失效时兜底 append）
    const reinsertInto = (parent: Element, ref: Node | null): void => {
      if (ref && ref.parentNode === parent) parent.insertBefore(el, ref);
      else parent.appendChild(el);
    };

    if (existing) {
      const before = existing;
      const beforeMove = before.move ?? null;
      const beforeSelector = before.selector;
      const after = this.store.update(before.id, { move, selector: newSelector });
      if (after) {
        this.history.push({
          label: 'move:embed',
          apply: () => {
            reinsertInto(container, insertRef);
            el.style.transform = '';
            this.store.update(before.id, { move, selector: buildSelector(el) });
          },
          revert: () => {
            reinsertInto(originalParent, originalNextSibling);
            el.style.transform = origInlineTransform;
            this.store.update(before.id, { move: beforeMove ?? undefined, selector: beforeSelector });
          },
        });
      }
    } else {
      const added = this.store.add({
        selector: newSelector,
        elementType: 'container',
        summary: el.tagName.toLowerCase(),
        note: '',
        changes: [],
        viewportPos: toViewportPos(origRect),
        move,
      });
      const addedSnap = added;
      this.history.push({
        label: 'move:embed',
        apply: () => {
          reinsertInto(container, insertRef);
          el.style.transform = '';
          this.store.restore({ ...addedSnap, selector: buildSelector(el) });
        },
        revert: () => {
          reinsertInto(originalParent, originalNextSibling);
          el.style.transform = origInlineTransform;
          this.store.remove(addedSnap.id);
        },
      });
    }
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
            applyChangesToEl(this.resolveEl(afterSnap.selector), changes, 'new');
            this.store.update(afterSnap.id, { changes: afterSnap.changes });
          },
          revert: () => {
            applyChangesToEl(this.resolveEl(afterSnap.selector), changes, 'old');
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
          applyChangesToEl(this.resolveEl(addedSnap.selector), changes, 'new');
          this.store.restore(addedSnap);
        },
        revert: () => {
          applyChangesToEl(this.resolveEl(addedSnap.selector), changes, 'old');
          this.store.remove(addedSnap.id);
        },
      });
    }
  }

  private resolveEl(selector: string): HTMLElement | null {
    return resolveTarget(selector);
  }
}
