/* ============================================================
   fields.ts — 属性控件注册表 + 控件工厂（双入口单源）
   蓝图 §5.1 / design-system §8 / preview pigeon-components.js FIELDS：
   - FIELD_DEFS 统一注册表：修改栏 = 按元素类型挑的高频子集；高级样式 = 全集
   - FieldsSession：同一 field 的两个入口共享当前值与监听，改一处两处同步
   - 控件改动 → 立即 inline style 预览 → 基线快照（撤销/StyleChange 记录用）
   - getChanges 同一属性合并为一条（最初 oldValue、最新 newValue）
   ============================================================ */

import { t } from './i18n';
import type { StyleChange } from '../state/annotations';
import type { ElementType } from '../shared/dom-utils';
import { openDropdown, sampleAncestorValues, primaryFontFamily, DropdownItem } from './dropdown';
import { openColorPicker, parseCssColor, formatCssColor } from './color-picker';

/* ---- 图标（Lucide，与 preview/pigeon-components.js 单一真相源一致） ---- */
const I = {
  blk: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/>',
  flx: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="15" x2="15" y1="3" y2="21"/>',
  grd: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="15" x2="15" y1="3" y2="21"/>',
  inl: '<line x1="3" x2="21" y1="6" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" x2="11" y1="18" y2="18"/>',
  alL: '<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>',
  alC: '<line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/>',
  alR: '<line x1="21" x2="3" y1="6" y2="6"/><line x1="21" x2="9" y1="12" y2="12"/><line x1="21" x2="7" y1="18" y2="18"/>',
  alJ: '<line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/>',
  chevD: '<path d="m6 9 6 6 6-6"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  eyedropper: '<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
} as const;

function svg(inner: string, sw = 1.6): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

/* ---- 注册表类型 ---- */

export type FieldKind =
  | 'textarea'
  | 'num'
  | 'color'
  | 'select'
  | 'seg'
  | 'deco'
  | 'range'
  | 'button'
  | 'hidden';

export interface SelectOption {
  value: string;
  labelKey?: string;
  /** 直接给定标签（如字重的 "600 半粗" 走 labelKey；采样字体直接用值） */
  label?: string;
  /** 图标分段用 */
  icon?: string;
  tipKey?: string;
  fontFamily?: string;
}

export interface FieldDef {
  labelKey: string;
  /** 输出记录用 CSS 属性名；文字内容修改为特殊值 'text' */
  cssProp: string;
  kind: FieldKind;
  /** 当前控件值（打开面板时的初值） */
  read(el: HTMLElement): string;
  /** 控件值 → CSS 值 */
  cssValue(controlValue: string): string;
  /** 基线 CSS 值（默认 cssValue(read())；box-shadow 等复合属性覆写） */
  readCss?(el: HTMLElement): string;
  /** 自定义应用（默认 setProperty(cssProp, cssValue)）；返回实际写入的 CSS 值 */
  apply?(el: HTMLElement, controlValue: string, session: FieldsSession): string;
  /** 变更说明/卡片展示值（默认原样） */
  toDisplay?(controlValue: string): string;
  // num/range 配置
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  // select/seg 配置
  options?: () => SelectOption[];
  /** 智能识别栏采样（返回控件值数组；无则不加智能栏） */
  smartSample?: (target: Element) => string[];
  // button 配置
  buttonLabelKey?: string;
}

/* ---- 读取工具 ---- */

function computed(el: HTMLElement): CSSStyleDeclaration {
  return el.ownerDocument.defaultView!.getComputedStyle(el);
}

function numOf(value: string, fallback: number, decimals = 0): string {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return String(fallback);
  const f = Math.pow(10, decimals);
  return String(Math.round(n * f) / f);
}

function colorOf(value: string, fallback: string): string {
  const parsed = parseCssColor(value);
  return parsed ? formatCssColor(parsed) : fallback;
}

function optionLabel(opt: SelectOption): string {
  if (opt.label !== undefined) return opt.label;
  if (opt.labelKey) return t(opt.labelKey);
  return opt.value;
}

/** 数值型字段快捷定义 */
function numField(
  labelKey: string,
  cssProp: string,
  readRaw: (cs: CSSStyleDeclaration, el: HTMLElement) => string,
  cfg: { unit?: string; step?: number; min?: number; decimals?: number; unitless?: boolean; fallback?: number } = {}
): FieldDef {
  const decimals = cfg.decimals ?? 0;
  return {
    labelKey,
    cssProp,
    kind: 'num',
    unit: cfg.unit ?? 'px',
    step: cfg.step ?? 1,
    min: cfg.min,
    decimals,
    read: (el) => numOf(readRaw(computed(el), el), cfg.fallback ?? 0, decimals),
    cssValue: (v) => {
      const n = numOf(v, cfg.fallback ?? 0, decimals);
      return cfg.unitless ? n : `${n}px`;
    },
  };
}

function colorField(labelKey: string, cssProp: string, readRaw: (cs: CSSStyleDeclaration) => string, fallback: string): FieldDef {
  return {
    labelKey,
    cssProp,
    kind: 'color',
    read: (el) => colorOf(readRaw(computed(el)), fallback),
    cssValue: (v) => colorOf(v, fallback),
  };
}

/* ---- 阴影档位 ---- */

