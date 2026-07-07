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
import { makeDraggableByHandle } from './floating-drag';
import { composeCardChangeLines } from './annotation-summary';
import { pushEsc } from './esc-stack';
import { loadImage, requestCapture } from './capture-client';
import {
  computeCaptureRange,
  MAX_CAPTURE_HEIGHT,
  planScreens,
  type CaptureRange,
  type DocRect,
} from './capture-range';
import {
  layoutOverlay,
  MARK_INSET,
  PIN_DIAMETER,
  PIN_OFFSET,
  type OverlayLayout,
} from './capture-overlay-layout';

export { computeCaptureRange, MAX_CAPTURE_HEIGHT, planScreens } from './capture-range';
export type { CaptureRange, DocRect } from './capture-range';
export { layoutOverlay, MARK_INSET, PIN_DIAMETER, PIN_OFFSET } from './capture-overlay-layout';
export type { OverlayLayout } from './capture-overlay-layout';

// ============================================================
// 展开批注卡片布局（阶段 F10，纯函数可单测）
// 导出图叠加「已展开、互不重叠」的批注卡片：编号徽标 + 类型 + 批注 + 变更摘要。
// 布局全程用文档坐标；卡片矩形并入 computeCaptureRange 使画布容纳所有卡片。
// ============================================================

/** 单张卡片要展示的内容（运行时用 t()/FIELD_DEFS 组装，见 composeCard） */
export interface CardContent {
  /** 本地化类型标签（"批注"/"批注 + 样式" 等；区域为"区域"），可空 */
  typeLabel: string;
  /** 批注文字（已 trim，可空） */
  note: string;
  /** 变更摘要原始行（"字段: 原值 → 新值"，未换行），区域为空 */
  lines: string[];
}

/** 文本宽度测量函数（运行时注入 canvas measureText；单测注入桩） */
export type MeasureFn = (text: string, font: string) => number;

/** 卡片布局输入项（文档坐标） */
export interface CardLayoutItem {
  number: number;
  /** 位号圆中心（连线指向它） */
  anchor: { x: number; y: number };
  /** 就近放置参考框（元素/区域框，避免卡片盖住本体） */
  refBox: DocRect;
  card: CardContent;
}

/** 布局完成的卡片（文档坐标 + 已换行的可绘制行） */
export interface LaidOutCard {
  number: number;
  rect: DocRect;
  anchor: { x: number; y: number };
  /** 徽标右侧类型标签 */
  header: string;
  /** 已换行的批注行 */
  noteLines: string[];
  /** 已换行的变更摘要行（首行含 "• " 前缀） */
  changeLines: string[];
}

/** 卡片最大/最小宽度（px，含内边距） */
export const CARD_MAX_WIDTH = 244;
export const CARD_MIN_WIDTH = 116;
const CARD_PAD = 11;
/** 徽标行高（含编号圆） */
const CARD_HEADER_H = 22;
/** 正文行高 */
const CARD_LINE_H = 16;
/** 分区间距（header↔note↔changes） */
const CARD_SEC_GAP = 7;
/** 卡片与参考框/彼此的间距 */
const CARD_GAP = 14;
/** 编号徽标半径 */
const CARD_BADGE_R = 8.5;

/** 卡片字体（照搬 pigeonlib .acard 字号；family 与 PIN_FONT 一致） */
const CARD_HEADER_FONT = '600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CARD_BODY_FONT = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
const CARD_BADGE_FONT = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** 卡片颜色（design-tokens.css 亮色令牌，截图为页面故用亮色） */
const CARD_BG = '#faf7f0'; // --csf
const CARD_BORDER = '#d9d3c4'; // --cbd
const CARD_TEXT = '#23262e'; // --ctx
const CARD_TEXT2 = '#6b6b6b'; // --ctx2

/**
 * 纯函数：把一段文字按像素宽换行为多行。
 * 拉丁文优先在最后一个空格断行（整词换行）；CJK 等无空格文本逐字断行。
 * 保留原有换行符（note 可含多段）。measure 由调用方注入（可单测）。
 */
