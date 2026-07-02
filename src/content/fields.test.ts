// @vitest-environment jsdom
/* ============================================================
   fields.test.ts — 注册表 / 控件实例化 / 双入口单源同步 /
   修改记录合并 / 未保存回滚
   ============================================================ */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FIELD_DEFS,
  FIELD_CATEGORY,
  FieldsSession,
  createPropRow,
  createControl,
  modbarRows,
  autoModbarRows,
  advancedRows,
  modbarTitleKey,
  ControlContext,
} from './fields';

let target: HTMLElement;
let ctx: ControlContext;

beforeEach(() => {
  document.body.innerHTML = '';
  target = document.createElement('div');
  target.textContent = '示例文字';
  target.style.fontSize = '16px';
  target.style.color = '#112233';
  document.body.appendChild(target);
  const popoverRoot = document.createElement('div');
  document.body.appendChild(popoverRoot);
  ctx = { popoverRoot };
});

describe('FIELD_DEFS — 注册表', () => {
  it('全集字段均已注册且结构完整', () => {
    const expected = [
      'text', 'font', 'fontSize', 'fontWeight', 'color', 'align', 'decoration',
      'lineHeight', 'letter', 'listStyle', 'transform',
      'width', 'height', 'minW', 'maxW', 'display', 'overflow',
      'bgColor', 'bgImage', 'border', 'borderColor', 'radius',
      'shadow', 'shadowColor', 'opacity', 'blur', 'margin', 'padding', 'replaceImg',
    ];
    for (const key of expected) {
      const def = FIELD_DEFS[key];
      expect(def, key).toBeTruthy();
      expect(def.labelKey, key).toBeTruthy();
      expect(def.cssProp, key).toBeTruthy();
      expect(typeof def.read, key).toBe('function');
      expect(typeof def.cssValue, key).toBe('function');
    }
  });

  it('每个可见字段都有分类归属（调试除外）', () => {
    for (const key of Object.keys(FIELD_DEFS)) {
      if (key === 'replaceImg') continue; // 图片替换是动作按钮，不属样式分类
      expect(FIELD_CATEGORY[key], key).toBeTruthy();
    }
  });

  it('修改栏布局按元素类型智能切换且为高级样式子集语义', () => {
    expect(modbarRows('text').flat()).toContain('text');
    expect(modbarRows('image').flat()).toContain('replaceImg');
    expect(modbarRows('video').flat()).toContain('replaceImg');
    expect(modbarRows('button').flat()).toContain('bgColor');
    expect(modbarRows('container').flat()).toEqual(modbarRows('button').flat());
    expect(modbarTitleKey('text')).toBe('modbar_text');
    expect(modbarTitleKey('other')).toBe('modbar_auto');
  });

  it('高级样式 4 分类布局存在且刻意排除 position/top/left/z-index', () => {
    const all = [
      ...advancedRows('typography').flat(),
      ...advancedRows('size').flat(),
      ...advancedRows('appearance').flat(),
    ];
    expect(all.length).toBeGreaterThan(15);
    for (const key of all) {
      const cssProp = FIELD_DEFS[key].cssProp;
      expect(['position', 'top', 'left', 'z-index']).not.toContain(cssProp);
    }
  });
});

describe('createControl / createPropRow — 实例化', () => {
  it('num 控件初值来自元素当前样式', () => {
    const el = createControl(new FieldsSession(target), 'fontSize', ctx);
    expect(el.className).toContain('pd-num');
    expect(el.querySelector('input')!.value).toBe('16');
  });

  it('propRow 含标题与控件；auto 选项出「自动」角标', () => {
    const session = new FieldsSession(target);
    const row = createPropRow(session, 'bgColor', ctx, { auto: true });
    expect(row.getAttribute('data-field')).toBe('bgColor');
    expect(row.querySelector('.prop-h .t')).toBeTruthy();
    expect(row.querySelector('.auto')).toBeTruthy();
    expect(row.querySelector('.pd-color')).toBeTruthy();
  });

  it('未知字段抛错', () => {
    expect(() => createControl(new FieldsSession(target), 'nope', ctx)).toThrow();
  });
});

