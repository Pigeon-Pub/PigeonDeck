// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationStore } from '../state/annotations';
import { History } from '../state/history';
import { SelectionBox } from './selection-box';

interface Context {
  box: SelectionBox;
  history: History;
  store: AnnotationStore;
  target: HTMLElement;
  before: HTMLElement;
  after: HTMLElement;
}

function setup(): Context {
  const overlay = document.createElement('div');
  const before = document.createElement('div');
  const target = document.createElement('div');
  const after = document.createElement('div');
  target.id = 'delete-target';
  target.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 100, height: 40 } as DOMRect);
  document.body.append(before, target, after, overlay);

  const store = new AnnotationStore();
  const history = new History();
  const box = new SelectionBox({ store, history, overlayLayer: overlay });
  box.select(target);
  return { box, history, store, target, before, after };
}

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }),
  );
}

describe('SelectionBox Delete', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('deletes the selected element and clears the selection box', () => {
    const { box, target } = setup();

    press('Delete');

    expect(target.isConnected).toBe(false);
    expect(document.querySelector('[data-testid="pd-selbox"]')).toBeNull();
    box.destroy();
  });

  it('undo restores the original position and annotation, then redo deletes both again', () => {
    const { box, history, store, target, before, after } = setup();
    const annotation = store.add({
      selector: '#delete-target',
      elementType: 'container',
      summary: 'div',
      note: 'remove me',
      changes: [],
      viewportPos: { x: 10, y: 20, w: 100, h: 40 },
    });

    press('Delete');

    expect(store.getById(annotation.id)).toBeUndefined();
    expect(history.undo()).toBe(true);
    expect([...document.body.children].slice(0, 3)).toEqual([before, target, after]);
    expect(store.getById(annotation.id)).toEqual(annotation);

    expect(history.redo()).toBe(true);
    expect(target.isConnected).toBe(false);
    expect(store.getById(annotation.id)).toBeUndefined();
    box.destroy();
  });

  it('ignores Delete from editable controls', () => {
    const { box, target } = setup();
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'open' });
    const textarea = document.createElement('textarea');
    shadow.appendChild(textarea);
    document.body.appendChild(host);

    press('Delete', textarea);

    expect(target.isConnected).toBe(true);
    box.destroy();
  });

  it('ignores Backspace', () => {
    const { box, target } = setup();

    press('Backspace');

    expect(target.isConnected).toBe(true);
    box.destroy();
  });

  it('ignores Delete already handled by another shortcut', () => {
    const { box, target } = setup();
    const event = new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    window.dispatchEvent(event);

    expect(target.isConnected).toBe(true);
    box.destroy();
  });
});
