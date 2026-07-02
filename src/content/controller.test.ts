/* ============================================================
   controller.test.ts — Controller 模式切换规则全覆盖
   ============================================================ */

import { describe, it, expect, vi } from 'vitest';
import { Controller } from './controller';

describe('Controller — 初始状态', () => {
  it('初始为收起、annotate 模式', () => {
    const c = new Controller();
    const s = c.getState();
    expect(s.expanded).toBe(false);
    expect(s.mode).toBe('annotate');
  });
});

describe('Controller — 展开/收起', () => {
  it('expand() 后 expanded=true, mode=annotate', () => {
    const c = new Controller();
    c.expand();
    const s = c.getState();
    expect(s.expanded).toBe(true);
    expect(s.mode).toBe('annotate');
  });

  it('重复 expand() 无副作用', () => {
    const c = new Controller();
    c.expand();
    c.expand();
    expect(c.getState().expanded).toBe(true);
  });

  it('collapse() 后 expanded=false, mode 重置为 annotate', () => {
    const c = new Controller();
    c.expand();
    c.toggleMode('move');
    c.collapse();
    const s = c.getState();
    expect(s.expanded).toBe(false);
    expect(s.mode).toBe('annotate');
  });

  it('重复 collapse() 无副作用', () => {
    const c = new Controller();
    c.collapse();
    expect(c.getState().expanded).toBe(false);
  });

  it('toggleExpanded() 切换展开/收起', () => {
    const c = new Controller();
    c.toggleExpanded();
    expect(c.getState().expanded).toBe(true);
    c.toggleExpanded();
    expect(c.getState().expanded).toBe(false);
  });
});

describe('Controller — 模式互斥', () => {
  it('展开后点 move → mode=move', () => {
    const c = new Controller();
    c.expand();
    c.toggleMode('move');
    expect(c.getState().mode).toBe('move');
  });

  it('已在 move → 再点 move 回 annotate', () => {
    const c = new Controller();
    c.expand();
    c.toggleMode('move');
    c.toggleMode('move');
    expect(c.getState().mode).toBe('annotate');
  });

  it('move 模式下点 settings → mode=settings（互斥）', () => {
    const c = new Controller();
    c.expand();
    c.toggleMode('move');
    c.toggleMode('settings');
    expect(c.getState().mode).toBe('settings');
  });

  it('已在 settings → 再点 settings 回 annotate', () => {
    const c = new Controller();
    c.expand();
    c.toggleMode('settings');
    c.toggleMode('settings');
    expect(c.getState().mode).toBe('annotate');
  });

  it('收起状态下 toggleMode() 无效', () => {
    const c = new Controller();
    // collapsed
    c.toggleMode('move');
    expect(c.getState().mode).toBe('annotate');
    expect(c.getState().expanded).toBe(false);
  });

  it('展开后 expand() 不重置正在进行的模式', () => {
    // expand() 应在已展开时 early-return，不影响 mode
    const c = new Controller();
    c.expand();
    c.toggleMode('move');
    c.expand(); // no-op
    expect(c.getState().mode).toBe('move');
  });
});

describe('Controller — subscribe 订阅', () => {
  it('状态变化时通知订阅者', () => {
    const c = new Controller();
    const listener = vi.fn();
    c.subscribe(listener);
    c.expand();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ expanded: true, mode: 'annotate' });
  });

  it('取消订阅后不再通知', () => {
    const c = new Controller();
    const listener = vi.fn();
    const unsub = c.subscribe(listener);
    unsub();
    c.expand();
    expect(listener).not.toHaveBeenCalled();
  });

  it('收起通知正确状态', () => {
    const c = new Controller();
    const listener = vi.fn();
    c.expand();
    c.subscribe(listener);
    c.collapse();
    expect(listener).toHaveBeenCalledWith({ expanded: false, mode: 'annotate' });
  });

  it('模式切换通知正确状态', () => {
    const c = new Controller();
    c.expand();
    const listener = vi.fn();
    c.subscribe(listener);
    c.toggleMode('move');
    expect(listener).toHaveBeenCalledWith({ expanded: true, mode: 'move' });
  });

  it('无变化时不多发通知（mode 未变）', () => {
    const c = new Controller();
    c.expand(); // mode already annotate
    const listener = vi.fn();
    c.subscribe(listener);
    // toggleMode('move') then toggleMode('move') → back to annotate
    c.toggleMode('move');
    c.toggleMode('move');
    // 2 次变化 → 2 次通知
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe('Controller — 瞬时动作回调', () => {
  it('triggerCopyText 调用 onCopyText', () => {
    const c = new Controller();
    const cb = vi.fn();
    c.setCallbacks({ onCopyText: cb });
    c.triggerCopyText();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('triggerCopyImage 调用 onCopyImage', () => {
    const c = new Controller();
    const cb = vi.fn();
    c.setCallbacks({ onCopyImage: cb });
    c.triggerCopyImage();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('triggerClear 调用 onClear', () => {
    const c = new Controller();
    const cb = vi.fn();
    c.setCallbacks({ onClear: cb });
    c.triggerClear();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('triggerUndo 调用 onUndo', () => {
    const c = new Controller();
    const cb = vi.fn();
    c.setCallbacks({ onUndo: cb });
    c.triggerUndo();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('triggerRedo 调用 onRedo', () => {
    const c = new Controller();
    const cb = vi.fn();
    c.setCallbacks({ onRedo: cb });
    c.triggerRedo();
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('未设置回调时不抛异常', () => {
    const c = new Controller();
    expect(() => c.triggerCopyText()).not.toThrow();
    expect(() => c.triggerUndo()).not.toThrow();
  });

  it('瞬时动作不改变 mode', () => {
    const c = new Controller();
    c.expand();
    c.triggerCopyText();
    c.triggerCopyImage();
    c.triggerClear();
    expect(c.getState().mode).toBe('annotate');
  });
});
