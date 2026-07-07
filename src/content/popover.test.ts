// @vitest-environment jsdom
/* ============================================================
   popover.test.ts — mountPopover 基本行为 + bindPopoverToggle 开关语义
   INVARIANT 1：触发钮再次点击 = 关闭（不叠开）；点别的触发钮切换旧关新开。
   ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import { mountPopover, closeAllPopovers, bindPopoverToggle, PopoverHandle } from './popover';

/** 造一个挂载根 + 触发钮 */
function setup(): { root: HTMLElement; trigger: HTMLButtonElement } {
  document.body.innerHTML = '';
  const root = document.createElement('div');
  const trigger = document.createElement('button');
  document.body.appendChild(root);
  document.body.appendChild(trigger);
  return { root, trigger };
}

/** 以触发钮为锚点开一个浮层（onClose 透传） */
function openPopover(root: HTMLElement, anchor: HTMLElement, onClose?: () => void): PopoverHandle {
  const el = document.createElement('div');
  el.className = 'test-pop';
  return mountPopover(root, el, anchor, onClose);
}

/** 计当前挂载的测试浮层数量 */
function popCount(root: HTMLElement): number {
  return root.querySelectorAll('.test-pop').length;
}

describe('bindPopoverToggle — 触发钮点击开关', () => {
  beforeEach(() => {
    closeAllPopovers();
    document.body.innerHTML = '';
  });

  it('首次点击打开浮层', () => {
    const { root, trigger } = setup();
    bindPopoverToggle(trigger, (onClose) => openPopover(root, trigger, onClose));
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popCount(root)).toBe(1);
  });

  it('再次点击同一触发钮 = 关闭（不叠开第二个）', () => {
    const { root, trigger } = setup();
    bindPopoverToggle(trigger, (onClose) => openPopover(root, trigger, onClose));
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 开
    expect(popCount(root)).toBe(1);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true })); // 关
    expect(popCount(root)).toBe(0);
  });

  it('开→关→再点 = 重新打开（句柄已归零）', () => {
    const { root, trigger } = setup();
    bindPopoverToggle(trigger, (onClose) => openPopover(root, trigger, onClose));
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popCount(root)).toBe(1);
  });

  it('连点三次不会堆叠（终态只剩 1 个：开→关→开）', () => {
    const { root, trigger } = setup();
    bindPopoverToggle(trigger, (onClose) => openPopover(root, trigger, onClose));
    for (let i = 0; i < 3; i++) trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popCount(root)).toBe(1);
  });

  it('浮层被外部关闭（closeAllPopovers）后，再次点击可重新打开', () => {
    const { root, trigger } = setup();
    bindPopoverToggle(trigger, (onClose) => openPopover(root, trigger, onClose));
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popCount(root)).toBe(1);
    closeAllPopovers(); // onClose 归零本地句柄
    expect(popCount(root)).toBe(0);
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popCount(root)).toBe(1);
  });

  it('点别的触发钮：mountPopover 点外部逻辑关旧、新触发钮开新（不双开）', () => {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    const a = document.createElement('button');
    const b = document.createElement('button');
    document.body.append(root, a, b);

    bindPopoverToggle(a, (onClose) => openPopover(root, a, onClose));
    bindPopoverToggle(b, (onClose) => openPopover(root, b, onClose));

    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popCount(root)).toBe(1);

    // 点 b：先触发 window mousedown（capture）关掉 a 的浮层，再 click 开 b 的
    b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(popCount(root)).toBe(1);
  });
});
