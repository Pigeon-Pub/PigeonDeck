// @vitest-environment jsdom
/* ============================================================
   eyedropper.test.ts — 页内取色器纯函数（F18c）
   rgbToHex 补零 / viewportToImage 缩放·取整·钳制
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { rgbToHex, viewportToImage } from './eyedropper';

describe('rgbToHex', () => {
  it('补零且小写十六进制', () => {
    expect(rgbToHex(0, 0, 0)).toBe('#000000');
    expect(rgbToHex(255, 255, 255)).toBe('#ffffff');
    expect(rgbToHex(16, 8, 4)).toBe('#100804');
    expect(rgbToHex(184, 132, 44)).toBe('#b8842c'); // 品牌金
  });
});

describe('viewportToImage', () => {
  it('按 scale 放大后向下取整', () => {
    expect(viewportToImage(10, 2, 100)).toBe(20); // dpr=2
    expect(viewportToImage(10.9, 1, 100)).toBe(10); // 向下取整
    expect(viewportToImage(0, 2, 100)).toBe(0);
  });

  it('钳制到 [0, max-1]', () => {
    expect(viewportToImage(1000, 2, 100)).toBe(99); // 上界 max-1
    expect(viewportToImage(-5, 2, 100)).toBe(0); // 下界 0
  });
});