describe('FieldsSession — 即时预览与修改记录', () => {
  it('set 立即写 inline style', () => {
    const session = new FieldsSession(target);
    session.set('fontSize', '24');
    expect(target.style.fontSize).toBe('24px');
  });

  it('同一属性多次改动合并为一条（最初 oldValue、最新 newValue）', () => {
    const session = new FieldsSession(target);
    session.set('fontSize', '20');
    session.set('fontSize', '28');
    const changes = session.getChanges();
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({
      prop: 'fontSize',
      cssProp: 'font-size',
      oldValue: '16px',
      newValue: '28px',
    });
  });

  it('改回原值后该条剔除', () => {
    const session = new FieldsSession(target);
    session.set('fontSize', '24');
    session.set('fontSize', '16');
    expect(session.getChanges()).toEqual([]);
  });

  it('text 字段改动记录 textContent 前后值', () => {
    const session = new FieldsSession(target);
    session.set('text', '新文字');
    expect(target.textContent).toBe('新文字');
    const changes = session.getChanges();
    expect(changes).toEqual([{ prop: 'text', cssProp: 'text', oldValue: '示例文字', newValue: '新文字' }]);
  });

  it('getDiff 返回变更展示值，未变更为 null', () => {
    const session = new FieldsSession(target);
    expect(session.getDiff('fontSize')).toBeNull();
    session.set('fontSize', '24');
    expect(session.getDiff('fontSize')).toEqual({ from: '16', to: '24' });
  });
});

describe('FieldsSession — 双入口单源同步', () => {
  it('两处实例化同一字段：一处改动另一处同步', () => {
    const session = new FieldsSession(target);
    const rowA = createPropRow(session, 'fontSize', ctx); // 修改栏入口
    const rowB = createPropRow(session, 'fontSize', ctx); // 高级样式入口
    const inputA = rowA.querySelector('input')!;
    const inputB = rowB.querySelector('input')!;

    inputA.value = '32';
    inputA.dispatchEvent(new Event('change'));

    expect(inputB.value).toBe('32');
    expect(target.style.fontSize).toBe('32px');
  });

  it('分段控件双入口选中态同步', () => {
    const session = new FieldsSession(target);
    const segA = createControl(session, 'align', ctx);
    const segB = createControl(session, 'align', ctx);
    segA.querySelector<HTMLButtonElement>('[data-value="center"]')!.click();
    expect(segB.querySelector('[data-value="center"]')!.classList.contains('on')).toBe(true);
    expect(target.style.textAlign).toBe('center');
  });

  it('subscribeAny 在任意字段变化时触发（角标聚合）', () => {
    const session = new FieldsSession(target);
    let called = 0;
    session.subscribeAny(() => called++);
    session.set('fontSize', '20');
    session.set('color', '#b8842c');
    expect(called).toBe(2);
    expect(session.changedKeys()).toEqual(new Set(['fontSize', 'color']));
  });
});

describe('FieldsSession — 未保存回滚', () => {
  it('rollback 恢复有 inline 初值的属性', () => {
    const session = new FieldsSession(target);
    session.set('fontSize', '30');
    session.rollback();
    expect(target.style.fontSize).toBe('16px');
    expect(session.getChanges()).toEqual([]);
  });

  it('rollback 移除原本没有 inline 值的属性', () => {
    const session = new FieldsSession(target);
    session.set('padding', '24');
    expect(target.style.padding).toBe('24px');
    session.rollback();
    expect(target.style.getPropertyValue('padding')).toBe('');
  });

  it('rollback 恢复文字内容', () => {
    const session = new FieldsSession(target);
    session.set('text', '临时文字');
    session.rollback();
    expect(target.textContent).toBe('示例文字');
  });

  it('rollback 后控件 UI 回到元素当前值', () => {
    const session = new FieldsSession(target);
    const row = createPropRow(session, 'fontSize', ctx);
    const input = row.querySelector('input')!;
    session.set('fontSize', '40');
    expect(input.value).toBe('40');
    session.rollback();
    expect(input.value).toBe('16');
  });
});

describe('autoModbarRows — 陌生元素自动适配', () => {
  it('按 computed style 列出最相关控件（上限 4，不足回填默认）', () => {
    const plain = document.createElement('div');
    document.body.appendChild(plain);
    const rows = autoModbarRows(plain);
    const keys = rows.flat();
    expect(keys.length).toBeGreaterThanOrEqual(1);
    expect(keys.length).toBeLessThanOrEqual(4);
    expect(keys).toContain('display');
  });

  it('有背景/内边距的元素优先列出对应控件', () => {
    const styled = document.createElement('div');
    styled.style.backgroundColor = '#f4efe2';
    styled.style.padding = '24px';
    document.body.appendChild(styled);
    const keys = autoModbarRows(styled).flat();
    expect(keys).toContain('bgColor');
    expect(keys).toContain('padding');
  });
});