const SHADOW_GEOM: Record<string, string> = {
  light: '0 1px 3px',
  mid: '0 4px 10px',
  heavy: '0 10px 24px -6px',
};

function shadowCss(level: string, color: string): string {
  const geom = SHADOW_GEOM[level];
  return geom ? `${geom} ${color}` : 'none';
}

/** 从 computed box-shadow 提取颜色（提不到用默认阴影色） */
function shadowColorOf(boxShadow: string): string {
  const m = boxShadow.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
  return m ? colorOf(m[0], 'rgba(60, 46, 18, 0.22)') : 'rgba(60, 46, 18, 0.22)';
}

/* ---- 选项集 ---- */

const FONT_LIST = ['Inter', 'Roboto', 'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman', 'Menlo'];
const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];

function fontOptions(): SelectOption[] {
  return [
    { value: 'system-ui', labelKey: 'opt_font_system' },
    ...FONT_LIST.map((f) => ({ value: f, label: f, fontFamily: f })),
  ];
}

function weightOptions(): SelectOption[] {
  return WEIGHTS.map((w) => ({ value: w, labelKey: `opt_w${w}` }));
}

function normalizeWeight(value: string): string {
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  return numOf(value, 400);
}

/* ---- 注册表（全集） ---- */

export const FIELD_DEFS: Record<string, FieldDef> = {
  text: {
    labelKey: 'field_text',
    cssProp: 'text',
    kind: 'textarea',
    read: (el) => el.textContent ?? '',
    cssValue: (v) => v,
    apply: (el, v) => {
      el.textContent = v;
      return v;
    },
  },
  font: {
    labelKey: 'field_font',
    cssProp: 'font-family',
    kind: 'select',
    read: (el) => primaryFontFamily(computed(el).fontFamily || 'system-ui') || 'system-ui',
    cssValue: (v) => (/\s/.test(v) ? `"${v}"` : v),
    toDisplay: (v) => v,
    options: fontOptions,
    smartSample: (target) =>
      sampleAncestorValues(target, (node) => {
        const ff = node.ownerDocument.defaultView?.getComputedStyle(node).fontFamily;
        return ff ? primaryFontFamily(ff) : null;
      }),
  },
  fontSize: numField('field_font_size', 'font-size', (cs) => cs.fontSize, { min: 1, fallback: 16 }),
  fontWeight: {
    labelKey: 'field_font_weight',
    cssProp: 'font-weight',
    kind: 'select',
    read: (el) => normalizeWeight(computed(el).fontWeight || '400'),
    cssValue: (v) => normalizeWeight(v),
    toDisplay: (v) => {
      const opt = weightOptions().find((o) => o.value === normalizeWeight(v));
      return opt ? optionLabel(opt) : v;
    },
    options: weightOptions,
    smartSample: (target) =>
      sampleAncestorValues(target, (node) => {
        const w = node.ownerDocument.defaultView?.getComputedStyle(node).fontWeight;
        return w ? normalizeWeight(w) : null;
      }),
  },
  color: colorField('field_color', 'color', (cs) => cs.color, '#23262e'),
  align: {
    labelKey: 'field_align',
    cssProp: 'text-align',
    kind: 'seg',
    read: (el) => {
      const v = computed(el).textAlign;
      if (v === 'start' || v === '') return 'left';
      if (v === 'end') return 'right';
      return v;
    },
    cssValue: (v) => v,
    toDisplay: (v) => t(`opt_align_${v}`),
    options: () => [
      { value: 'left', icon: I.alL, tipKey: 'tip_align_left' },
      { value: 'center', icon: I.alC, tipKey: 'tip_align_center' },
      { value: 'right', icon: I.alR, tipKey: 'tip_align_right' },
      { value: 'justify', icon: I.alJ, tipKey: 'tip_align_justify' },
    ],
  },
  decoration: {
    // 组合控件：B/I/U/S 分别落到 fontWeight / fontStyle / textDecoration 三个字段
    labelKey: 'field_decoration',
    cssProp: 'text-decoration-line',
    kind: 'deco',
    read: () => '',
    cssValue: (v) => v,
  },
  fontStyle: {
    labelKey: 'field_font_style',
    cssProp: 'font-style',
    kind: 'hidden',
    read: (el) => computed(el).fontStyle || 'normal',
    cssValue: (v) => v,
  },
  textDecoration: {
    labelKey: 'field_decoration',
    cssProp: 'text-decoration-line',
    kind: 'hidden',
    read: (el) => computed(el).textDecorationLine || 'none',
    cssValue: (v) => v || 'none',
  },
  lineHeight: {
    labelKey: 'field_line_height',
    cssProp: 'line-height',
    kind: 'num',
    unit: 'em',
    step: 0.1,
    min: 0.5,
    decimals: 1,
    read: (el) => {
      const cs = computed(el);
      const lh = cs.lineHeight;
      if (!lh || lh === 'normal') return '1.5';
      const px = parseFloat(lh);
      const fs = parseFloat(cs.fontSize) || 16;
      if (!Number.isNaN(px)) return numOf(String(px / fs), 1.5, 1);
      return numOf(lh, 1.5, 1);
    },
    cssValue: (v) => numOf(v, 1.5, 1),
  },
  letter: numField('field_letter', 'letter-spacing', (cs) => (cs.letterSpacing === 'normal' ? '0' : cs.letterSpacing), {
    step: 0.1,
    decimals: 1,
  }),
  listStyle: {
    labelKey: 'field_list_style',
    cssProp: 'list-style-type',
    kind: 'select',
    read: (el) => computed(el).listStyleType || 'none',
    cssValue: (v) => v,
    toDisplay: (v) => {
      const map: Record<string, string> = {
        none: 'opt_none',
        disc: 'opt_disc',
        circle: 'opt_circle',
        square: 'opt_square',
        decimal: 'opt_decimal',
        'lower-alpha': 'opt_lower_alpha',
        'lower-roman': 'opt_lower_roman',
      };
      return map[v] ? t(map[v]) : v;
    },
    options: () => [
      { value: 'none', labelKey: 'opt_none' },
      { value: 'disc', labelKey: 'opt_disc' },
      { value: 'circle', labelKey: 'opt_circle' },
      { value: 'square', labelKey: 'opt_square' },
      { value: 'decimal', labelKey: 'opt_decimal' },
      { value: 'lower-alpha', labelKey: 'opt_lower_alpha' },
      { value: 'lower-roman', labelKey: 'opt_lower_roman' },
    ],
  },
  transform: {
    labelKey: 'field_transform',
    cssProp: 'text-transform',
    kind: 'select',
    read: (el) => computed(el).textTransform || 'none',
    cssValue: (v) => v,
    toDisplay: (v) => {
      const map: Record<string, string> = {
        none: 'opt_case_none',
        uppercase: 'opt_uppercase',
        lowercase: 'opt_lowercase',
        capitalize: 'opt_capitalize',
      };
      return map[v] ? t(map[v]) : v;
    },
    options: () => [
      { value: 'none', labelKey: 'opt_case_none' },
      { value: 'uppercase', labelKey: 'opt_uppercase' },
      { value: 'lowercase', labelKey: 'opt_lowercase' },
      { value: 'capitalize', labelKey: 'opt_capitalize' },
    ],
  },
  width: numField('field_width', 'width', (cs) => cs.width, { min: 0 }),
  height: numField('field_height', 'height', (cs) => cs.height, { min: 0 }),
  minW: numField('field_min_w', 'min-width', (cs) => (cs.minWidth === 'auto' ? '0' : cs.minWidth), { min: 0 }),
  maxW: {
    ...numField('field_max_w', 'max-width', (cs) => cs.maxWidth, { min: 0 }),
    read: (el) => {
      const cs = computed(el);
      return numOf(cs.maxWidth === 'none' ? cs.width : cs.maxWidth, 0);
    },
  },
  display: {
    labelKey: 'field_display',
    cssProp: 'display',
    kind: 'seg',
    read: (el) => computed(el).display || 'block',
    cssValue: (v) => v,
    toDisplay: (v) => {
      const map: Record<string, string> = {
        block: 'opt_display_block',
        flex: 'opt_display_flex',
        grid: 'opt_display_grid',
        inline: 'opt_display_inline',
      };
      return map[v] ? t(map[v]) : v;
    },
    options: () => [
      { value: 'block', icon: I.blk, tipKey: 'tip_block' },
      { value: 'flex', icon: I.flx, tipKey: 'tip_flex' },
      { value: 'grid', icon: I.grd, tipKey: 'tip_grid' },
      { value: 'inline', icon: I.inl, tipKey: 'tip_inline' },
    ],
  },
  overflow: {
    labelKey: 'field_overflow',
    cssProp: 'overflow',
    kind: 'seg',
    read: (el) => {
      const v = computed(el).overflow;
      return v === 'visible' || v === 'hidden' || v === 'scroll' ? v : 'visible';
    },
    cssValue: (v) => v,
    toDisplay: (v) => t(`opt_${v}`),
    options: () => [
      { value: 'visible', labelKey: 'opt_visible' },
      { value: 'hidden', labelKey: 'opt_hidden' },
      { value: 'scroll', labelKey: 'opt_scroll' },
    ],
  },
  bgColor: colorField('field_bg_color', 'background-color', (cs) => cs.backgroundColor, 'rgba(0, 0, 0, 0)'),
  bgImage: {
    labelKey: 'field_bg_image',
    cssProp: 'background-image',
    kind: 'button',
    buttonLabelKey: 'btn_pick_bg_image',
    read: () => '',
    cssValue: (v) => v,
  },
  border: {
    labelKey: 'field_border',
    cssProp: 'border-style',
    kind: 'select',
    read: (el) => computed(el).borderTopStyle || 'none',
    cssValue: (v) => v,
    toDisplay: (v) => {
      const map: Record<string, string> = {
        none: 'opt_none',
        solid: 'opt_solid',
        dashed: 'opt_dashed',
        dotted: 'opt_dotted',
        double: 'opt_double',
      };
      return map[v] ? t(map[v]) : v;
    },
    options: () => [
      { value: 'none', labelKey: 'opt_none' },
      { value: 'solid', labelKey: 'opt_solid' },
      { value: 'dashed', labelKey: 'opt_dashed' },
      { value: 'dotted', labelKey: 'opt_dotted' },
      { value: 'double', labelKey: 'opt_double' },
    ],
    smartSample: (target) =>
      sampleAncestorValues(target, (node) => {
        const s = node.ownerDocument.defaultView?.getComputedStyle(node).borderTopStyle;
        return s && s !== 'none' ? s : null;
      }),
  },
  borderColor: colorField('field_border_color', 'border-color', (cs) => cs.borderTopColor, '#d9d3c4'),
  radius: numField('field_radius', 'border-radius', (cs) => cs.borderTopLeftRadius, { min: 0 }),
  shadow: {
    labelKey: 'field_shadow',
    cssProp: 'box-shadow',
    kind: 'seg',
    read: (el) => {
      const bs = computed(el).boxShadow;
      return !bs || bs === 'none' ? 'none' : '';
    },
    readCss: (el) => computed(el).boxShadow || 'none',
    cssValue: (v) => shadowCss(v, 'rgba(60, 46, 18, 0.22)'),
    apply: (el, v, session) => {
      const css = shadowCss(v, session.get('shadowColor'));
      el.style.setProperty('box-shadow', css);
      return css;
    },
    toDisplay: (v) => {
      const map: Record<string, string> = {
        none: 'opt_none',
        light: 'opt_shadow_light',
        mid: 'opt_shadow_mid',
        heavy: 'opt_shadow_heavy',
      };
      return map[v] ? t(map[v]) : v;
    },
    options: () => [
      { value: 'none', labelKey: 'opt_none' },
      { value: 'light', labelKey: 'opt_shadow_light' },
      { value: 'mid', labelKey: 'opt_shadow_mid' },
      { value: 'heavy', labelKey: 'opt_shadow_heavy' },
    ],
  },
  shadowColor: {
    labelKey: 'field_shadow_color',
    cssProp: 'box-shadow',
    kind: 'color',
    read: (el) => shadowColorOf(computed(el).boxShadow || ''),
    readCss: (el) => computed(el).boxShadow || 'none',
    cssValue: (v) => v,
    apply: (el, v, session) => {
      // 阴影档位为无时按"轻"给出可见反馈（档位选择保持不变）
      const level = session.get('shadow') || 'none';
      const css = shadowCss(level === 'none' || level === '' ? 'light' : level, v);
      el.style.setProperty('box-shadow', css);
      return css;
    },
  },
  opacity: {
    labelKey: 'field_opacity',
    cssProp: 'opacity',
    kind: 'range',
    max: 100,
    unit: '%',
    read: (el) => numOf(String((parseFloat(computed(el).opacity) || 1) * 100), 100),
    cssValue: (v) => String((parseFloat(numOf(v, 100)) || 0) / 100),
    toDisplay: (v) => `${numOf(v, 100)}%`,
  },
  blur: {
    labelKey: 'field_blur',
    cssProp: 'filter',
    kind: 'range',
    max: 20,
    unit: 'px',
    read: (el) => {
      const m = (computed(el).filter || '').match(/blur\(([\d.]+)px\)/);
      return m ? numOf(m[1], 0) : '0';
    },
    cssValue: (v) => {
      const n = parseFloat(numOf(v, 0)) || 0;
      return n === 0 ? 'none' : `blur(${n}px)`;
    },
    toDisplay: (v) => `${numOf(v, 0)}px`,
  },
  margin: numField('field_margin', 'margin', (cs) => cs.marginTop, {}),
  padding: numField('field_padding', 'padding', (cs) => cs.paddingTop, { min: 0 }),
  replaceImg: {
    labelKey: 'field_replace_img',
    cssProp: 'src',
    kind: 'button',
    buttonLabelKey: 'btn_replace_img',
    read: () => '',
    cssValue: (v) => v,
  },
};

