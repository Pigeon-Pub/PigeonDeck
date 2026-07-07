/* ============================================================
   capture-card-layout.ts - pure expanded annotation card layout helpers
   ============================================================ */

import type { DocRect } from './capture-range';

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
export const CARD_PAD = 11;
/** 徽标行高（含编号圆） */
export const CARD_HEADER_H = 22;
/** 正文行高 */
export const CARD_LINE_H = 16;
/** 分区间距（header↔note↔changes） */
export const CARD_SEC_GAP = 7;
/** 卡片与参考框/彼此的间距 */
export const CARD_GAP = 14;
/** 编号徽标半径 */
export const CARD_BADGE_R = 8.5;

/** 卡片字体（照搬 pigeonlib .acard 字号；family 与 PIN_FONT 一致） */
export const CARD_HEADER_FONT = '600 12.5px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const CARD_BODY_FONT = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
export const CARD_BADGE_FONT = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';

/** 卡片颜色（design-tokens.css 亮色令牌，截图为页面故用亮色） */
export const CARD_BG = '#faf7f0'; // --csf
export const CARD_BORDER = '#d9d3c4'; // --cbd
export const CARD_TEXT = '#23262e'; // --ctx
export const CARD_TEXT2 = '#6b6b6b'; // --ctx2

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
