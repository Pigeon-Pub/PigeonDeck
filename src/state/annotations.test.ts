/* ============================================================
   annotations.test.ts — Store 编号规则全覆盖 + 增删改查 + 订阅
   ============================================================ */

import { describe, it, expect, vi } from 'vitest';
import { AnnotationStore, AnnotationInput, StyleChange, mergeChanges } from './annotations';

function input(overrides: Partial<AnnotationInput> = {}): AnnotationInput {
  return {
    selector: '#target',
    elementType: 'text',
    summary: 'p "示例"',
    note: '改一下',
    changes: [],
    viewportPos: { x: 10, y: 20, w: 100, h: 40 },
    ...overrides,
  };
}

describe('AnnotationStore — 编号规则', () => {
  it('编号从 1 递增分配', () => {
    const s = new AnnotationStore();
    expect(s.add(input()).number).toBe(1);
    expect(s.add(input({ selector: '#b' })).number).toBe(2);
    expect(s.add(input({ selector: '#c' })).number).toBe(3);
  });

  it('删除不重排：删掉中间标注，剩余编号不变', () => {
    const s = new AnnotationStore();
    const a1 = s.add(input({ selector: '#a' }));
    const a2 = s.add(input({ selector: '#b' }));
    const a3 = s.add(input({ selector: '#c' }));
    s.remove(a2.id);
    const numbers = s.getAll().map((a) => a.number);
    expect(numbers).toEqual([a1.number, a3.number]);
    expect(numbers).toEqual([1, 3]);
  });

  it('删除后新标注继续用下一个号，不复用空位', () => {
    const s = new AnnotationStore();
    s.add(input({ selector: '#a' }));
    const a2 = s.add(input({ selector: '#b' }));
    s.remove(a2.id);
    expect(s.add(input({ selector: '#c' })).number).toBe(3);
  });

  it('删除最后一条后新编号也不复用', () => {
    const s = new AnnotationStore();
    const a1 = s.add(input());
    s.remove(a1.id);
    expect(s.add(input()).number).toBe(2);
  });

  it('清空后编号从 1 重置', () => {
    const s = new AnnotationStore();
    s.add(input({ selector: '#a' }));
    s.add(input({ selector: '#b' }));
    s.clear();
    expect(s.getAll()).toEqual([]);
    expect(s.add(input()).number).toBe(1);
  });

  it('update 不改变编号', () => {
    const s = new AnnotationStore();
    const a = s.add(input());
    const updated = s.update(a.id, { note: '新说明' });
    expect(updated!.number).toBe(a.number);
    expect(updated!.note).toBe('新说明');
  });
});

describe('AnnotationStore — 增删改查', () => {
  it('add 返回完整记录（id/createdAt 已分配，changes 为空数组）', () => {
    const s = new AnnotationStore();
    const a = s.add(input());
    expect(a.id).toBeTruthy();
    expect(a.createdAt).toBeGreaterThan(0);
    expect(a.changes).toEqual([]);
    expect(a.note).toBe('改一下');
  });

  it('id 各不相同', () => {
    const s = new AnnotationStore();
    const ids = [s.add(input()).id, s.add(input()).id, s.add(input()).id];
    expect(new Set(ids).size).toBe(3);
  });

  it('getBySelector 命中对应记录', () => {
    const s = new AnnotationStore();
    s.add(input({ selector: '#a' }));
    const b = s.add(input({ selector: '#b' }));
    expect(s.getBySelector('#b')?.id).toBe(b.id);
    expect(s.getBySelector('#none')).toBeUndefined();
  });

  it('getById 命中对应记录', () => {
    const s = new AnnotationStore();
    const a = s.add(input());
    expect(s.getById(a.id)?.selector).toBe('#target');
    expect(s.getById('missing')).toBeUndefined();
  });

  it('remove 不存在的 id 返回 false', () => {
    const s = new AnnotationStore();
    expect(s.remove('missing')).toBe(false);
  });

  it('update 不存在的 id 返回 undefined', () => {
    const s = new AnnotationStore();
    expect(s.update('missing', { note: 'x' })).toBeUndefined();
  });

  it('getAll 返回副本，外部修改不影响内部', () => {
    const s = new AnnotationStore();
    s.add(input());
    const all = s.getAll();
    all.pop();
    expect(s.getAll().length).toBe(1);
  });
});

