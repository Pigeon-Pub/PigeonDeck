import { describe, expect, it } from 'vitest';
import {
  FONT_LIST,
  WEIGHTS,
  isShadowlessValue,
  normalizeWeight,
  numOf,
  shadowColorOf,
  shadowCss,
} from './field-values';

describe('field value helpers', () => {
  it('normalizes numeric values with fallback and decimals', () => {
    expect(numOf('12px', 0)).toBe('12');
    expect(numOf('1.44', 1, 1)).toBe('1.4');
    expect(numOf('bad', 7)).toBe('7');
  });

  it('normalizes font weights', () => {
    expect(normalizeWeight('normal')).toBe('400');
    expect(normalizeWeight('bold')).toBe('700');
    expect(normalizeWeight('650')).toBe('650');
    expect(normalizeWeight('bad')).toBe('400');
  });

  it('keeps curated font and weight option sources stable', () => {
    expect(FONT_LIST).toContain('Inter');
    expect(FONT_LIST).toContain('Menlo');
    expect(WEIGHTS).toEqual(['100', '200', '300', '400', '500', '600', '700', '800', '900']);
  });

  it('builds shadow presets and detects shadowless values', () => {
    expect(shadowCss('mid', 'rgba(1, 2, 3, 0.4)')).toBe('0 4px 10px rgba(1, 2, 3, 0.4)');
    expect(shadowCss('none', 'black')).toBe('none');
    expect(isShadowlessValue('none')).toBe(true);
    expect(isShadowlessValue('rgba(0, 0, 0, 0) 0px 0px 0px 0px')).toBe(true);
    expect(isShadowlessValue('rgba(0, 0, 0, 0.2) 0px 4px 10px 0px')).toBe(false);
  });

  it('extracts a displayable shadow color with fallback', () => {
    expect(shadowColorOf('rgba(1, 2, 3, 0.4) 0px 4px 10px')).toBe('rgba(1, 2, 3, 0.4)');
    expect(shadowColorOf('none')).toBe('rgba(60, 46, 18, 0.22)');
  });
});
