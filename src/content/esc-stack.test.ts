// @vitest-environment jsdom
/* ============================================================
   esc-stack.test.ts — Esc 优先级栈：LIFO / 按身份移除 / 栈空放行
   ============================================================ */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initEscStack, pushEsc } from './esc-stack';

/** 向 window 派发一个可取消的 Escape keydown，返回事件对象（供断言 defaultPrevented）。 */
function esc(): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true });
  window.dispatchEvent(e);
  return e;
}

describe('esc-stack — Esc 优先级栈', () => {
  beforeEach(() => {
    initEscStack(); // 幂等：仅首次真正安装监听
  });

  it('LIFO：仅栈顶处理器触发，下层不触发；再按一次才轮到下层', () => {
    const a = vi.fn();
    const b = vi.fn();
    const popA = pushEsc(a);
    const popB = pushEsc(b);

    esc();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();

    esc();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    popA(); // 幂等（均已弹出）
    popB();
  });

  it('触发时拦截：preventDefault + stopImmediatePropagation，下游监听器不触发', () => {
    const downstream = vi.fn();
    window.addEventListener('keydown', downstream, true); // 晚于 esc-stack 注册

    const handler = vi.fn();
    const pop = pushEsc(handler);
    const e = esc();

    expect(handler).toHaveBeenCalledTimes(1);
    expect(e.defaultPrevented).toBe(true);
    expect(downstream).not.toHaveBeenCalled(); // 被 stopImmediatePropagation 拦下

    window.removeEventListener('keydown', downstream, true);
    pop();
  });

  it('pop 按身份移除：即便不在栈顶也只删自己（乱序拆卸不误删他人）', () => {
    const a = vi.fn();
    const b = vi.fn();
    const popA = pushEsc(a); // 底
    pushEsc(b); // 顶

    popA(); // 乱序移除底部 a

    esc(); // 栈顶仍是 b
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it('栈空放行：不 preventDefault、不拦截，下游监听器照常触发', () => {
    const downstream = vi.fn();
    window.addEventListener('keydown', downstream, true);

    const e = esc();
    expect(e.defaultPrevented).toBe(false);
    expect(downstream).toHaveBeenCalledTimes(1);

    window.removeEventListener('keydown', downstream, true);
  });
});
