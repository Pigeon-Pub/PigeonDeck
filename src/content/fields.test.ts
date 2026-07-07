// @vitest-environment jsdom
/* ============================================================
   fields.test.ts — 注册表 / 控件实例化 / 双入口单源同步 /
   修改记录合并 / 未保存回滚
   ============================================================ */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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

  it('notify 快照迭代：某监听在通知过程中退订自己也不影响其余监听被调用（顽固隐患加固）', () => {
    const session = new FieldsSession(target);
    const calls: string[] = [];
    let unsubB: (() => void) | null = null;
    session.subscribe('color', () => {
      calls.push('a');
      unsubB?.(); // A 在通知过程中退订 B —— 迭代中改动监听集合
    });
    unsubB = session.subscribe('color', () => {
      calls.push('b');
    });
    // 不抛错，且本轮进入快照的两个监听都被调用（活动 Set 迭代会漏调 B；快照保证不漏）
    expect(() => session.set('color', '#ff0000')).not.toThrow();
    expect(calls).toEqual(['a', 'b']);
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

  it('不同元素真正浮现不同控件（按元素驱动，非固定四项）', () => {
    // 有边框 + 圆角、无背景无内边距 → 列 border/radius，不再无脑塞 padding
    const bordered = document.createElement('div');
    bordered.style.borderTopWidth = '2px';
    bordered.style.borderTopStyle = 'solid';
    bordered.style.borderTopLeftRadius = '8px';
    document.body.appendChild(bordered);
    const keys = autoModbarRows(bordered).flat();
    expect(keys).toContain('border');
    expect(keys).toContain('radius');
    expect(keys).not.toContain('padding');
    expect(keys).not.toContain('bgColor');
  });

  it('毫无特征的裸元素回落到克制的默认（不无差别回填 4 项）', () => {
    const bare = document.createElement('div');
    document.body.appendChild(bare);
    const keys = autoModbarRows(bare).flat();
    expect(keys.length).toBeLessThanOrEqual(3);
  });
});

describe('autoModbarRows — SVG 非 HTMLElement 路径（F19）', () => {
  function makeSvgRect(): SVGElement {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    svg.appendChild(rect);
    document.body.appendChild(svg);
    return rect;
  }

  it('SVG 形状元素浮现 fill/stroke（而非 HTML 的 background/padding）', () => {
    const rect = makeSvgRect();
    rect.style.fill = 'red';
    const keys = autoModbarRows(rect as unknown as HTMLElement).flat();
    expect(keys).toContain('fill');
    expect(keys).toContain('stroke');
    expect(keys).not.toContain('bgColor');
    expect(keys).not.toContain('padding');
  });

  it('fill/stroke/strokeWidth 已注册且归入 appearance 分类', () => {
    for (const key of ['fill', 'stroke', 'strokeWidth']) {
      expect(FIELD_DEFS[key], key).toBeTruthy();
      expect(FIELD_CATEGORY[key], key).toBe('appearance');
    }
  });

  it('为 SVG 元素实例化 fill 控件不报错，set 写入 SVG inline style', () => {
    const rect = makeSvgRect();
    rect.style.fill = 'rgb(255, 0, 0)';
    const session = new FieldsSession(rect as unknown as HTMLElement);
    const row = createPropRow(session, 'fill', ctx, { auto: true });
    expect(row.querySelector('.pd-color')).toBeTruthy();
    session.set('fill', '#00ff00');
    expect(session.get('fill')).toBe('#00ff00');
    expect(rect.style.getPropertyValue('fill')).not.toBe('');
  });
});

