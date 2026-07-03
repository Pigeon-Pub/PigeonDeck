// @vitest-environment jsdom
/* ============================================================
   dropdown.test.ts — 智能识别栏采样逻辑 + 浮层结构
   祖先链采样 / 去重 / 频次前5 / 采不到自隐
   ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import { sampleAncestorValues, primaryFontFamily, openDropdown } from './dropdown';

/** 造一条嵌套链：返回最内层元素。values[i] 写在自内向外第 i 层的 data-v 上 */
function buildChain(values: Array<string | null>): Element {
  document.body.innerHTML = '';
  let parent: Element = document.body;
  const chain: Element[] = [];
  for (let i = values.length - 1; i >= 0; i--) {
    const div = document.createElement('div');
    if (values[i] !== null) div.setAttribute('data-v', values[i]!);
    parent.appendChild(div);
    parent = div;
    chain.push(div);
  }
  return chain[chain.length - 1];
}

const getV = (el: Element): string | null => el.getAttribute('data-v');

describe('sampleAncestorValues — 祖先链采样', () => {
  it('从元素本身沿祖先链采样（含中途各层）', () => {
    const el = buildChain(['a', 'b', 'c']);
    expect(sampleAncestorValues(el, getV)).toEqual(['a', 'b', 'c']);
  });

  it('去重并按频次降序', () => {
    const el = buildChain(['a', 'b', 'b', 'c', 'b', 'c']);
    // b×3, c×2, a×1
    expect(sampleAncestorValues(el, getV)).toEqual(['b', 'c', 'a']);
  });

  it('同频保持自内向外先见顺序', () => {
    const el = buildChain(['x', 'y', 'x', 'y']);
    expect(sampleAncestorValues(el, getV)).toEqual(['x', 'y']);
  });

  it('超过 5 个取频次前 5', () => {
    // g×2 最多，其余各 1（f 在链最外，仍被裁掉）
    const el = buildChain(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'g']);
    const result = sampleAncestorValues(el, getV);
    expect(result).toHaveLength(5);
    expect(result).toEqual(['g', 'a', 'b', 'c', 'd']);
  });

  it('max 参数可调', () => {
    const el = buildChain(['a', 'b', 'c']);
    expect(sampleAncestorValues(el, getV, 2)).toEqual(['a', 'b']);
  });

  it('采不到任何值返回空数组', () => {
    const el = buildChain([null, null]);
    expect(sampleAncestorValues(el, getV)).toEqual([]);
  });

  it('空值/undefined 被跳过', () => {
    const el = buildChain(['a', null, 'b']);
    expect(sampleAncestorValues(el, () => undefined)).toEqual([]);
    expect(sampleAncestorValues(el, getV)).toEqual(['a', 'b']);
  });

  it('补采同层兄弟的值（兄弟补充，不顶替祖先顺序）', () => {
    document.body.innerHTML = '';
    const parent = document.createElement('div');
    parent.setAttribute('data-v', 'b');
    const target = document.createElement('div');
    target.setAttribute('data-v', 'a');
    const sib = document.createElement('div');
    sib.setAttribute('data-v', 'sib');
    parent.appendChild(target);
    parent.appendChild(sib);
    document.body.appendChild(parent);
    const result = sampleAncestorValues(target, getV);
    expect(result).toContain('sib'); // 兄弟值被采到
    // 祖先优先：兄弟值排在祖先值之后
    expect(result.indexOf('a')).toBeLessThan(result.indexOf('sib'));
    expect(result.indexOf('b')).toBeLessThan(result.indexOf('sib'));
  });
});

describe('primaryFontFamily — 首选字体名', () => {
  it('取逗号前第一个并去引号', () => {
    expect(primaryFontFamily('"Segoe UI", Arial, sans-serif')).toBe('Segoe UI');
    expect(primaryFontFamily("'PingFang SC', sans-serif")).toBe('PingFang SC');
    expect(primaryFontFamily('Georgia, serif')).toBe('Georgia');
    expect(primaryFontFamily('system-ui')).toBe('system-ui');
  });
});

describe('openDropdown — 浮层结构', () => {
  let root: HTMLElement;
  let anchor: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    root = document.createElement('div');
    anchor = document.createElement('button');
    document.body.appendChild(root);
    document.body.appendChild(anchor);
  });

  const items = [
    { value: 'a', label: 'A' },
    { value: 'b', label: 'B' },
  ];

  it('有智能项时渲染智能识别栏 + 分隔线', () => {
    const handle = openDropdown({
      root,
      anchor,
      items,
      smartItems: [{ value: 'x', label: 'X' }],
      current: 'a',
      onPick: () => {},
    });
    expect(root.querySelector('[data-testid="pd-dd-smart"]')).toBeTruthy();
    expect(root.querySelector('.pd-dd-sep')).toBeTruthy();
    expect(root.querySelector('[data-testid="pd-dd-smart"] .smart')).toBeTruthy();
    handle.close();
  });

  it('无智能项时智能栏自隐', () => {
    const handle = openDropdown({ root, anchor, items, smartItems: [], current: 'a', onPick: () => {} });
    expect(root.querySelector('[data-testid="pd-dd-smart"]')).toBeNull();
    expect(root.querySelector('.pd-dd-sep')).toBeNull();
    expect(root.querySelectorAll('[data-testid="pd-dd-item"]')).toHaveLength(2);
    handle.close();
  });

  it('当前值行打勾高亮（.on）', () => {
    const handle = openDropdown({ root, anchor, items, current: 'b', onPick: () => {} });
    const on = root.querySelector('.pd-dd-item.on');
    expect(on?.getAttribute('data-value')).toBe('b');
    handle.close();
  });

  it('点选项回调 onPick 并关闭浮层', () => {
    let picked = '';
    openDropdown({ root, anchor, items, current: 'a', onPick: (v) => (picked = v) });
    const row = root.querySelector<HTMLElement>('[data-value="b"]')!;
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(picked).toBe('b');
    expect(root.querySelector('[data-testid="pd-dropdown"]')).toBeNull();
  });
});
