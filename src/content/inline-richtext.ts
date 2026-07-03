/* ============================================================
   inline-richtext.ts — Word 式双行富文本浮条（阶段 4a）
   视觉配方严格照搬 preview/parts/24-inline-edit.html 的 .rtbar 结构。
   显示时机：进入内联编辑即常驻显示，直到退出编辑（有非折叠选区贴选区上方，
   否则锚定 editEl 上边缘，绝不遮挡正在编辑的文字）。
   所有浮条按钮在 mousedown 上 preventDefault（保住选区、避免 contentEditable 失焦）。
   execCommand 在 click 里执行（mousedown 后 click 仍会触发）。
   字体/字号：不走 execCommand（其产出的 font-family/font-size 无 !important，
   会输给宿主页的 !important 规则），改为把当前选区包进
   <span style="font-family|font-size: … !important">（wrapSelectionStyle），
   保住选区、可链式修改，且稳压宿主 CSS。
   ============================================================ */

import { t } from './i18n';
import { openColorPicker } from './color-picker';
import { openDropdown, sampleAncestorValues, primaryFontFamily } from './dropdown';

/* ---- SVG 图标 ---- */

const chevD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const highlightIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`;
const alignIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/></svg>`;
const listIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="9" x2="21" y1="6" y2="6"/><line x1="9" x2="21" y1="12" y2="12"/><line x1="9" x2="21" y1="18" y2="18"/><circle cx="4" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1.4" fill="currentColor" stroke="none"/></svg>`;

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
}

export class RichTextBar {
  private el: HTMLElement;
  private panelLayer: HTMLElement;
  private editEl: HTMLElement;
  /** 当前颜色状态（字色 abar） */
  private currentFgColor = 'var(--c1)';
  /** 打开弹层前存下的选区（弹层交互会塌陷页面选区，回调时恢复） */
  private savedRange: Range | null = null;