/** 分类归属（高级样式导航变更角标计数用） */
export const FIELD_CATEGORY: Record<string, 'typography' | 'size' | 'appearance'> = {
  text: 'typography',
  font: 'typography',
  fontSize: 'typography',
  fontWeight: 'typography',
  color: 'typography',
  align: 'typography',
  decoration: 'typography',
  fontStyle: 'typography',
  textDecoration: 'typography',
  lineHeight: 'typography',
  letter: 'typography',
  listStyle: 'typography',
  transform: 'typography',
  margin: 'typography',
  padding: 'typography',
  width: 'size',
  height: 'size',
  minW: 'size',
  maxW: 'size',
  display: 'size',
  overflow: 'size',
  bgColor: 'appearance',
  bgImage: 'appearance',
  border: 'appearance',
  borderColor: 'appearance',
  radius: 'appearance',
  shadow: 'appearance',
  shadowColor: 'appearance',
  opacity: 'appearance',
  blur: 'appearance',
};

/* ============================================================
   FieldsSession — 一次面板会话的字段状态（双入口共享）
   ============================================================ */

interface Baseline {
  /** 修改前 inline 值（回滚用；text 字段存原文本） */
  inline: string;
  /** 修改前 computed/inline CSS 值（StyleChange.oldValue） */
  css: string;
  /** 修改前控件值（变更说明展示用） */
  control: string;
}

