/* ============================================================
   capture.ts — 阶段 9a 截图拼接管线
   纯函数（computeCaptureRange / planScreens）可单测；
   captureStitched / CopyImageManager 有 DOM/chrome 依赖，不单测。
   视觉来源：preview/parts/38-output-image.html（.opanel-img .shot-wrap .shot .ofoot）
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, Annotation } from '../state/annotations';
import { Settings } from '../state/settings';
import { Toast } from './toast';
import { t } from './i18n';

// ============================================================
// 纯函数 + 数据类型（可单测）
// ============================================================

/** 文档坐标矩形（x/y 相对文档左上角，px） */
export interface DocRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 计算出的截图范围（文档坐标） */
export interface CaptureRange {
  /** 范围顶端 y（文档坐标，已 clamp ≥0） */
  top: number;
  /** 范围高度（px，已 clamp ≤maxHeight） */
  height: number;
  /** 范围宽度（px，通常等于文档宽或视口宽） */
  width: number;
  /** 是否因 maxHeight 截断 */
  truncated: boolean;
}

/** 单张截图拼接的最大高度（超出截断） */
export const MAX_CAPTURE_HEIGHT = 14000;

/**
 * 纯函数：由文档坐标矩形列表计算长图截图范围。
 * @param rects     所有标注元素的文档坐标矩形（空数组时返回 height:0）
 * @param padding   上下额外留白（px）
 * @param maxHeight 最大允许高度（默认 MAX_CAPTURE_HEIGHT）
 * @param docWidth  文档/视口宽度（由调用方传入，保持函数纯净）
 */
export function computeCaptureRange(
  rects: DocRect[],
  padding: number,
  maxHeight: number,
  docWidth: number
): CaptureRange {
  if (rects.length === 0) {
    return { top: 0, height: 0, width: docWidth, truncated: false };
  }
  const minY = Math.min(...rects.map((r) => r.y)) - padding;
  const maxY = Math.max(...rects.map((r) => r.y + r.h)) + padding;
  const top = Math.max(0, minY);
  let height = Math.max(0, maxY - top);
  let truncated = false;
  if (height > maxHeight) {
    height = maxHeight;
    truncated = true;
  }
  return { top, height, width: docWidth, truncated };
}

/**
 * 纯函数：由截图范围和视口高度计算需要滚动到的 scrollY 序列。
 * 末屏 scrollY 对齐范围底（使最后一张截图的底部恰好覆盖 rangeBottom）。
 * @param rangeTop   截图范围顶端（文档 Y）
 * @param rangeHeight 截图范围高度
 * @param viewportH  当前视口高度
 * @returns scrollY 数组（从上到下）
 */
export function planScreens(
  rangeTop: number,
  rangeHeight: number,
  viewportH: number
): number[] {
  if (rangeHeight <= 0 || viewportH <= 0) return [];
  if (rangeHeight <= viewportH) {
    // 单屏：滚到范围顶部
    return [Math.max(0, rangeTop)];
  }
  const rangeBottom = rangeTop + rangeHeight;
  const screens: number[] = [];
  let y = rangeTop;
  // 逐屏向下，直到剩余部分不足一屏
  while (y + viewportH < rangeBottom) {
    screens.push(y);
    y += viewportH;
  }
  // 末屏：对齐范围底
  const lastY = Math.max(0, rangeBottom - viewportH);
  if (screens.length === 0 || screens[screens.length - 1] !== lastY) {
    screens.push(lastY);
  }
  return screens;
}

// ============================================================
// 叠加绘制坐标（阶段 9b，纯函数可单测）
// ============================================================

/** 标注框相对目标元素外扩（overlay.ts MARK_INSET） */
export const MARK_INSET = 3;
/** 位号圆相对标注框左上角偏移（overlay.ts PIN_OFFSET） */
export const PIN_OFFSET = 11;
/** 位号圆直径（pigeonlib .pd-pin 22px） */
export const PIN_DIAMETER = 22;

/** 叠加元素在拼接 canvas 上的布局（canvas 坐标 = CSS px） */
export interface OverlayLayout {
  /** 标注框/区域框矩形（canvas 坐标） */
  box: { x: number; y: number; w: number; h: number };
  /** 位号圆左上角 + 直径（canvas 坐标） */
  pin: { x: number; y: number; d: number };
}