describe('AnnotationStore — 订阅', () => {
  it('add/update/remove/clear 均触发通知', () => {
    const s = new AnnotationStore();
    const listener = vi.fn();
    s.subscribe(listener);
    const a = s.add(input());
    s.update(a.id, { note: 'x' });
    s.remove(a.id);
    s.clear();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('通知携带当前全量快照', () => {
    const s = new AnnotationStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.add(input());
    expect(listener).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ number: 1 })])
    );
  });

  it('取消订阅后不再通知', () => {
    const s = new AnnotationStore();
    const listener = vi.fn();
    const unsub = s.subscribe(listener);
    unsub();
    s.add(input());
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('AnnotationStore — 序列化恢复', () => {
  it('toPageState → load 往返：编号与 nextNumber 保留', () => {
    const s = new AnnotationStore();
    s.add(input({ selector: '#a' }));
    const a2 = s.add(input({ selector: '#b' }));
    s.remove(a2.id);
    const state = s.toPageState();

    const restored = new AnnotationStore();
    restored.load(state);
    expect(restored.getAll().map((a) => a.number)).toEqual([1]);
    // 恢复后新增编号延续（不复用已删除的 2）
    expect(restored.add(input()).number).toBe(3);
  });

  it('load 触发订阅通知', () => {
    const s = new AnnotationStore();
    const listener = vi.fn();
    s.subscribe(listener);
    s.load({ nextNumber: 5, annotations: [] });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('AnnotationStore — restore（撤销删除/重做新增）', () => {
  it('restore 原样放回：id/number 保留，按编号排序', () => {
    const s = new AnnotationStore();
    const a1 = s.add(input({ selector: '#a' }));
    const a2 = s.add(input({ selector: '#b' }));
    s.add(input({ selector: '#c' }));
    s.remove(a2.id);
    s.restore(a2);
    expect(s.getAll().map((a) => a.number)).toEqual([1, 2, 3]);
    expect(s.getById(a2.id)?.number).toBe(2);
    expect(s.getById(a1.id)).toBeTruthy();
  });

  it('restore 不回退 nextNumber，且不重复放回', () => {
    const s = new AnnotationStore();
    const a1 = s.add(input());
    s.remove(a1.id);
    s.restore(a1);
    s.restore(a1); // 重复 restore 忽略
    expect(s.getAll().length).toBe(1);
    expect(s.add(input()).number).toBe(2);
  });

  it('清空后 restore 高编号标注 → nextNumber 前进到其后', () => {
    const s = new AnnotationStore();
    const a = s.add(input());
    s.add(input());
    const a3 = s.add(input());
    s.clear();
    void a;
    s.restore(a3);
    expect(s.add(input()).number).toBe(4);
  });
});

describe('mergeChanges — 同属性合并', () => {
  const change = (prop: string, oldValue: string, newValue: string): StyleChange => ({
    prop,
    cssProp: prop,
    oldValue,
    newValue,
  });

  it('同一属性多次改动合并为一条：最初 oldValue + 最新 newValue', () => {
    const merged = mergeChanges(
      [change('fontSize', '24px', '28px')],
      [change('fontSize', '28px', '32px')]
    );
    expect(merged).toEqual([change('fontSize', '24px', '32px')]);
  });

  it('不同属性各自保留', () => {
    const merged = mergeChanges(
      [change('fontSize', '24px', '32px')],
      [change('color', '#000', '#b8842c')]
    );
    expect(merged).toHaveLength(2);
  });

  it('改回原值的条目剔除', () => {
    const merged = mergeChanges(
      [change('fontSize', '24px', '32px')],
      [change('fontSize', '32px', '24px')]
    );
    expect(merged).toEqual([]);
  });

  it('空旧记录时直接采用新记录', () => {
    const merged = mergeChanges([], [change('color', '#000', '#fff')]);
    expect(merged).toEqual([change('color', '#000', '#fff')]);
  });
});
