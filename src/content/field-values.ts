import { formatCssColor, parseCssColor } from './color-picker';

export const FONT_LIST = ['Inter', 'Roboto', 'Helvetica Neue', 'Arial', 'Georgia', 'Times New Roman', 'Menlo'];
export const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];

const SHADOW_GEOM: Record<string, string> = {
  light: '0 1px 3px',
  mid: '0 4px 10px',
  heavy: '0 10px 24px',
};

export function numOf(value: string, fallback: number, decimals = 0): string {
  const n = parseFloat(value);
  if (Number.isNaN(n)) return String(fallback);
  const f = Math.pow(10, decimals);
  return String(Math.round(n * f) / f);
}

export function colorOf(value: string, fallback: string): string {
  const parsed = parseCssColor(value);
  return parsed ? formatCssColor(parsed) : fallback;
}

export function shadowCss(level: string, color: string): string {
  const geom = SHADOW_GEOM[level];
  return geom ? `${geom} ${color}` : 'none';
}

export function isShadowlessValue(boxShadow: string): boolean {
  const bs = (boxShadow ?? '').trim();
  if (!bs || bs === 'none') return true;
  const colorMatch = bs.match(/rgba?\([^)]*\)/i);
  if (colorMatch) {
    const parsed = parseCssColor(colorMatch[0]);
    if (parsed && parsed.a === 0) return true;
  }
  const nums = bs.match(/-?[\d.]+px/g);
  if (nums && nums.length > 0 && nums.every((n) => parseFloat(n) === 0)) return true;
  return false;
}

export function shadowColorOf(boxShadow: string): string {
  const m = boxShadow.match(/rgba?\([^)]+\)|#[0-9a-fA-F]{3,8}/);
  return m ? colorOf(m[0], 'rgba(60, 46, 18, 0.22)') : 'rgba(60, 46, 18, 0.22)';
}

export function normalizeWeight(value: string): string {
  if (value === 'normal') return '400';
  if (value === 'bold') return '700';
  return numOf(value, 400);
}
