// @vitest-environment jsdom
/* ============================================================
   clear.test.ts — 阶段 10 清空复合命令核心语义
   通过真实 ClearManager 走「触发 → 确认 → 清空」路径，验证：
   - 清空后 store 空 + nextNumber 重置为 1 + history 可撤销
   - 撤销后标注（含编号）与 nextNumber 恢复
   - 重做后再次清空
   ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import { ClearManager } from './clear';
import { Controller } from './controller';
import { AnnotationStore, AnnotationInput } from '../state/annotations';
import { History } from '../state/history';
import { Toast } from './toast';

function makeInput(selector: string, note: string): AnnotationInput {
  return {
    selector,
    elementType: 'text',
    summary: 'summary',
    note,
    changes: [],
    viewportPos: { x: 0, y: 0, w: 10, h: 10 },
  };
}

interface Harness {
  controller: Controller;
  store: AnnotationStore;
  history: History;
  panelLayer: HTMLElement;
}

function setup(): Harness {
  document.body.innerHTML = '';

  const controlLayer = document.createElement('div');
  const clearBtn = document.createElement('button');
  clearBtn.setAttribute('data-testid', 'pd-btn-clear');
  clearBtn.className = 'pd-tbtn';
  controlLayer.appendChild(clearBtn);
  document.body.appendChild(controlLayer);

  const panelLayer = document.createElement('div');
  document.body.appendChild(panelLayer);

  const feedbackLayer = document.createElement('div');
  document.body.appendChild(feedbackLayer);

  const controller = new Controller();
  const store = new AnnotationStore();
  const history = new History();
  const toast = new Toast(feedbackLayer);

  new ClearManager({ controller, store, history, toast, controlLayer, panelLayer });

  return { controller, store, history, panelLayer };
}

/** 触发清空 → 确认弹层出现 → 点确认 */
function triggerAndConfirm(h: Harness): void {
  h.controller.triggerClear();
  const ok = h.panelLayer.querySelector<HTMLButtonElement>('[data-testid="pd-clear-ok"]');
  if (!ok) throw new Error('confirm popover not opened');
  ok.click();
}

describe('ClearManager — 清空复合命令', () => {
  let h: Harness;

  beforeEach(() => {
    h = setup();
    h.store.add(makeInput('#a', 'first'));
    h.store.add(makeInput('#b', 'second'));
  });

  it('确认清空后：store 空 + nextNumber=1 + 可撤销', () => {
    expect(h.store.getAll()).toHaveLength(2);
    expect(h.store.peekNextNumber()).toBe(3);

    triggerAndConfirm(h);

    expect(h.store.getAll()).toHaveLength(0);
    expect(h.store.peekNextNumber()).toBe(1);
    expect(h.history.canUndo()).toBe(true);
    expect(h.history.canRedo()).toBe(false);
  });

  it('撤销后：标注与编号恢复，nextNumber 也恢复', () => {
    triggerAndConfirm(h);
    h.history.undo();

    const anns = h.store.getAll();
    expect(anns).toHaveLength(2);
    expect(anns.map((a) => a.number)).toEqual([1, 2]);
    expect(anns.map((a) => a.note)).toEqual(['first', 'second']);
    // nextNumber 恢复到清空前（3），保证编号不重排
    expect(h.store.peekNextNumber()).toBe(3);
    expect(h.history.canRedo()).toBe(true);
  });

  it('重做后：再次清空，store 空 + nextNumber=1', () => {
    triggerAndConfirm(h);
    h.history.undo();
    h.history.redo();

    expect(h.store.getAll()).toHaveLength(0);
    expect(h.store.peekNextNumber()).toBe(1);
    expect(h.history.canUndo()).toBe(true);
  });

  it('清空历史：清空前的历史被清掉，栈内只剩一条 clear', () => {
    // 先制造一条历史（模拟已有可撤销操作）
    h.history.push({ label: 'noop', apply: () => {}, revert: () => {} });
    expect(h.history.canUndo()).toBe(true);

    triggerAndConfirm(h);
    // 清空后撤销一次 → 恢复；再撤销应无（旧历史已被 clear 掉）
    expect(h.history.undo()).toBe(true);
    expect(h.history.canUndo()).toBe(false);
  });

  it('无内容时点清空：不开弹层、不清（弹层不出现）', () => {
    const empty = setup();
    empty.controller.triggerClear();
    expect(empty.panelLayer.querySelector('[data-testid="pd-clear-confirm"]')).toBeNull();
  });

  it('弹层已开时再点清空 = 收起', () => {
    h.controller.triggerClear();
    expect(h.panelLayer.querySelector('[data-testid="pd-clear-confirm"]')).not.toBeNull();
    h.controller.triggerClear();
    expect(h.panelLayer.querySelector('[data-testid="pd-clear-confirm"]')).toBeNull();
  });
});