  constructor(opts: RichTextBarOptions) {
    this.panelLayer = opts.panelLayer;
    this.editEl = opts.editEl;
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

  /**
   * 重定位浮条（常驻，不隐藏）：
   * 有落在 editEl 内的非折叠选区 → 贴选区上方；
   * 否则（折叠光标/无选区）→ 锚定在 editEl 上边缘上方，绝不遮挡正在编辑的文字。
   */
  private reposition = (): void => {
    const rect = this.currentAnchorRect();
    this.showAt(rect);
  };

  /** 选出锚定矩形：优先 editEl 内的非折叠选区框，回退 editEl 外框 */
  private currentAnchorRect(): DOMRect {
    const sel = window.getSelection();
    if (sel && sel.rangeCount && !sel.isCollapsed) {
      const range = sel.getRangeAt(0);
      if (this.editEl.contains(range.commonAncestorContainer)) {
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

  private buildBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pd-surface rtbar';
    bar.setAttribute('data-testid', 'pd-rtbar');
    bar.setAttribute('data-pd-popover', '');

    // ---- 第一行：字体 ▾ / 字号 ▾ / 字色 / 高亮 ---- //
    const row1 = document.createElement('div');
    row1.className = 'rtrow';

    // 字体下拉触发钮
    const fontSel = this.makeDropdownTrigger('selfont', t('rt_font'), 'System UI');
    fontSel.querySelector('button')!.addEventListener('click', () => {
      this.saveSelection();
      const anchorEl = this.selectionAnchorElement();
      const smartValues = sampleAncestorValues(anchorEl, (node) => {
        const ff = node.ownerDocument.defaultView?.getComputedStyle(node).fontFamily;
        return ff ? primaryFontFamily(ff) : null;
      });
      openDropdown({
        root: this.panelLayer,
        anchor: fontSel.querySelector('button') as HTMLElement,
        items: FONT_LIST.map((f) => ({ value: f.value, label: f.label, fontFamily: f.stack })),
        smartItems: smartValues.map((v) => ({ value: v, label: v, fontFamily: resolveFontStack(v) })),
        current: primaryFontFamily(this.getComputedProp('fontFamily')),
        onPick: (v) => {
          this.restoreSelection();
          // 用 !important 内联 span 稳压宿主页 !important 规则
          this.wrapSelectionStyle('font-family', resolveFontStack(v), true);
        },
      });
    });
    row1.appendChild(fontSel);

    // 字号下拉触发钮
    const sizeSel = this.makeDropdownTrigger('selsz', t('rt_size'), '16', 'pd-rt-size');
    sizeSel.querySelector('button')!.addEventListener('click', () => {
      this.saveSelection();
      const anchorEl = this.selectionAnchorElement();
      const smartValues = sampleAncestorValues(anchorEl, (node) => {
        const fs = node.ownerDocument.defaultView?.getComputedStyle(node).fontSize;
        if (!fs) return null;
        const n = Math.round(parseFloat(fs));
        return Number.isFinite(n) ? String(n) : null;
      });
      openDropdown({
        root: this.panelLayer,
        anchor: sizeSel.querySelector('button') as HTMLElement,
        items: SIZE_LIST.map((s) => ({ value: s, label: s + 'px' })),
        smartItems: smartValues.map((v) => ({ value: v, label: v + 'px' })),
        current: Math.round(parseFloat(this.getComputedProp('fontSize'))).toString(),
        onPick: (v) => {
          this.restoreSelection();
          // 直接把选区包进 <span style="font-size:Npx !important">，不再整段重写 innerHTML
          // （旧法会毁掉选区与节点标识，导致后续命令作用于失效节点）
          this.wrapSelectionStyle('font-size', `${v}px`, true);
        },
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
    colorBtn.addEventListener('click', () => {
      this.saveSelection();
      openColorPicker({
        root: this.panelLayer,
        anchor: colorBtn,
        target: this.editEl,
        value: this.getComputedProp('color'),
        onChange: (css) => {
          this.restoreSelection();
          this.execStyle();
          document.execCommand('foreColor', false, css);
          colorBar.style.background = css;
          this.currentFgColor = css;
        },
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
    hlBtn.addEventListener('click', () => {
      this.saveSelection();
      openColorPicker({
        root: this.panelLayer,
        anchor: hlBtn,
        target: this.editEl,
        value: this.getComputedProp('backgroundColor'),
        onChange: (css) => {
          this.restoreSelection();
          this.execStyle();
          if (!document.execCommand('hiliteColor', false, css)) {
            document.execCommand('backColor', false, css);
          }
        },
      });
    });
    row1.appendChild(hlBtn);

    bar.appendChild(row1);

    // ---- 第二行：B/I/U/S / 上标/下标 / 对齐 ▾ / 列表 ---- //
    const row2 = document.createElement('div');
    row2.className = 'rtrow';

    // B/I/U/S 切换组
    const fmt = document.createElement('div');
    fmt.className = 'fmt';

    const bBtn = this.makeFmtBtn('B', 'b', t('rt_bold'), 'pd-rt-bold', () => document.execCommand('bold'));
    const iBtn = this.makeFmtBtn('I', 'i', t('rt_italic'), 'pd-rt-italic', () => document.execCommand('italic'));
    const uBtn = this.makeFmtBtn('U', 'u', t('rt_underline'), 'pd-rt-underline', () => document.execCommand('underline'));
    const sBtn = this.makeFmtBtn('S', 's', t('rt_strike'), 'pd-rt-strike', () => document.execCommand('strikeThrough'));
    fmt.appendChild(bBtn);
    fmt.appendChild(iBtn);
    fmt.appendChild(uBtn);
    fmt.appendChild(sBtn);
    row2.appendChild(fmt);

    row2.appendChild(this.makeSep());

    // 上标
    const supBtn = document.createElement('button');
    supBtn.className = 'tb sup';
    supBtn.setAttribute('title', t('rt_superscript'));
    supBtn.innerHTML = '<span>x<sup>2</sup></span>';
    supBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    supBtn.addEventListener('click', () => { this.execStyle(); document.execCommand('superscript'); });
    row2.appendChild(supBtn);

    // 下标
    const subBtn = document.createElement('button');
    subBtn.className = 'tb sup';
    subBtn.setAttribute('title', t('rt_subscript'));
    subBtn.innerHTML = '<span>x<sub>2</sub></span>';
    subBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    subBtn.addEventListener('click', () => { this.execStyle(); document.execCommand('subscript'); });
    row2.appendChild(subBtn);

    row2.appendChild(this.makeSep());

    // 对齐下拉
    const alignBtn = document.createElement('button');
    alignBtn.className = 'tb';
    alignBtn.setAttribute('title', t('rt_align'));
    alignBtn.innerHTML = alignIcon + `<svg class="car" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
    alignBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    alignBtn.addEventListener('click', () => {
      this.saveSelection();
      openDropdown({
        root: this.panelLayer,
        anchor: alignBtn,
        items: [
          { value: 'justifyLeft', label: 'Left' },
          { value: 'justifyCenter', label: 'Center' },
          { value: 'justifyRight', label: 'Right' },
        ],
        current: '',
        onPick: (v) => {
          this.restoreSelection();
          this.execStyle();
          document.execCommand(v);
        },
      });
    });
    row2.appendChild(alignBtn);

    // 列表（无序/项目符号列表；图标为左侧圆点，区别于对齐图标）
    // 注：insertUnorderedList 是块级命令，editEl 为行内元素时浏览器可能 no-op（不报错）。
    const listBtn = document.createElement('button');
    listBtn.className = 'tb';
    listBtn.setAttribute('title', t('rt_list'));
    listBtn.setAttribute('data-testid', 'pd-rt-list');
    listBtn.innerHTML = listIcon;
    listBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
    listBtn.addEventListener('click', () => { this.execStyle(); document.execCommand('insertUnorderedList'); });
    row2.appendChild(listBtn);

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
    btn.addEventListener('click', () => {
      this.execStyle();
      onExec();
    });
    return btn;
  }

  /** 确保 execCommand 使用 CSS inline style */
  private execStyle(): void {
    document.execCommand('styleWithCSS', false, 'true');
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
