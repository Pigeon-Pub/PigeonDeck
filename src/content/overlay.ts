/* ============================================================
   overlay.ts — 页面覆盖层（渲染进 overlay 层）
   - 批注模式 hover：高亮框 + 元素标签（跟随鼠标）
   - 已保存标注：标注框 + 位号圆，跟随目标元素实时位置
   - 跟随机制：scroll/resize rAF 节流 + ResizeObserver/MutationObserver 兜底
   视觉配方：base.css（.pd-hover/.pd-hlabel/.pd-markbox/.pd-pin）
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, Annotation, RegionData } from '../state/annotations';
import { Settings } from '../state/settings';

export interface OverlayHooks {
  onPinClick?: (annotation: Annotation, pinEl: HTMLElement) => void;
  onPinContextMenu?: (annotation: Annotation, pinEl: HTMLElement, ev: MouseEvent) => void;
}

/** 单条标注的覆盖 UI 记录 */
interface MarkEntry {
  annotation: Annotation;
  /** 解析到的目标元素（找不到为 null，数据保留、UI 隐藏）；区域标注始终为 null */
  target: Element | null;
  markbox: HTMLElement;
  pin: HTMLElement;
  resizeObserver: ResizeObserver | null;
  /** 标注类型：true = 区域标注 */
  isRegion: boolean;
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
  /** 批注模式当前选中元素取值器（main.ts 注入 PanelManager.getSelectedTarget）：
      hover 命中已选元素时跳过高亮，避免与选中框/八句柄重叠（F6，对齐移动模式）。 */
  private getSelected: (() => Element | null) | null = null;

  // hover UI
  private hoverBox: HTMLElement;
  private hoverLabel: HTMLElement;
  private hoverTarget: Element | null = null;
  private mouse = { x: 0, y: 0 };
  private hoverActive = false;

  // 标注 UI
  private entries: Map<string, MarkEntry> = new Map();
  /** 被抑制持久标注框/位号的标注 id（R5）：该标注正被单击选中编辑时置为其 id，
      refresh 跳过绘制它自己的框/位号，避免与八句柄选中框重叠成双框；null = 无抑制。 */
  private suppressedMarkId: string | null = null;

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
    // 渲染进 overlay 层（z-2）：位于面板（z-3）与工具盘（z-4）之下，故 hover 高亮/标签
    // 不再遮挡工具盘/面板（F5）；仍高于页面内容，正常页面元素上照常可见。
    // pointer-events:none 保证不拦截交互。
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