export class FieldsSession {
  readonly target: HTMLElement;
  private values = new Map<string, string>();
  private applied = new Map<string, string>(); // 最新写入的 CSS 值
  private baselines = new Map<string, Baseline>();
  private listeners = new Map<string, Set<(v: string) => void>>();
  private anyListeners = new Set<() => void>();

  constructor(target: HTMLElement) {
    this.target = target;
  }

  /** 当前控件值（未改过 = 从元素读取） */
  get(key: string): string {
    const held = this.values.get(key);
    if (held !== undefined) return held;
    return FIELD_DEFS[key]?.read(this.target) ?? '';
  }

  /** 应用一次改动：立即 inline 预览 + 记录基线 + 通知两处入口 */
  set(key: string, controlValue: string): void {
    const def = FIELD_DEFS[key];
    if (!def) return;
    if (!this.baselines.has(key)) {
      this.baselines.set(key, {
        inline: key === 'text' ? (this.target.textContent ?? '') : this.target.style.getPropertyValue(def.cssProp),
        css: def.readCss ? def.readCss(this.target) : def.cssValue(def.read(this.target)),
        control: def.read(this.target),
      });
    }
    let appliedCss: string;
    if (def.apply) {
      appliedCss = def.apply(this.target, controlValue, this);
    } else {
      appliedCss = def.cssValue(controlValue);
      this.target.style.setProperty(def.cssProp, appliedCss);
    }
    this.values.set(key, controlValue);
    this.applied.set(key, appliedCss);
    this.notify(key);
  }

