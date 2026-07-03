/* ============================================================
   capture.ts — 阶段 9a 截图拼接管线
   纯函数（computeCaptureRange / planScreens）可单测；
   captureStitched / CopyImageManager 有 DOM/chrome 依赖，不单测。
   视觉来源：preview/parts/38-output-image.html（.opanel-img .shot-wrap .shot .ofoot）
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, Annotation } from '../state/annotations';
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
// 运行时辅助（有 DOM/chrome 依赖，不单测）
// ============================================================

/** 将 Annotation 列表转换为文档坐标矩形（运行时，有 DOM 访问） */
function collectDocRects(annotations: Annotation[]): DocRect[] {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const result: DocRect[] = [];

  for (const a of annotations) {
    // 区域标注：docRect 本身已是文档坐标
    if (a.kind === 'region' && a.region) {
      const r = a.region.docRect;
      if (r.w > 0 && r.h > 0) result.push({ x: r.x, y: r.y, w: r.w, h: r.h });
      continue;
    }
    // 元素标注：优先从 DOM 取当前位置
    try {
      const el = document.querySelector(a.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          result.push({ x: r.left + sx, y: r.top + sy, w: r.width, h: r.height });
          continue;
        }
      }
    } catch {
      // 无效 selector：静默忽略，走 fallback
    }
    // Fallback：viewportPos + 当前 scroll（近似）
    const vp = a.viewportPos;
    if (vp.w > 0 && vp.h > 0) {
      result.push({ x: vp.x + sx, y: vp.y + sy, w: vp.w, h: vp.h });
    }
  }

  return result;
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
  private toast: Toast;
  private panelLayer: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private outsideHandler: ((ev: MouseEvent) => void) | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  /** 当前截图 canvas（9b 叠加用） */
  private currentCanvas: HTMLCanvasElement | null = null;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    toast: Toast;
    panelLayer: HTMLElement;
  }) {
    this.controller = opts.controller;
    this.store = opts.store;
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
      const rects = collectDocRects(annotations);
      if (rects.length === 0) {
        this.toast.show(t('toast_capture_failed'));
        return;
      }

      const docWidth =
        Math.max(document.documentElement.scrollWidth, window.innerWidth);
      const range = computeCaptureRange(rects, CAPTURE_PADDING, MAX_CAPTURE_HEIGHT, docWidth);

      if (range.height === 0) {
        this.toast.show(t('toast_capture_failed'));
        return;
      }

      const canvas = await captureStitched(range);
      this.currentCanvas = canvas;
      this.openPanel(canvas);
    } catch (err) {
      console.error('[PigeonDeck] captureStitched failed', err);
      this.toast.show(t('toast_capture_failed'));
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
    // 9b 接入剪贴板；9a 先下载代替
    btnCopy.addEventListener('click', () => this.download());
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

  // ---- 下载 ----

  private download(): void {
    if (!this.currentCanvas) return;
    const url = this.currentCanvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pigeondeck-capture.png';
    a.click();
  }
}