/**
 * 纯函数：把标注的文档坐标矩形换算到拼接 canvas 坐标。
 * canvas 与截图同为 CSS px，坐标 = 文档坐标 − range.top（Y 方向）。
 * @param docRect 文档坐标矩形
 * @param range   截图范围（提供 top 偏移）
 * @param inset   框相对元素外扩量（元素=MARK_INSET，区域=0）
 */
export function layoutOverlay(
  docRect: DocRect,
  range: CaptureRange,
  inset: number
): OverlayLayout {
  const bx = docRect.x - inset;
  const by = docRect.y - range.top - inset;
  const bw = docRect.w + inset * 2;
  const bh = docRect.h + inset * 2;
  return {
    box: { x: bx, y: by, w: bw, h: bh },
    pin: { x: bx - PIN_OFFSET, y: by - PIN_OFFSET, d: PIN_DIAMETER },
  };
}

// ============================================================
// 运行时辅助（有 DOM/chrome 依赖，不单测）
// ============================================================

/** 一个待叠加绘制的标注项（运行时收集，含文档坐标） */
interface OverlayItem {
  number: number;
  kind: 'element' | 'region';
  /** 主框：元素标注框 / 区域框；被移动元素时 = 初始（源）位置 */
  box: DocRect;
  /** 移动预览幽灵框（最终位置），仅被移动元素存在 */
  ghost?: DocRect;
}

/**
 * 收集所有标注的文档坐标叠加项（运行时，有 DOM 访问）。
 * 元素标注取实时 getBoundingClientRect（含 transform 预览 = 最终位置）；
 * 被移动元素反推初始位置 = 最终 − (dx, dy)，最终位置作为幽灵框。
 */
function collectOverlayItems(annotations: Annotation[]): OverlayItem[] {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const items: OverlayItem[] = [];

  for (const a of annotations) {
    // 区域标注：docRect 本身已是文档坐标
    if (a.kind === 'region' && a.region) {
      const r = a.region.docRect;
      if (r.w > 0 && r.h > 0) {
        items.push({ number: a.number, kind: 'region', box: { x: r.x, y: r.y, w: r.w, h: r.h } });
      }
      continue;
    }

    // 元素标注：优先实时 DOM 位置，回退 viewportPos
    let rect: DocRect | null = null;
    try {
      const el = document.querySelector(a.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          rect = { x: r.left + sx, y: r.top + sy, w: r.width, h: r.height };
        }
      }
    } catch {
      // 无效 selector：静默忽略，走 fallback
    }
    if (!rect) {
      const vp = a.viewportPos;
      if (vp.w > 0 && vp.h > 0) rect = { x: vp.x + sx, y: vp.y + sy, w: vp.w, h: vp.h };
    }
    if (!rect) continue;

    if (a.move) {
      // rect（实时）= 应用 transform 后的最终位置；初始位置 = 最终 − 累计位移
      const finalRect = rect;
      const initialRect: DocRect = {
        x: finalRect.x - a.move.dx,
        y: finalRect.y - a.move.dy,
        w: finalRect.w,
        h: finalRect.h,
      };
      items.push({ number: a.number, kind: 'element', box: initialRect, ghost: finalRect });
    } else {
      items.push({ number: a.number, kind: 'element', box: rect });
    }
  }

  return items;
}

/** OverlayItem 列表铺平为范围计算用的矩形（含幽灵框） */
function itemsToRects(items: OverlayItem[]): DocRect[] {
  const rects: DocRect[] = [];
  for (const it of items) {
    rects.push(it.box);
    if (it.ghost) rects.push(it.ghost);
  }
  return rects;
}

// ---- Canvas 叠加绘制（有 canvas 依赖，不单测；坐标换算复用 layoutOverlay） ----

/** 邮政金（pigeonlib --c1 亮色值，截图为页面故用亮色） */
const GOLD = '#b8842c';
const GOLD_SOFT = 'rgba(184,132,44,0.12)';
const PIN_SHADOW = 'rgba(120,84,20,0.5)';
const PIN_FONT = '600 12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** 圆角矩形路径 */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

/** 画位号圆（金底白字 + 阴影，贴框左上角） */
function drawPin(ctx: CanvasRenderingContext2D, pin: OverlayLayout['pin'], num: number): void {
  const cx = pin.x + pin.d / 2;
  const cy = pin.y + pin.d / 2;
  const r = pin.d / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = GOLD;
  ctx.shadowColor = PIN_SHADOW;
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.fillStyle = '#fff';
  ctx.font = PIN_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(num), cx, cy);
  ctx.restore();
}

