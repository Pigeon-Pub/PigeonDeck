// @vitest-environment jsdom
/* ============================================================
   restore-replay.test.ts — Cluster W5b Bug1 刷新恢复重放核心语义
   验证 replayRestoredAnnotations：
   - 样式修改 / transform 位移 / 重父嵌入 三类 DOM 副作用重放 + 可撤销/重做
   - 区域标注 / 无法定位元素 → 数据级命令（无 DOM 回放）仍可撤销
   - 多条按创建顺序 push（Ctrl+Z 先撤最新）
   ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import { replayRestoredAnnotations } from './restore-replay';
import { AnnotationStore, AnnotationInput, MoveData } from '../state/annotations';
import { History } from '../state/history';

function baseInput(selector: string): AnnotationInput {
  return {
    selector,
    elementType: 'container',
    summary: 's',
    note: '',
    changes: [],
    viewportPos: { x: 0, y: 0, w: 10, h: 10 },
  };
}

function moveData(dx: number, dy: number, reparent?: MoveData['reparent']): MoveData {
  return {
    dx,
    dy,
    initialRect: { x: 0, y: 0, w: 10, h: 10 },
    finalRect: { x: dx, y: dy, w: 10, h: 10 },
    snap: null,
    freeMove: false,
    reparent,
  };
}

describe('replayRestoredAnnotations', () => {
  let store: AnnotationStore;
  let history: History;

  beforeEach(() => {
    document.body.innerHTML = '';
    store = new AnnotationStore();
    history = new History();
  });

  it('样式修改：重放应用 new 值，撤销回 old + 移除，重做复原', () => {
    document.body.innerHTML = `<div id="t">x</div>`;
    store.add({
      ...baseInput('#t'),
      elementType: 'text',
      changes: [{ prop: 'fontWeight', cssProp: 'font-weight', oldValue: '400', newValue: '700' }],
    });

    replayRestoredAnnotations(store, history);
    const el = document.getElementById('t')!;
    expect(el.style.getPropertyValue('font-weight')).toBe('700');
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(el.style.getPropertyValue('font-weight')).toBe('400');
    expect(store.getAll()).toHaveLength(0);

    history.redo();
    expect(el.style.getPropertyValue('font-weight')).toBe('700');
    expect(store.getAll()).toHaveLength(1);
  });

  it('位移移动：重放设 transform，撤销清空 + 移除，重做复原（元素不回弹）', () => {
    document.body.innerHTML = `<div id="m">x</div>`;
    store.add({ ...baseInput('#m'), move: moveData(40, 30) });

    replayRestoredAnnotations(store, history);
    const el = document.getElementById('m')!;
    expect(el.style.transform).toBe('translate(40px, 30px)');

    history.undo();
    expect(el.style.transform).toBe('');
    expect(store.getAll()).toHaveLength(0);

    history.redo();
    expect(el.style.transform).toBe('translate(40px, 30px)');
  });

  it('重父嵌入：重放追加进容器 + selector 同步，撤销回原父，重做再嵌入', () => {
    document.body.innerHTML = `<div id="orig"><span id="mv">x</span></div><div id="box"></div>`;
    store.add({
      ...baseInput('#orig > #mv'),
      move: moveData(0, 0, { fromSelector: '#mv', toSelector: '#box' }),
    });

    replayRestoredAnnotations(store, history);
    expect(document.getElementById('mv')!.parentElement!.id).toBe('box');
    // selector 已同步为当下唯一位置
    expect(store.getAll()[0].selector).toBe('#mv');

    history.undo();
    expect(document.getElementById('mv')!.parentElement!.id).toBe('orig');
    expect(store.getAll()).toHaveLength(0);

    history.redo();
    expect(document.getElementById('mv')!.parentElement!.id).toBe('box');
  });

  it('重父 + 样式修改：两种副作用都重放且都可撤销', () => {
    document.body.innerHTML = `<div id="orig"><span id="mv">x</span></div><div id="box"></div>`;
    store.add({
      ...baseInput('#orig > #mv'),
      changes: [{ prop: 'fontWeight', cssProp: 'font-weight', oldValue: '400', newValue: '700' }],
      move: moveData(0, 0, { fromSelector: '#mv', toSelector: '#box' }),
    });

    replayRestoredAnnotations(store, history);
    const mv = document.getElementById('mv')!;
    expect(mv.parentElement!.id).toBe('box');
    expect(mv.style.getPropertyValue('font-weight')).toBe('700');

    history.undo();
    expect(document.getElementById('mv')!.parentElement!.id).toBe('orig');
    expect(mv.style.getPropertyValue('font-weight')).toBe('400');
  });

  it('区域标注：数据级命令（无 DOM 回放）仍可撤销/重做', () => {
    store.add({
      kind: 'region',
      selector: '',
      elementType: 'other',
      summary: 'r',
      note: 'n',
      changes: [],
      viewportPos: { x: 0, y: 0, w: 100, h: 80 },
      region: { docRect: { x: 0, y: 0, w: 100, h: 80 }, elements: ['#x'] },
    });

    expect(() => replayRestoredAnnotations(store, history)).not.toThrow();
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(store.getAll()).toHaveLength(0);
    history.redo();
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0].kind).toBe('region');
  });

  it('无法定位的元素：数据级命令，不抛错、仍可撤销', () => {
    store.add({
      ...baseInput('#missing'),
      changes: [{ prop: 'fontWeight', cssProp: 'font-weight', oldValue: '400', newValue: '700' }],
    });

    expect(() => replayRestoredAnnotations(store, history)).not.toThrow();
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(store.getAll()).toHaveLength(0);
  });

  it('多条：撤销先撤最新（按创建顺序 push）', () => {
    document.body.innerHTML = `<div id="a">x</div><div id="b">y</div>`;
    store.add({ ...baseInput('#a'), note: 'first' });
    store.add({ ...baseInput('#b'), note: 'second' });

    replayRestoredAnnotations(store, history);
    history.undo(); // 撤最新 = second

    const left = store.getAll();
    expect(left).toHaveLength(1);
    expect(left[0].note).toBe('first');
  });
});
