/* ============================================================
   color-picker.ts — 调色盘（展开浮层）
   design-system §5.14/5.15 / preview part 23：
   完整取色器（饱和度方块 + 色相条）+ HEX 行 + RGB 三通道
   + 局部取色推荐（元素及祖先链 computed color/background-color
     去重按频率前 7，圆形 flex:1 铺满）+ 透明度滑杆（.pd-range 配方）
   ============================================================ */

import { t } from './i18n';
import { mountPopover, PopoverHandle } from './popover';

/* ---- 颜色模型与转换 ---- */

export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** 解析 CSS 颜色字符串（#rgb/#rrggbb/#rrggbbaa/rgb()/rgba()），失败返回 null */
export function parseCssColor(input: string): RGBA | null {
  const s = (input ?? '').trim().toLowerCase();
  if (s.startsWith('#')) {
    const hex = s.slice(1);
    if (/^[0-9a-f]{3}$/.test(hex)) {
      return {
        r: parseInt(hex[0] + hex[0], 16),
        g: parseInt(hex[1] + hex[1], 16),
        b: parseInt(hex[2] + hex[2], 16),
        a: 1,
      };
    }
    if (/^[0-9a-f]{6}$/.test(hex) || /^[0-9a-f]{8}$/.test(hex)) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
        a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    let a = 1;
    if (m[4] !== undefined) {
      a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    }
    return {
      r: Math.round(parseFloat(m[1])),
      g: Math.round(parseFloat(m[2])),
      b: Math.round(parseFloat(m[3])),
      a,
    };
  }
  return null;
}

function hex2(n: number): string {
  return Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
}

/** 输出 CSS 颜色：不透明 → #rrggbb；带透明度 → rgba() */
export function formatCssColor(c: RGBA): string {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  const a = Math.round(c.a * 100) / 100;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}

/** RGB → HSV（h 0-360, s/v 0-100） */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : (d / max) * 100;
  return { h, s, v: max * 100 };
}

/** HSV → RGB */
export function hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = vn - c;
  let rn = 0;
  let gn = 0;
  let bn = 0;
  if (h < 60) [rn, gn, bn] = [c, x, 0];
  else if (h < 120) [rn, gn, bn] = [x, c, 0];
  else if (h < 180) [rn, gn, bn] = [0, c, x];
  else if (h < 240) [rn, gn, bn] = [0, x, c];
  else if (h < 300) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  return {
    r: Math.round((rn + m) * 255),
    g: Math.round((gn + m) * 255),
    b: Math.round((bn + m) * 255),
  };
}

/* ---- 局部取色推荐采样 ---- */

export interface ElementColorSource {
  color?: string;
  backgroundColor?: string;
}

/**
 * 局部取色推荐：采样元素及祖先链（至 body 含）的 computed
 * color / background-color，剔除全透明，归一化后去重按频率降序取前 max（默认 7）。
 * getStyles 可注入（单测隔离 jsdom computed style 差异）。
 */
export function sampleRecommendedColors(
  el: Element,
  max = 7,
  getStyles: (node: Element) => ElementColorSource = (node) => {
    const cs = node.ownerDocument.defaultView?.getComputedStyle(node);
    return cs ? { color: cs.color, backgroundColor: cs.backgroundColor } : {};
  }
): string[] {
  const counts = new Map<string, number>();
  const order: string[] = [];
  const doc = el.ownerDocument;
  let node: Element | null = el;
  while (node && node !== doc.documentElement) {
    const styles = getStyles(node);
    for (const raw of [styles.color, styles.backgroundColor]) {
      if (!raw) continue;
      const parsed = parseCssColor(raw);
      if (!parsed || parsed.a === 0) continue; // 全透明剔除
      const key = formatCssColor(parsed);
      if (!counts.has(key)) {
        counts.set(key, 0);
        order.push(key);
      }
      counts.set(key, counts.get(key)! + 1);
    }
    node = node.parentElement;
  }
  return order.sort((a, b) => counts.get(b)! - counts.get(a)!).slice(0, max);
}

/* ---- 调色盘浮层 ---- */

export interface ColorPickerOptions {
  /** 浮层挂载容器（panel 层根） */
  root: HTMLElement;
  /** 锚点（颜色控件的色块按钮） */
  anchor: HTMLElement;
  /** 推荐色采样目标（被批注的页面元素） */
  target: Element;
  /** 当前颜色（CSS 颜色串） */
  value: string;
  /** 每次调整实时回调（hex 或 rgba 串） */
  onChange: (cssColor: string) => void;
}

