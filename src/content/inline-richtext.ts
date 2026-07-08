/* ============================================================
   inline-richtext.ts — Word 式双行富文本浮条（阶段 4a / F21 重写）
   视觉配方严格照搬 preview/parts/24-inline-edit.html 的 .rtbar 结构。
   显示时机：进入内联编辑即常驻显示，直到退出编辑（有非折叠选区贴选区上方，
   否则锚定 editEl 上边缘，绝不遮挡正在编辑的文字）。
   所有浮条按钮在 mousedown 上 preventDefault（保住选区、避免 contentEditable 失焦）。
   F21：彻底放弃 execCommand（对齐/字色/加粗等要么写不进导出、要么落在 editEl 自身
   style 上被退出时的整段还原抹掉）。改为统一「意图捕获」——每个动作执行即：
   - 选区态：把选区包进带内联样式的 <span>（字体/字号加 !important 稳压宿主）；
   - 光标态：作用于整块（复用单层包裹 span；对齐写 editEl.style.text-align）；
   并同步 push 一条结构化 RichTextChange 到会话缓冲，作为导出到 AI 提示词的唯一富文本源。
   底部右下角原「无序列表」钮改为「保存对勾」，是显式提交编辑的入口之一（另一为 Ctrl/Cmd+Enter）。
   ============================================================ */

import { t, getLocale } from './i18n';
import { openColorPicker } from './color-picker';
import { openDropdown, sampleAncestorValues, primaryFontFamily } from './dropdown';
import { bindPopoverToggle } from './popover';
import type { RichTextChange, RichTextKind } from '../state/annotations';
import { mergeRichText } from '../state/annotations';
import { formatRichTextLine, richTextLabelsFor } from './format';

/* ---- SVG 图标 ---- */

const chevD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const highlightIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`;
const alignIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/></svg>`;
/** 保存对勾图标（Lucide check）——底部原「无序列表」钮改为「保存」提交按钮（F21#1） */
const checkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

/* ---- 字体/字号列表 ---- */

/**
 * 字体候选：每项都带可靠的兜底字体栈（结尾必为通用族），保证任意选择都能渲染出
 * 变化——避免直接给裸 web-font 名（如 Inter/Roboto，目标页多半没装 → 视觉无变化）。
 * value 用首选族名（与 computed 的 primaryFontFamily 可比，供当前项打勾高亮）。
 */
interface FontChoice {
  /** 显示名 */
  label: string;
  /** 当前值匹配用（= 首选族名） */
  value: string;
  /** 实际应用的带兜底字体栈 */
  stack: string;
}

