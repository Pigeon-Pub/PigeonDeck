/* ============================================================
   format.test.ts — 阶段 8a 格式化管线重度单测
   覆盖：Type 组合 / 去重合并 / 移动 / Changes 分流 / Region /
         渲染结构 / 语言 / 内容修改 / 吸附描述
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { buildOperations, renderTaskList } from './format';
import type { PageContext } from './format';
import type { Annotation, MoveData, RegionData, ViewportPos } from '../state/annotations';

// ============================================================
// Factories
// ============================================================

const BASE_VP: ViewportPos = { x: 100, y: 200, w: 300, h: 50 };

function ann(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    number: 1,
    selector: 'button.cta',
    elementType: 'button',
    summary: 'button "Submit"',
    note: '',
    changes: [],
    createdAt: 0,
    viewportPos: BASE_VP,
    ...overrides,
  };
}

const CTX: PageContext = {
  url: 'https://example.com/pricing',
  title: 'Pricing — Acme',
  viewportW: 1440,
  viewportH: 900,
  timestamp: '2026-06-27 16:40',
};

const INITIAL_RECT: ViewportPos = { x: 100, y: 200, w: 300, h: 50 };
const FINAL_RECT: ViewportPos = { x: 200, y: 300, w: 300, h: 50 };

const MOVE_SNAPPED: MoveData = {
  dx: 100,
  dy: 100,
  initialRect: INITIAL_RECT,
  finalRect: FINAL_RECT,
  snap: 'align-center-h',
  freeMove: false,
};

const MOVE_FREE: MoveData = {
  dx: 50,
  dy: 20,
  initialRect: INITIAL_RECT,
  finalRect: { x: 150, y: 220, w: 300, h: 50 },
  snap: null,
  freeMove: true,
};

const MOVE_NO_SNAP: MoveData = {
  dx: 30,
  dy: 10,
  initialRect: INITIAL_RECT,
  finalRect: { x: 130, y: 210, w: 300, h: 50 },
  snap: null,
  freeMove: false,
};

// ============================================================
// buildOperations — Type construction
// ============================================================

describe('buildOperations — type construction', () => {
  it('pure Annotation: note non-empty → type = "Annotation"', () => {
    const ops = buildOperations([ann({ note: 'Change color' })]);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('Annotation');
  });

  it('pure Style Modification: CSS change, no note → type = "Style Modification"', () => {
    const ops = buildOperations([
      ann({ changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#fff', newValue: '#000' }] }),
    ]);
    expect(ops[0].type).toBe('Style Modification');
  });

  it('pure Move: move set, no note, no changes → type = "Move"', () => {
    const ops = buildOperations([ann({ move: MOVE_SNAPPED })]);
    expect(ops[0].type).toBe('Move');
  });

  it('Annotation + Style: note + CSS → type = "Annotation + Style Modification"', () => {
    const ops = buildOperations([
      ann({
        note: 'Make bigger',
        changes: [{ prop: 'fs', cssProp: 'font-size', oldValue: '14px', newValue: '18px' }],
      }),
    ]);
    expect(ops[0].type).toBe('Annotation + Style Modification');
  });

  it('Annotation + Style + Move: all three → type = "Annotation + Style Modification + Move"', () => {
    const ops = buildOperations([
      ann({
        note: 'Fix button',
        changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#fff', newValue: '#000' }],
        move: MOVE_SNAPPED,
      }),
    ]);
    expect(ops[0].type).toBe('Annotation + Style Modification + Move');
  });

  it('Region → type = "Region"', () => {
    const region: RegionData = {
      docRect: { x: 100, y: 200, w: 400, h: 300 },
      elements: ['div.card', 'span.price'],
    };
    const ops = buildOperations([ann({ kind: 'region', selector: '', note: 'Too cramped', region })]);
    expect(ops[0].type).toBe('Region');
  });

  it('empty annotation (no note, no changes, no move) → skipped, no output', () => {
    const ops = buildOperations([ann({ note: '', changes: [], move: undefined })]);
    expect(ops).toHaveLength(0);
  });

  it('whitespace-only note treated as empty', () => {
    const ops = buildOperations([ann({ note: '   ', changes: [], move: undefined })]);
    expect(ops).toHaveLength(0);
  });
});

// ============================================================
// buildOperations — same-element merge (§6.4)
// ============================================================

describe('buildOperations — same-element merge', () => {
  it('single annotation with note + CSS + move → one operation, all three type parts', () => {
    const ops = buildOperations([
      ann({
        note: 'Change color and move',
        changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#2563eb', newValue: '#b8842c' }],
        move: MOVE_SNAPPED,
      }),
    ]);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe('Annotation + Style Modification + Move');
    expect(ops[0].cssChanges).toHaveLength(1);
    expect(ops[0].move).toBeDefined();
    expect(ops[0].instruction).toBe('Change color and move');
  });

  it('two annotations same selector → merged to one operation', () => {
    const a1 = ann({
      id: 'a1', number: 1, selector: 'div.hero',
      changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#fff', newValue: '#000' }],
    });
    const a2 = ann({
      id: 'a2', number: 2, selector: 'div.hero',
      changes: [{ prop: 'fs', cssProp: 'font-size', oldValue: '14px', newValue: '18px' }],
    });
    const ops = buildOperations([a1, a2]);
    expect(ops).toHaveLength(1);
    expect(ops[0].cssChanges).toHaveLength(2);
  });

  it('two annotations same selector: latest non-empty note wins', () => {
    const a1 = ann({ id: 'a1', number: 1, selector: 's', note: '' });
    const a2 = ann({ id: 'a2', number: 2, selector: 's', note: 'Updated note', changes: [{ prop: 'x', cssProp: 'opacity', oldValue: '1', newValue: '0.5' }] });
    const ops = buildOperations([a1, a2]);
    expect(ops[0].instruction).toBe('Updated note');
  });

  it('two annotations same selector, same prop → keeps first old, last new value', () => {
    const a1 = ann({
      id: 'a1', number: 1, selector: 's',
      changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#old', newValue: '#mid' }],
    });
    const a2 = ann({
      id: 'a2', number: 2, selector: 's',
      changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#mid', newValue: '#new' }],
    });
    const ops = buildOperations([a1, a2]);
    expect(ops[0].cssChanges).toHaveLength(1);
    expect(ops[0].cssChanges[0].oldValue).toBe('#old');
    expect(ops[0].cssChanges[0].newValue).toBe('#new');
  });
});

// ============================================================
// buildOperations — Move (§6.3)
// ============================================================

describe('buildOperations — move initial→final only', () => {
  it('move data carries initialRect and finalRect', () => {
    const ops = buildOperations([ann({ move: MOVE_SNAPPED })]);
    expect(ops[0].move?.initialRect).toEqual(INITIAL_RECT);
    expect(ops[0].move?.finalRect).toEqual(FINAL_RECT);
  });

  it('merged same-selector: keeps first initialRect', () => {
    const origInitial: ViewportPos = { x: 50, y: 50, w: 100, h: 30 };
    const a1 = ann({
      id: 'a1', number: 1, selector: 's',
      move: { dx: 50, dy: 50, initialRect: origInitial, finalRect: { x: 100, y: 100, w: 100, h: 30 }, snap: null, freeMove: false },
    });
    const a2 = ann({
      id: 'a2', number: 2, selector: 's',
      move: { dx: 100, dy: 100, initialRect: { x: 100, y: 100, w: 100, h: 30 }, finalRect: { x: 150, y: 150, w: 100, h: 30 }, snap: null, freeMove: false },
    });
    const ops = buildOperations([a1, a2]);
    expect(ops[0].move?.initialRect).toEqual(origInitial);
    expect(ops[0].move?.finalRect).toEqual({ x: 150, y: 150, w: 100, h: 30 });
  });
});

// ============================================================
// buildOperations — Changes splitting
// ============================================================

describe('buildOperations — changes splitting', () => {
  it('CSS change → cssChanges only', () => {
    const ops = buildOperations([
      ann({ changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#fff', newValue: '#000' }] }),
    ]);
    expect(ops[0].cssChanges).toHaveLength(1);
    expect(ops[0].contentChanges).toHaveLength(0);
  });

  it('text change → contentChanges, not cssChanges', () => {
    const ops = buildOperations([
      ann({ changes: [{ prop: 'text', cssProp: 'text', oldValue: 'Old text', newValue: 'New text' }] }),
    ]);
    expect(ops[0].cssChanges).toHaveLength(0);
    expect(ops[0].contentChanges).toHaveLength(1);
    expect(ops[0].contentChanges[0].kind).toBe('text');
  });

  it('html change → contentChanges with kind html', () => {
    const ops = buildOperations([
      ann({ changes: [{ prop: 'html', cssProp: 'html', oldValue: '<b>Old</b>', newValue: '<i>New</i>' }] }),
    ]);
    expect(ops[0].contentChanges[0].kind).toBe('html');
  });

  it('src change → contentChanges with kind src', () => {
    const ops = buildOperations([
      ann({ changes: [{ prop: 'src', cssProp: 'src', oldValue: 'https://old.com/img.jpg', newValue: 'data:image/png;base64,abc' }] }),
    ]);
    expect(ops[0].contentChanges[0].kind).toBe('src');
  });

  it('mixed CSS + text → correct split', () => {
    const ops = buildOperations([
      ann({
        changes: [
          { prop: 'bg', cssProp: 'background-color', oldValue: '#fff', newValue: '#000' },
          { prop: 'text', cssProp: 'text', oldValue: 'Old', newValue: 'New' },
        ],
      }),
    ]);
    expect(ops[0].cssChanges).toHaveLength(1);
    expect(ops[0].contentChanges).toHaveLength(1);
    expect(ops[0].cssChanges[0].cssProp).toBe('background-color');
    expect(ops[0].contentChanges[0].kind).toBe('text');
  });
});

// ============================================================
// buildOperations — Region
// ============================================================

describe('buildOperations — region', () => {
  it('region: type=Region, carries scope and coordinates', () => {
    const region: RegionData = {
      docRect: { x: 320, y: 180, w: 400, h: 340 },
      elements: ['div.card', 'img.thumb', 'span.price'],
    };
    const ops = buildOperations([ann({ kind: 'region', selector: '', note: 'Fix spacing', region })]);
    expect(ops[0].type).toBe('Region');
    expect(ops[0].region?.elements).toEqual(['div.card', 'img.thumb', 'span.price']);
  });

  it('region not merged with element annotations', () => {
    const region: RegionData = { docRect: { x: 0, y: 0, w: 100, h: 100 }, elements: ['div.a'] };
    const annotations = [
      ann({ id: 'e', number: 1, selector: 'div.a', note: 'elem note' }),
      ann({ id: 'r', number: 2, selector: '', kind: 'region', note: 'region note', region }),
    ];
    const ops = buildOperations(annotations);
    expect(ops).toHaveLength(2);
    expect(ops.some((o) => o.type === 'Region')).toBe(true);
    expect(ops.some((o) => o.type === 'Annotation')).toBe(true);
  });

  it('region with no note and no elements → skipped', () => {
    const region: RegionData = { docRect: { x: 0, y: 0, w: 100, h: 100 }, elements: [] };
    const ops = buildOperations([ann({ kind: 'region', selector: '', note: '', region })]);
    expect(ops).toHaveLength(0);
  });
});

// ============================================================
// buildOperations — ordering
// ============================================================

describe('buildOperations — ordering', () => {
  it('ops sorted by annotation number ascending', () => {
    const annotations = [
      ann({ id: 'a5', number: 5, selector: 's5', note: 'five' }),
      ann({ id: 'a2', number: 2, selector: 's2', note: 'two' }),
      ann({ id: 'a8', number: 8, selector: 's8', note: 'eight' }),
    ];
    const ops = buildOperations(annotations);
    expect(ops.map((o) => o.number)).toEqual([2, 5, 8]);
  });
});

// ============================================================
// renderTaskList — Page Context
// ============================================================

describe('renderTaskList — page context', () => {
  it('renders [Page Context] with all fields', () => {
    const result = renderTaskList([], CTX);
    expect(result).toContain('[Page Context]');
    expect(result).toContain('URL: https://example.com/pricing');
    expect(result).toContain('Title: Pricing — Acme');
    expect(result).toContain('Viewport: 1440 × 900 (px)');
    expect(result).toContain('Timestamp: 2026-06-27 16:40');
  });
});

// ============================================================
// renderTaskList — Global Editing Rules
// ============================================================

describe('renderTaskList — global editing rules', () => {
  it('en: English three rules', () => {
    const result = renderTaskList([], CTX, 'en');
    expect(result).toContain('[Global Editing Rules]');
    expect(result).toContain('- Do NOT hardcode top/left absolute positions.');
    expect(result).toContain('- Prefer existing layout: flex, grid, gap, margin, order.');
    expect(result).toContain('- Visual coordinates are location hints, not implementation.');
  });

  it('zh_CN: Chinese three rules', () => {
    const result = renderTaskList([], CTX, 'zh_CN');
    expect(result).toContain('[Global Editing Rules]');
    expect(result).toContain('- 不要硬编码 top/left 绝对定位');
    expect(result).toContain('- 优先使用现有布局机制：flex、grid、gap、margin、order');
    expect(result).toContain('- 视觉坐标为定位线索，不是实施指令');
  });

  it('unknown lang → fallback to en rules', () => {
    // @ts-expect-error: test unknown lang fallback
    const result = renderTaskList([], CTX, 'fr');
    expect(result).toContain('Do NOT hardcode top/left absolute positions.');
  });

  it('user note in Chinese stays Chinese even in en output', () => {
    const ops = buildOperations([ann({ note: '这是中文批注', selector: 'p', number: 1 })]);
    const result = renderTaskList(ops, CTX, 'en');
    expect(result).toContain('这是中文批注');
    expect(result).toContain('Do NOT hardcode');
  });
});

// ============================================================
// renderTaskList — Operations section
// ============================================================

describe('renderTaskList — [Operations] section', () => {
  it('empty ops → [Operations] with "(no operations)"', () => {
    const result = renderTaskList([], CTX);
    expect(result).toContain('[Operations]');
    expect(result).toContain('no operations');
  });

  it('Annotation op: header, Target, Location, Instruction', () => {
    const ops = buildOperations([
      ann({
        number: 1,
        selector: 'section.hero > h2',
        summary: 'h2 "Hero Title"',
        note: 'Make it bigger',
        viewportPos: { x: 720, y: 90, w: 400, h: 60 },
      }),
    ]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('--- #1 Annotation ---');
    expect(result).toContain('Target: section.hero > h2');
    expect(result).toContain('Location: h2 "Hero Title"');
    expect(result).toContain('Instruction: Make it bigger');
  });

  it('Style Modification op: no Location shown, has Changes table', () => {
    const ops = buildOperations([
      ann({
        number: 2,
        selector: 'button.cta',
        note: '',
        changes: [
          { prop: 'bg', cssProp: 'background-color', oldValue: '#2563eb', newValue: '#b8842c' },
          { prop: 'br', cssProp: 'border-radius', oldValue: '6px', newValue: '12px' },
        ],
      }),
    ]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('--- #2 Style Modification ---');
    expect(result).toContain('Target: button.cta');
    expect(result).not.toContain('Location:');
    expect(result).toContain('Changes:');
    expect(result).toContain('| background-color | #2563eb | #b8842c |');
    expect(result).toContain('| border-radius | 6px | 12px |');
  });

  it('Annotation + Style Modification + Move: all blocks present', () => {
    const ops = buildOperations([
      ann({
        number: 2,
        selector: 'button.cta',
        note: 'Gold color + move to sidebar',
        changes: [{ prop: 'bg', cssProp: 'background-color', oldValue: '#2563eb', newValue: '#b8842c' }],
        move: MOVE_SNAPPED,
      }),
    ]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('--- #2 Annotation + Style Modification + Move ---');
    expect(result).toContain('Location:');
    expect(result).toContain('Instruction: Gold color + move to sidebar');
    expect(result).toContain('Changes:');
    expect(result).toContain('| background-color | #2563eb | #b8842c |');
    expect(result).toContain('Move:');
    expect(result).toContain('Source: button.cta');
    expect(result).toContain('Initial:');
    expect(result).toContain('Final:');
    expect(result).toContain('Snap: snapped (X center)');
  });

  it('Move op: Source/Target/Initial/Final/Snap present', () => {
    const ops = buildOperations([ann({ number: 3, selector: 'div.card', move: MOVE_SNAPPED })]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('--- #3 Move ---');
    expect(result).toContain('Move:');
    expect(result).toContain('Source: div.card');
    expect(result).toContain('Initial: (100, 200) 300×50');
    expect(result).toContain('Final: (200, 300) 300×50');
    expect(result).toContain('Snap: snapped (X center)');
  });

  it('Move: free move → "Snap: free move"', () => {
    const ops = buildOperations([ann({ move: MOVE_FREE })]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('Snap: free move');
  });

  it('Move: snap null, freeMove false → "Snap: no snap"', () => {
    const ops = buildOperations([ann({ move: MOVE_NO_SNAP })]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('Snap: no snap');
  });

  it('Region op: Scope, Coordinates, Instruction; no Target line', () => {
    const region: RegionData = {
      docRect: { x: 320, y: 180, w: 400, h: 340 },
      elements: ['div.card', 'img.thumb', 'span.price'],
    };
    const ops = buildOperations([ann({ number: 4, kind: 'region', selector: '', note: '留白太挤', region })]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('--- #4 Region ---');
    expect(result).toContain('Scope: [div.card, img.thumb, span.price]');
    expect(result).toContain('Coordinates: (320,180)–(720,520)');
    expect(result).toContain('Instruction: 留白太挤');
    expect(result).not.toContain('\nTarget:');
  });

  it('content change text: Content: "old" → "new"', () => {
    const ops = buildOperations([
      ann({ changes: [{ prop: 'text', cssProp: 'text', oldValue: 'Hello', newValue: 'World' }] }),
    ]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('Content: "Hello" → "World"');
    // text changes do NOT go into the CSS Changes table
    expect(result).not.toContain('Changes:');
  });

  it('content change html: strips tags', () => {
    const ops = buildOperations([
      ann({ changes: [{ prop: 'html', cssProp: 'html', oldValue: '<b>Bold</b> text', newValue: '<i>Italic</i>' }] }),
    ]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('Content: "Bold text" → "Italic"');
  });

  it('content change src dataURL: shows data:<mime>, not raw base64', () => {
    const ops = buildOperations([
      ann({
        changes: [{
          prop: 'src', cssProp: 'src',
          oldValue: 'https://example.com/img.jpg',
          newValue: 'data:image/png;base64,abc123longdata',
        }],
      }),
    ]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('Media:');
    expect(result).toContain('data:image/png');
    expect(result).not.toContain('base64,abc123');
  });

  it('content change src URL: shows filename', () => {
    const ops = buildOperations([
      ann({
        changes: [{
          prop: 'src', cssProp: 'src',
          oldValue: 'https://example.com/old.jpg',
          newValue: 'https://cdn.example.com/new.png',
        }],
      }),
    ]);
    const result = renderTaskList(ops, CTX);
    expect(result).toContain('Media: "old.jpg" → "new.png"');
  });
});

// ============================================================
// renderTaskList — output structure
// ============================================================

describe('renderTaskList — output structure', () => {
  it('three sections separated by blank lines', () => {
    const result = renderTaskList([], CTX, 'en');
    const sections = result.split('\n\n');
    expect(sections.some((s) => s.startsWith('[Page Context]'))).toBe(true);
    expect(sections.some((s) => s.startsWith('[Global Editing Rules]'))).toBe(true);
    expect(sections.some((s) => s.startsWith('[Operations]'))).toBe(true);
  });

  it('multiple ops: sorted by number in output text', () => {
    const annotations = [
      ann({ id: 'a3', number: 3, selector: 's3', note: 'three' }),
      ann({ id: 'a1', number: 1, selector: 's1', note: 'one' }),
    ];
    const ops = buildOperations(annotations);
    const result = renderTaskList(ops, CTX);
    expect(result.indexOf('--- #1')).toBeLessThan(result.indexOf('--- #3'));
  });

  it('operations separated by blank lines', () => {
    const annotations = [
      ann({ id: 'a1', number: 1, selector: 's1', note: 'first' }),
      ann({ id: 'a2', number: 2, selector: 's2', note: 'second' }),
    ];
    const ops = buildOperations(annotations);
    const result = renderTaskList(ops, CTX);
    // Two op headers should exist with a blank line between them
    expect(result).toContain('--- #1 Annotation ---');
    expect(result).toContain('--- #2 Annotation ---');
    const idx1 = result.indexOf('--- #1 Annotation ---');
    const idx2 = result.indexOf('--- #2 Annotation ---');
    const between = result.slice(idx1, idx2);
    expect(between).toContain('\n\n');
  });
});
