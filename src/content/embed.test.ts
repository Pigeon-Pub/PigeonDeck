// @vitest-environment jsdom
/* ============================================================
   embed.test.ts — 拖拽嵌入纯函数单测
   pickDropTarget / pickInsertIndex / parseTranslate
   ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import { pickDropTarget, pickInsertIndex, parseTranslate } from './embed';

describe('pickDropTarget', () => {
  let dragged: HTMLElement;
  let sibling: HTMLElement;
  let parent: HTMLElement;
  let child: HTMLElement;
  let host: HTMLElement;
  let hostInner: HTMLElement;

  beforeEach(() => {
    document.body.innerHTML = '';
    parent = document.createElement('div');
    dragged = document.createElement('div');
    child = document.createElement('div');
    sibling = document.createElement('div');
    host = document.createElement('div'); // 模拟工具 shadowHost
    hostInner = document.createElement('div');
    dragged.appendChild(child);
    parent.appendChild(dragged);
    parent.appendChild(sibling);
    host.appendChild(hostInner);
    document.body.appendChild(parent);
    document.body.appendChild(host);
  });

  it('跳过被拖元素自身', () => {
    expect(pickDropTarget([dragged, sibling], dragged, host)).toBe(sibling);
  });

  it('跳过被拖元素的后代', () => {
    expect(pickDropTarget([child, sibling], dragged, host)).toBe(sibling);
  });

  it('跳过被拖元素的祖先', () => {
    expect(pickDropTarget([parent, sibling], dragged, host)).toBe(sibling);
  });

  it('跳过工具自身 UI（shadowHost 及其子树）', () => {
    expect(pickDropTarget([host, hostInner, sibling], dragged, host)).toBe(sibling);
  });

  it('返回栈中首个（最内层）合格容器', () => {
    const inner = document.createElement('div');
    const outer = document.createElement('div');
    outer.appendChild(inner);
    document.body.appendChild(outer);
    // inner 在前 → 优先返回 inner
    expect(pickDropTarget([inner, outer], dragged, host)).toBe(inner);
  });

  it('无合格容器 → null', () => {
    expect(pickDropTarget([dragged, child, parent, host], dragged, host)).toBeNull();
  });
});

describe('pickInsertIndex', () => {
  it('拖放点在首个子项之前 → 0', () => {
    expect(pickInsertIndex([100, 200, 300], 50)).toBe(0);
  });

  it('拖放点落在中间 → 首个 start > pointer 的下标', () => {
    expect(pickInsertIndex([100, 200, 300], 150)).toBe(1);
    expect(pickInsertIndex([100, 200, 300], 250)).toBe(2);
  });

  it('拖放点在末尾之后 → 追加（length）', () => {
    expect(pickInsertIndex([100, 200, 300], 400)).toBe(3);
  });

  it('空子项列表 → 0（append）', () => {
    expect(pickInsertIndex([], 100)).toBe(0);
  });

  it('边界：等于某 start 时不算「之后」，落在其前一位', () => {
    // start 200 不满足 > 200，200 之前无更大者 → 命中 300 的下标 2
    expect(pickInsertIndex([100, 200, 300], 200)).toBe(2);
  });
});

describe('parseTranslate', () => {
  it('空串 → {0,0}', () => {
    expect(parseTranslate('')).toEqual({ x: 0, y: 0 });
  });

  it('none → {0,0}', () => {
    expect(parseTranslate('none')).toEqual({ x: 0, y: 0 });
  });

  it('translate(10px, 20px)', () => {
    expect(parseTranslate('translate(10px, 20px)')).toEqual({ x: 10, y: 20 });
  });

  it('负值 + 无空格', () => {
    expect(parseTranslate('translate(-5px,-8px)')).toEqual({ x: -5, y: -8 });
  });

  it('小数', () => {
    expect(parseTranslate('translate(1.5px, 2.25px)')).toEqual({ x: 1.5, y: 2.25 });
  });

  it('非 translate 变换 → {0,0}', () => {
    expect(parseTranslate('scale(2)')).toEqual({ x: 0, y: 0 });
  });
});