/** 打开调色盘浮层 */
export function openColorPicker(opts: ColorPickerOptions): PopoverHandle {
  const initial = parseCssColor(opts.value) ?? { r: 184, g: 132, b: 44, a: 1 };
  const hsv = rgbToHsv(initial.r, initial.g, initial.b);
  const state = { h: hsv.h, s: hsv.s, v: hsv.v, a: initial.a };

  const pop = document.createElement('div');
  pop.className = 'pd-surface pop';
  pop.setAttribute('data-testid', 'pd-palette');

  pop.innerHTML = `
    <div class="pop-h"><span>${t('palette_title')}</span></div>
    <div class="sat" data-testid="pd-palette-sat"><span class="dot"></span></div>
    <div class="hue" data-testid="pd-palette-hue"><span class="k"></span></div>
    <div class="hexrow">
      <span class="chip"></span>
      <input class="pd-input" data-testid="pd-palette-hex">
    </div>
    <div class="rgb">
      <div class="f"><b>R</b><input data-ch="r" inputmode="numeric"></div>
      <div class="f"><b>G</b><input data-ch="g" inputmode="numeric"></div>
      <div class="f"><b>B</b><input data-ch="b" inputmode="numeric"></div>
    </div>
    <div class="sug">
      <div class="sug-h">${t('palette_suggest')}<small>${t('palette_suggest_hint')}</small></div>
      <div class="sug-row" data-testid="pd-palette-sug"></div>
    </div>
    <div class="opa">
      <div class="opa-h"><span>${t('palette_opacity')}</span><span class="opa-v"></span></div>
      <div class="pd-range" data-testid="pd-palette-alpha"><span class="knob"></span></div>
    </div>`;

  const sat = pop.querySelector<HTMLElement>('.sat')!;
  const dot = pop.querySelector<HTMLElement>('.sat .dot')!;
  const hue = pop.querySelector<HTMLElement>('.hue')!;
  const hueKnob = pop.querySelector<HTMLElement>('.hue .k')!;
  const chip = pop.querySelector<HTMLElement>('.chip')!;
  const hexInput = pop.querySelector<HTMLInputElement>('[data-testid="pd-palette-hex"]')!;
  const rgbInputs = [...pop.querySelectorAll<HTMLInputElement>('.rgb input')];
  const sugRow = pop.querySelector<HTMLElement>('.sug-row')!;
  const opaValue = pop.querySelector<HTMLElement>('.opa-v')!;
  const alphaTrack = pop.querySelector<HTMLElement>('[data-testid="pd-palette-alpha"]')!;
  const alphaKnob = alphaTrack.querySelector<HTMLElement>('.knob')!;

  // 局部取色推荐（采不到不出块）
  const suggestions = sampleRecommendedColors(opts.target);
  const sugBox = pop.querySelector<HTMLElement>('.sug')!;
  if (suggestions.length === 0) {
    sugBox.style.display = 'none';
  } else {
    for (const color of suggestions) {
      const s = document.createElement('span');
      s.className = 's';
      s.setAttribute('data-color', color);
      s.style.background = color;
      sugRow.appendChild(s);
    }
  }

  const currentColor = (): RGBA => {
    const rgb = hsvToRgb(state.h, state.s, state.v);
    return { ...rgb, a: state.a };
  };

  const render = (): void => {
    const c = currentColor();
    const css = formatCssColor(c);
    const hueCss = `hsl(${Math.round(state.h)}, 100%, 50%)`;
    sat.style.background = `linear-gradient(0deg,#000,rgba(0,0,0,0)),linear-gradient(90deg,#fff,${hueCss})`;
    dot.style.left = `${state.s}%`;
    dot.style.top = `${100 - state.v}%`;
    dot.style.background = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
    hueKnob.style.left = `${(state.h / 360) * 100}%`;
    chip.style.background = css;
    if (document.activeElement !== hexInput) {
      hexInput.value = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
    }
    for (const input of rgbInputs) {
      if (document.activeElement === input) continue;
      const ch = input.getAttribute('data-ch') as 'r' | 'g' | 'b';
      input.value = String(c[ch]);
    }
    const pct = Math.round(state.a * 100);
    opaValue.textContent = `${pct}%`;
    alphaKnob.style.left = `${pct}%`;
    // 推荐色选中态
    for (const s of sugRow.children) {
      s.classList.toggle('on', s.getAttribute('data-color') === css);
    }
  };

  const commit = (): void => {
    render();
    opts.onChange(formatCssColor(currentColor()));
  };

  /** 按下即拖：在 track 上把指针位置映射为 0-1 */
  const bindDrag = (track: HTMLElement, onRatio: (x: number, y: number) => void): void => {
    const handle = (ev: MouseEvent): void => {
      const rect = track.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height));
      onRatio(x, y);
    };
    track.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      handle(ev);
      const onMove = (mv: MouseEvent): void => handle(mv);
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  };

  bindDrag(sat, (x, y) => {
    state.s = x * 100;
    state.v = (1 - y) * 100;
    commit();
  });
  bindDrag(hue, (x) => {
    state.h = Math.min(359.9, x * 360);
    commit();
  });
  bindDrag(alphaTrack, (x) => {
    state.a = Math.round(x * 100) / 100;
    commit();
  });

  hexInput.addEventListener('change', () => {
    const parsed = parseCssColor(hexInput.value);
    if (!parsed) {
      render();
      return;
    }
    const nh = rgbToHsv(parsed.r, parsed.g, parsed.b);
    state.h = nh.h;
    state.s = nh.s;
    state.v = nh.v;
    commit();
  });

  for (const input of rgbInputs) {
    input.addEventListener('change', () => {
      const c = currentColor();
      const ch = input.getAttribute('data-ch') as 'r' | 'g' | 'b';
      const n = Math.max(0, Math.min(255, parseInt(input.value, 10) || 0));
      const next = { ...c, [ch]: n };
      const nh = rgbToHsv(next.r, next.g, next.b);
      state.h = nh.h;
      state.s = nh.s;
      state.v = nh.v;
      commit();
    });
  }

  sugRow.addEventListener('click', (ev) => {
    const s = (ev.target as Element).closest?.('.s');
    if (!(s instanceof HTMLElement)) return;
    const parsed = parseCssColor(s.getAttribute('data-color') ?? '');
    if (!parsed) return;
    const nh = rgbToHsv(parsed.r, parsed.g, parsed.b);
    state.h = nh.h;
    state.s = nh.s;
    state.v = nh.v;
    // 推荐色不透明，保留当前透明度设置
    commit();
  });

  render();
  return mountPopover(opts.root, pop, opts.anchor);
}
