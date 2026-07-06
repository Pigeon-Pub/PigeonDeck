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
    'Apply ONLY the changes listed in the operations below.',
    'Do NOT touch unrelated code, files or areas.',
    'When something is unclear, ask the user instead of guessing.',
  ],
  zh_CN: [
    '不要硬编码 top/left 绝对定位',
    '优先使用现有布局机制：flex、grid、gap、margin、order',
    '视觉坐标为定位线索，不是实施指令',
    '只执行下方操作列表中列出的修改',
    '不要改动无关的代码、文件或区域',
    '遇到不明确的地方，先向用户确认，不要臆测',
  ],
};

/**
 * 任务清单的可本地化标签表（模块内字符串表，非 t() i18n 键；English 为默认/回退）。
 * 只翻译分区标题 / 字段标签 / 吸附短语；结构（分区顺序、缩进）与值（URL/选择器/坐标）不变。
 * 操作 Type（Annotation/Style Modification/Move/Region 及组合）保持英文——它同时是渲染逻辑判据。
 */
interface Labels {
  pageContext: string;
  globalRules: string;
  operations: string;
  noOperations: string;
  url: string;
  title: string;
  viewport: string;
  timestamp: string;
  target: string;
  location: string;
  instruction: string;
  content: string;
  media: string;
  changes: string;
  move: string;
  source: string;
  into: string;
  final: string;
  initial: string;
  snap: string;
  scope: string;
  coordinates: string;
  snapEmbedded: string;
  snapFree: string;
  snapNone: string;
  /** 操作 Type 各组件的本地化显示标签（op.type 内部判据仍为英文，仅显示翻译） */
  typeAnnotation: string;
  typeStyle: string;
  typeMove: string;
  typeRegion: string;
  /** `snapped (<edge>)` 包装：传入已本地化的边缘描述 */
  snapped: (edge: string) => string;
  /** 吸附边缘语义标识 → 本地化描述 */
  snapEdges: Record<string, string>;
}

const LABELS: Record<'en' | 'zh_CN', Labels> = {
  en: {
    pageContext: '[Page Context]',
    globalRules: '[Global Editing Rules]',
    operations: '[Operations]',
    noOperations: '(no operations)',
    url: 'URL',
    title: 'Title',
    viewport: 'Viewport',
    timestamp: 'Timestamp',
    target: 'Target',
    location: 'Location',
    instruction: 'Instruction',
    content: 'Content',
    media: 'Media',
    changes: 'Changes',
    move: 'Move',
    source: 'Source',
    into: 'Into',
    final: 'Final',
    initial: 'Initial',
    snap: 'Snap',
    scope: 'Scope',
    coordinates: 'Coordinates',
    snapEmbedded: 'embedded into container',
    snapFree: 'free move',
    snapNone: 'no snap',
    typeAnnotation: 'Annotation',
    typeStyle: 'Style Modification',
    typeMove: 'Move',
    typeRegion: 'Region',
    snapped: (edge) => `snapped (${edge})`,
    snapEdges: {
      'align-left': 'left edge',
      'align-right': 'right edge',
      'align-top': 'top edge',
      'align-bottom': 'bottom edge',
      'align-center-h': 'X center',
      'align-center-v': 'Y center',
      'align-x': 'X axis',
      'align-y': 'Y axis',
    },
  },
  zh_CN: {
    pageContext: '[页面上下文]',
    globalRules: '[全局编辑规则]',
    operations: '[操作列表]',
    noOperations: '（无操作）',
    url: '网址',
    title: '标题',
    viewport: '视口',
    timestamp: '时间',
    target: '目标',
    location: '位置',
    instruction: '说明',
    content: '内容',
    media: '媒体',
    changes: '修改',
    move: '移动',
    source: '源',
    into: '移入',
    final: '最终',
    initial: '初始',
    snap: '吸附',
    scope: '范围',
    coordinates: '坐标',
    snapEmbedded: '嵌入容器',
    snapFree: '自由移动',
    snapNone: '无吸附',
    typeAnnotation: '批注',
    typeStyle: '样式修改',
    typeMove: '移动',
    typeRegion: '区域',
    snapped: (edge) => `已吸附（${edge}）`,
    snapEdges: {
      'align-left': '左边缘',
      'align-right': '右边缘',
      'align-top': '顶边缘',
      'align-bottom': '底边缘',
      'align-center-h': 'X 轴居中',
      'align-center-v': 'Y 轴居中',
      'align-x': 'X 轴',
      'align-y': 'Y 轴',
    },
  },
};

function normalizeLang(lang: string): 'en' | 'zh_CN' {
  return lang === 'zh_CN' ? 'zh_CN' : 'en';
}

// ============================================================
// Render helpers
// ============================================================