export function wrapText(
  text: string,
  maxWidth: number,
  font: string,
  measure: MeasureFn
): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let cur = '';
    for (const ch of Array.from(para)) {
      const test = cur + ch;
      if (cur !== '' && measure(test, font) > maxWidth) {
        const lastSpace = cur.lastIndexOf(' ');
        if (lastSpace > 0 && ch !== ' ') {
          out.push(cur.slice(0, lastSpace));
          cur = cur.slice(lastSpace + 1) + ch;
        } else {
          out.push(cur);
          cur = ch === ' ' ? '' : ch;
        }
      } else {
        cur = test;
      }
    }
    out.push(cur);
  }
  return out;
}

/** 卡片高度（layout 与 drawCards 共用同一常量，保证绘制与尺寸一致） */
function cardHeight(noteLines: string[], changeLines: string[]): number {
  let h = CARD_PAD + CARD_HEADER_H;
  if (noteLines.length > 0) h += CARD_SEC_GAP + noteLines.length * CARD_LINE_H;
  if (changeLines.length > 0) h += CARD_SEC_GAP + changeLines.length * CARD_LINE_H;
  return h + CARD_PAD;
}

/** 两矩形是否重叠（含 margin 间距要求） */
function rectsOverlap(a: DocRect, b: DocRect, margin: number): boolean {
  return !(
    a.x + a.w + margin <= b.x ||
    b.x + b.w + margin <= a.x ||
    a.y + a.h + margin <= b.y ||
    b.y + b.h + margin <= a.y
  );
}

/**
 * 纯函数：为每张卡片计算不互相重叠的矩形与连线锚点（文档坐标）。
 * 算法：① 按内容换行并测量宽高；② 就近放置（右/左空间更大侧，都放不下则下方），
 * 水平夹紧在 [0, docWidth] 内；③ 与已放卡片重叠则向下推，直到不重叠。
 * 非完美排布（仅向下推），但保证互不重叠且可读；比例待真机冒烟核对。
 */
export function computeCardLayout(
  items: CardLayoutItem[],
  docWidth: number,
  measure: MeasureFn
): LaidOutCard[] {
  const result: LaidOutCard[] = [];
  const maxTextW = CARD_MAX_WIDTH - CARD_PAD * 2;

  for (const item of items) {
    // ① 换行 + 尺寸
    const noteLines = item.card.note
      ? wrapText(item.card.note, maxTextW, CARD_BODY_FONT, measure)
      : [];
    const changeLines: string[] = [];
    for (const raw of item.card.lines) {
      changeLines.push(...wrapText('• ' + raw, maxTextW, CARD_BODY_FONT, measure));
    }
    const headerW = CARD_BADGE_R * 2 + 6 + measure(item.card.typeLabel, CARD_HEADER_FONT);
    let contentW = headerW;
    for (const ln of noteLines) contentW = Math.max(contentW, measure(ln, CARD_BODY_FONT));
    for (const ln of changeLines) contentW = Math.max(contentW, measure(ln, CARD_BODY_FONT));
    const cardW = Math.min(
      CARD_MAX_WIDTH,
      Math.max(CARD_MIN_WIDTH, Math.ceil(contentW) + CARD_PAD * 2)
    );
    const cardH = cardHeight(noteLines, changeLines);

    // ② 就近放置：优先空间更大的一侧，都放不下则下方
    const freeRight = docWidth - (item.refBox.x + item.refBox.w);
    const freeLeft = item.refBox.x;
    let x: number;
    let y = item.refBox.y;
    if (freeRight >= cardW + CARD_GAP && freeRight >= freeLeft) {
      x = item.refBox.x + item.refBox.w + CARD_GAP;
    } else if (freeLeft >= cardW + CARD_GAP) {
      x = item.refBox.x - CARD_GAP - cardW;
    } else {
      x = item.refBox.x;
      y = item.refBox.y + item.refBox.h + CARD_GAP;
    }
    x = Math.max(0, Math.min(x, docWidth - cardW));

    // ③ 消解重叠：向下推（只降不升，必然收敛）
    let rect: DocRect = { x, y, w: cardW, h: cardH };
    const guardMax = result.length * 4 + 8;
    let moved = true;
    let guard = 0;
    while (moved && guard < guardMax) {
      moved = false;
      for (const placed of result) {
        if (rectsOverlap(rect, placed.rect, CARD_GAP)) {
          rect = { ...rect, y: placed.rect.y + placed.rect.h + CARD_GAP };
          moved = true;
        }
      }
      guard++;
    }

    result.push({
      number: item.number,
      rect,
      anchor: item.anchor,
      header: item.card.typeLabel,
      noteLines,
      changeLines,
    });
  }

  return result;
}


