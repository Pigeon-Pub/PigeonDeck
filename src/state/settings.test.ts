/* ============================================================
   settings.test.ts — 阶段 11a 新字段默认值/合并 + clampNumber 夹紧逻辑
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, clampNumber, Settings } from './settings';

describe('DEFAULT_SETTINGS — 阶段 11 新字段', () => {
  it('theme 默认 light', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('light');
  });

  it('longPressMs 默认 300', () => {
    expect(DEFAULT_SETTINGS.longPressMs).toBe(300);
  });

  it('dragThreshold 默认 0（点住即拖）', () => {
    expect(DEFAULT_SETTINGS.dragThreshold).toBe(0);
  });

  it('保留既有字段默认值不变', () => {
    expect(DEFAULT_SETTINGS.hoverLabel).toBe(true);
    expect(DEFAULT_SETTINGS.cardDefaultExpanded).toBe(false);
    expect(DEFAULT_SETTINGS.defaultGranularity).toBe('smart');
    expect(DEFAULT_SETTINGS.historyLimit).toBe(50);
    expect(DEFAULT_SETTINGS.exportLang).toBe('en');
    expect(DEFAULT_SETTINGS.imageMethod).toBe('clipboard');
    expect(DEFAULT_SETTINGS.watermark).toBe(false);
  });

  it('部分存储值与默认值合并：缺失字段回退默认（loadSettings 语义）', () => {
    const stored: Partial<Settings> = { theme: 'dark', historyLimit: 100 };
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    expect(merged.theme).toBe('dark');
    expect(merged.historyLimit).toBe(100);
    // 未存储字段回退默认
    expect(merged.longPressMs).toBe(300);
    expect(merged.dragThreshold).toBe(0);
  });
});

describe('clampNumber — 数值夹紧', () => {
  it('在范围内原样返回（取整）', () => {
    expect(clampNumber(300, 50, 2000, 300)).toBe(300);
    expect(clampNumber(123.6, 1, 9999, 50)).toBe(124);
  });

  it('低于下界夹到下界', () => {
    expect(clampNumber(-5, 0, 2000, 0)).toBe(0);
    expect(clampNumber(0, 1, 9999, 50)).toBe(1);
  });

  it('高于上界夹到上界', () => {
    expect(clampNumber(99999, 1, 9999, 50)).toBe(9999);
    expect(clampNumber(5000, 50, 2000, 300)).toBe(2000);
  });

  it('非数字回退 fallback', () => {
    expect(clampNumber(NaN, 1, 9999, 50)).toBe(50);
    expect(clampNumber(Infinity, 0, 2000, 300)).toBe(300);
    expect(clampNumber(parseFloat('abc'), 0, 2000, 300)).toBe(300);
  });
});