/**
 * 程序化重绘所有叠加层到拼接 canvas（编号/框/区域/移动预览/连线）。
 * 不截页面已有 UI，全部按标注文档坐标重画（照搬 pigeonlib 视觉值）。
 */
export function drawOverlays(
  ctx: CanvasRenderingContext2D,
  items: OverlayItem[],
  range: CaptureRange
): void {
  for (const item of items) {
    const inset = item.kind === 'region' ? 0 : MARK_INSET;
    const layout = layoutOverlay(item.box, range, inset);

    // 区域框：填充软金底
    if (item.kind === 'region') {
      ctx.fillStyle = GOLD_SOFT;
      roundRectPath(ctx, layout.box.x, layout.box.y, layout.box.w, layout.box.h, 6);
      ctx.fill();
    }

    // 移动预览：幽灵框（最终位置）+ 连线（源框中心 → 幽灵框中心）
    if (item.ghost) {
      const ghost = layoutOverlay(item.ghost, range, MARK_INSET);
      // 连线（虚线）先画，压在框下
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = GOLD;
      ctx.beginPath();
      ctx.moveTo(layout.box.x + layout.box.w / 2, layout.box.y + layout.box.h / 2);
      ctx.lineTo(ghost.box.x + ghost.box.w / 2, ghost.box.y + ghost.box.h / 2);
      ctx.stroke();
      ctx.restore();
      // 幽灵框轮廓
      ctx.save();
      ctx.strokeStyle = GOLD;
      ctx.lineWidth = 1.5;
      roundRectPath(ctx, ghost.box.x, ghost.box.y, ghost.box.w, ghost.box.h, 6);
      ctx.stroke();
      ctx.restore();
    }

    // 标注框 / 区域框描边
    ctx.save();
    ctx.strokeStyle = GOLD;
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, layout.box.x, layout.box.y, layout.box.w, layout.box.h, 6);
    ctx.stroke();
    ctx.restore();

    // 位号圆
    drawPin(ctx, layout.pin, item.number);
  }
}

/** 元数据水印：长图底部「URL · 时间戳」低调小字（左下角浅底药丸） */
export function drawWatermark(
  ctx: CanvasRenderingContext2D,
  range: CaptureRange,
  url: string,
  timestamp: string
): void {
  const text = `${url} · ${timestamp}`;
  ctx.save();
  ctx.font = '11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const padX = 9;
  const pillH = 20;
  const metrics = ctx.measureText(text);
  const pillW = metrics.width + padX * 2;
  const pillX = 8;
  const pillY = range.height - pillH - 8;

  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  roundRectPath(ctx, pillX, pillY, pillW, pillH, 4);
  ctx.fill();

  ctx.fillStyle = 'rgba(60,66,80,0.9)';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, pillX + padX, pillY + pillH / 2);
  ctx.restore();
}

/** 'YYYY-MM-DD HH:mm' 本地时间戳（与 copy-text 一致） */
function formatTimestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 等待指定毫秒 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 加载 dataUrl 为 HTMLImageElement */
function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** 向 background service worker 发送截图请求 */
async function requestCapture(): Promise<string> {
  const resp = (await chrome.runtime.sendMessage({ type: 'pd-capture' })) as
    | { dataUrl?: string; error?: string }
    | undefined;
  if (!resp?.dataUrl) {
    throw new Error(resp?.error ?? 'captureVisibleTab returned no dataUrl');
  }
  return resp.dataUrl;
}

/**
 * 拼接长图截图（有 DOM + chrome 依赖，不单测）。
 * 流程：隐藏 UI → 逐屏截图 → canvas 拼接 → 恢复 UI + scroll。
 * @returns 拼接后的 canvas，失败时抛出异常。
 */
