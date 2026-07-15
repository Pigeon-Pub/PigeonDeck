// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';
import { deletionRuntime } from './deletion-runtime';

describe('deletionRuntime', () => {
  beforeEach(() => {
    deletionRuntime.reset();
    document.body.innerHTML =
      '<div id="parent"><div id="target" style="opacity:.5" aria-hidden="false"></div><div id="next"></div></div>';
  });

  it('preserve-space 隐藏并禁用原节点，restore 原样恢复', () => {
    const target = document.querySelector<HTMLElement>('#target')!;

    deletionRuntime.capture('a', target);
    expect(deletionRuntime.apply('a', 'preserve-space')).toBe(true);

    expect(target.isConnected).toBe(true);
    expect(target.style.opacity).toBe('0');
    expect(target.style.pointerEvents).toBe('none');
    expect(target.inert).toBe(true);
    expect(target.getAttribute('aria-hidden')).toBe('true');

    expect(deletionRuntime.restore('a')).toBe(true);
    expect(target.style.opacity).toBe('0.5');
    expect(target.style.pointerEvents).toBe('');
    expect(target.inert).toBe(false);
    expect(target.getAttribute('aria-hidden')).toBe('false');
  });

  it('reflow 脱离节点，restore 插回原后继节点之前', () => {
    const target = document.querySelector<HTMLElement>('#target')!;
    const next = document.querySelector('#next')!;

    deletionRuntime.capture('b', target);
    expect(deletionRuntime.apply('b', 'reflow')).toBe(true);
    expect(target.isConnected).toBe(false);

    expect(deletionRuntime.restore('b')).toBe(true);
    expect(target.isConnected).toBe(true);
    expect(target.nextElementSibling).toBe(next);
  });

  it('未知删除记录返回 false', () => {
    expect(deletionRuntime.apply('missing', 'preserve-space')).toBe(false);
    expect(deletionRuntime.restore('missing')).toBe(false);
  });
});