    // Bug3（显示17）：指针离开文档/窗口时清除 hover 金框，避免最后一格高亮滞留
    // （鼠标移出视口时看起来「整页变黄」）。mouseleave 绑 document（E2E 可 dispatch）；
    // window blur 兜底焦点丢失；mouseout(relatedTarget==null) 兜底离开窗口（元素间正常
    // 移动 relatedTarget 非空，不误清）。
    document.addEventListener('mouseleave', this.onDocumentLeave);
    window.addEventListener('blur', this.onDocumentLeave);
    window.addEventListener('mouseout', this.onWindowMouseOut, true);
  }

  destroy(): void {
    this.unsubscribeStore();
    this.unsubscribeController();
    window.removeEventListener('scroll', this.scheduleRefresh, true);
    window.removeEventListener('resize', this.scheduleRefresh);
    window.removeEventListener('mousemove', this.onMouseMove, true);
    document.removeEventListener('mouseleave', this.onDocumentLeave);
    window.removeEventListener('blur', this.onDocumentLeave);
    window.removeEventListener('mouseout', this.onWindowMouseOut, true);
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

  /** 注入「批注模式当前选中元素」取值器（main.ts 在 PanelManager 建好后调用，F6）。 */
  setSelectedGetter(getter: () => Element | null): void {
    this.getSelected = getter;
  }

  /**
   * 抑制/恢复某条标注自己的持久标注框 + 位号（R5，PanelManager 在打开/关闭面板时调用）。
   * 单击已标注元素重新选中它时，面板 + 八句柄选中框会出现；此时隐藏该标注自己的持久框，
   * 避免持久框与选中框重叠成双框（其余标注的框照常）。传 null 恢复（面板关闭/切换选中时）。
   */
  setSuppressedMark(id: string | null): void {
    if (this.suppressedMarkId === id) return;
    this.suppressedMarkId = id;
    this.scheduleRefresh();
  }

  /** 未能定位目标元素的标注数（恢复后轻提示用）；区域标注始终可定位，不计入 */
  getUnresolvedCount(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.isRegion) continue;
      if (entry.annotation.deleted && entry.annotation.deletion) continue;
      if (!entry.target || !entry.target.isConnected) count++;
    }
    return count;
  }

  /** 某标注目标元素的当前视口矩形（面板/卡片定位用） */
  getTargetRect(annotationId: string): DOMRect | null {
    const entry = this.entries.get(annotationId);
    if (!entry) return null;
    // 区域标注：根据 docRect 计算当前视口矩形
    if (entry.isRegion && entry.annotation.region) {
      const region = entry.annotation.region;
      const { docRect } = region;
      const { dx, dy } = this.regionScrollOffset(region);
      return new DOMRect(docRect.x - dx, docRect.y - dy, docRect.w, docRect.h);
    }
    if (entry.target?.isConnected) return entry.target.getBoundingClientRect();
    if (entry.annotation.deleted && entry.annotation.deletion) {
      const { docRect } = entry.annotation.deletion;
      return new DOMRect(
        docRect.x - window.scrollX,
        docRect.y - window.scrollY,
        docRect.w,
        docRect.h
      );
    }
    return null;
  }

  /** 某标注位号圆的当前视口矩形（卡片/菜单锚点用，由目标矩形推算，不依赖渲染时序） */
  getPinRect(annotationId: string): DOMRect | null {
    const entry = this.entries.get(annotationId);
    if (!entry) return null;
    // 区域标注：pin 贴区域左上角
    if (entry.isRegion && entry.annotation.region) {
      const region = entry.annotation.region;
      const { docRect } = region;
      const { dx, dy } = this.regionScrollOffset(region);
      const vpX = docRect.x - dx;
      const vpY = docRect.y - dy;
      return new DOMRect(vpX - PIN_OFFSET, vpY - PIN_OFFSET, 22, 22);
    }
    const rect = this.getTargetRect(annotationId);
    if (!rect) return null;
    return new DOMRect(
      rect.left - MARK_INSET - PIN_OFFSET,
      rect.top - MARK_INSET - PIN_OFFSET,
      22,
      22
    );
  }

  /**
   * 区域标注的视口偏移 = window 滚动 + 嵌套滚动容器的滚动增量。
   * 顶层滚动时（无 scrollSelector）退化为纯 window 滚动（旧行为，无回归）。
   * 嵌套滚动容器内的区域：加上「祖先当前滚动 − 创建时滚动」，使框随内层内容移动。
   * 祖先选择器失效（找不到/非法）时回退纯 window 滚动。
   */
  private regionScrollOffset(region: RegionData): { dx: number; dy: number } {
    let dx = window.scrollX;
    let dy = window.scrollY;
    if (region.scrollSelector) {
      try {
        const scroller = document.querySelector(region.scrollSelector);
        if (scroller) {
          dx += scroller.scrollLeft - (region.scrollLeft ?? 0);
          dy += scroller.scrollTop - (region.scrollTop ?? 0);
        }
      } catch {
        // 选择器非法：回退纯 window 滚动
      }
    }
    return { dx, dy };
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

  /** 指针离开文档 / 窗口失焦：清除 hover 高亮（Bug3 显示17） */
  private onDocumentLeave = (): void => {
    this.clearHover();
  };

  /** mouseout 兜底：仅当指针离开窗口（relatedTarget 为 null）才清，避免元素间移动误清 */
  private onWindowMouseOut = (ev: MouseEvent): void => {
    if (ev.relatedTarget === null) this.clearHover();
  };

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

    // F6：hover 命中批注模式已选中的元素时不再画高亮框（已有选中框 + 八句柄），
    // 与移动模式一致（move.ts：resolved === selectedEl → clearHover）。
    if (this.getSelected && this.getSelected() === target) {
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
    const isRegion = annotation.kind === 'region';

    // 区域标注：用 .pd-region 框；元素标注：用 .pd-markbox
    const markbox = document.createElement('div');
    if (isRegion) {
      markbox.className = 'pd-region';
      markbox.setAttribute('data-testid', 'pd-region');
    } else {
      markbox.className = 'pd-markbox';
      markbox.setAttribute('data-testid', 'pd-markbox');
    }
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
      target: isRegion ? null : this.resolveTarget(annotation.selector),
      markbox,
      pin,
      resizeObserver: null,
      isRegion,
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

    // 区域标注不需要 ResizeObserver
    if (!isRegion) {
      this.observeTarget(entry);
    }
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
      // R5：该标注正被选中编辑（面板 + 八句柄框已出现）→ 隐藏它自己的持久框/位号，
      // 避免与选中框重叠成双框；恢复由 setSuppressedMark(null) 触发下一次 refresh 重画。
      if (entry.annotation.id === this.suppressedMarkId) {
        entry.markbox.style.display = 'none';
        entry.pin.style.display = 'none';
        continue;
      }

      if (entry.isRegion) {
        // 区域标注：按 docRect − 视口偏移重定位，始终可见。
        // 视口偏移含嵌套滚动容器增量，故内层容器滚动时框也跟随。
        const regionData = entry.annotation.region;
        if (!regionData) continue;
        const { docRect } = regionData;
        const { dx, dy } = this.regionScrollOffset(regionData);
        const vpX = docRect.x - dx;
        const vpY = docRect.y - dy;
        Object.assign(entry.markbox.style, {
          display: 'block',
          left: `${vpX}px`,
          top: `${vpY}px`,
          width: `${docRect.w}px`,
          height: `${docRect.h}px`,
        });
        Object.assign(entry.pin.style, {
          display: 'flex',
          left: `${vpX - PIN_OFFSET}px`,
          top: `${vpY - PIN_OFFSET}px`,
        });
        continue;
      }

      // 元素标注：目标元素消失 → 尝试重新解析（页面重渲染后可能复原）
      if (!entry.target || !entry.target.isConnected) {
        entry.target = this.resolveTarget(entry.annotation.selector);
        this.observeTarget(entry);
      }

      const rect = this.getTargetRect(entry.annotation.id);
      if (!rect || rect.width === 0 || rect.height === 0) {
        // 隐藏 UI，保留数据
        entry.markbox.style.display = 'none';
        entry.pin.style.display = 'none';
        continue;
      }

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