  /** 本次会话的修改记录（同属性一条：最初 oldValue、最新 newValue；改回原值剔除） */
  getChanges(): StyleChange[] {
    const changes: StyleChange[] = [];
    for (const [key, base] of this.baselines) {
      const def = FIELD_DEFS[key];
      const newValue = this.applied.get(key);
      if (!def || newValue === undefined || newValue === base.css) continue;
      changes.push({ prop: key, cssProp: def.cssProp, oldValue: base.css, newValue });
    }
    return changes;
  }

  /** 已变更（未改回）的字段 key 集合（角标/变更说明用） */
  changedKeys(): Set<string> {
    return new Set(this.getChanges().map((c) => c.prop));
  }

  /** 某字段的变更说明展示值（未变更返回 null） */
  getDiff(key: string): { from: string; to: string } | null {
    const base = this.baselines.get(key);
    const def = FIELD_DEFS[key];
    if (!base || !def) return null;
    const applied = this.applied.get(key);
    if (applied === undefined || applied === base.css) return null;
    const current = this.values.get(key) ?? '';
    const display = def.toDisplay ?? ((v: string): string => v);
    return { from: display(base.control), to: display(current) };
  }

  /** 回滚本次会话的全部预览改动（未保存关面板） */
  rollback(): void {
    for (const [key, base] of this.baselines) {
      const def = FIELD_DEFS[key];
      if (!def) continue;
      if (key === 'text') {
        this.target.textContent = base.inline;
      } else if (base.inline === '') {
        this.target.style.removeProperty(def.cssProp);
      } else {
        this.target.style.setProperty(def.cssProp, base.inline);
      }
    }
    const touched = [...this.baselines.keys()];
    this.baselines.clear();
    this.values.clear();
    this.applied.clear();
    for (const key of touched) this.notify(key);
  }

