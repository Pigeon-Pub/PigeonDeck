/* ============================================================
   format.ts — 复制文本：纯函数格式化管线
   阶段 8a：buildOperations + renderTaskList
   无 DOM、无 chrome API、无 i18n 运行时依赖，便于重度单测。
   ============================================================ */

import type { Annotation, StyleChange, MoveData, RegionData, ViewportPos } from '../state/annotations';
import { mergeChanges } from '../state/annotations';

// ============================================================
// Public types
// ============================================================

export interface PageContext {
  url: string;
  title: string;
  viewportW: number;
  viewportH: number;
  /** 原样输出，调用方格式化（如 '2026-06-27 16:40'） */
  timestamp: string;
}

export interface ContentChange {
  kind: 'text' | 'html' | 'src';
  oldValue: string;
  newValue: string;
}

export interface Operation {
  number: number;
  /** "Annotation" | "Style Modification" | "Move" | "Region" | 组合（+ 连接） */
  type: string;
  /** CSS selector（Region 为空串） */
  target: string;
  /** elementSummary + 位置坐标，仅 Annotation 类型的操作渲染此字段 */
  location?: string;
  /** 用户批注文字，空时不存在 */
  instruction?: string;
  /** 仅 CSS 属性修改（cssProp 不是 text/html/src），进 Changes 表 */
  cssChanges: StyleChange[];
  /** 内容修改（cssProp === text/html/src），渲染为可读描述 */
  contentChanges: ContentChange[];
  /** 移动数据（initialRect → finalRect，§6.3） */
  move?: MoveData;
  /** 区域数据（kind==='region' 时有效） */
  region?: RegionData;
}

// ============================================================
// Helpers — change splitting
// ============================================================

const CONTENT_PROPS = new Set<string>(['text', 'html', 'src']);

function splitChanges(changes: StyleChange[]): {
  cssChanges: StyleChange[];
  contentChanges: ContentChange[];
} {
  const cssChanges: StyleChange[] = [];
  const contentChanges: ContentChange[] = [];
  for (const c of changes) {
    if (CONTENT_PROPS.has(c.cssProp)) {
      contentChanges.push({
        kind: c.cssProp as 'text' | 'html' | 'src',
        oldValue: c.oldValue,
        newValue: c.newValue,
      });
    } else {
      cssChanges.push(c);
    }
  }
  return { cssChanges, contentChanges };
}

// ============================================================
// Helpers — type string
// ============================================================

function buildTypeString(
  hasAnnotation: boolean,
  hasStyle: boolean,
  hasMove: boolean,
  isRegion: boolean
): string | null {
  if (isRegion) return 'Region';
  const parts: string[] = [];
  if (hasAnnotation) parts.push('Annotation');
  if (hasStyle) parts.push('Style Modification');
  if (hasMove) parts.push('Move');
  return parts.length > 0 ? parts.join(' + ') : null;
}

// ============================================================
// buildOperations
// ============================================================

export function buildOperations(annotations: Annotation[]): Operation[] {
  const regions: Annotation[] = [];
  const elements: Annotation[] = [];

  for (const a of annotations) {
    if (a.kind === 'region') {
      regions.push(a);
    } else {
      elements.push(a);
    }
  }

  // 按 selector 去重合并（§6.4 防御性合并）
  const bySel = new Map<string, Annotation>();
  for (const a of elements) {
    const existing = bySel.get(a.selector);
    if (existing) {
      const merged = mergeChanges(existing.changes, a.changes);
      // 最新非空 note 优先
      const note = a.note.trim() ? a.note : existing.note;
      // move：保留最初 initialRect，取最新 finalRect/dx/dy
      let move: MoveData | undefined = a.move ?? existing.move;
      if (a.move && existing.move) {
        move = { ...a.move, initialRect: existing.move.initialRect };
      }
      bySel.set(a.selector, { ...existing, note, changes: merged, move });
    } else {
      bySel.set(a.selector, a);
    }
  }

  const ops: Operation[] = [];

  // 元素操作
  for (const a of bySel.values()) {
    const { cssChanges, contentChanges } = splitChanges(a.changes);
    const hasAnnotation = a.note.trim().length > 0;
    const hasStyle = cssChanges.length > 0 || contentChanges.length > 0;
    const hasMove = a.move != null;
    const type = buildTypeString(hasAnnotation, hasStyle, hasMove, false);
    if (!type) continue; // 空标注，跳过

    const vp: ViewportPos = a.viewportPos;
    const location = `${a.summary}, (${vp.x},${vp.y})`;

    ops.push({
      number: a.number,
      type,
      target: a.selector,
      location,
      instruction: a.note.trim() || undefined,
      cssChanges,
      contentChanges,
      move: a.move,
    });
  }

  // 区域操作（各自独立，不合并）
  for (const a of regions) {
    const hasNote = a.note.trim().length > 0;
    const hasElements = (a.region?.elements.length ?? 0) > 0;
    if (!hasNote && !hasElements) continue;

    ops.push({
      number: a.number,
      type: 'Region',
      target: '',
      instruction: a.note.trim() || undefined,
      cssChanges: [],
      contentChanges: [],
      region: a.region,
    });
  }

  // 按编号升序
  ops.sort((a, b) => a.number - b.number);
  return ops;
}

// ============================================================
// renderTaskList — 语言模板（常量，不依赖运行时 i18n）
// ============================================================

