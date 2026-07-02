// @vitest-environment jsdom
/* ============================================================
   color-picker.test.ts — 推荐色采样（去重/频次排序/取前7/剔透明）
   + 颜色解析与转换往返
   ============================================================ */

import { describe, it, expect } from 'vitest';
import {
  parseCssColor,
  formatCssColor,
  rgbToHsv,
  hsvToRgb,
  sampleRecommendedColors,
  ElementColorSource,
} from './color-picker';

/** 造一条嵌套链（自内向外），每层挂 color/backgroundColor 数据 */
function buildChain(layers: ElementColorSource[]): {
  el: Element;
  getStyles: (node: Element) => ElementColorSource;
} {
  document.body.innerHTML = '';
  const map = new Map<Element, ElementColorSource>();
  let parent: Element = document.body;
  let innermost: Element = document.body;
  for (let i = layers.length - 1; i >= 0; i--) {
    const div = document.createElement('div');
    map.set(div, layers[i]);
    parent.appendChild(div);
    parent = div;
    innermost = div;
  }
  return { el: innermost, getStyles: (node) => map.get(node) ?? {} };
}

describe('sampleRecommendedColors — 局部取色推荐', () => {
  it('采样元素及祖先链的 color 与 background-color', () => {
    const { el, getStyles } = buildChain([
      { color: '#111111', backgroundColor: '#ffffff' },
      { color: '#222222' },
    ]);
    const result = sampleRecommendedColors(el, 7, getStyles);
    expect(result).toEqual(['#111111', '#ffffff', '#222222']);
  });

  it('去重并按频率降序', () => {
    const { el, getStyles } = buildChain([
      { color: '#aaaaaa', backgroundColor: '#ffffff' },
      { color: '#ffffff', backgroundColor: '#ffffff' },
      { color: '#bbbbbb' },
    ]);
    const result = sampleRecommendedColors(el, 7, getStyles);
    expect(result[0]).toBe('#ffffff'); // ×3
    expect(result).toContain('#aaaaaa');
    expect(result).toContain('#bbbbbb');
  });

  it('超过 7 个取前 7', () => {
    const layers: ElementColorSource[] = [];
    for (let i = 0; i < 9; i++) {
      layers.push({ color: `rgb(${i * 10}, 0, 0)` });
    }
    const { el, getStyles } = buildChain(layers);
    expect(sampleRecommendedColors(el, 7, getStyles)).toHaveLength(7);
  });

  it('全透明颜色剔除（rgba alpha=0 / transparent 常见形态）', () => {
    const { el, getStyles } = buildChain([
      { color: '#333333', backgroundColor: 'rgba(0, 0, 0, 0)' },
      { backgroundColor: 'rgba(255, 255, 255, 0)' },
    ]);
    expect(sampleRecommendedColors(el, 7, getStyles)).toEqual(['#333333']);
  });

  it('rgb() 与 hex 同色归一化后合并计数', () => {
    const { el, getStyles } = buildChain([
      { color: 'rgb(255, 255, 255)' },
      { color: '#ffffff' },
      { color: '#000000' },
    ]);
    const result = sampleRecommendedColors(el, 7, getStyles);
    expect(result[0]).toBe('#ffffff');
    expect(result).toHaveLength(2);
  });

  it('采不到任何颜色返回空数组', () => {
    const { el, getStyles } = buildChain([{}, {}]);
    expect(sampleRecommendedColors(el, 7, getStyles)).toEqual([]);
  });
});

describe('parseCssColor / formatCssColor', () => {
  it('解析 #rrggbb / #rgb / rgba()', () => {
    expect(parseCssColor('#b8842c')).toEqual({ r: 184, g: 132, b: 44, a: 1 });
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseCssColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseCssColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 });
    expect(parseCssColor('not-a-color')).toBeNull();
  });

  it('formatCssColor：不透明输出 hex，带透明度输出 rgba', () => {
    expect(formatCssColor({ r: 184, g: 132, b: 44, a: 1 })).toBe('#b8842c');
    expect(formatCssColor({ r: 10, g: 20, b: 30, a: 0.5 })).toBe('rgba(10, 20, 30, 0.5)');
  });
});

describe('rgbToHsv / hsvToRgb 往返', () => {
  it('典型颜色往返误差 ≤1', () => {
    const samples = [
      { r: 184, g: 132, b: 44 },
      { r: 255, g: 0, b: 0 },
      { r: 0, g: 128, b: 255 },
      { r: 250, g: 247, b: 240 },
    ];
    for (const c of samples) {
      const hsv = rgbToHsv(c.r, c.g, c.b);
      const back = hsvToRgb(hsv.h, hsv.s, hsv.v);
      expect(Math.abs(back.r - c.r)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.g - c.g)).toBeLessThanOrEqual(1);
      expect(Math.abs(back.b - c.b)).toBeLessThanOrEqual(1);
    }
  });
});
