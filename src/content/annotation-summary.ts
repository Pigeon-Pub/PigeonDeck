import { Annotation, RICHTEXT_DOM_CSSPROP } from '../state/annotations';
import { FIELD_DEFS } from './fields';
import { t } from './i18n';

export function truncateValue(value: string, max = 24): string {
  return value.length > max ? value.slice(0, max) + '…' : value;
}

export function htmlToText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function srcSummary(src: string): string {
  if (!src) return '…';
  if (src.startsWith('data:')) {
    const mime = src.slice(5, src.indexOf(';') >= 0 ? src.indexOf(';') : src.indexOf(','));
    return `data:${mime || 'media'}`;
  }
  try {
    const u = new URL(src, location.href);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last || u.hostname;
  } catch {
    return src;
  }
}

export function composeCardChangeLines(annotation: Annotation): string[] {
  const lines: string[] = [];
  for (const change of annotation.changes) {
    if (change.cssProp === RICHTEXT_DOM_CSSPROP) continue;
    const def = FIELD_DEFS[change.prop];
    const isHtml = change.cssProp === 'html';
    const isText = change.cssProp === 'text';
    const isSrc = change.cssProp === 'src';
    const label =
      isHtml || isText
        ? t('rt_content_change')
        : isSrc
          ? t('replace_media_change')
          : def
            ? t(def.labelKey)
            : change.prop;
    const fmt = (v: string): string => (isHtml ? htmlToText(v) : isSrc ? srcSummary(v) : v);
    lines.push(`${label}: ${truncateValue(fmt(change.oldValue))} → ${truncateValue(fmt(change.newValue))}`);
  }
  for (const rc of annotation.richText ?? []) {
    lines.push(rc.summary);
  }
  return lines;
}
