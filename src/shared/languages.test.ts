import { describe, it, expect } from 'vitest';
import { matchLanguages, isoSubtag, LangEntry, BCP47_LANGUAGES } from './languages';

const SAMPLE: LangEntry[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh_CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh_TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
];

describe('isoSubtag', () => {
  it('取语言主标签（下划线前，小写）', () => {
    expect(isoSubtag('zh_CN')).toBe('zh');
    expect(isoSubtag('pt_BR')).toBe('pt');
    expect(isoSubtag('EN')).toBe('en');
    expect(isoSubtag('fil')).toBe('fil');
  });
});

describe('matchLanguages', () => {
  it('空 query → 全部返回，顺序不变，ranges 空', () => {
    const r = matchLanguages('', SAMPLE);
    expect(r).toHaveLength(SAMPLE.length);
    expect(r.map((m) => m.entry.code)).toEqual(['en', 'zh_CN', 'zh_TW', 'fr', 'de']);
    expect(r.every((m) => m.ranges.length === 0)).toBe(true);
  });

  it('空白 query 视为空', () => {
    expect(matchLanguages('   ', SAMPLE)).toHaveLength(SAMPLE.length);
  });

  it('ISO 前缀 "zh" → 命中两个中文变体', () => {
    const r = matchLanguages('zh', SAMPLE);
    expect(r.map((m) => m.entry.code).sort()).toEqual(['zh_CN', 'zh_TW']);
  });

  it('模糊子串（英文名，大小写不敏感）', () => {
    const r = matchLanguages('CHIN', SAMPLE);
    expect(r.map((m) => m.entry.code).sort()).toEqual(['zh_CN', 'zh_TW']);
  });

  it('nativeName 子串命中并计算高亮 range', () => {
    const r = matchLanguages('中', SAMPLE);
    const zh = r.find((m) => m.entry.code === 'zh_CN');
    expect(zh).toBeDefined();
    // '简体中文' 中 '中' 在 index 2
    expect(zh!.ranges).toEqual([[2, 3]]);
  });

  it('通过 code/name 命中但 nativeName 不含 query → ranges 空', () => {
    const r = matchLanguages('french', SAMPLE);
    const fr = r.find((m) => m.entry.code === 'fr');
    expect(fr).toBeDefined();
    // 'Français'.toLowerCase() 不含 'french'
    expect(fr!.ranges).toEqual([]);
  });

  it('首字母/前缀命中（nativeName 前缀）', () => {
    const r = matchLanguages('deu', SAMPLE);
    expect(r.map((m) => m.entry.code)).toContain('de');
  });

  it('相关度排序：ISO 前缀优先于纯子串', () => {
    const entries: LangEntry[] = [
      { code: 'xx', name: 'Has en inside', nativeName: 'Has en inside' }, // 子串命中 'en'
      { code: 'en', name: 'English', nativeName: 'English' }, // ISO 前缀命中
    ];
    const r = matchLanguages('en', entries);
    expect(r[0].entry.code).toBe('en');
  });

  it('无命中 → 空数组', () => {
    expect(matchLanguages('zzzz', SAMPLE)).toEqual([]);
  });

  it('curated 集非空且含核心语言', () => {
    const codes = BCP47_LANGUAGES.map((e) => e.code);
    expect(codes).toContain('en');
    expect(codes).toContain('zh_CN');
    expect(BCP47_LANGUAGES.length).toBeGreaterThanOrEqual(35);
  });
});
