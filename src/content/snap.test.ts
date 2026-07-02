/* ============================================================
   snap.test.ts — snapDrag 吸附算法单测（纯函数）
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { snapDrag, Rect } from './snap';

/** 便捷构造矩形 */
function rect(left: number, top: number, width: number, height: number): Rect {
  return { left, top, width, height };
}

describe('snapDrag — 边缘对齐', () => {
  it('左边缘阈值内命中：dx 修正到对齐', () => {
    const dragged = rect(103, 200, 100, 50); // 左 103
    const cand = rect(100, 400, 100, 50); // 左 100
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dx).toBe(-3); // 103 → 100
    expect(r.semantics).toContain('align-left');
    expect(r.guides.some((g) => g.orient === 'v')).toBe(true);
  });

  it('右边缘对齐命中', () => {
    // 候选很窄且远离，确保只有右边缘在阈值内
    const dragged = rect(98, 200, 100, 50); // 右 198, 左 98, 中心 148
    const cand = rect(190, 400, 10, 50); // 右 200, 左 190, 中心 195
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dx).toBe(2); // 右 198 → 200
    expect(r.semantics).toContain('align-right');
  });

  it('顶边缘对齐命中：dy 修正', () => {
    // 候选很矮且远离，只有顶边缘在阈值内
    const dragged = rect(300, 202, 100, 50); // 上 202, 下 252, 中心 227
    const cand = rect(500, 200, 100, 10); // 上 200, 下 210, 中心 205
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dy).toBe(-2); // 202 → 200
    expect(r.semantics).toContain('align-top');
    expect(r.guides.some((g) => g.orient === 'h')).toBe(true);
  });

  it('底边缘对齐命中', () => {
    // 候选很高，top/center 远离拖拽元素所有锚点，只有底边缘在阈值内
    const dragged = rect(300, 197, 100, 50); // 上 197, 下 247, 中心 222
    const cand = rect(500, 100, 100, 150); // 上 100, 下 250, 中心 175
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dy).toBe(3); // 下 247 → 250
    expect(r.semantics).toContain('align-bottom');
  });
});

describe('snapDrag — 中心对齐', () => {
  it('水平中心对齐（竖线，X 轴）', () => {
    // 候选很窄，左/右边缘远离，只有中心在阈值内
    const dragged = rect(102, 300, 100, 50); // 左 102, 右 202, 中心 152
    const cand = rect(140, 600, 20, 50); // 左 140, 右 160, 中心 150
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dx).toBe(-2); // 中心 152 → 150
    expect(r.semantics).toContain('align-center-h');
  });

  it('垂直中心对齐（横线，Y 轴）', () => {
    // 候选很矮，上/下边缘远离，只有中心在阈值内
    const dragged = rect(300, 223, 100, 50); // 上 223, 下 273, 中心 248
    const cand = rect(600, 240, 100, 20); // 上 240, 下 260, 中心 250
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dy).toBe(2); // 中心 248 → 250
    expect(r.semantics).toContain('align-center-v');
  });
});

describe('snapDrag — 阈值边界', () => {
  it('距离 3px（< 阈值 4）→ 吸附', () => {
    const dragged = rect(103, 200, 100, 50);
    const cand = rect(100, 400, 100, 50);
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dx).toBe(-3);
  });

  it('距离 4px（= 阈值 4）→ 吸附（≤ 命中）', () => {
    const dragged = rect(104, 200, 100, 50);
    const cand = rect(100, 400, 100, 50);
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dx).toBe(-4);
    expect(r.semantics).toContain('align-left');
  });

  it('距离 5px（> 阈值 4）→ 不吸附', () => {
    const dragged = rect(105, 205, 100, 50);
    const cand = rect(100, 400, 100, 50);
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dx).toBe(0);
    expect(r.guides.length).toBe(0);
    expect(r.semantics.length).toBe(0);
  });
});

describe('snapDrag — XY 同时吸附', () => {
  it('X 和 Y 都在阈值内 → 两轴都吸附、两条参考线', () => {
    // 与 cand 左对齐差 3、上对齐差 2
    const dragged = rect(103, 202, 100, 50);
    const cand = rect(100, 200, 100, 50);
    const r = snapDrag(dragged, [cand], 4);
    expect(r.dx).toBe(-3);
    expect(r.dy).toBe(-2);
    expect(r.guides.filter((g) => g.orient === 'v').length).toBe(1);
    expect(r.guides.filter((g) => g.orient === 'h').length).toBe(1);
  });
});

describe('snapDrag — 多候选/空候选', () => {
  it('多候选取最近（最小修正量）', () => {
    const dragged = rect(103, 200, 100, 50); // 左 103
    const far = rect(110, 400, 100, 50); // 左 110（差 7，阈值外）
    const near = rect(101, 500, 100, 50); // 左 101（差 2，命中）
    const r = snapDrag(dragged, [far, near], 4);
    expect(r.dx).toBe(-2); // 吸到 near 的 101
  });

  it('两候选都在阈值内 → 取更近的那个', () => {
    const dragged = rect(103, 200, 100, 50); // 左 103
    const c1 = rect(100, 400, 100, 50); // 左 100（差 3）
    const c2 = rect(102, 500, 100, 50); // 左 102（差 1，更近）
    const r = snapDrag(dragged, [c1, c2], 4);
    expect(r.dx).toBe(-1); // 吸到 102
  });

  it('空候选 → 不吸附、无参考线', () => {
    const dragged = rect(103, 200, 100, 50);
    const r = snapDrag(dragged, [], 4);
    expect(r.dx).toBe(0);
    expect(r.dy).toBe(0);
    expect(r.guides.length).toBe(0);
    expect(r.semantics.length).toBe(0);
  });
});

describe('snapDrag — 参考线覆盖范围', () => {
  it('竖参考线覆盖拖拽元素与候选的 top..bottom 并集', () => {
    const dragged = rect(103, 300, 100, 50); // top 300, bottom 350
    const cand = rect(100, 100, 100, 50); // top 100, bottom 150
    const r = snapDrag(dragged, [cand], 4);
    const vGuide = r.guides.find((g) => g.orient === 'v')!;
    expect(vGuide.start).toBe(100); // 并集顶
    expect(vGuide.end).toBe(350); // 并集底
    expect(vGuide.pos).toBe(100); // 对齐后的公共 x
  });
});
