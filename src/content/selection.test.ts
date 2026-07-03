/* ============================================================
   selection.test.ts — SelectionResolver 单测
   ============================================================ */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SelectionResolver } from './selection';

// 对 resolveComponentBlock 进行 mock，以便单独测试 SelectionResolver 的偏移逻辑
vi.mock('./visual-units', () => ({
  resolveComponentBlock: (el: HTMLElement) => {
    // 返回 el 本身（简化 mock，不走启发式）
    return el;
  },
}));

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('SelectionResolver — element 基准', () => {
  beforeEach(() => setBody(''));

  it('element 基准 + 无偏移 → 返回命中元素', () => {
    setBody('<div id="p"><span id="s">x</span></div>');
    const resolver = new SelectionResolver('element');
    const s = document.getElementById('s')!;
    expect(resolver.resolve(s)).toBe(s);
  });

  it('getGranularity 返回 element', () => {
    const resolver = new SelectionResolver('element');
    expect(resolver.getGranularity()).toBe('element');
  });
});

describe('SelectionResolver — smart 基准（mock resolveComponentBlock = hitEl）', () => {
  beforeEach(() => setBody(''));

  it('smart 基准 + 偏移 0 → 返回基准（mock 中为 hitEl）', () => {
    setBody('<div id="p"><span id="s">x</span></div>');
    const resolver = new SelectionResolver('smart');
    const s = document.getElementById('s')!;
    expect(resolver.resolve(s)).toBe(s);
  });

  it('正偏移 +1 → 向祖先爬升一级', () => {
    setBody('<div id="gp"><div id="p"><span id="s">x</span></div></div>');
    const resolver = new SelectionResolver('smart');
    const s = document.getElementById('s')!;
    const p = document.getElementById('p')!;
    resolver.adjustOffset(1);
    expect(resolver.resolve(s)).toBe(p);
  });

  it('正偏移 +2 → 向祖先爬升两级', () => {
    setBody('<div id="gp"><div id="p"><span id="s">x</span></div></div>');
    const resolver = new SelectionResolver('smart');
    const s = document.getElementById('s')!;
    const gp = document.getElementById('gp')!;
    resolver.adjustOffset(1);
    resolver.adjustOffset(1);
    expect(resolver.resolve(s)).toBe(gp);
  });

  it('爬到 body 下方停止（不越过 body）', () => {
    setBody('<div id="top"><span id="s">x</span></div>');
    const resolver = new SelectionResolver('smart');
    const s = document.getElementById('s')!;
    // 向上爬 99 步，应停在 top（body 之下）
    for (let i = 0; i < 99; i++) resolver.adjustOffset(1);
    const result = resolver.resolve(s);
    // 不应越过 body/html
    expect(result === document.body || result === document.documentElement).toBe(false);
  });

  it('负偏移 -1 → 向子孙收窄（当 hitEl 在 base 内）', () => {
    setBody('<div id="outer"><div id="inner"><span id="s">x</span></div></div>');
    const resolver = new SelectionResolver('smart');
    const outer = document.getElementById('outer')!;

    // 先模拟 mock resolveComponentBlock 返回 outer（通过让 hitEl = outer）
    // 此处 mock 返回 hitEl 本身 = outer
    // 负偏移 -1 → 向 firstElementChild = inner
    resolver.adjustOffset(-1);
    const result = resolver.resolve(outer);
    // 向 firstElementChild 收窄一级
    const inner = document.getElementById('inner')!;
    expect(result).toBe(inner);
  });

  it('resetOffset 重置偏移', () => {
    setBody('<div id="p"><span id="s">x</span></div>');
    const resolver = new SelectionResolver('smart');
    const s = document.getElementById('s')!;
    resolver.adjustOffset(1);
    resolver.resetOffset();
    expect(resolver.getOffset()).toBe(0);
    expect(resolver.resolve(s)).toBe(s);
  });

  it('setGranularity(element) 重置偏移', () => {
    const resolver = new SelectionResolver('smart');
    resolver.adjustOffset(1);
    resolver.adjustOffset(1);
    resolver.adjustOffset(1);
    resolver.setGranularity('element');
    expect(resolver.getOffset()).toBe(0);
  });
});