/** 一个待叠加绘制的标注项（运行时收集，含文档坐标） */
interface OverlayItem {
  number: number;
  kind: 'element' | 'region';
  /** 主框：元素标注框 / 区域框；被移动元素时 = 初始（源）位置 */
  box: DocRect;
  /** 移动预览幽灵框（最终位置），仅被移动元素存在 */
  ghost?: DocRect;
  /** 展开卡片内容（F10），note 与 changes 皆空时为 undefined（只画框/位号） */
  card?: CardContent;
}

/** 类型标签（本地化）：批注 / 样式 / 移动 组合，或区域（照 format.ts 语义，紧凑版） */
function cardTypeLabel(a: Annotation): string {
  if (a.kind === 'region') return t('region_label');
  const parts: string[] = [];
  if (a.note.trim()) parts.push(t('card_type_annotation'));
  if (a.changes.length > 0) parts.push(t('card_type_style'));
  if (a.move) parts.push(t('card_type_move'));
  return parts.join(' + ');
}

/** 组装一条标注的卡片内容；无 note 且无变更行 → undefined（不画卡片） */
function composeCard(a: Annotation): CardContent | undefined {
  const note = a.note.trim();
  const lines = a.kind === 'region' ? [] : composeCardChangeLines(a);
  if (!note && lines.length === 0) return undefined;
  return { typeLabel: cardTypeLabel(a), note, lines };
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
    const card = composeCard(a);
    // 区域标注：docRect 本身已是文档坐标
    if (a.kind === 'region' && a.region) {
      const r = a.region.docRect;
      if (r.w > 0 && r.h > 0) {
        items.push({ number: a.number, kind: 'region', box: { x: r.x, y: r.y, w: r.w, h: r.h }, card });
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
      items.push({ number: a.number, kind: 'element', box: initialRect, ghost: finalRect, card });
    } else {
      items.push({ number: a.number, kind: 'element', box: rect, card });
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

/** OverlayItem → 卡片布局输入项（仅带卡片内容者）；位号圆中心为连线锚点（文档坐标） */
function buildCardLayoutItems(items: OverlayItem[]): CardLayoutItem[] {
  const out: CardLayoutItem[] = [];
  for (const it of items) {
    if (!it.card) continue;
    const inset = it.kind === 'region' ? 0 : MARK_INSET;
    const bx = it.box.x - inset;
    const by = it.box.y - inset;
    out.push({
      number: it.number,
      anchor: { x: bx - PIN_OFFSET + PIN_DIAMETER / 2, y: by - PIN_OFFSET + PIN_DIAMETER / 2 },
      refBox: it.box,
      card: it.card,
    });
  }
  return out;
}

/** 生成基于离屏 canvas 的文本测量函数（供 computeCardLayout / wrapText 注入） */
function makeCanvasMeasure(): MeasureFn {
  const c = document.createElement('canvas');
  const cx = c.getContext('2d');
  return (text, font) => {
    if (!cx) return text.length * 7; // 无 canvas 兜底（估算）
    cx.font = font;
    return cx.measureText(text).width;
  };
}

/**
 * 绘制展开的批注卡片（F10）：连线（位号→卡片最近点）+ 圆角面 + 编号徽标 + 类型 + 批注 + 变更行。
 * 坐标由文档坐标减 range.top 换算到 canvas；颜色/字体照搬 pigeonlib 亮色令牌。
 */
export function drawCards(
  ctx: CanvasRenderingContext2D,
  cards: LaidOutCard[],
  range: CaptureRange
): void {
  for (const card of cards) {
    const x = card.rect.x;
    const y = card.rect.y - range.top;
    const w = card.rect.w;
    const h = card.rect.h;
    const ax = card.anchor.x;
    const ay = card.anchor.y - range.top;

    // 连线：位号锚点 → 卡片最近点（虚线，先画压卡片下）
    const nx = Math.max(x, Math.min(ax, x + w));
    const ny = Math.max(y, Math.min(ay, y + h));
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = GOLD;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.restore();

    // 卡片面（--csf 底 + 柔和投影）
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 9);
    ctx.fillStyle = CARD_BG;
    ctx.shadowColor = 'rgba(60,46,18,0.18)';
    ctx.shadowBlur = 9;
    ctx.shadowOffsetY = 2;
    ctx.fill();
    ctx.restore();
    // 描边（--cbd）
    ctx.save();
    roundRectPath(ctx, x, y, w, h, 9);
    ctx.strokeStyle = CARD_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // 编号徽标（金圆白字，与位号圆同色系）
    const badgeCx = x + CARD_PAD + CARD_BADGE_R;
    const badgeCy = y + CARD_PAD + CARD_BADGE_R;
    ctx.save();
    ctx.beginPath();
    ctx.arc(badgeCx, badgeCy, CARD_BADGE_R, 0, Math.PI * 2);
    ctx.fillStyle = GOLD;
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = CARD_BADGE_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(card.number), badgeCx, badgeCy);
    ctx.restore();

    // 类型标签
    if (card.header) {
      ctx.save();
      ctx.fillStyle = CARD_TEXT;
      ctx.font = CARD_HEADER_FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(card.header, badgeCx + CARD_BADGE_R + 6, badgeCy);
      ctx.restore();
    }

    // 正文行
    let cy = y + CARD_PAD + CARD_HEADER_H;
    if (card.noteLines.length > 0) {
      cy += CARD_SEC_GAP;
      ctx.save();
      ctx.fillStyle = CARD_TEXT;
      ctx.font = CARD_BODY_FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const ln of card.noteLines) {
        ctx.fillText(ln, x + CARD_PAD, cy + CARD_LINE_H / 2);
        cy += CARD_LINE_H;
      }
      ctx.restore();
    }
    if (card.changeLines.length > 0) {
      // 分隔线（有 note 时）
      if (card.noteLines.length > 0) {
        ctx.save();
        ctx.strokeStyle = CARD_BORDER;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x + CARD_PAD, cy + CARD_SEC_GAP / 2);
        ctx.lineTo(x + w - CARD_PAD, cy + CARD_SEC_GAP / 2);
        ctx.stroke();
        ctx.restore();
      }
      cy += CARD_SEC_GAP;
      ctx.save();
      ctx.fillStyle = CARD_TEXT2;
      ctx.font = CARD_BODY_FONT;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const ln of card.changeLines) {
        ctx.fillText(ln, x + CARD_PAD, cy + CARD_LINE_H / 2);
        cy += CARD_LINE_H;
      }
      ctx.restore();
    }
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

