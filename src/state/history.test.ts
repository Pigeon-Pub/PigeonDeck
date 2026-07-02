/* ============================================================
   history.test.ts — 命令栈行为：push/undo/redo/上限截断/redo 清空
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { History, Command } from './history';

/** 造一条把数字追加进日志的命令 */
function cmd(log: string[], name: string): Command {
  return {
    label: name,
    apply: () => log.push(`apply:${name}`),
    revert: () => log.push(`revert:${name}`),
  };
}

describe('History — push/undo/redo', () => {
  it('push 不执行 apply（动作已在外部执行）', () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd(log, 'a'));
    expect(log).toEqual([]);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('undo 调 revert 并进入 redo 栈', () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd(log, 'a'));
    expect(h.undo()).toBe(true);
    expect(log).toEqual(['revert:a']);
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(true);
  });

  it('redo 调 apply 并回到 undo 栈', () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd(log, 'a'));
    h.undo();
    expect(h.redo()).toBe(true);
    expect(log).toEqual(['revert:a', 'apply:a']);
    expect(h.canUndo()).toBe(true);
    expect(h.canRedo()).toBe(false);
  });

  it('undo/redo 按后进先出顺序执行', () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd(log, 'a'));
    h.push(cmd(log, 'b'));
    h.undo();
    h.undo();
    expect(log).toEqual(['revert:b', 'revert:a']);
    h.redo();
    h.redo();
    expect(log).toEqual(['revert:b', 'revert:a', 'apply:a', 'apply:b']);
  });

  it('空栈 undo/redo 返回 false 且无副作用', () => {
    const h = new History();
    expect(h.undo()).toBe(false);
    expect(h.redo()).toBe(false);
  });
});

describe('History — redo 被新命令清空', () => {
  it('undo 后 push 新命令 → redo 不可用', () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd(log, 'a'));
    h.push(cmd(log, 'b'));
    h.undo(); // b 进 redo
    expect(h.canRedo()).toBe(true);
    h.push(cmd(log, 'c'));
    expect(h.canRedo()).toBe(false);
    expect(h.redo()).toBe(false);
  });
});

describe('History — 上限截断', () => {
  it('超过上限丢弃最旧命令', () => {
    const log: string[] = [];
    const h = new History(2);
    h.push(cmd(log, 'a'));
    h.push(cmd(log, 'b'));
    h.push(cmd(log, 'c')); // a 被丢弃
    expect(h.undo()).toBe(true); // c
    expect(h.undo()).toBe(true); // b
    expect(h.undo()).toBe(false); // a 已不在
    expect(log).toEqual(['revert:c', 'revert:b']);
  });

  it('默认上限 50', () => {
    const log: string[] = [];
    const h = new History();
    for (let i = 0; i < 60; i++) h.push(cmd(log, String(i)));
    let count = 0;
    while (h.undo()) count++;
    expect(count).toBe(50);
  });

  it('setLimit 缩小上限时立即截断最旧', () => {
    const log: string[] = [];
    const h = new History(10);
    for (let i = 0; i < 5; i++) h.push(cmd(log, String(i)));
    h.setLimit(2);
    let count = 0;
    while (h.undo()) count++;
    expect(count).toBe(2);
    expect(log).toEqual(['revert:4', 'revert:3']);
  });
});

describe('History — clear', () => {
  it('clear 后 undo/redo 均不可用', () => {
    const log: string[] = [];
    const h = new History();
    h.push(cmd(log, 'a'));
    h.undo();
    h.push(cmd(log, 'b'));
    h.clear();
    expect(h.canUndo()).toBe(false);
    expect(h.canRedo()).toBe(false);
  });
});