export async function captureStitched(range: CaptureRange): Promise<HTMLCanvasElement> {
  const host = document.getElementById('pd-host') as HTMLElement | null;
  const origVisibility = host?.style.visibility ?? '';
  const origScrollY = window.scrollY;

  try {
    // 1. 隐藏自身 UI
    if (host) host.style.visibility = 'hidden';

    const viewportH = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;
    const screens = planScreens(range.top, range.height, viewportH);

    if (screens.length === 0) {
      throw new Error('planScreens returned empty list');
    }

    // 2. 逐屏滚动 + 截图（内容侧也节流 350ms 渲染等待 + 600ms 间隔双保险）
    const captures: Array<{ dataUrl: string; scrollY: number }> = [];
    let prevScrollY: number | null = null;

    for (const scrollY of screens) {
      window.scrollTo(0, scrollY);
      // 等渲染稳定；若两屏间隔 <600ms，等待差值（与后台限速互补）
      const renderWait = 350;
      const rateWait = prevScrollY !== null ? 600 : 0;
      await sleep(Math.max(renderWait, rateWait));
      prevScrollY = scrollY;

      const dataUrl = await requestCapture();
      captures.push({ dataUrl, scrollY });
    }

    // 3. 恢复 scroll（在 canvas 拼接前恢复，避免白屏时间太长）
    window.scrollTo(0, origScrollY);

    // 4. 恢复 UI（恢复后 canvas 操作在后台进行）
    if (host) host.style.visibility = origVisibility;

    // 5. Canvas 拼接
    const canvas = document.createElement('canvas');
    canvas.width = range.width;
    canvas.height = range.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    for (const { dataUrl, scrollY } of captures) {
      const img = await loadImage(dataUrl);
      const overlapTop = Math.max(scrollY, range.top);
      const overlapBottom = Math.min(scrollY + viewportH, range.top + range.height);
      if (overlapTop >= overlapBottom) continue;

      // 源矩形（物理像素）
      const srcY = (overlapTop - scrollY) * dpr;
      const srcH = (overlapBottom - overlapTop) * dpr;
      // 目标矩形（CSS 像素 = 画布尺寸）
      const dstY = overlapTop - range.top;
      const dstH = overlapBottom - overlapTop;

      ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, dstY, range.width, dstH);
    }

    return canvas;
  } catch (err) {
    // 出错时务必恢复 UI 和 scroll
    if (host) host.style.visibility = origVisibility;
    window.scrollTo(0, origScrollY);
    throw err;
  }
}

// ============================================================
// CopyImageManager — 复制图片接线 + 基础结果弹窗
// ============================================================

const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;

const PANEL_WIDTH = 360;
const EDGE_MARGIN = 12;
/** 截图范围外框留白（px） */
const CAPTURE_PADDING = 80;

