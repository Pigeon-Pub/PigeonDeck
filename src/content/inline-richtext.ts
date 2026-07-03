/* ============================================================
   inline-richtext.ts — Word 式双行富文本浮条（阶段 4a）
   视觉配方严格照搬 preview/parts/24-inline-edit.html 的 .rtbar 结构。
   显示时机：进入内联编辑即常驻显示，直到退出编辑（有非折叠选区贴选区上方，
   否则锚定 editEl 上边缘，绝不遮挡正在编辑的文字）。
   所有浮条按钮在 mousedown 上 preventDefault（保住选区、避免 contentEditable 失焦）。
   execCommand 在 click 里执行（mousedown 后 click 仍会触发）。
   字号：execCommand('fontSize','7') 后把生成的 <font size="7"> 改写为 <span style="font-size:Npx">。
   ============================================================ */

import { t } from './i18n';
import { openColorPicker } from './color-picker';
import { openDropdown } from './dropdown';

/* ---- 纯函数：<font size="7"> → <span style="font-size:Npx"> ---- */

/**
 * 将 HTML 片段里所有 <font size="7"> 改写为 <span style="font-size:{px}px">，
 * 并把原 <font> 上的其余属性（color/face）按需搬到 span 的 style/属性上，
 * 最后还原 </font> → </span>。
 * 此函数只操作字符串，不依赖 DOM，纯函数，便于单测。
 *
 * @param html  含 <font size="7"> 的 HTML 片段
 * @param px    要设置的字号（像素整数）
 */
export function replaceLegacyFontSize(html: string, px: number): string {
  // 先统计有多少 <font size="7"> 会被替换
  const openRe = /<font\s([^>]*)size=["']?7["']?([^>]*)>/gi;
  let matchCount = 0;
  const result = html.replace(openRe, (_match, before: string, after: string) => {
    matchCount++;
    const attrs = (before + after).trim();
    const styleparts: string[] = [`font-size:${px}px`];
    // face → font-family
    const faceM = attrs.match(/face=["']?([^"'\s>]+)["']?/i);
    if (faceM) styleparts.push(`font-family:${faceM[1]}`);
    // color → color
    const colorM = attrs.match(/color=["']?([^"'\s>]+)["']?/i);
    if (colorM) styleparts.push(`color:${colorM[1]}`);
    return `<span style="${styleparts.join(';')}">`;
  });
  // 只把前 matchCount 个 </font> 替换为 </span>（其余 <font size!=7> 的关标签保留）
  if (matchCount === 0) return result;
  let replaced = 0;
  return result.replace(/<\/font>/gi, (m) => {
    if (replaced < matchCount) {
      replaced++;
      return '</span>';
    }
    return m;
  });
}

/* ---- SVG 图标 ---- */

const chevD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const highlightIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/></svg>`;
const alignIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/></svg>`;
const listIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><line x1="8" x2="21" y1="6" y2="6"/><line x1="8" x2="21" y1="12" y2="12"/><line x1="8" x2="21" y1="18" y2="18"/><line x1="3" x2="3.01" y1="6" y2="6"/><line x1="3" x2="3.01" y1="12" y2="12"/><line x1="3" x2="3.01" y1="18" y2="18"/></svg>`;

/* ---- 字体/字号列表 ---- */

const FONT_LIST = [
  'System UI', 'Inter', 'Roboto', 'Helvetica Neue', 'Arial',
  'Georgia', 'Times New Roman', 'Menlo', 'Courier New',
];
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
      openDropdown({
        root: this.panelLayer,
        anchor: fontSel.querySelector('button') as HTMLElement,
        items: FONT_LIST.map((f) => ({ value: f, label: f, fontFamily: f === 'System UI' ? undefined : f })),
        current: this.getComputedProp('fontFamily'),
        onPick: (v) => {
          this.restoreSelection();
          this.execStyle();
          document.execCommand('fontName', false, v === 'System UI' ? 'system-ui' : v);
        },
      });
    });
    row1.appendChild(fontSel);

    // 字号下拉触发钮
    const sizeSel = this.makeDropdownTrigger('selsz', t('rt_size'), '16', 'pd-rt-size');
    sizeSel.querySelector('button')!.addEventListener('click', () => {
      this.saveSelection();
      openDropdown({
        root: this.panelLayer,
        anchor: sizeSel.querySelector('button') as HTMLElement,
        items: SIZE_LIST.map((s) => ({ value: s, label: s + 'px' })),
        current: Math.round(parseFloat(this.getComputedProp('fontSize'))).toString(),
        onPick: (v) => {
          this.restoreSelection();
          // 字号必须用 legacy 模式：styleWithCSS=false 才会生成 <font size="7">，
          // 再由 replaceLegacyFontSize 改写为 <span style="font-size:Npx">。
          // （styleWithCSS=true 时 fontSize 会生成 xxx-large 关键字的 span，无法精确设 px）
          document.execCommand('styleWithCSS', false, 'false');
          document.execCommand('fontSize', false, '7');
          // 改写当前 editEl 内的 <font size=7> → <span style="font-size:Npx">
          this.editEl.innerHTML = replaceLegacyFontSize(this.editEl.innerHTML, parseInt(v, 10));
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

    // 列表
    const listBtn = document.createElement('button');
    listBtn.className = 'tb';
    listBtn.setAttribute('title', t('rt_list'));
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

  /** 读取当前选区内的 computed style（选区无则从 editEl 读） */
  private getComputedProp(prop: string): string {
    const cs = window.getComputedStyle(this.editEl);
    return (cs as unknown as Record<string, string>)[prop] ?? '';
  }
}