describe('shadow — 阴影档位与无阴影识别', () => {
  it('阴影强度随档位单调递增（轻 < 中 < 重 的模糊半径）', () => {
    const blurOf = (level: string): number => {
      const css = FIELD_DEFS.shadow.cssValue(level);
      const nums = css.match(/-?[\d.]+px/g) ?? [];
      // 几何格式 "0 <y>px <blur>px"：模糊是最后一个 px 值（offset-x 的 0 无 px 后缀）
      return parseFloat(nums[nums.length - 1] ?? '0');
    };
    expect(blurOf('light')).toBeLessThan(blurOf('mid'));
    expect(blurOf('mid')).toBeLessThan(blurOf('heavy'));
    // 重档不再带负扩散（历史上 -6px 造成非单调）
    expect(FIELD_DEFS.shadow.cssValue('heavy')).not.toContain('-');
  });

  it('shadow.read 把 none / 全零 / 全透明阴影都识别为「无」', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    // 显式 none
    el.style.boxShadow = 'none';
    expect(FIELD_DEFS.shadow.read(el)).toBe('none');
    // Tailwind reset 常见形态：全透明色 + 全零几何
    el.style.boxShadow = 'rgba(0, 0, 0, 0) 0px 0px 0px 0px';
    expect(FIELD_DEFS.shadow.read(el)).toBe('none');
    // 全零几何（非透明色）
    el.style.boxShadow = 'rgb(0, 0, 0) 0px 0px 0px 0px';
    expect(FIELD_DEFS.shadow.read(el)).toBe('none');
  });

  it('shadow.read 对真实可见阴影返回空串（不高亮无档）', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    el.style.boxShadow = 'rgba(0, 0, 0, 0.2) 0px 4px 10px 0px';
    expect(FIELD_DEFS.shadow.read(el)).toBe('');
  });
});

describe('color — 取色器（F18）', () => {
  it('无 EyeDropper API 时移除取色按钮（优雅降级）', () => {
    // jsdom 默认无 window.EyeDropper
    expect('EyeDropper' in window).toBe(false);
    const box = createControl(new FieldsSession(target), 'color', ctx);
    expect(box.querySelector('.eye')).toBeNull();
    expect(box.querySelector('.sw')).toBeTruthy(); // 色块仍在
  });

  it('取色前挂起页面拦截、promise 落定后恢复，并写入拾取色', async () => {
    let resumed = false;
    const suspend = (): (() => void) => () => {
      resumed = true;
    };
    const suspendSpy = vi.fn(suspend);
    const eyeCtx: ControlContext = { popoverRoot: ctx.popoverRoot, suspendInterception: suspendSpy };

    (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
      open(): Promise<{ sRGBHex: string }> {
        return Promise.resolve({ sRGBHex: '#abcdef' });
      }
    };
    try {
      const session = new FieldsSession(target);
      const box = createControl(session, 'color', eyeCtx);
      const eye = box.querySelector<HTMLButtonElement>('.eye')!;
      expect(eye).toBeTruthy();

      eye.click();
      expect(suspendSpy).toHaveBeenCalledTimes(1); // 打开前已挂起
      expect(resumed).toBe(false);

      await new Promise((r) => setTimeout(r, 0)); // 冲刷 open() 的 then/catch/finally 微任务链

      expect(resumed).toBe(true); // 落定后恢复拦截
      expect(session.get('color')).toBe('#abcdef');
    } finally {
      delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
    }
  });

  it('再入守卫：取色器挂起期间再次点击不再新建第二个 EyeDropper（杜绝覆盖层二次捕获冻结）', async () => {
    // 真机冻结 signature：颜色已变（首个 open 已落定）后整页/浏览器窗口点不动 = 第二个原生
    // 覆盖层重新进入系统级捕获。模块级守卫使任一时刻只允许一个取色器挂起 → 第二次 open 不可能发生。
    let created = 0;
    let resolveOpen: ((r: { sRGBHex: string }) => void) | null = null;
    (window as unknown as { EyeDropper: unknown }).EyeDropper = class {
      constructor() {
        created++;
      }
      open(): Promise<{ sRGBHex: string }> {
        // 永不自行落定：模拟原生覆盖层挂起态；由测试显式 resolve 收尾（避免污染其余用例）
        return new Promise<{ sRGBHex: string }>((res) => {
          resolveOpen = res;
        });
      }
    };
    try {
      const session = new FieldsSession(target);
      const box = createControl(session, 'color', ctx);
      const eye = box.querySelector<HTMLButtonElement>('.eye')!;

      eye.click(); // 首个取色器：挂起
      eye.click(); // 挂起期间再次点击：守卫拦截，不得新建/打开第二个
      expect(created).toBe(1);

      // 收尾：落定首个取色器 → finally 复位守卫（否则模块级挂起态会污染后续用例）
      resolveOpen!({ sRGBHex: '#123456' });
      await new Promise((r) => setTimeout(r, 0));

      // 复位后可再次正常打开
      eye.click();
      expect(created).toBe(2);
      resolveOpen!({ sRGBHex: '#654321' });
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      delete (window as unknown as { EyeDropper?: unknown }).EyeDropper;
    }
  });
});