  /** 订阅某字段值变化（双入口同步的机制） */
  subscribe(key: string, fn: (v: string) => void): () => void {
    let set = this.listeners.get(key);
    if (!set) {
      set = new Set();
      this.listeners.set(key, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  /** 订阅任意字段变化（导航角标等聚合 UI 用） */
  subscribeAny(fn: () => void): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  private notify(key: string): void {
    const v = this.get(key);
    for (const fn of this.listeners.get(key) ?? []) fn(v);
    for (const fn of this.anyListeners) fn();
  }
}

/* ============================================================
   控件工厂 — 同一 def 可实例化到修改栏与高级样式两处
   ============================================================ */

export interface ControlContext {
  /** 浮层挂载容器（panel 层根，下拉/调色盘用） */
  popoverRoot: HTMLElement;
}

function stepAdjust(session: FieldsSession, key: string, def: FieldDef, dir: 1 | -1): void {
  const step = def.step ?? 1;
  const decimals = def.decimals ?? 0;
  const cur = parseFloat(session.get(key));
  let next = (Number.isNaN(cur) ? 0 : cur) + dir * step;
  if (def.min !== undefined) next = Math.max(def.min, next);
  if (def.max !== undefined) next = Math.min(def.max, next);
  const f = Math.pow(10, decimals);
  session.set(key, String(Math.round(next * f) / f));
}

function buildTextarea(session: FieldsSession, key: string): HTMLElement {
  const ta = document.createElement('textarea');
  ta.className = 'pd-textarea';
  ta.rows = 2;
  ta.value = session.get(key);
  ta.addEventListener('input', () => session.set(key, ta.value));
  session.subscribe(key, (v) => {
    if (document.activeElement !== ta && ta.value !== v) ta.value = v;
  });
  return ta;
}

function buildNum(session: FieldsSession, key: string, def: FieldDef): HTMLElement {
  const box = document.createElement('div');
  box.className = 'pd-num';
  box.innerHTML =
    `<input>` +
    `<span class="unit">${def.unit ?? 'px'}</span>` +
    `<span class="step"><button type="button" data-dir="1">${svg(I.plus, 2.1)}</button><button type="button" data-dir="-1">${svg(I.minus, 2.1)}</button></span>`;
  const input = box.querySelector('input')!;
  input.value = session.get(key);
  input.addEventListener('change', () => {
    const n = parseFloat(input.value);
    if (Number.isNaN(n)) {
      input.value = session.get(key);
      return;
    }
    session.set(key, input.value.trim());
  });
  // 滚轮微调（design-system §5.12）
  box.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    stepAdjust(session, key, def, ev.deltaY < 0 ? 1 : -1);
  });
  for (const btn of box.querySelectorAll<HTMLButtonElement>('.step button')) {
    btn.addEventListener('click', () => {
      stepAdjust(session, key, def, btn.getAttribute('data-dir') === '1' ? 1 : -1);
    });
  }
  session.subscribe(key, (v) => {
    if (document.activeElement !== input && input.value !== v) input.value = v;
  });
  return box;
}

function buildColor(session: FieldsSession, key: string, ctx: ControlContext): HTMLElement {
  const box = document.createElement('div');
  box.className = 'pd-color';
  box.innerHTML =
    `<button type="button" class="sw" title="${t('palette_open')}"><i class="fill"></i></button>` +
    `<input class="val">` +
    `<button type="button" class="eye" title="${t('palette_eyedropper')}">${svg(I.eyedropper)}</button>`;
  const sw = box.querySelector<HTMLButtonElement>('.sw')!;
  const fill = box.querySelector<HTMLElement>('.fill')!;
  const val = box.querySelector<HTMLInputElement>('.val')!;
  const eye = box.querySelector<HTMLButtonElement>('.eye')!;

  const render = (v: string): void => {
    fill.style.background = v;
    if (document.activeElement !== val) val.value = v;
  };
  render(session.get(key));

  sw.addEventListener('click', () => {
    openColorPicker({
      root: ctx.popoverRoot,
      anchor: sw,
      target: session.target,
      value: session.get(key),
      onChange: (color) => session.set(key, color),
    });
  });
  val.addEventListener('change', () => {
    const parsed = parseCssColor(val.value);
    if (!parsed) {
      val.value = session.get(key);
      return;
    }
    session.set(key, formatCssColor(parsed));
  });
  eye.addEventListener('click', () => {
    interface EyeDropperResult {
      sRGBHex: string;
    }
    const EyeDropperCtor = (window as unknown as { EyeDropper?: new () => { open(): Promise<EyeDropperResult> } })
      .EyeDropper;
    if (!EyeDropperCtor) return;
    new EyeDropperCtor()
      .open()
      .then((result) => session.set(key, result.sRGBHex))
      .catch(() => {
        /* 用户取消 */
      });
  });
  session.subscribe(key, render);
  return box;
}

function buildSeg(session: FieldsSession, key: string, def: FieldDef): HTMLElement {
  const options = def.options?.() ?? [];
  const iconMode = options.some((o) => o.icon);
  const box = document.createElement('div');
  box.className = 'pd-seg accent' + (iconMode ? ' icons' : '');
  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('data-value', opt.value);
    if (opt.tipKey) btn.title = t(opt.tipKey);
    btn.innerHTML = opt.icon ? svg(opt.icon, 1.7) : '';
    if (!opt.icon) btn.textContent = optionLabel(opt);
    btn.addEventListener('click', () => session.set(key, opt.value));
    box.appendChild(btn);
  }
  const render = (v: string): void => {
    for (const btn of box.querySelectorAll('button')) {
      btn.classList.toggle('on', btn.getAttribute('data-value') === v);
    }
  };
  render(session.get(key));
  session.subscribe(key, render);
  return box;
}

function buildSelect(session: FieldsSession, key: string, def: FieldDef, ctx: ControlContext): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'pd-sel';
  wrap.innerHTML =
    `<button type="button" class="pd-select"><span class="v"></span></button>` +
    `<span class="pd-sel-arrow">${svg(I.chevD, 2)}</span>`;
  const trigger = wrap.querySelector<HTMLButtonElement>('.pd-select')!;
  const label = wrap.querySelector<HTMLElement>('.v')!;

  const displayFor = (v: string): string => {
    const opt = def.options?.().find((o) => o.value === v);
    return opt ? optionLabel(opt) : v;
  };
  const render = (v: string): void => {
    label.textContent = displayFor(v);
  };
  render(session.get(key));

  trigger.addEventListener('click', () => {
    const items: DropdownItem[] = (def.options?.() ?? []).map((o) => ({
      value: o.value,
      label: optionLabel(o),
      fontFamily: o.fontFamily,
    }));
    const smartValues = def.smartSample?.(session.target) ?? [];
    const smartItems: DropdownItem[] = smartValues.map((v) => ({
      value: v,
      label: displayFor(v),
      fontFamily: key === 'font' ? v : undefined,
    }));
    openDropdown({
      root: ctx.popoverRoot,
      anchor: trigger,
      items,
      smartItems,
      current: session.get(key),
      onPick: (v) => session.set(key, v),
    });
  });
  session.subscribe(key, render);
  return wrap;
}

