/* ============================================================
   overlay.ts — 页面覆盖层（渲染进 overlay 层）
   - 批注模式 hover：高亮框 + 元素标签（跟随鼠标）
   - 已保存标注：标注框 + 位号圆，跟随目标元素实时位置
   - 跟随机制：scroll/resize rAF 节流 + ResizeObserver/MutationObserver 兜底
   视觉配方：base.css（.pd-hover/.pd-hlabel/.pd-markbox/.pd-pin）
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, Annotation } from '../state/annotations';
import { Settings } from '../state/settings';

export interface OverlayHooks {
  onPinClick?: (annotation: Annotation, pinEl: HTMLElement) => void;
  onPinContextMenu?: (annotation: Annotation, pinEl: HTMLElement, ev: MouseEvent) => void;
}

/** 单条标注的覆盖 UI 记录 */
interface MarkEntry {
  annotation: Annotation;
  /** 解析到的目标元素（找不到为 null，数据保留、UI 隐藏） */
  target: Element | null;
  markbox: HTMLElement;
  pin: HTMLElement;
  resizeObserver: ResizeObserver | null;
}

/** 标注框相对目标元素外扩 3px（preview part 06：inset:-3px） */
const MARK_INSET = 3;
/** 位号圆相对标注框左上角偏移（preview part 06：left/top -11px） */
const PIN_OFFSET = 11;
/** hover 标签相对鼠标的偏移 */
const LABEL_OFFSET_X = 0;
const LABEL_OFFSET_Y = 26;

export class Overlay {
  private controller: Controller;
  private root: HTMLElement; // overlay 层根容器
  private settings: Settings;
  private hooks: OverlayHooks;
  private shadowHost: Element;

  // hover UI
  private hoverBox: HTMLElement;
  private hoverLabel: HTMLElement;
  private hoverTarget: Element | null = null;
  private mouse = { x: 0, y: 0 };
  private hoverActive = false;

  // 标注 UI
  private entries: Map<string, MarkEntry> = new Map();

  // 跟随机制
  private rafId: number | null = null;
  private mutationObserver: MutationObserver;
  private unsubscribeStore: () => void;
  private unsubscribeController: () => void;

