// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { RICHTEXT_DOM_CSSPROP, RichTextDomSnapshot, StyleChange } from '../state/annotations';
import { applyChangesTo } from './change-apply';

describe('applyChangesTo', () => {
  it('applies text, html, src, css, and rich text DOM snapshots in order', () => {
    const el = document.createElement('div');
    const img = document.createElement('img');
    const rich: RichTextDomSnapshot = { html: '<strong>Bold</strong>', textAlign: 'center' };
    const changes: StyleChange[] = [
      {
        prop: 'color',
        cssProp: 'color',
        oldValue: 'red',
        newValue: 'blue',
      },
      {
        prop: 'text',
        cssProp: 'text',
        oldValue: 'old text',
        newValue: 'new text',
      },
      {
        prop: 'html',
        cssProp: 'html',
        oldValue: '<em>Old</em>',
        newValue: '<span>New</span>',
      },
      {
        prop: 'richtext',
        cssProp: RICHTEXT_DOM_CSSPROP,
        oldValue: JSON.stringify({ html: 'old rich', textAlign: 'left' } satisfies RichTextDomSnapshot),
        newValue: JSON.stringify(rich),
      },
    ];

    applyChangesTo(el, changes, 'new');
    applyChangesTo(img, [{ prop: 'src', cssProp: 'src', oldValue: 'a.png', newValue: 'b.png' }], 'new');

    expect(el.style.color).toBe('blue');
    expect(el.innerHTML).toBe('<strong>Bold</strong>');
    expect(el.style.textAlign).toBe('center');
    expect(img.getAttribute('src')).toBe('b.png');
  });

  it('restores old values and ignores invalid rich text snapshots', () => {
    const el = document.createElement('div');
    const changes: StyleChange[] = [
      { prop: 'text', cssProp: 'text', oldValue: 'old', newValue: 'new' },
      { prop: 'richtext', cssProp: RICHTEXT_DOM_CSSPROP, oldValue: 'not-json', newValue: 'also-bad' },
    ];

    applyChangesTo(el, changes, 'old');

    expect(el.textContent).toBe('old');
  });
});
