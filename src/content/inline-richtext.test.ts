/**
 * inline-richtext.test.ts — 字体栈解析纯函数单测
 * resolveFontStack: 下拉选中值（FONT_LIST 首选族名 / 智能识别采到的实际族名 /
 * 通用族关键字）→ 一个总能渲染出东西的字体栈。纯字符串函数，无需 DOM。
 */

import { describe, it, expect } from 'vitest';
import { resolveFontStack, FONT_LIST } from './inline-richtext';

describe('resolveFontStack', () => {
  it('FONT_LIST 命中：返回其带兜底的栈', () => {
    expect(resolveFontStack('Georgia')).toBe('Georgia, "Times New Roman", Times, serif');
    expect(resolveFontStack('Arial')).toBe('Arial, Helvetica, sans-serif');
  });

  it('system-ui 命中 FONT_LIST：返回完整系统栈', () => {
    expect(resolveFontStack('system-ui')).toContain('system-ui');
    expect(resolveFontStack('system-ui')).toContain('sans-serif');
  });

  it('通用族关键字原样返回', () => {
    expect(resolveFontStack('serif')).toBe('serif');
    expect(resolveFontStack('sans-serif')).toBe('sans-serif');
    expect(resolveFontStack('monospace')).toBe('monospace');
  });

  it('通用族关键字大小写不敏感', () => {
    expect(resolveFontStack('SERIF')).toBe('SERIF');
  });

  it('未知单词族名：补 sans-serif 兜底', () => {
    expect(resolveFontStack('Roboto')).toBe('Roboto, sans-serif');
  });

  it('未知含空格族名：加引号并补兜底', () => {
    expect(resolveFontStack('Comic Sans MS')).toBe('"Comic Sans MS", sans-serif');
  });

  it('已带引号的族名：去掉原引号后按需重新加引号', () => {
    expect(resolveFontStack('"Helvetica Neue"')).toBe('"Helvetica Neue", sans-serif');
  });

  it('每个 FONT_LIST 栈都以通用族结尾（保证总能渲染）', () => {
    const generic = /(serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/i;
    for (const f of FONT_LIST) {
      expect(f.stack, f.label).toMatch(generic);
    }
  });

  it('每个 FONT_LIST value 都能被 resolveFontStack 解析为自身栈', () => {
    for (const f of FONT_LIST) {
      expect(resolveFontStack(f.value)).toBe(f.stack);
    }
  });
});