  constructor(
    controller: Controller,
    store: AnnotationStore,
    overlayLayer: HTMLElement,
    settings: Settings,
    hooks: OverlayHooks = {}
  ) {
    this.controller = controller;
    this.root = overlayLayer;
    this.settings = settings;
    this.hooks = hooks;
    this.shadowHost = (overlayLayer.getRootNode() as ShadowRoot).host;

    // hover UI（常驻 DOM，display 切换）
    this.hoverBox = document.createElement('div');
    this.hoverBox.className = 'pd-hover';
    this.hoverBox.setAttribute('data-testid', 'pd-hover');
    this.hoverBox.style.display = 'none';
    this.root.appendChild(this.hoverBox);

    this.hoverLabel = document.createElement('div');
    this.hoverLabel.className = 'pd-hlabel';
    this.hoverLabel.setAttribute('data-testid', 'pd-hlabel');
    this.hoverLabel.style.display = 'none';
    this.root.appendChild(this.hoverLabel);

    // 订阅数据 → 同步标注 UI
    this.unsubscribeStore = store.subscribe((annotations) => this.syncMarks(annotations));
    this.syncMarks(store.getAll());

    // 订阅模式 → hover 开关
    this.unsubscribeController = controller.subscribe(() => this.syncHoverActive());
    this.syncHoverActive();

    // 跟随机制：scroll（捕获段，含嵌套滚动容器）/ resize → rAF 节流刷新
    window.addEventListener('scroll', this.scheduleRefresh, { capture: true, passive: true });
    window.addEventListener('resize', this.scheduleRefresh);

    // MutationObserver 兜底：页面结构/样式变化时刷新
    this.mutationObserver = new MutationObserver(this.scheduleRefresh);
    this.mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class', 'hidden'],
    });

    // hover 追踪
    window.addEventListener('mousemove', this.onMouseMove, true);
  }

  destroy(): void {
    this.unsubscribeStore();
    this.unsubscribeController();
    window.removeEventListener('scroll', this.scheduleRefresh, true);
    window.removeEventListener('resize', this.scheduleRefresh);
    window.removeEventListener('mousemove', this.onMouseMove, true);
    this.mutationObserver.disconnect();
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    for (const entry of this.entries.values()) {
      entry.resizeObserver?.disconnect();
      entry.markbox.remove();
      entry.pin.remove();
    }
    this.entries.clear();
    this.hoverBox.remove();
    this.hoverLabel.remove();
  }

  updateSettings(settings: Settings): void {
    this.settings = settings;
    if (!settings.hoverLabel) this.hoverLabel.style.display = 'none';
  }

  /** 未能定位目标元素的标注数（恢复后轻提示用） */
  getUnresolvedCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (!entry.target || !entry.target.isConnected) count++;
    }
    return count;
  }

  /** 某标注目标元素的当前视口矩形（面板/卡片定位用） */
  getTargetRect(annotationId: string): DOMRect | null {
    const entry = this.entries.get(annotationId);
    if (!entry?.target?.isConnected) return null;
    return entry.target.getBoundingClientRect();
  }

  /** 某标注位号圆的当前视口矩形（卡片/菜单锚点用，由目标矩形推算，不依赖渲染时序） */
  getPinRect(annotationId: string): DOMRect | null {
    const rect = this.getTargetRect(annotationId);
    if (!rect) return null;
    return new DOMRect(
      rect.left - MARK_INSET - PIN_OFFSET,
      rect.top - MARK_INSET - PIN_OFFSET,
      22,
      22
    );
  }

  // ---- hover ----

  private syncHoverActive(): void {
    const { expanded, mode } = this.controller.getState();
    this.hoverActive = expanded && mode === 'annotate';
    if (!this.hoverActive) this.clearHover();
  }

  private clearHover(): void {
    this.hoverTarget = null;
    this.hoverBox.style.display = 'none';
    this.hoverLabel.style.display = 'none';
  }

  /** 事件是否来自我们自己的 Shadow DOM UI */
  private isOwnUi(ev: Event): boolean {
    return ev.composedPath().includes(this.shadowHost);
  }

  private onMouseMove = (ev: MouseEvent): void => {
    if (!this.hoverActive) return;
    this.mouse = { x: ev.clientX, y: ev.clientY };

    if (this.isOwnUi(ev)) {
      this.clearHover();
      return;
    }

    const target = ev.target;
    if (
      !(target instanceof Element) ||
      target === document.documentElement ||
      target === document.body
    ) {
      this.clearHover();
      return;
    }

    this.hoverTarget = target;
    this.scheduleRefresh();
  };

  private renderHover(): void {
    const el = this.hoverTarget;
    if (!this.hoverActive || !el || !el.isConnected) {
      this.clearHover();
      return;
    }
    const rect = el.getBoundingClientRect();
    Object.assign(this.hoverBox.style, {
      display: 'block',
      left: `${rect.left - MARK_INSET}px`,
      top: `${rect.top - MARK_INSET}px`,
      width: `${rect.width + MARK_INSET * 2 - 3}px`, // 减边框宽度×2
      height: `${rect.height + MARK_INSET * 2 - 3}px`,
    });

    if (this.settings.hoverLabel) {
      this.hoverLabel.textContent = el.tagName.toLowerCase();
      // 跟随鼠标：默认在鼠标上方，贴近视口顶部时翻到下方
      let top = this.mouse.y - LABEL_OFFSET_Y;
      if (top < 4) top = this.mouse.y + 18;
      const left = Math.max(4, Math.min(this.mouse.x + LABEL_OFFSET_X, window.innerWidth - 60));
      Object.assign(this.hoverLabel.style, {
        display: 'block',
        left: `${left}px`,
        top: `${top}px`,
      });
    } else {
      this.hoverLabel.style.display = 'none';
    }
  }

  // ---- 标注框 + 位号圆 ----

  /** store 变化时按 id 差量同步 entries */
  private syncMarks(annotations: Annotation[]): void {
    const alive = new Set(annotations.map((a) => a.id));

    // 移除已删除的
    for (const [id, entry] of this.entries) {
      if (!alive.has(id)) {
        entry.resizeObserver?.disconnect();
        entry.markbox.remove();
        entry.pin.remove();
        this.entries.delete(id);
      }
    }

    // 新增/更新
    for (const annotation of annotations) {
      const existing = this.entries.get(annotation.id);
      if (existing) {
        existing.annotation = annotation;
      } else {
        this.entries.set(annotation.id, this.createEntry(annotation));
      }
    }

    this.scheduleRefresh();
  }

  private createEntry(annotation: Annotation): MarkEntry {
    const markbox = document.createElement('div');
    markbox.className = 'pd-markbox';
    markbox.setAttribute('data-testid', 'pd-markbox');
    markbox.setAttribute('data-number', String(annotation.number));
    markbox.style.display = 'none';
    this.root.appendChild(markbox);

    const pin = document.createElement('div');
    pin.className = 'pd-pin';
    pin.setAttribute('data-testid', 'pd-pin');
    pin.setAttribute('data-number', String(annotation.number));
    pin.textContent = String(annotation.number);
    pin.style.display = 'none';
    this.root.appendChild(pin);

    const entry: MarkEntry = {
      annotation,
      target: this.resolveTarget(annotation.selector),
      markbox,
      pin,
      resizeObserver: null,
    };

    pin.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.hooks.onPinClick?.(entry.annotation, pin);
    });
    pin.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      this.hooks.onPinContextMenu?.(entry.annotation, pin, ev);
    });

    this.observeTarget(entry);
    return entry;
  }

  private resolveTarget(selector: string): Element | null {
    try {
      const matches = document.querySelectorAll(selector);
      return matches.length === 1 ? matches[0] : null;
    } catch {
      return null;
    }
  }

  private observeTarget(entry: MarkEntry): void {
    entry.resizeObserver?.disconnect();
    entry.resizeObserver = null;
    if (entry.target) {
      const ro = new ResizeObserver(this.scheduleRefresh);
      ro.observe(entry.target);
      entry.resizeObserver = ro;
    }
  }

  // ---- 跟随刷新（rAF 节流） ----

  private scheduleRefresh = (): void => {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = null;
      this.refresh();
    });
  };

  private refresh(): void {
    for (const entry of this.entries.values()) {
      // 目标元素消失 → 尝试重新解析（页面重渲染后可能复原）
      if (!entry.target || !entry.target.isConnected) {
        entry.target = this.resolveTarget(entry.annotation.selector);
        this.observeTarget(entry);
      }

      const el = entry.target;
      if (!el || !el.isConnected || el.getClientRects().length === 0) {
        // 隐藏 UI，保留数据
        entry.markbox.style.display = 'none';
        entry.pin.style.display = 'none';
        continue;
      }

      const rect = el.getBoundingClientRect();
      const left = rect.left - MARK_INSET;
      const top = rect.top - MARK_INSET;
      Object.assign(entry.markbox.style, {
        display: 'block',
        left: `${left}px`,
        top: `${top}px`,
        width: `${rect.width + MARK_INSET * 2 - 3}px`, // 减边框宽度×2
        height: `${rect.height + MARK_INSET * 2 - 3}px`,
      });
      Object.assign(entry.pin.style, {
        display: 'flex',
        left: `${left - PIN_OFFSET}px`,
        top: `${top - PIN_OFFSET}px`,
      });
    }

    this.renderHover();
  }
}