const GLOBAL_RULES: Record<'en' | 'zh_CN', readonly string[]> = {
  en: [
    'Do NOT hardcode top/left absolute positions.',
    'Prefer existing layout: flex, grid, gap, margin, order.',
    'Visual coordinates are location hints, not implementation.',
  ],
  zh_CN: [
    '不要硬编码 top/left 绝对定位',
    '优先使用现有布局机制：flex、grid、gap、margin、order',
    '视觉坐标为定位线索，不是实施指令',
  ],
};

function normalizeLang(lang: string): 'en' | 'zh_CN' {
  return lang === 'zh_CN' ? 'zh_CN' : 'en';
}

// ============================================================
// Render helpers
// ============================================================

/** 吸附语义 → 英文描述 */
function describeSnap(move: MoveData): string {
  if (move.freeMove) return 'free move';
  if (!move.snap) return 'no snap';
  const label: Record<string, string> = {
    'align-left': 'left edge',
    'align-right': 'right edge',
    'align-top': 'top edge',
    'align-bottom': 'bottom edge',
    'align-center-h': 'X center',
    'align-center-v': 'Y center',
    'align-x': 'X axis',
    'align-y': 'Y axis',
  };
  return `snapped (${label[move.snap] ?? move.snap})`;
}

function truncate(str: string, max = 60): string {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

/** dataURL → data:<mime>；普通 URL → 文件名尾段 */
function describeMediaUrl(url: string): string {
  if (url.startsWith('data:')) {
    // data:<type>[;<encoding>],<data> — 取 type 部分
    const semiIdx = url.indexOf(';');
    const commaIdx = url.indexOf(',');
    const end =
      semiIdx === -1
        ? commaIdx === -1
          ? url.length
          : commaIdx
        : commaIdx === -1
          ? semiIdx
          : Math.min(semiIdx, commaIdx);
    return `data:${url.slice(5, end) || 'unknown'}`;
  }
  const last = url.split('/').pop() ?? url;
  return last || url;
}

function renderContentChange(c: ContentChange): string {
  if (c.kind === 'src') {
    return `Media: "${describeMediaUrl(c.oldValue)}" → "${describeMediaUrl(c.newValue)}"`;
  }
  const oldText = c.kind === 'html' ? stripTags(c.oldValue) : c.oldValue;
  const newText = c.kind === 'html' ? stripTags(c.newValue) : c.newValue;
  return `Content: "${truncate(oldText)}" → "${truncate(newText)}"`;
}

function renderVp(vp: ViewportPos): string {
  return `(${vp.x}, ${vp.y}) ${vp.w}×${vp.h}`;
}

function renderOp(op: Operation): string {
  const lines: string[] = [];
  lines.push(`--- #${op.number} ${op.type} ---`);

  // ---- Region ----
  if (op.type === 'Region') {
    if (op.region) {
      lines.push(`Scope: [${op.region.elements.join(', ')}]`);
      const { x, y, w, h } = op.region.docRect;
      lines.push(`Coordinates: (${x},${y})–(${x + w},${y + h})`);
    }
    if (op.instruction) lines.push(`Instruction: ${op.instruction}`);
    return lines.join('\n');
  }

  // ---- Element operation ----
  lines.push(`Target: ${op.target}`);

  // Location 仅对含 Annotation 的操作显示
  if (op.location && op.type.includes('Annotation')) {
    lines.push(`Location: ${op.location}`);
  }

  if (op.instruction) lines.push(`Instruction: ${op.instruction}`);

  // 内容修改（在 CSS 表格之前）
  for (const cc of op.contentChanges) {
    lines.push(renderContentChange(cc));
  }

  // CSS 修改表格
  if (op.cssChanges.length > 0) {
    lines.push('Changes:');
    for (const c of op.cssChanges) {
      lines.push(`  | ${c.cssProp} | ${c.oldValue} | ${c.newValue} |`);
    }
  }

  // Move 块（§6.3：仅初始→最终）
  if (op.move) {
    const m = op.move;
    lines.push('Move:');
    lines.push(`  Source: ${op.target}`);
    lines.push(`  Target: (${m.finalRect.x}, ${m.finalRect.y})`);
    lines.push(`  Initial: ${renderVp(m.initialRect)}`);
    lines.push(`  Final: ${renderVp(m.finalRect)}`);
    lines.push(`  Snap: ${describeSnap(m)}`);
  }

  return lines.join('\n');
}

// ============================================================
// renderTaskList
// ============================================================

export function renderTaskList(
  ops: Operation[],
  ctx: PageContext,
  lang: 'en' | 'zh_CN' = 'en'
): string {
  const effectiveLang = normalizeLang(lang);
  const rules = GLOBAL_RULES[effectiveLang];

  const sections: string[] = [];

  // [Page Context]
  sections.push(
    [
      '[Page Context]',
      `- URL: ${ctx.url}`,
      `- Title: ${ctx.title}`,
      `- Viewport: ${ctx.viewportW} × ${ctx.viewportH} (px)`,
      `- Timestamp: ${ctx.timestamp}`,
    ].join('\n')
  );

  // [Global Editing Rules]
  sections.push(
    ['[Global Editing Rules]', ...rules.map((r) => `- ${r}`)].join('\n')
  );

  // [Operations]
  if (ops.length === 0) {
    sections.push('[Operations]\n(no operations)');
  } else {
    sections.push(['[Operations]', ops.map(renderOp).join('\n\n')].join('\n'));
  }

  return sections.join('\n\n');
}