export class CopyImageManager {
  private controller: Controller;
  private store: AnnotationStore;
  private settings: Settings;
  private toast: Toast;
  private panelLayer: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private outsideHandler: ((ev: MouseEvent) => void) | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  private currentCanvas: HTMLCanvasElement | null = null;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    settings: Settings;
    toast: Toast;
    panelLayer: HTMLElement;
  }) {
    this.controller = opts.controller;
    this.store = opts.store;
    this.settings = opts.settings;
    this.toast = opts.toast;
    this.panelLayer = opts.panelLayer;

    // 合并进已有回调（setCallbacks 是 merge 语义，不覆盖其它回调）
    this.controller.setCallbacks({ onCopyImage: () => void this.run() });
  }

  // ---- 主流程 ----

  private async run(): Promise<void> {
    const annotations = this.store.getAll();
    if (annotations.length === 0) {
      this.toast.show(t('toast_capture_empty'));
      return;
    }

    this.toast.show(t('toast_capture_generating'));

    try {
      const items = collectOverlayItems(annotations);
      if (items.length === 0) {
        this.toast.show(t('toast_capture_failed'));
        return;
      }

      const docWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);
      const range = computeCaptureRange(
        itemsToRects(items),
        CAPTURE_PADDING,
        MAX_CAPTURE_HEIGHT,
        docWidth
      );

      if (range.height === 0) {
        this.toast.show(t('toast_capture_failed'));
        return;
      }

      const canvas = await captureStitched(range);

      // 叠加绘制：编号/框/区域/移动预览/连线 + 可选水印
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawOverlays(ctx, items, range);
        if (this.settings.watermark) {
          drawWatermark(ctx, range, location.href, formatTimestamp());
        }
      }

      this.currentCanvas = canvas;
      this.openPanel(canvas);

      // 按 imageMethod 自动执行一次（弹窗仍展示两键）
      this.autoExport();
    } catch (err) {
      console.error('[PigeonDeck] captureStitched failed', err);
      this.toast.show(t('toast_capture_failed'));
    }
  }

  /** 生成后按设置自动执行剪贴板 / 下载 */
  private autoExport(): void {
    if (this.settings.imageMethod === 'download') {
      this.download();
    } else {
      this.copyToClipboard();
    }
  }

  // ---- 结果弹窗 ----

  private openPanel(canvas: HTMLCanvasElement): void {
    this.closePanel();

    const panel = document.createElement('div');
    panel.className = 'pd-surface opanel opanel-img';
    panel.setAttribute('data-testid', 'pd-image-output');
    panel.setAttribute('data-pd-popover', '');
    panel.style.position = 'absolute';
    panel.style.width = `${PANEL_WIDTH}px`;

    // 图片预览区
    const shotWrap = document.createElement('div');
    shotWrap.className = 'shot-wrap';

    const shot = document.createElement('div');
    shot.className = 'shot pd-scroll';

    const img = document.createElement('img');
    img.className = 'shot-img';
    img.setAttribute('data-testid', 'pd-image-shot');
    img.src = canvas.toDataURL('image/png');
    img.style.width = '100%';
    img.style.height = 'auto';
    img.style.display = 'block';

    shot.appendChild(img);
    shotWrap.appendChild(shot);
    panel.appendChild(shotWrap);

    // 底栏（9a：下载占位 + 复制占位）
    const foot = document.createElement('div');
    foot.className = 'ofoot ofoot-end';

    const btnDownload = document.createElement('button');
    btnDownload.className = 'pd-iconbtn';
    btnDownload.setAttribute('data-testid', 'pd-image-download');
    btnDownload.title = t('output_img_download');
    btnDownload.setAttribute('aria-label', t('output_img_download'));
    btnDownload.innerHTML = ICON_DOWNLOAD;
    btnDownload.addEventListener('click', () => this.download());
    foot.appendChild(btnDownload);

    const btnCopy = document.createElement('button');
    btnCopy.className = 'pd-btn primary';
    btnCopy.setAttribute('data-testid', 'pd-image-copy');
    btnCopy.innerHTML = ICON_COPY;
    btnCopy.appendChild(document.createTextNode(t('output_copy')));
    btnCopy.addEventListener('click', () => this.copyToClipboard());
    foot.appendChild(btnCopy);

    panel.appendChild(foot);

    this.panelLayer.appendChild(panel);
    this.panelEl = panel;

    this.positionPanel();
    this.bindDismiss();
  }

  private positionPanel(): void {
    if (!this.panelEl) return;
    const w = this.panelEl.offsetWidth;
    const h = this.panelEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(EDGE_MARGIN, Math.min((vw - w) / 2, vw - w - EDGE_MARGIN));
    const top = Math.max(EDGE_MARGIN, Math.min((vh - h) / 2, vh - h - EDGE_MARGIN));
    this.panelEl.style.left = `${left}px`;
    this.panelEl.style.top = `${top}px`;
  }

  private bindDismiss(): void {
    this.outsideHandler = (ev: MouseEvent): void => {
      if (!this.panelEl) return;
      const path = ev.composedPath();
      if (path.includes(this.panelEl)) return;
      this.closePanel();
    };
    this.keyHandler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.closePanel();
      }
    };
    window.addEventListener('mousedown', this.outsideHandler, true);
    window.addEventListener('keydown', this.keyHandler, true);
  }

  private closePanel(): void {
    if (this.outsideHandler) {
      window.removeEventListener('mousedown', this.outsideHandler, true);
      this.outsideHandler = null;
    }
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
  }

  // ---- 剪贴板 / 下载 ----

  /** 复制 PNG 到剪贴板（ClipboardItem，手势内或生成后自动触发） */
  private copyToClipboard(): void {
    if (!this.currentCanvas) return;
    this.currentCanvas.toBlob((blob) => {
      if (
        !blob ||
        typeof ClipboardItem === 'undefined' ||
        !navigator.clipboard ||
        typeof navigator.clipboard.write !== 'function'
      ) {
        this.toast.show(t('toast_capture_copy_failed'));
        return;
      }
      navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
        () => this.toast.show(t('toast_capture_copied'), 'ok'),
        () => this.toast.show(t('toast_capture_copy_failed'))
      );
    }, 'image/png');
  }

  /** 下载为 PNG 文件（toBlob → blob URL → 撤销） */
  private download(): void {
    if (!this.currentCanvas) return;
    this.currentCanvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'pigeondeck-capture.png';
      a.click();
      URL.revokeObjectURL(url);
      this.toast.show(t('toast_capture_downloaded'), 'ok');
    }, 'image/png');
  }
}
