/* ============================================================
   settings.test.ts — 阶段 11a 新字段默认值/合并 + clampNumber 夹紧逻辑
   ============================================================ */

import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, clampNumber, Settings } from './settings';
import { buildDefaultShortcuts } from './shortcuts-def';

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
    expect(DEFAULT_SETTINGS.historyLimit).toBe(50);
    expect(DEFAULT_SETTINGS.exportLang).toBe('en');
    expect(DEFAULT_SETTINGS.imageMethod).toBe('clipboard');
    expect(DEFAULT_SETTINGS.watermark).toBe(false);
  });

  it('defaultGranularity 默认 element（逻辑12）', () => {
    expect(DEFAULT_SETTINGS.defaultGranularity).toBe('element');
  });

  it('showModbar 默认开启（建议7）', () => {
    expect(DEFAULT_SETTINGS.showModbar).toBe(true);
  });

  it('toolbarPosition 默认不持久化位置', () => {
    expect(DEFAULT_SETTINGS.toolbarPosition).toBeNull();
  });

  it('deletionLayout 默认保留原位置', () => {
    expect(DEFAULT_SETTINGS.deletionLayout).toBe('preserve-space');
  });

  it('shortcuts 默认含 registry 全部 id', () => {
    expect(DEFAULT_SETTINGS.shortcuts).toEqual(buildDefaultShortcuts());
    expect(DEFAULT_SETTINGS.shortcuts.undo).toBe('Mod+Z');
    expect(DEFAULT_SETTINGS.shortcuts.delete).toBe('Delete');
    expect(DEFAULT_SETTINGS.shortcuts.moveFree).toBe('Alt');
  });

  it('旧存储 {undo,redo,exit} 迁移：保留旧值 + 补全新 id（loadSettings 语义）', () => {
    const storedShortcuts = { undo: 'Mod+Y', redo: 'Mod+Shift+Z', exit: 'Escape' };
    // 复刻 loadSettings 的 shortcuts 合并行：registry 默认打底，旧值覆盖
    const merged = { ...buildDefaultShortcuts(), ...storedShortcuts };
    expect(merged.undo).toBe('Mod+Y'); // 旧自定义值保留
    expect(merged.save).toBe('Mod+Enter'); // 新 id 补默认
    expect(merged.delete).toBe('Delete');
    expect(merged.moveFree).toBe('Alt');
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

  it('旧存储缺少 deletionLayout 时回退默认值', () => {
    const stored: Partial<Settings> = { theme: 'dark' };
    const merged = { ...DEFAULT_SETTINGS, ...stored };
    expect(merged.deletionLayout).toBe('preserve-space');
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
