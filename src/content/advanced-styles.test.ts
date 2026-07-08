// @vitest-environment jsdom
/* ============================================================
   advanced-styles.test.ts — 调试 tab readout 无内层滚动
   N1：.cslist 不再附带 pd-scroll，外层 .scon 负责滚动
   ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import { createAdvancedBox } from './advanced-styles';
import { FieldsSession } from './fields';

let target: HTMLElement;
let ctx: { popoverRoot: HTMLElement };

beforeEach(() => {
  document.body.innerHTML = '';
  target = document.createElement('div');
  target.textContent = 'test element';
  document.body.appendChild(target);
  const popoverRoot = document.createElement('div');
  document.body.appendChild(popoverRoot);
  ctx = { popoverRoot };
});

describe('createAdvancedBox — debug tab', () => {
  it('debug readout .cslist should NOT have pd-scroll class (N1 fix)', () => {
    const session = new FieldsSession(target);
    const box = createAdvancedBox({ session, ctx });

    // 切到调试分类
    const debugBtn = box.querySelector<HTMLButtonElement>('[data-testid="pd-adv-nav-debug"]');
    expect(debugBtn).toBeTruthy();
    debugBtn!.click();

    const cslist = box.querySelector('.cslist');
    expect(cslist).toBeTruthy();
    expect(cslist!.classList.contains('pd-scroll')).toBe(false);
  });

  it('debug readout renders computed-style rows', () => {
    const session = new FieldsSession(target);
    const box = createAdvancedBox({ session, ctx });

    const debugBtn = box.querySelector<HTMLButtonElement>('[data-testid="pd-adv-nav-debug"]');
    debugBtn!.click();

    // 应包含 CS_PROPS 定义的若干行（当前 11 行）
    const rows = box.querySelectorAll('.csrow');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('translate toggle switches debug label language', () => {
    const session = new FieldsSession(target);
    const box = createAdvancedBox({ session, ctx });

    const debugBtn = box.querySelector<HTMLButtonElement>('[data-testid="pd-adv-nav-debug"]');
    debugBtn!.click();

    // 英文态：第一个 .csrow .p 应为英文 prop 名（display）
    const firstProp = () => box.querySelector('.csrow .p')?.textContent ?? '';
    expect(firstProp()).toBe('display');

    // 点翻译
    const trBtn = box.querySelector<HTMLButtonElement>('[data-testid="pd-adv-translate"]');
    expect(trBtn).toBeTruthy();
    trBtn!.click();

    // 翻译态：第一个 .csrow .p 应变为中文（显示）
    expect(firstProp()).toBe('显示');
  });
});