function buildDeco(session: FieldsSession): HTMLElement {
  const box = document.createElement('div');
  box.className = 'pd-seg accent deco';
  const defs: Array<{ token: string; glyph: string; tipKey: string; isOn: () => boolean; toggle: () => void }> = [
    {
      token: 'b',
      glyph: 'B',
      tipKey: 'tip_bold',
      isOn: () => parseFloat(session.get('fontWeight')) >= 600,
      toggle: () => {
        const on = parseFloat(session.get('fontWeight')) >= 600;
        session.set('fontWeight', on ? '400' : '700');
      },
    },
    {
      token: 'i',
      glyph: 'I',
      tipKey: 'tip_italic',
      isOn: () => session.get('fontStyle') === 'italic',
      toggle: () => {
        session.set('fontStyle', session.get('fontStyle') === 'italic' ? 'normal' : 'italic');
      },
    },
    {
      token: 'u',
      glyph: 'U',
      tipKey: 'tip_underline',
      isOn: () => session.get('textDecoration').includes('underline'),
      toggle: () => toggleDecoLine('underline'),
    },
    {
      token: 's',
      glyph: 'S',
      tipKey: 'tip_strike',
      isOn: () => session.get('textDecoration').includes('line-through'),
      toggle: () => toggleDecoLine('line-through'),
    },
  ];

  function toggleDecoLine(line: string): void {
    const cur = session.get('textDecoration');
    const tokens = new Set(cur.split(/\s+/).filter((s) => s && s !== 'none'));
    if (tokens.has(line)) tokens.delete(line);
    else tokens.add(line);
    session.set('textDecoration', tokens.size === 0 ? 'none' : [...tokens].join(' '));
  }

  for (const d of defs) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `d-${d.token}`;
    btn.title = t(d.tipKey);
    btn.textContent = d.glyph;
    btn.addEventListener('click', () => d.toggle());
    box.appendChild(btn);
  }
  const render = (): void => {
    const buttons = box.querySelectorAll('button');
    defs.forEach((d, i) => buttons[i].classList.toggle('on', d.isOn()));
  };
  render();
  for (const key of ['fontWeight', 'fontStyle', 'textDecoration']) {
    session.subscribe(key, render);
  }
  return box;
}

function buildRange(session: FieldsSession, key: string, def: FieldDef): HTMLElement {
  const max = def.max ?? 100;
  const wrap = document.createElement('div');
  wrap.className = 'opwrap';
  wrap.innerHTML = `<div class="pd-range"><span class="knob"></span></div><span class="opval"></span>`;
  const track = wrap.querySelector<HTMLElement>('.pd-range')!;
  const knob = wrap.querySelector<HTMLElement>('.knob')!;
  const opval = wrap.querySelector<HTMLElement>('.opval')!;

  const render = (v: string): void => {
    const n = Math.max(0, Math.min(max, parseFloat(v) || 0));
    knob.style.left = `${(n / max) * 100}%`;
    opval.textContent = def.toDisplay ? def.toDisplay(String(n)) : String(n);
  };
  render(session.get(key));

  const setFromEvent = (ev: MouseEvent): void => {
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
    session.set(key, String(Math.round(ratio * max)));
  };
  track.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    setFromEvent(ev);
    const onMove = (mv: MouseEvent): void => setFromEvent(mv);
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });
  session.subscribe(key, render);
  return wrap;
}

function buildButton(def: FieldDef): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'pd-btn';
  btn.style.width = '100%';
  btn.innerHTML = `${svg(I.image)}${t(def.buttonLabelKey ?? '')}`;
  btn.addEventListener('click', () => {
    /* 替换流程在阶段 4 落地（回调 stub） */
  });
  return btn;
}

/** 实例化一个属性控件（不含 .prop 外壳） */
export function createControl(session: FieldsSession, key: string, ctx: ControlContext): HTMLElement {
  const def = FIELD_DEFS[key];
  if (!def) throw new Error(`unknown field: ${key}`);
  switch (def.kind) {
    case 'textarea':
      return buildTextarea(session, key);
    case 'num':
      return buildNum(session, key, def);
    case 'color':
      return buildColor(session, key, ctx);
    case 'seg':
      return buildSeg(session, key, def);
    case 'select':
      return buildSelect(session, key, def, ctx);
    case 'deco':
      return buildDeco(session);
    case 'range':
      return buildRange(session, key, def);
    case 'button':
      return buildButton(def);
    default:
      throw new Error(`field ${key} is not instantiable`);
  }
}

export interface PropRowOptions {
  /** 陌生元素自动识别角标 */
  auto?: boolean;
}

/**
 * 实例化一行属性原件（.prop：标题 + 变更说明 + 控件）。
 * 修改栏与高级样式各自调用一次 → 同一 session 的两个入口，值与监听共享。
 */
