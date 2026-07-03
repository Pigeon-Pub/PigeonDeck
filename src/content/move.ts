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
  private guideEls: HTMLElement[] = [];
  private freeHintEl: HTMLElement | null = null;

  // 拖拽防误触阈值（settings.dragThreshold）：未达时长前不触发位移
  private moveArmed = false;
  private moveArmTimer: ReturnType<typeof setTimeout> | null = null;

  // 跟随刷新
  private rafId: number | null = null;

  private active = false;
  private unsubscribeController: () => void;

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

    // capture 段：移动模式接管 click/mousedown
    window.addEventListener('click', this.onClick, true);
    window.addEventListener('mousedown', this.onMouseDown, true);
    window.addEventListener('mousemove', this.onHoverMove, true);
    window.addEventListener('scroll', this.scheduleReposition, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleReposition);
  }

  destroy(): void {
    this.unsubscribeController();
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

    // 已有移动的偏移（transform 需在其基础上叠加本次拖拽，避免多次移动时跳回原点）
    const preDx = this.movePreExistingMove ? this.movePreExistingMove.dx : 0;
    const preDy = this.movePreExistingMove ? this.movePreExistingMove.dy : 0;

    this.clearGuides();

    if (this.moveFree) {
      // free move：原始位移，无吸附、无参考线，显 free hint
      this.moveDx = rawDx;
      this.moveDy = rawDy;
      this.moveSnapSemantic = null;
      this.selectedEl.style.transform = `translate(${preDx + rawDx}px, ${preDy + rawDy}px)`;
      this.showFreeHint();
    } else {
      this.hideFreeHint();
      // dragged 矩形 = 原始（含已有偏移的视口）矩形 + 本次原始位移
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
      this.selectedEl.style.transform = `translate(${preDx + this.moveDx}px, ${preDy + this.moveDy}px)`;
      if (snap.guides.length > 0) this.renderGuides(snap.guides);
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

    this.endMove();

    // 位移过小视为点击，不记录（保留选中）
    if (Math.abs(dx) < CLICK_SLOP && Math.abs(dy) < CLICK_SLOP) {
      el.style.transform = preMove ? `translate(${preMove.dx}px, ${preMove.dy}px)` : '';
      return;
    }

    if (!origRect) return;
    this.commitMove(el, dx, dy, free, snapSemantic, origRect, preMove);
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
   */
  private commitMove(
    el: HTMLElement,
    dx: number,
    dy: number,
    free: boolean,
    snapSemantic: string | null,
    origRect: DOMRect,
    preMove: MoveData | null
  ): void {
    const selector = buildSelector(el);
    const existing = this.store.getBySelector(selector);

    // 合并：若本次拖拽前已有 move，initialRect 沿用最初；否则用本次拖拽起点矩形
    const initialRect: ViewportPos = preMove ? preMove.initialRect : toViewportPos(origRect);
    // 累计位移 = 已有位移 + 本次位移
    const totalDx = (preMove ? preMove.dx : 0) + dx;
    const totalDy = (preMove ? preMove.dy : 0) + dy;

    const finalRect: ViewportPos = {
      x: Math.round(origRect.x + dx),
      y: Math.round(origRect.y + dy),
      w: Math.round(origRect.width),
      h: Math.round(origRect.height),
    };

    const newMove: MoveData = {
      dx: totalDx,
      dy: totalDy,
      initialRect,
      finalRect,
      snap: snapSemantic,
      freeMove: free,
    };

    // transform 新旧值（撤销/重做）
    const newTransform = `translate(${totalDx}px, ${totalDy}px)`;
    const oldTransform = preMove ? `translate(${preMove.dx}px, ${preMove.dy}px)` : '';

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
