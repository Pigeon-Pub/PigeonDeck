/**
 * inline-richtext.test.ts — 字号改写纯函数单测
 * replaceLegacyFontSize: <font size="7"> → <span style="font-size:Npx">
 * 纯字符串函数，不依赖 DOM，无需 jsdom 环境。
 */

import { describe, it, expect } from 'vitest';
import { replaceLegacyFontSize } from './inline-richtext';

describe('replaceLegacyFontSize', () => {
  it('单个 <font size=7> 转换为 <span style="font-size:Npx">', () => {
    const input = '<font size="7">hello</font>';
    const output = replaceLegacyFontSize(input, 24);
    expect(output).toContain('<span style="font-size:24px">');
    expect(output).toContain('</span>');
    expect(output).not.toContain('<font');
    expect(output).not.toContain('</font>');
  });

  it('保留内容文字', () => {
    const output = replaceLegacyFontSize('<font size="7">world</font>', 18);
    expect(output).toBe('<span style="font-size:18px">world</span>');
  });

  it('单引号 size 属性', () => {
    const output = replaceLegacyFontSize("<font size='7'>text</font>", 16);
    expect(output).toContain('<span style="font-size:16px">');
    expect(output).toContain('</span>');
  });

  it('无引号 size 属性', () => {
    const output = replaceLegacyFontSize('<font size=7>text</font>', 20);
    expect(output).toContain('<span style="font-size:20px">');
  });

  it('附带 color 属性：转移至 span style', () => {
    const output = replaceLegacyFontSize('<font size="7" color="#ff0000">red</font>', 14);
    expect(output).toContain('font-size:14px');
    expect(output).toContain('color:#ff0000');
    expect(output).toContain('<span');
  });

  it('附带 face 属性：转移至 span style 作为 font-family', () => {
    const output = replaceLegacyFontSize('<font size="7" face="Arial">text</font>', 12);
    expect(output).toContain('font-size:12px');
    expect(output).toContain('font-family:Arial');
  });

  it('不含 <font size=7> 的 HTML 保持原样', () => {
    const input = '<b>hello</b> world';
    expect(replaceLegacyFontSize(input, 16)).toBe(input);
  });

  it('<font size="3"> 不被替换（只处理 size=7）', () => {
    const input = '<font size="3">small</font>';
    expect(replaceLegacyFontSize(input, 16)).toBe(input);
  });

  it('多个 <font size=7> 全部替换', () => {
    const input = '<font size="7">a</font> and <font size="7">b</font>';
    const output = replaceLegacyFontSize(input, 32);
    const spanCount = (output.match(/<span/g) ?? []).length;
    expect(spanCount).toBe(2);
    expect(output).not.toContain('<font');
  });

  it('嵌套保持：内层其他标签不受影响', () => {
    const input = '<font size="7"><b>bold</b></font>';
    const output = replaceLegacyFontSize(input, 20);
    expect(output).toContain('<b>bold</b>');
    expect(output).toContain('<span style="font-size:20px">');
  });

  it('大写 FONT 标签也被处理（大小写不敏感）', () => {
    const output = replaceLegacyFontSize('<FONT SIZE="7">text</FONT>', 28);
    expect(output).toContain('<span style="font-size:28px">');
    expect(output).toContain('</span>');
  });
});