export function createPropRow(
  session: FieldsSession,
  key: string,
  ctx: ControlContext,
  opts: PropRowOptions = {}
): HTMLElement {
  const def = FIELD_DEFS[key];
  if (!def) throw new Error(`unknown field: ${key}`);

  const row = document.createElement('div');
  row.className = 'prop';
  row.setAttribute('data-field', key);
  row.setAttribute('data-testid', `pd-prop-${key}`);

  const head = document.createElement('div');
  head.className = 'prop-h';
  const title = document.createElement('span');
  title.className = 't';
  title.textContent = t(def.labelKey);
  if (opts.auto) {
    const badge = document.createElement('span');
    badge.className = 'auto';
    badge.textContent = t('badge_auto');
    title.appendChild(badge);
  }
  head.appendChild(title);
  row.appendChild(head);

  const ctl = document.createElement('div');
  ctl.className = 'ctl';
  ctl.appendChild(createControl(session, key, ctx));
  row.appendChild(ctl);

  // 变更说明（旧→新）贴标题右侧，改动即出现、改回即消失
  const renderDiff = (): void => {
    head.querySelector('.pd-diff')?.remove();
    const diff = session.getDiff(key);
    if (!diff) return;
    const span = document.createElement('span');
    span.className = 'pd-diff';
    span.innerHTML = `${diff.from}<i>→</i><b>${diff.to}</b>`;
    head.appendChild(span);
  };
  renderDiff();
  session.subscribe(key, renderDiff);

  return row;
}

/* ============================================================
   字段布局 — 修改栏智能切换（design-system §7）与高级样式分类
   Row = 一行的 key 列表（2 个 = grid2 并排）
   ============================================================ */

export type FieldRow = string[];

/** 修改栏标题 i18n key */
export function modbarTitleKey(type: ElementType): string {
  switch (type) {
    case 'text':
      return 'modbar_text';
    case 'image':
      return 'modbar_image';
    case 'video':
      return 'modbar_video';
    case 'button':
    case 'container':
      return 'modbar_box';
    default:
      return 'modbar_auto';
  }
}

/** 修改栏字段布局（按元素类型智能切换；other 走 autoModbarRows） */
export function modbarRows(type: ElementType): FieldRow[] {
  switch (type) {
    case 'text':
      return [['text'], ['fontSize', 'fontWeight'], ['color'], ['align']];
    case 'image':
    case 'video':
      return [['replaceImg'], ['width', 'height'], ['radius', 'border']];
    case 'button':
    case 'container':
      return [['bgColor'], ['radius', 'border'], ['shadow'], ['opacity'], ['margin', 'padding']];
    default:
      return [];
  }
}

/** 陌生元素：按 computed style 动态列出最相关控件（前 4，带「自动」角标） */
export function autoModbarRows(target: HTMLElement): FieldRow[] {
  const cs = computed(target);
  const hasText = (target.textContent ?? '').trim() !== '';
  const candidates: Array<{ key: string; relevant: boolean }> = [
    { key: 'bgColor', relevant: (parseCssColor(cs.backgroundColor)?.a ?? 0) > 0 },
    { key: 'padding', relevant: parseFloat(cs.paddingTop) > 0 },
    { key: 'radius', relevant: parseFloat(cs.borderTopLeftRadius) > 0 },
    { key: 'color', relevant: hasText },
    { key: 'fontSize', relevant: hasText },
    { key: 'border', relevant: parseFloat(cs.borderTopWidth) > 0 },
    { key: 'opacity', relevant: parseFloat(cs.opacity) < 1 },
    { key: 'display', relevant: true },
  ];
  const picked: string[] = [];
  for (const c of candidates) {
    if (c.relevant && picked.length < 4) picked.push(c.key);
  }
  for (const fallback of ['bgColor', 'padding', 'radius', 'display']) {
    if (picked.length >= 4) break;
    if (!picked.includes(fallback)) picked.push(fallback);
  }
  // 打包：相邻两个数值控件并排（贴 part 35 的紧凑布局）
  const rows: FieldRow[] = [];
  for (let i = 0; i < picked.length; i++) {
    const cur = picked[i];
    const next = picked[i + 1];
    if (next && FIELD_DEFS[cur].kind === 'num' && FIELD_DEFS[next].kind === 'num') {
      rows.push([cur, next]);
      i++;
    } else {
      rows.push([cur]);
    }
  }
  return rows;
}

export type AdvCategory = 'typography' | 'size' | 'appearance' | 'debug';

/** 高级样式分类字段布局（preview parts 20/21/12；调试分类为只读 readout 不在此列） */
export function advancedRows(category: AdvCategory): FieldRow[] {
  switch (category) {
    case 'typography':
      return [
        ['font'],
        ['fontSize', 'fontWeight'],
        ['color'],
        ['align'],
        ['decoration'],
        ['lineHeight', 'letter'],
        ['listStyle', 'transform'],
        ['margin', 'padding'],
      ];
    case 'size':
      return [['width', 'height'], ['minW', 'maxW'], ['display'], ['overflow']];
    case 'appearance':
      return [
        ['bgColor'],
        ['bgImage'],
        ['border', 'radius'],
        ['borderColor'],
        ['shadow'],
        ['shadowColor'],
        ['opacity'],
        ['blur'],
      ];
    default:
      return [];
  }
}

/** 把一组行布局渲染进容器（单行直接 .prop；双列包 .prop.grid2） */
export function renderRows(
  container: HTMLElement,
  session: FieldsSession,
  rows: FieldRow[],
  ctx: ControlContext,
  opts: PropRowOptions = {}
): void {
  for (const row of rows) {
    if (row.length === 1) {
      container.appendChild(createPropRow(session, row[0], ctx, opts));
    } else {
      const grid = document.createElement('div');
      grid.className = 'prop grid2';
      for (const key of row) grid.appendChild(createPropRow(session, key, ctx, opts));
      container.appendChild(grid);
    }
  }
}
