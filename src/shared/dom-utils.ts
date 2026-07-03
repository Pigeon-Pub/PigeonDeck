/* ============================================================
   dom-utils.ts — 页面元素 DOM 工具
   选择器生成 / 元素分类 / 摘要 / 可见性判定。
   供批注（选择器持久化+恢复）与后续导出模块共用。
   ============================================================ */

export type ElementType = 'text' | 'image' | 'video' | 'button' | 'container' | 'other';

/** 选择器生成的最大祖先深度（超过则接受非唯一性兜底） */
const MAX_SELECTOR_DEPTH = 8;

/** CSS.escape 兜底（jsdom 测试环境无 CSS 全局） */
function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }
  return value.replace(/[!-,./:-@\[-^`{-~]/g, (ch) => '\\' + ch);
}

/** class 是否适合用于选择器（排除明显是状态/工具类的噪音） */
function isStableClass(cls: string): boolean {
  // 排除含数字哈希风格（如 css-1x2y3z、jsx-483920）与过长的类名
  if (cls.length > 40) return false;
  if (/^(css|jss|jsx|sc)-/.test(cls)) return false;
  if (/^[a-z]+-?[0-9a-f]{5,}$/i.test(cls)) return false;
  return true;
}

/** 单层选择器：优先 id → 唯一 class 组合 → tag:nth-of-type */
function segmentFor(el: Element, scope: ParentNode): string | null {
  // 1) id（文档内唯一才用）
  if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) {
    const sel = `#${cssEscape(el.id)}`;
    if (el.ownerDocument.querySelectorAll(sel).length === 1) return sel;
  }

  const tag = el.tagName.toLowerCase();

  // 2) 同级唯一的 class 组合
  const classes = Array.from(el.classList).filter(isStableClass);
  if (classes.length > 0) {
    const sel = `${tag}.${classes.map((c) => cssEscape(c)).join('.')}`;
    try {
      if (scope.querySelectorAll(`:scope > ${sel}`).length === 1) return sel;
    } catch {
      // :scope 不可用时忽略，走 nth-of-type
    }
  }

  // 3) tag:nth-of-type
  let index = 1;
  let sib = el.previousElementSibling;
  while (sib) {
    if (sib.tagName === el.tagName) index++;
    sib = sib.previousElementSibling;
  }
  return `${tag}:nth-of-type(${index})`;
}

/**
 * 为页面元素生成稳定唯一的 CSS 选择器。
 * 逐层向上拼接：id 段是锚点（终止）；唯一 class 段若全局唯一命中可提前返回；
 * 纯 nth-of-type 段不单独作锚（易随页面变动漂移），继续上溯至 id 或 body。
 * 生成后用 querySelector 验证唯一性，不唯一则继续加长。
 */
export function buildSelector(el: Element): string {
  const doc = el.ownerDocument;
  const parts: string[] = [];
  let cur: Element | null = el;
  let depth = 0;

  while (cur && cur !== doc.documentElement && cur !== doc.body) {
    const parent: ParentNode = cur.parentNode ?? doc;
    const seg = segmentFor(cur, parent);
    if (!seg) break;
    parts.unshift(seg);

    // id 段是全局锚点，直接终止
    if (seg.startsWith('#')) break;

    // class 段可能全局唯一：验证命中即提前返回（短且稳）
    if (seg.includes('.')) {
      const candidate = parts.join(' > ');
      const m = doc.querySelectorAll(candidate);
      if (m.length === 1 && m[0] === el) return candidate;
    }

    // 软深度上限：超过后若当前链已唯一命中则接受，避免无限加长
    depth++;
    if (depth >= MAX_SELECTOR_DEPTH) {
      const candidate = parts.join(' > ');
      const m = doc.querySelectorAll(candidate);
      if (m.length === 1 && m[0] === el) return candidate;
    }

    cur = cur.parentElement;
  }

  const selector = parts.join(' > ') || el.tagName.toLowerCase();
  // 最终验证：唯一且命中目标才算合格；否则原样返回（结构链兜底，恢复时再校验）
  const matches = doc.querySelectorAll(selector);
  if (matches.length === 1 && matches[0] === el) return selector;
  return selector;
}

const BUTTON_TAGS = new Set(['BUTTON', 'A']);
const CONTAINER_TAGS = new Set([
  'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'ASIDE', 'HEADER', 'FOOTER', 'NAV',
  'UL', 'OL', 'TABLE', 'FORM', 'FIGURE', 'DETAILS', 'DIALOG',
]);

/** 元素是否含非空的直接文本子节点 */
function hasDirectText(el: Element): boolean {
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '') {
      return true;
    }
  }
  return false;
}

/**
 * 元素分类：
 * image=img；video=video；button=button/a/[role=button]；
 * text=有直接文本内容的叶子类元素；container=块级且有子元素；其余 other。
 */
export function classifyElement(el: Element): ElementType {
  const tag = el.tagName;
  if (tag === 'IMG') return 'image';
  if (tag === 'VIDEO') return 'video';
  if (BUTTON_TAGS.has(tag) || el.getAttribute('role') === 'button') return 'button';
  if (hasDirectText(el) && el.children.length === 0) return 'text';
  if (CONTAINER_TAGS.has(tag) && el.children.length > 0) return 'container';
  // 有直接文本但也有子元素的标题/段落类，仍按 text 对待
  if (hasDirectText(el)) return 'text';
  return 'other';
}

const SUMMARY_MAX = 40;

/** 简短人类可读摘要：tag + 截断文本/alt */
export function getElementSummary(el: Element): string {
  const tag = el.tagName.toLowerCase();
  let text = '';
  if (el.tagName === 'IMG') {
    text = el.getAttribute('alt') ?? '';
  } else {
    text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
  }
  if (text.length > SUMMARY_MAX) {
    text = text.slice(0, SUMMARY_MAX) + '…';
  }
  return text ? `${tag} "${text}"` : tag;
}

/** 元素当前是否可见（有布局盒 + 未被 CSS 隐藏） */
export function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const rects = el.getClientRects();
  if (rects.length === 0) return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle(el);
  if (!style) return false;
  return style.display !== 'none' && style.visibility !== 'hidden';
}

/**
 * 从 el 向上查找最近的可滚动祖先：overflow(x/y) 为 auto/scroll/overlay
 * 且实际存在滚动尺寸（scrollHeight>clientHeight 或 scrollWidth>clientWidth）。
 * 找不到返回 null（区域随 window 滚动即可，无需修正）。
 * 供区域框选记录嵌套滚动容器用（overlay 复现时按选择器再解析）。
 */
export function findScrollableAncestor(el: Element): Element | null {
  const win = el.ownerDocument.defaultView;
  if (!win) return null;
  const doc = el.ownerDocument;
  const scrollableOverflow = (v: string): boolean =>
    v === 'auto' || v === 'scroll' || v === 'overlay';
  let cur: Element | null = el.parentElement;
  while (cur && cur !== doc.body && cur !== doc.documentElement) {
    const style = win.getComputedStyle(cur);
    const canY = scrollableOverflow(style.overflowY) && cur.scrollHeight > cur.clientHeight;
    const canX = scrollableOverflow(style.overflowX) && cur.scrollWidth > cur.clientWidth;
    if (canY || canX) return cur;
    cur = cur.parentElement;
  }
  return null;
}