export const FONT_LIST: FontChoice[] = [
  { label: 'System UI', value: 'system-ui', stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  { label: 'Arial', value: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
  { label: 'Helvetica', value: 'Helvetica Neue', stack: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
  { label: 'Verdana', value: 'Verdana', stack: 'Verdana, Geneva, Tahoma, sans-serif' },
  { label: 'Tahoma', value: 'Tahoma', stack: 'Tahoma, Verdana, Geneva, sans-serif' },
  { label: 'Georgia', value: 'Georgia', stack: 'Georgia, "Times New Roman", Times, serif' },
  { label: 'Times New Roman', value: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
  { label: 'Courier New', value: 'Courier New', stack: '"Courier New", Consolas, monospace' },
  { label: 'Consolas', value: 'Consolas', stack: 'Consolas, "Courier New", monospace' },
  { label: 'Sans-serif', value: 'sans-serif', stack: 'sans-serif' },
  { label: 'Serif', value: 'serif', stack: 'serif' },
  { label: 'Monospace', value: 'monospace', stack: 'monospace' },
];

const GENERIC_FAMILY_RE =
  /^(serif|sans-serif|monospace|cursive|fantasy|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|math|emoji|fangsong)$/i;

/**
 * 把下拉选中值（FONT_LIST 首选族名 / 智能识别采到的实际族名 / 通用族关键字）
 * 解析为一个总能渲染出东西的字体栈：
 * - FONT_LIST 命中 → 用其带兜底的栈
 * - 通用族关键字 → 原样返回
 * - 其余具体族名 → 加引号并补 sans-serif 兜底
 * 纯函数，便于单测。
 */
export function resolveFontStack(value: string): string {
  const choice = FONT_LIST.find((f) => f.value === value);
  if (choice) return choice.stack;
  if (GENERIC_FAMILY_RE.test(value)) return value;
  const name = value.replace(/["']/g, '').trim();
  const quoted = /\s/.test(name) ? `"${name}"` : name;
  return `${quoted}, sans-serif`;
}

const SIZE_LIST = ['10', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '64'];

/* ---- RichTextBar ---- */

export interface RichTextBarOptions {
  /** panel 层（浮条挂载容器） */
  panelLayer: HTMLElement;
  /** 当前正在编辑的 contentEditable 元素 */
  editEl: HTMLElement;
  /** 保存对勾（或 Ctrl/Cmd+Enter）提交编辑（F21：唯一显式提交入口之一） */
  onCommit: () => void;
}

/** computed text-align 归一为可读值（start/end → left/right，空 → left） */
function normalizeAlign(v: string): string {
  if (v === 'start') return 'left';
  if (v === 'end') return 'right';
  return v || 'left';
}

export class RichTextBar {
  private el: HTMLElement;
  private panelLayer: HTMLElement;
  private editEl: HTMLElement;
  private onCommit: () => void;
  /** 当前颜色状态（字色 abar） */
  private currentFgColor = 'var(--c1)';
  /** 打开弹层前存下的选区（弹层交互会塌陷页面选区，回调时恢复） */
  private savedRange: Range | null = null;
  /**
   * 本次编辑会话的结构化富文本修改缓冲（F21）：每个动作在**执行即记录**
   * （按意图捕获，不靠 diff innerHTML）。提交时由 DirectEditManager 读取
   * getChanges() 归并后并入标注 richText[]，作为导出唯一富文本源。
   */
  private changes: RichTextChange[] = [];
  /** 字体/字号选择器的显示标签（selectionchange 时实时刷新，N6 修复） */
  private fontLabel: HTMLSpanElement | null = null;
  private sizeLabel: HTMLSpanElement | null = null;

  constructor(opts: RichTextBarOptions) {
    this.panelLayer = opts.panelLayer;
    this.editEl = opts.editEl;
    this.onCommit = opts.onCommit;
    this.el = this.buildBar();
    this.panelLayer.appendChild(this.el);

    // 浮条在整个编辑期间常驻显示（不随选区折叠隐藏）：
    // 选区变化时重定位；滚动/缩放时跟随。
    document.addEventListener('selectionchange', this.reposition);
    window.addEventListener('scroll', this.reposition, { capture: true, passive: true });
    window.addEventListener('resize', this.reposition);
    this.reposition();
  }

  destroy(): void {
    document.removeEventListener('selectionchange', this.reposition);
    window.removeEventListener('scroll', this.reposition, true);
    window.removeEventListener('resize', this.reposition);
    this.el.remove();
  }

  /** 读取本次会话归并去重后的结构化修改（提交时 DirectEditManager 调用） */
  getChanges(): RichTextChange[] {
    return mergeRichText([], this.changes);
  }

  /**
   * 重定位浮条（常驻，不隐藏）：
   * 有落在 editEl 内的非折叠选区 → 贴选区上方；
   * 否则（折叠光标/无选区）→ 锚定在 editEl 上边缘上方，绝不遮挡正在编辑的文字。
   */
  private reposition = (): void => {
    this.updateDropdownLabels();
    const rect = this.currentAnchorRect();
    this.showAt(rect);
  };

  /** 选出锚定矩形：优先 editEl 内的非折叠选区框，回退 editEl 外框 */
  private currentAnchorRect(): DOMRect {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (
        this.editEl.contains(range.commonAncestorContainer) &&
        typeof range.getBoundingClientRect === 'function'
      ) {
        const r = range.getBoundingClientRect();
        if (r.width > 0 || r.height > 0) return r;
      }
    }
    return this.editEl.getBoundingClientRect();
  }

  private showAt(rect: DOMRect): void {
    const barW = this.el.offsetWidth || 320;
    const barH = this.el.offsetHeight || 76;
    const GAP = 8;
    const EDGE = 8;
    let top = rect.top - barH - GAP;
    let left = rect.left;
    // 上方放不下 → 翻到锚定矩形下方（editEl 锚定时即整个元素下方，不压文字）
    if (top < EDGE) top = rect.bottom + GAP;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    left = Math.max(EDGE, Math.min(left, vw - barW - EDGE));
    top = Math.max(EDGE, Math.min(top, vh - barH - EDGE));
    this.el.style.left = `${left}px`;
    this.el.style.top = `${top}px`;
  }

  /**
   * 字体/字号选择器标签跟随选区实时刷新（N6 修复：不再硬编码默认值）。
   * 选区跨不同值时，以选区起点的计算值为准——不试图枚举混合值。
   */
  private updateDropdownLabels(): void {
    if (this.fontLabel) {
      const family = primaryFontFamily(this.getComputedProp('fontFamily'));
      const entry = FONT_LIST.find((f) => f.value === family);
      this.fontLabel.textContent = entry ? entry.label : family || '—';
    }
    if (this.sizeLabel) {
      const n = Math.round(parseFloat(this.getComputedProp('fontSize')));
      this.sizeLabel.textContent = Number.isFinite(n) ? String(n) : '—';
    }
  }

  // ============================================================
  // 应用 + 记录（F21：DROP execCommand，统一 span 包裹 / 元素级样式）
  // 这些 public 方法既是浮条按钮/弹层回调的落点，也是单测的驱动入口。
  // ============================================================

  /** 字体：包选区或整块，记 kind='font-family'（old/new 为首选族名） */
  applyFontFamily(value: string): void {
    const old = primaryFontFamily(this.getComputedProp('fontFamily'));
    const ctx = this.applyStyle('font-family', resolveFontStack(value), true);
    this.record('font-family', ctx.target, ctx.targetText, old, value);
  }

  /** 字号：包选区或整块，记 kind='font-size'（old=computed，如 '16px'；new='Npx'） */
  applyFontSize(px: string): void {
    const old = this.getComputedProp('fontSize');
    const ctx = this.applyStyle('font-size', `${px}px`, true);
    this.record('font-size', ctx.target, ctx.targetText, old, `${px}px`);
  }

  /** 字色：包选区或整块，记 kind='color' */
  applyColor(css: string): void {
    const old = this.getComputedProp('color');
    const ctx = this.applyStyle('color', css, false);
    this.currentFgColor = css;
    this.record('color', ctx.target, ctx.targetText, old, css);
  }

  /** 高亮：包选区或整块 background-color，记 kind='highlight' */
  applyHighlight(css: string): void {
    const old = this.getComputedProp('backgroundColor');
    const ctx = this.applyStyle('background-color', css, false);
    this.record('highlight', ctx.target, ctx.targetText, old, css);
  }

  /**
   * 对齐：绝不写 span，始终作用于可编辑块自身 style.text-align（元素级），
   * 记 kind='align'、target='element'（含仅光标态，满足 F21#4）。
   * text-align 的 DOM 还原由 richtext 载体（editEl.textAlign 快照）负责。
   */
  applyAlign(dir: 'left' | 'center' | 'right'): void {
    const old = normalizeAlign(this.getComputedProp('textAlign'));
    this.editEl.style.setProperty('text-align', dir);
    this.record('align', 'element', undefined, old, dir);
  }

  toggleBold(): void {
    this.applyToggle('bold', 'font-weight', '700', 'normal', this.weightIsBold());
  }
  toggleItalic(): void {
    this.applyToggle('italic', 'font-style', 'italic', 'normal', this.styleIsItalic());
  }
  toggleUnderline(): void {
    this.applyToggle('underline', 'text-decoration-line', 'underline', 'none', this.hasDecoration('underline'));
  }
  toggleStrike(): void {
    this.applyToggle('strike', 'text-decoration-line', 'line-through', 'none', this.hasDecoration('line-through'));
  }
  toggleSuperscript(): void {
    this.applyToggle('superscript', 'vertical-align', 'super', 'baseline', this.getComputedProp('verticalAlign') === 'super');
  }
  toggleSubscript(): void {
    this.applyToggle('subscript', 'vertical-align', 'sub', 'baseline', this.getComputedProp('verticalAlign') === 'sub');
  }

  private weightIsBold(): boolean {
    const w = this.getComputedProp('fontWeight');
    return w === 'bold' || (parseInt(w, 10) || 0) >= 600;
  }
  private styleIsItalic(): boolean {
    const s = this.getComputedProp('fontStyle');
    return s === 'italic' || s.startsWith('oblique');
  }
  private hasDecoration(kind: 'underline' | 'line-through'): boolean {
    return this.getComputedProp('textDecorationLine').includes(kind);
  }

  /** 开关类：按当前态取反 → 应用 → 记 old/new='on'/'off' */
  private applyToggle(
    kind: RichTextKind,
    cssProp: string,
    onVal: string,
    offVal: string,
    isOn: boolean
  ): void {
    let ctx: { target: 'selection' | 'element'; targetText?: string };
    if (isOn && cssProp === 'text-decoration-line') {
      // text-decoration-line: none 无法覆盖祖先 span 的装饰（CSS 绘制机制不受后代影响），
      // 必须直接从有该属性的 span 上 removeProperty（N7 修复）。
      ctx = this.removeDecorationToggle();
    } else {
      ctx = this.applyStyle(cssProp, isOn ? offVal : onVal, false);
    }
    this.record(kind, ctx.target, ctx.targetText, isOn ? 'on' : 'off', isOn ? 'off' : 'on');
  }

  /**
   * text-decoration-line「关闭」：直接从实际持有该属性的 span 上 removeProperty，
   * 而不是用 setProperty('none')——CSS text-decoration 是绘制属性，后代 none 无法取消祖先的装饰。
   * 处理路径：
   * 1. 元素级（光标态）→ 取整块包裹 span 移除；
   * 2. 选区精确匹配某 span → 直接在该 span 上 removeProperty；
   * 3. 选区仅覆盖 span 部分内容 → 沿 DOM 向上找最近的装饰 span 整体移除。
   */
  private removeDecorationToggle(): { target: 'selection' | 'element'; targetText?: string } {
    const ctx = this.currentTargetContext();
    const PROP = 'text-decoration-line';
    if (ctx.target === 'element') {
      const el = this.editEl;
      const only = el.firstChild;
      if (el.childNodes.length === 1 && only instanceof HTMLElement && only.tagName === 'SPAN') {
        only.style.removeProperty(PROP);
      } else {
        el.style.removeProperty(PROP);
      }
    } else {
      const sel = window.getSelection();
      let handled = false;
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const reuse = this.selectionWrapSpan(range);
        if (reuse && reuse.style.getPropertyValue(PROP)) {
          reuse.style.removeProperty(PROP);
          handled = true;
        }
      }
      if (!handled) {
        // 选区仅覆盖 span 部分内容（selectionWrapSpan 未能精确匹配），
        // 向上找最近有该属性的 span 并移除（整 span 去装饰）。
        let node: HTMLElement | null = this.selectionAnchorElement();
        while (node && node !== this.editEl) {
          if (node.tagName === 'SPAN' && node.style.getPropertyValue(PROP)) {
            node.style.removeProperty(PROP);
            break;
          }
          node = node.parentElement;
        }
      }
    }
    return ctx;
  }

  /**
   * 有非折叠选区 → 包选区 span；否则（光标态）→ 整块（复用/新建单层包裹 span）。
   * 返回本次作用范围，供 record 归类。读 ctx 在 apply 之前（apply 会改选区/DOM）。
   */
  private applyStyle(cssProp: string, value: string, important: boolean): {
    target: 'selection' | 'element';
    targetText?: string;
  } {
    const ctx = this.currentTargetContext();
    if (ctx.target === 'selection') {
      this.wrapSelectionStyle(cssProp, value, important);
    } else {
      this.elementScopeApply(cssProp, value, important);
    }
    return ctx;
  }

  /** 当前活动选区落在 editEl 内且非折叠 → 'selection' + 文本；否则 'element' */
  private currentTargetContext(): { target: 'selection' | 'element'; targetText?: string } {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const r = sel.getRangeAt(0);
      if (this.editEl.contains(r.commonAncestorContainer)) {
        return { target: 'selection', targetText: r.toString() };
      }
    }
    return { target: 'element' };
  }

  /**
   * 元素级应用（光标态/无选区）：把整块内容包进单层 <span> 并设样式。
   * 已存在唯一包裹 span 时直接复用，避免元素级链式修改叠套嵌套。
   */
  private elementScopeApply(cssProp: string, value: string, important: boolean): void {
    const el = this.editEl;
    const priority = important ? 'important' : '';
    const only = el.firstChild;
    if (
      el.childNodes.length === 1 &&
      only instanceof HTMLElement &&
      only.tagName === 'SPAN'
    ) {
      only.style.setProperty(cssProp, value, priority);
      return;
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    if (range.collapsed) return; // 空元素，无内容可包
    const span = document.createElement('span');
    span.style.setProperty(cssProp, value, priority);
    try {
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      span.appendChild(frag);
      el.appendChild(span);
    }
  }

  /** 记录一条结构化修改（summary 用当前界面语言预生成，卡片直接展示） */
  private record(
    kind: RichTextKind,
    target: 'selection' | 'element',
    targetText: string | undefined,
    oldValue: string,
    newValue: string
  ): void {
    const change: RichTextChange = { kind, target, targetText, oldValue, newValue, summary: '' };
    change.summary = formatRichTextLine(change, richTextLabelsFor(getLocale()));
    this.changes.push(change);
  }

  private buildBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pd-surface rtbar';
    bar.setAttribute('data-testid', 'pd-rtbar');
    bar.setAttribute('data-pd-popover', '');

    // ---- 第一行：字体 ▾ / 字号 ▾ / 字色 / 高亮 ---- //
    const row1 = document.createElement('div');
    row1.className = 'rtrow';

    // 字体下拉触发钮
    const fontSel = this.makeDropdownTrigger('selfont', t('rt_font'), '');
    this.fontLabel = fontSel.querySelector<HTMLSpanElement>('.v');
    const fontBtn = fontSel.querySelector('button') as HTMLElement;
    bindPopoverToggle(fontBtn, (onClose) => {
      this.saveSelection();
      const anchorEl = this.selectionAnchorElement();
      const smartValues = sampleAncestorValues(anchorEl, (node) => {
        const ff = node.ownerDocument.defaultView?.getComputedStyle(node).fontFamily;
        return ff ? primaryFontFamily(ff) : null;
      });
      return openDropdown({
        root: this.panelLayer,
        anchor: fontBtn,
        items: FONT_LIST.map((f) => ({ value: f.value, label: f.label, fontFamily: f.stack })),
        smartItems: smartValues.map((v) => ({ value: v, label: v, fontFamily: resolveFontStack(v) })),
        current: primaryFontFamily(this.getComputedProp('fontFamily')),
        onPick: (v) => {
          this.restoreSelection();
          this.applyFontFamily(v);
        },
        onClose,
      });
    });
    row1.appendChild(fontSel);

    // 字号下拉触发钮
    const sizeSel = this.makeDropdownTrigger('selsz', t('rt_size'), '', 'pd-rt-size');
    this.sizeLabel = sizeSel.querySelector<HTMLSpanElement>('.v');
    const sizeBtn = sizeSel.querySelector('button') as HTMLElement;
    bindPopoverToggle(sizeBtn, (onClose) => {
      this.saveSelection();
      const anchorEl = this.selectionAnchorElement();
      const smartValues = sampleAncestorValues(anchorEl, (node) => {
        const fs = node.ownerDocument.defaultView?.getComputedStyle(node).fontSize;
        if (!fs) return null;
        const n = Math.round(parseFloat(fs));
        return Number.isFinite(n) ? String(n) : null;
      });
      return openDropdown({
        root: this.panelLayer,
        anchor: sizeBtn,
        items: SIZE_LIST.map((s) => ({ value: s, label: s + 'px' })),
        smartItems: smartValues.map((v) => ({ value: v, label: v + 'px' })),
        current: Math.round(parseFloat(this.getComputedProp('fontSize'))).toString(),
        onPick: (v) => {
          this.restoreSelection();
          this.applyFontSize(v);
        },
        onClose,
      });
    });
    row1.appendChild(sizeSel);

    row1.appendChild(this.makeSep());

    // 字色按钮（A + 色条）
    const colorBtn = document.createElement('button');
    colorBtn.className = 'tb col';
    colorBtn.setAttribute('title', t('rt_color'));
    colorBtn.setAttribute('data-testid', 'pd-rt-color');
    const colorA = document.createElement('span');
    colorA.style.cssText = 'font-weight:700;line-height:1';
    colorA.textContent = 'A';
    const colorBar = document.createElement('span');
    colorBar.className = 'abar';
    colorBar.style.background = this.currentFgColor;
    colorBtn.appendChild(colorA);
    colorBtn.appendChild(colorBar);
    colorBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    bindPopoverToggle(colorBtn, (onClose) => {
      this.saveSelection();
      return openColorPicker({
        root: this.panelLayer,
        anchor: colorBtn,
        target: this.editEl,
        value: this.getComputedProp('color'),
        onChange: (css) => {
          this.restoreSelection();
          this.applyColor(css);
          colorBar.style.background = css;
        },
        onClose,
      });
    });
    row1.appendChild(colorBtn);

    // 高亮按钮
    const hlBtn = document.createElement('button');
    hlBtn.className = 'tb';
    hlBtn.setAttribute('title', t('rt_highlight'));
    hlBtn.setAttribute('data-testid', 'pd-rt-highlight');
    hlBtn.innerHTML = highlightIcon + `<svg class="car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    hlBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    bindPopoverToggle(hlBtn, (onClose) => {
      this.saveSelection();
      return openColorPicker({
        root: this.panelLayer,
        anchor: hlBtn,
        target: this.editEl,
        value: this.getComputedProp('backgroundColor'),
        onChange: (css) => {
          this.restoreSelection();
          this.applyHighlight(css);
        },
        onClose,
      });
    });
    row1.appendChild(hlBtn);

    bar.appendChild(row1);

    // ---- 第二行：B/I/U/S / 上标/下标 / 对齐 ▾ / 保存 ---- //
    const row2 = document.createElement('div');
    row2.className = 'rtrow';

    // B/I/U/S 切换组
    const fmt = document.createElement('div');
    fmt.className = 'fmt';

    fmt.appendChild(this.makeFmtBtn('B', 'b', t('rt_bold'), 'pd-rt-bold', () => this.toggleBold()));
    fmt.appendChild(this.makeFmtBtn('I', 'i', t('rt_italic'), 'pd-rt-italic', () => this.toggleItalic()));
    fmt.appendChild(this.makeFmtBtn('U', 'u', t('rt_underline'), 'pd-rt-underline', () => this.toggleUnderline()));
    fmt.appendChild(this.makeFmtBtn('S', 's', t('rt_strike'), 'pd-rt-strike', () => this.toggleStrike()));
    row2.appendChild(fmt);

    row2.appendChild(this.makeSep());

    // 上标
    const supBtn = document.createElement('button');
    supBtn.className = 'tb sup';
    supBtn.setAttribute('title', t('rt_superscript'));
    supBtn.innerHTML = '<span>x<sup>2</sup></span>';
    supBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    supBtn.addEventListener('click', () => this.toggleSuperscript());
    row2.appendChild(supBtn);

    // 下标
    const subBtn = document.createElement('button');
    subBtn.className = 'tb sup';
    subBtn.setAttribute('title', t('rt_subscript'));
    subBtn.innerHTML = '<span>x<sub>2</sub></span>';
    subBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    subBtn.addEventListener('click', () => this.toggleSubscript());
    row2.appendChild(subBtn);

    row2.appendChild(this.makeSep());

    // 对齐下拉（值即 CSS text-align，作用于整块）
    const alignBtn = document.createElement('button');
    alignBtn.className = 'tb';
    alignBtn.setAttribute('title', t('rt_align'));
    alignBtn.setAttribute('data-testid', 'pd-rt-align');
    alignBtn.innerHTML = alignIcon + `<svg class="car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    alignBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    bindPopoverToggle(alignBtn, (onClose) =>
      openDropdown({
        root: this.panelLayer,
        anchor: alignBtn,
        items: [
          { value: 'left', label: 'Left' },
          { value: 'center', label: 'Center' },
          { value: 'right', label: 'Right' },
        ],
        current: normalizeAlign(this.getComputedProp('textAlign')),
        onPick: (v) => {
          this.editEl.focus();
          this.applyAlign(v as 'left' | 'center' | 'right');
        },
        onClose,
      })
    );
    row2.appendChild(alignBtn);

    // 保存对勾（F21#1：底部原「列表」钮改为提交编辑）
    const saveBtn = document.createElement('button');
    saveBtn.className = 'tb';
    saveBtn.setAttribute('title', t('rt_save'));
    saveBtn.setAttribute('data-testid', 'pd-rt-save');
    saveBtn.innerHTML = checkIcon;
    // mousedown 上 preventDefault：保住 editable 焦点/选区，click 才不被 blur 抢先
    saveBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    saveBtn.addEventListener('click', () => this.onCommit());
    row2.appendChild(saveBtn);

    bar.appendChild(row2);

    return bar;
  }

  private makeDropdownTrigger(extraClass: string, title: string, defaultVal: string, testId?: string): HTMLSpanElement {
    const wrap = document.createElement('span');
    wrap.className = `pd-sel ${extraClass}`;
    if (testId) wrap.setAttribute('data-testid', testId);
    const btn = document.createElement('button');
    btn.className = 'pd-select';
    btn.setAttribute('title', title);
    btn.type = 'button';
    const v = document.createElement('span');
    v.className = 'v';
    v.textContent = defaultVal;
    btn.appendChild(v);
    btn.addEventListener('mousedown', (ev) => ev.preventDefault());
    const arrow = document.createElement('span');
    arrow.className = 'pd-sel-arrow';
    arrow.innerHTML = chevD;
    wrap.appendChild(btn);
    wrap.appendChild(arrow);
    return wrap;
  }

  private makeSep(): HTMLSpanElement {
    const sep = document.createElement('span');
    sep.className = 'sep';
    return sep;
  }

  private makeFmtBtn(
    label: string,
    extraClass: string,
    title: string,
    testId: string,
    onExec: () => void
  ): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = extraClass;
    btn.setAttribute('title', title);
    btn.setAttribute('data-testid', testId);
    btn.textContent = label;
    btn.addEventListener('mousedown', (ev) => ev.preventDefault());
    btn.addEventListener('click', () => onExec());
    return btn;
  }

  /**
   * 存下当前选区（触发钮 mousedown 已 preventDefault，此刻选区仍在）。
   * 只在选区非折叠且落在 editEl 内时记录，否则清空。
   */
  private saveSelection(): void {
    const s = window.getSelection();
    this.savedRange =
      s && s.rangeCount && !s.isCollapsed && this.editEl.contains(s.getRangeAt(0).commonAncestorContainer)
        ? s.getRangeAt(0).cloneRange()
        : null;
  }

  /** 恢复之前存下的选区（弹层交互塌陷后）；失败静默兜底 */
  private restoreSelection(): void {
    this.editEl.focus();
    const s = window.getSelection();
    if (!s || !this.savedRange) return;
    try {
      s.removeAllRanges();
      s.addRange(this.savedRange.cloneRange());
    } catch {
      // Range 因内容包裹失效（拖动连续触发时可能出现）→ 静默
    }
  }

  /** 当前选区锚点的最近元素（落在 editEl 内），无选区则回退 editEl */
  private selectionAnchorElement(): HTMLElement {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      let node: Node | null = sel.getRangeAt(0).startContainer;
      if (node && node.nodeType !== Node.ELEMENT_NODE) node = node.parentElement;
      if (node instanceof HTMLElement && this.editEl.contains(node)) return node;
    }
    return this.editEl;
  }

  /** 读取当前选区锚点元素的 computed style（选区无则从 editEl 读） */
  private getComputedProp(prop: string): string {
    const cs = window.getComputedStyle(this.selectionAnchorElement());
    return (cs as unknown as Record<string, string>)[prop] ?? '';
  }

  /**
   * 选区恰好覆盖某个已有 <span> 的全部内容时返回该 span（供复用，避免叠套冗余 span，
   * 典型链式：先选字体再选字号作用于同一段）。否则返回 null。
   */
  private selectionWrapSpan(range: Range): HTMLElement | null {
    const common = range.commonAncestorContainer;
    const el = common.nodeType === Node.ELEMENT_NODE ? (common as HTMLElement) : common.parentElement;
    if (!el || el === this.editEl || el.tagName !== 'SPAN') return null;
    const full = document.createRange();
    full.selectNodeContents(el);
    const sameStart = range.compareBoundaryPoints(Range.START_TO_START, full) === 0;
    const sameEnd = range.compareBoundaryPoints(Range.END_TO_END, full) === 0;
    return sameStart && sameEnd ? el : null;
  }

  /**
   * 把当前非折叠选区包进一个带内联样式的 <span>，稳压宿主页 CSS（important 可选）。
   * 单 Range 常规场景走 surroundContents；跨节点选区回退 extract+wrap+insert。
   * 完成后重新选中该 span 内容，保住选区以便链式修改。
   */
  private wrapSelectionStyle(prop: string, value: string, important = false): void {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.collapsed || !this.editEl.contains(range.commonAncestorContainer)) return;
    const priority = important ? 'important' : '';

    // 选区恰好是某个已有 span 的全部内容 → 复用它（合并样式，避免嵌套冗余 span）
    const reuse = this.selectionWrapSpan(range);
    if (reuse) {
      reuse.style.setProperty(prop, value, priority);
      return;
    }

    const span = document.createElement('span');
    span.style.setProperty(prop, value, priority);
    try {
      range.surroundContents(span);
    } catch {
      // 跨节点选区：surroundContents 会抛错 → 提取内容后整体包裹再插回
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }

    // 重新选中 span 内容，链式操作继续作用于同一段文本
    const nr = document.createRange();
    nr.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(nr);
    this.savedRange = nr.cloneRange();
  }
}