/** 吸附语义 → 本地化描述 */
function describeSnap(move: MoveData, L: Labels): string {
  if (move.reparent) return L.snapEmbedded;
  if (move.freeMove) return L.snapFree;
  if (!move.snap) return L.snapNone;
  return L.snapped(L.snapEdges[move.snap] ?? move.snap);
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

function renderContentChange(c: ContentChange, L: Labels): string {
  if (c.kind === 'src') {
    return `${L.media}: "${describeMediaUrl(c.oldValue)}" → "${describeMediaUrl(c.newValue)}"`;
  }
  const oldText = c.kind === 'html' ? stripTags(c.oldValue) : c.oldValue;
  const newText = c.kind === 'html' ? stripTags(c.newValue) : c.newValue;
  return `${L.content}: "${truncate(oldText)}" → "${truncate(newText)}"`;
}

function renderVp(vp: ViewportPos): string {
  return `(${vp.x}, ${vp.y}) ${vp.w}×${vp.h}`;
}

/**
 * op.type（英文，同时是渲染逻辑判据）→ 本地化显示串：
 * 按 ' + ' 拆分逐段翻译再重接。未知段原样保留（防御）。
 */
function localizeType(type: string, L: Labels): string {
  const map: Record<string, string> = {
    Annotation: L.typeAnnotation,
    'Style Modification': L.typeStyle,
    Move: L.typeMove,
    Region: L.typeRegion,
  };
  return type
    .split(' + ')
    .map((part) => map[part] ?? part)
    .join(' + ');
}

function renderOp(op: Operation, L: Labels): string {
  const lines: string[] = [];
  lines.push(`--- #${op.number} ${localizeType(op.type, L)} ---`);

  // ---- Region ----
  if (op.type === 'Region') {
    if (op.region) {
      lines.push(`${L.scope}: [${op.region.elements.join(', ')}]`);
      const { x, y, w, h } = op.region.docRect;
      lines.push(`${L.coordinates}: (${x},${y})–(${x + w},${y + h})`);
    }
    if (op.instruction) lines.push(`${L.instruction}: ${op.instruction}`);
    return lines.join('\n');
  }

  // ---- Element operation ----
  lines.push(`${L.target}: ${op.target}`);

  // Location 仅对含 Annotation 的操作显示
  if (op.location && op.type.includes('Annotation')) {
    lines.push(`${L.location}: ${op.location}`);
  }

  if (op.instruction) lines.push(`${L.instruction}: ${op.instruction}`);

  // 内容修改（在 CSS 表格之前）
  for (const cc of op.contentChanges) {
    lines.push(renderContentChange(cc, L));
  }

  // CSS 修改表格
  if (op.cssChanges.length > 0) {
    lines.push(`${L.changes}:`);
    for (const c of op.cssChanges) {
      lines.push(`  | ${c.cssProp} | ${c.oldValue} | ${c.newValue} |`);
    }
  }

  // Move 块（§6.3：仅初始→最终）
  if (op.move) {
    const m = op.move;
    lines.push(`${L.move}:`);
    lines.push(`  ${L.source}: ${op.target}`);
    // 嵌入（DOM 重父）：把结构关系放在坐标之前，指示 AI 按 DOM/flex 结构移动而非硬编码坐标
    if (m.reparent) {
      lines.push(`  ${L.into}: ${m.reparent.toSelector}`);
    }
    lines.push(`  ${L.target}: (${m.finalRect.x}, ${m.finalRect.y})`);
    lines.push(`  ${L.initial}: ${renderVp(m.initialRect)}`);
    lines.push(`  ${L.final}: ${renderVp(m.finalRect)}`);
    lines.push(`  ${L.snap}: ${describeSnap(m, L)}`);
  }

  return lines.join('\n');
}

// ============================================================
// renderTaskList
// ============================================================

export function renderTaskList(
  ops: Operation[],
  ctx: PageContext,
  lang: string = 'en'
): string {
  const effectiveLang = normalizeLang(lang);
  const rules = GLOBAL_RULES[effectiveLang];
  const L = LABELS[effectiveLang];

  const sections: string[] = [];

  // [Page Context]
  sections.push(
    [
      L.pageContext,
      `- ${L.url}: ${ctx.url}`,
      `- ${L.title}: ${ctx.title}`,
      `- ${L.viewport}: ${ctx.viewportW} × ${ctx.viewportH} (px)`,
      `- ${L.timestamp}: ${ctx.timestamp}`,
    ].join('\n')
  );

  // [Global Editing Rules]
  sections.push(
    [L.globalRules, ...rules.map((r) => `- ${r}`)].join('\n')
  );

  // [Operations]
  if (ops.length === 0) {
    sections.push(`${L.operations}\n${L.noOperations}`);
  } else {
    sections.push([L.operations, ops.map((op) => renderOp(op, L)).join('\n\n')].join('\n'));
  }

  return sections.join('\n\n');
}
