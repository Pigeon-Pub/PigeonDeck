/* ============================================================
   visual-units.test.ts — resolveComponentBlock 单测
   ============================================================ */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveComponentBlock } from './visual-units';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('resolveComponentBlock', () => {
  beforeEach(() => setBody(''));

  it('命中元素本身有背景色 → 返回自身', () => {
    setBody('<div id="card" style="background:#fff;padding:16px"><span id="txt">hello</span></div>');
    const txt = document.getElementById('txt')!;
    const card = document.getElementById('card')!;
    // 强制设 computed background（jsdom 不走 CSS 引擎，需要手动 inline）
    const result = resolveComponentBlock(txt);
    // txt 本身无背景，card 有 → 应爬升到 card
    expect(result).toBe(card);
  });

  it('命中元素本身有背景色 → 返回自身', () => {
    setBody('<div id="el" style="background:#e0e0e0">text</div>');
    const el = document.getElementById('el')!;
    const result = resolveComponentBlock(el);
    expect(result).toBe(el);
  });

  it('无视觉边界且非语义标签 → 返回命中元素', () => {
    setBody('<div><span id="s">x</span></div>');
    const s = document.getElementById('s')!;
    const result = resolveComponentBlock(s);
    expect(result).toBe(s);
  });

  it('语义标签 article 停住', () => {
    setBody('<article id="art"><div><span id="s">x</span></div></article>');
    const s = document.getElementById('s')!;
    const art = document.getElementById('art')!;
    // article 是语义块，应该在 art 停下
    const result = resolveComponentBlock(s);
    expect(result).toBe(art);
  });

  it('li 是语义块', () => {
    setBody('<ul><li id="item"><span id="s">text</span></li></ul>');
    const s = document.getElementById('s')!;
    const item = document.getElementById('item')!;
    const result = resolveComponentBlock(s);
    expect(result).toBe(item);
  });

  it('命中元素即有背景 → 停在命中元素，不继续向上', () => {
    setBody('<section id="sec"><div id="inner" style="background:#f00">x</div></section>');
    const inner = document.getElementById('inner')!;
    const result = resolveComponentBlock(inner);
    expect(result).toBe(inner);
  });

  it('命中元素有 box-shadow → 停在命中元素', () => {
    setBody('<div id="card" style="box-shadow:0 2px 8px rgba(0,0,0,0.1)"><span id="s">x</span></div>');
    const s = document.getElementById('s')!;
    const card = document.getElementById('card')!;
    const result = resolveComponentBlock(s);
    expect(result).toBe(card);
  });

  it('命中元素有 border → 停在命中元素', () => {
    setBody('<div id="b" style="border:1px solid #ccc"><span id="s">x</span></div>');
    const s = document.getElementById('s')!;
    const b = document.getElementById('b')!;
    const result = resolveComponentBlock(s);
    expect(result).toBe(b);
  });
});