/** 加载 dataUrl 为 HTMLImageElement（eyedropper.ts 复用） */

/** 向 background service worker 发送截图请求（eyedropper.ts 复用） */

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
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;
const ICON_EXTERNAL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6"/><path d="M10 14 21 3"/><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>`;

const PANEL_WIDTH = 452;
const EDGE_MARGIN = 12;
/** 截图范围外框留白（px） */
const CAPTURE_PADDING = 80;

export class CopyImageManager {
  private controller: Controller;
  private store: AnnotationStore;
  private settings: Settings;
  private toast: Toast;
  private panelLayer: HTMLElement;
  private feedbackLayer: HTMLElement;
  private panelEl: HTMLElement | null = null;
  private outsideHandler: ((ev: MouseEvent) => void) | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;
  private currentCanvas: HTMLCanvasElement | null = null;
  private lightboxEl: HTMLElement | null = null;
  private lightboxEsc: (() => void) | null = null;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    settings: Settings;
    toast: Toast;
    panelLayer: HTMLElement;
    feedbackLayer: HTMLElement;
  }) {
    this.controller = opts.controller;
    this.store = opts.store;
    this.settings = opts.settings;
    this.toast = opts.toast;
    this.panelLayer = opts.panelLayer;
    this.feedbackLayer = opts.feedbackLayer;

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

      // F10：展开的批注卡片布局（文档坐标，互不重叠）；卡片矩形并入范围使画布容纳它们
      const cards = computeCardLayout(buildCardLayoutItems(items), docWidth, makeCanvasMeasure());
      const rects = itemsToRects(items).concat(cards.map((c) => c.rect));
      const range = computeCaptureRange(rects, CAPTURE_PADDING, MAX_CAPTURE_HEIGHT, docWidth);
      if (range.truncated) {
        console.warn(
          '[PigeonDeck] capture range hit MAX_CAPTURE_HEIGHT; some annotation cards may be cropped.'
        );
      }

      if (range.height === 0) {
        this.toast.show(t('toast_capture_failed'));
        return;
      }

      const canvas = await captureStitched(range);

      // 叠加绘制：编号/框/区域/移动预览/连线 + 展开卡片 + 可选水印
      const ctx = canvas.getContext('2d');
      if (ctx) {
        drawOverlays(ctx, items, range);
        drawCards(ctx, cards, range);
        if (this.settings.watermark) {
          drawWatermark(ctx, range, location.href, formatTimestamp());
        }
      }

      this.currentCanvas = canvas;
      this.openPanel(canvas);
    } catch (err) {
      console.error('[PigeonDeck] captureStitched failed', err);
      this.toast.show(t('toast_capture_failed'));
    }
  }

  // ---- 结果弹窗 ----

  /** 供工具盘拖拽时关闭结果弹窗（INVARIANT 3）。幂等（未开时 closePanel 直接返回）。 */
  close(): void {
    this.closePanel();
  }

  private openPanel(canvas: HTMLCanvasElement): void {
    this.closePanel();

    const panel = document.createElement('div');
    panel.className = 'pd-surface opanel opanel-img';
    panel.setAttribute('data-testid', 'pd-image-output');
    panel.setAttribute('data-pd-popover', '');
    panel.style.position = 'absolute';
    panel.style.width = `${PANEL_WIDTH}px`;

    // 顶栏：标题 + 关闭 X（照设置面板 .shead）
    const head = document.createElement('div');
    head.className = 'shead';
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = t('tb_copy_image');
    head.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'pd-iconbtn';
    closeBtn.setAttribute('data-testid', 'pd-image-close');
    closeBtn.setAttribute('aria-label', t('panel_cancel'));
    closeBtn.title = t('panel_cancel');
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', () => this.closePanel());
    head.appendChild(closeBtn);
    panel.appendChild(head);

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
    img.style.cursor = 'zoom-in';
    // 单击预览 → 全屏灯箱（放大查看长图）
    img.addEventListener('click', () => this.openLightbox());

    shot.appendChild(img);
    shotWrap.appendChild(shot);
    panel.appendChild(shotWrap);

    // 底栏：下载 + 复制（用户自选，不自动导出）
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
    // 顶栏可拖动整面板（X 按钮由 makeDraggableByHandle 忽略）
    makeDraggableByHandle(panel, head);
    this.bindDismiss();
  }

  // ---- 单击预览灯箱（feedback 层，覆盖视口，click-to-zoom） ----

  private openLightbox(): void {
    if (!this.currentCanvas) return;
    this.closeLightbox();

    const back = document.createElement('div');
    back.className = 'pd-lightbox';
    back.setAttribute('data-testid', 'pd-image-lightbox');

    const big = document.createElement('img');
    big.className = 'lb-img';
    big.src = this.currentCanvas.toDataURL('image/png');
    // 单击图片：适配视口 ↔ 实际尺寸切换
    big.addEventListener('click', (ev) => {
      ev.stopPropagation();
      back.classList.toggle('zoomed');
    });
    back.appendChild(big);

    // 在新标签页打开（blob: URL — Chrome 拦截顶层 data: 导航）
    const openBtn = document.createElement('button');
    openBtn.className = 'pd-iconbtn lb-open';
    openBtn.setAttribute('data-testid', 'pd-image-lightbox-open');
    openBtn.title = t('output_img_open_tab');
    openBtn.setAttribute('aria-label', t('output_img_open_tab'));
    openBtn.innerHTML = ICON_EXTERNAL;
    openBtn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      this.currentCanvas?.toBlob((blob) => {
        if (!blob) return;
        window.open(URL.createObjectURL(blob), '_blank');
      }, 'image/png');
    });
    back.appendChild(openBtn);

    // 点背景关闭（点图片/按钮已 stopPropagation）
    back.addEventListener('click', () => this.closeLightbox());

    this.feedbackLayer.appendChild(back);
    this.lightboxEl = back;
    this.lightboxEsc = pushEsc(() => this.closeLightbox());
  }

  private closeLightbox(): void {
    this.lightboxEsc?.();
    this.lightboxEsc = null;
    if (this.lightboxEl) {
      this.lightboxEl.remove();
      this.lightboxEl = null;
    }
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
      // 灯箱打开时不处理面板外部点击（灯箱覆盖视口并自管关闭）
      if (this.lightboxEl) return;
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
    this.closeLightbox();
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
