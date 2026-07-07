import {
  RICHTEXT_DOM_CSSPROP,
  RichTextDomSnapshot,
  StyleChange,
} from '../state/annotations';

export function applyChangesTo(target: Element | null, changes: StyleChange[], dir: 'old' | 'new'): void {
  if (!(target instanceof Element)) return;
  const el = target as HTMLElement;
  const deferred: StyleChange[] = [];
  for (const c of changes) {
    if (c.cssProp === RICHTEXT_DOM_CSSPROP) {
      deferred.push(c);
      continue;
    }
    const value = dir === 'old' ? c.oldValue : c.newValue;
    if (c.cssProp === 'text') {
      el.textContent = value;
    } else if (c.cssProp === 'html') {
      el.innerHTML = value;
    } else if (c.cssProp === 'src') {
      el.setAttribute('src', value);
    } else {
      el.style.setProperty(c.cssProp, value);
    }
  }
  for (const c of deferred) {
    const value = dir === 'old' ? c.oldValue : c.newValue;
    try {
      const snap = JSON.parse(value) as RichTextDomSnapshot;
      el.innerHTML = snap.html;
      el.style.textAlign = snap.textAlign;
    } catch {
      // Ignore corrupted session snapshots; do not mutate the page further.
    }
  }
}
