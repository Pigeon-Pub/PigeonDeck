/* ============================================================
   dom-utils.test.ts — 选择器生成 / 元素分类 / 摘要 / 可见性
   ============================================================ */
// @vitest-environment jsdom

import { describe, it, expect, beforeEach } from 'vitest';
import { buildSelector, classifyElement, getElementSummary, isVisible, findScrollableAncestor } from './dom-utils';

function setBody(html: string): void {
  document.body.innerHTML = html;
}

describe('buildSelector — 选择器生成', () => {
  beforeEach(() => setBody(''));

  it('有唯一 id 的元素 → #id', () => {
    setBody('<div id="hero"><p>x</p></div>');
    const el = document.getElementById('hero')!;
    expect(buildSelector(el)).toBe('#hero');
    expect(document.querySelector(buildSelector(el))).toBe(el);
  });

  it('祖先有 id 时以 id 为锚点', () => {
    setBody('<div id="card"><p>a</p><p>b</p></div>');
    const el = document.querySelectorAll('p')[1];
    const sel = buildSelector(el);
    expect(sel).toContain('#card');
    expect(document.querySelectorAll(sel).length).toBe(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it('唯一 class 组合可用时使用 class', () => {
    setBody('<div><span class="price main">1</span><span class="label">2</span></div>');
    const el = document.querySelector('.price')!;
    const sel = buildSelector(el);
    expect(sel).toContain('.price');
    expect(document.querySelector(sel)).toBe(el);
  });

  it('无 id 无 class → nth-of-type 链且唯一命中', () => {
    setBody('<div><p>a</p><p>b</p><p>c</p></div>');
    const el = document.querySelectorAll('p')[2];
    const sel = buildSelector(el);
    expect(sel).toContain('nth-of-type(3)');
    expect(document.querySelectorAll(sel).length).toBe(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it('深层嵌套仍能唯一定位', () => {
    setBody(
      '<div><section><div><ul><li>1</li><li><span>目标</span></li></ul></div></section></div>'
    );
    const el = document.querySelector('li:nth-of-type(2) span')!;
    const sel = buildSelector(el);
    expect(document.querySelectorAll(sel).length).toBe(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it('重复 id（非法但常见）不产出多命中选择器', () => {
    setBody('<div id="dup"><i>a</i></div><div id="dup"><i>b</i></div>');
    const el = document.querySelectorAll('i')[1];
    const sel = buildSelector(el);
    expect(document.querySelectorAll(sel).length).toBe(1);
    expect(document.querySelector(sel)).toBe(el);
  });

  it('噪音 class（css-hash 风格）被跳过', () => {
    setBody('<div><em class="css-1x2y3z">a</em><em class="css-9z8y7x">b</em></div>');
    const el = document.querySelectorAll('em')[1];
    const sel = buildSelector(el);
    expect(sel).not.toContain('css-');
    expect(document.querySelector(sel)).toBe(el);
  });
});

describe('classifyElement — 元素分类', () => {
  it('img → image', () => {
    setBody('<img alt="pic">');
    expect(classifyElement(document.querySelector('img')!)).toBe('image');
  });

  it('video → video', () => {
    setBody('<video></video>');
    expect(classifyElement(document.querySelector('video')!)).toBe('video');
  });

  it('button / a / role=button → button', () => {
    setBody('<button>go</button><a href="#">link</a><div role="button">d</div>');
    expect(classifyElement(document.querySelector('button')!)).toBe('button');
    expect(classifyElement(document.querySelector('a')!)).toBe('button');
    expect(classifyElement(document.querySelector('div[role]')!)).toBe('button');
  });

  it('有直接文本的叶子元素 → text', () => {
    setBody('<p>一段文字</p><span>短语</span>');
    expect(classifyElement(document.querySelector('p')!)).toBe('text');
    expect(classifyElement(document.querySelector('span')!)).toBe('text');
  });

  it('有直接文本 + 子元素的标题 → text', () => {
    setBody('<h2>标题 <small>副标</small></h2>');
    expect(classifyElement(document.querySelector('h2')!)).toBe('text');
  });

  it('div/section 有子元素 → container', () => {
    setBody('<div><p>x</p></div><section><span>y</span></section>');
    expect(classifyElement(document.querySelector('div')!)).toBe('container');
    expect(classifyElement(document.querySelector('section')!)).toBe('container');
  });

  it('空 div → other', () => {
    setBody('<div></div>');
    expect(classifyElement(document.querySelector('div')!)).toBe('other');
  });

  it('纯空白文本不算 text', () => {
    setBody('<div>   \n  </div>');
    expect(classifyElement(document.querySelector('div')!)).toBe('other');
  });
});

describe('getElementSummary — 元素摘要', () => {
  it('tag + 文本', () => {
    setBody('<button>提交订单</button>');
    expect(getElementSummary(document.querySelector('button')!)).toBe('button "提交订单"');
  });

  it('img 用 alt', () => {
    setBody('<img alt="产品图">');
    expect(getElementSummary(document.querySelector('img')!)).toBe('img "产品图"');
  });

  it('超长文本截断并加省略号', () => {
    setBody(`<p>${'很长的文字'.repeat(20)}</p>`);
    const summary = getElementSummary(document.querySelector('p')!);
    expect(summary.length).toBeLessThan(60);
    expect(summary).toContain('…');
  });

  it('无文本时只有 tag', () => {
    setBody('<div></div>');
    expect(getElementSummary(document.querySelector('div')!)).toBe('div');
  });

  it('多空白折叠为单空格', () => {
    setBody('<p>a\n   b\t c</p>');
    expect(getElementSummary(document.querySelector('p')!)).toBe('p "a b c"');
  });
});

describe('isVisible — 可见性', () => {
  it('display:none → 不可见', () => {
    setBody('<div style="display:none">x</div>');
    expect(isVisible(document.querySelector('div')!)).toBe(false);
  });

  it('visibility:hidden → 不可见', () => {
    setBody('<div style="visibility:hidden">x</div>');
    // jsdom 的 getClientRects 恒空，此断言主要覆盖 computed style 分支
    expect(isVisible(document.querySelector('div')!)).toBe(false);
  });

  it('未挂载的元素 → 不可见', () => {
    const el = document.createElement('div');
    expect(isVisible(el)).toBe(false);
  });
});

describe('findScrollableAncestor — 最近可滚动祖先（逻辑6）', () => {
  /** jsdom 不算布局，用 defineProperty 桩化滚动尺寸 */
  function stubScroll(el: Element, scrollH: number, clientH: number): void {
    Object.defineProperty(el, 'scrollHeight', { value: scrollH, configurable: true });
    Object.defineProperty(el, 'clientHeight', { value: clientH, configurable: true });
  }

  it('命中 overflow:auto 且实际有溢出的祖先', () => {
    setBody('<div id="scroller"><div id="mid"><span id="leaf">x</span></div></div>');
    const scroller = document.getElementById('scroller')!;
    (scroller as HTMLElement).style.overflowY = 'auto';
    stubScroll(scroller, 500, 100);
    expect(findScrollableAncestor(document.getElementById('leaf')!)).toBe(scroller);
  });

  it('overflow:auto 但无溢出（scrollHeight==clientHeight）→ 跳过', () => {
    setBody('<div id="s"><span id="leaf">x</span></div>');
    const s = document.getElementById('s')!;
    (s as HTMLElement).style.overflowY = 'auto';
    stubScroll(s, 100, 100);
    expect(findScrollableAncestor(document.getElementById('leaf')!)).toBeNull();
  });

  it('有溢出但 overflow:visible → 跳过', () => {
    setBody('<div id="s"><span id="leaf">x</span></div>');
    const s = document.getElementById('s')!;
    stubScroll(s, 500, 100); // overflow 默认 visible
    expect(findScrollableAncestor(document.getElementById('leaf')!)).toBeNull();
  });

  it('无可滚动祖先 → null', () => {
    setBody('<div id="wrap"><span id="leaf">x</span></div>');
    expect(findScrollableAncestor(document.getElementById('leaf')!)).toBeNull();
  });
});
