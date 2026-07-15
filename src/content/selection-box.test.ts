// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnotationStore } from '../state/annotations';
import { History } from '../state/history';
import { DEFAULT_SETTINGS, Settings } from '../state/settings';
import { deletionRuntime } from './deletion-runtime';
import { SelectionBox } from './selection-box';

interface Context {
  box: SelectionBox;
  history: History;
  store: AnnotationStore;
  target: HTMLElement;
  before: HTMLElement;
  after: HTMLElement;
  settings: Settings;
}

function setup(settingsPatch: Partial<Settings> = {}): Context {
  const overlay = document.createElement('div');
  const before = document.createElement('div');
  const target = document.createElement('div');
  const after = document.createElement('div');
  target.id = 'delete-target';
  target.getBoundingClientRect = () => new DOMRect(10, 20, 100, 40);
  document.body.append(before, target, after, overlay);

  const store = new AnnotationStore();
  const history = new History();
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    ...settingsPatch,
    shortcuts: { ...DEFAULT_SETTINGS.shortcuts, ...settingsPatch.shortcuts },
  };
  const box = new SelectionBox({ store, history, overlayLayer: overlay, settings });
  box.select(target);
  return { box, history, store, target, before, after, settings };
}

function press(key: string, target: EventTarget = window): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, composed: true }),
  );
}

describe('SelectionBox Delete', () => {
  beforeEach(() => {
    deletionRuntime.reset();
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

  it('默认保留布局并保存删除前文档坐标', () => {
    const { box, history, store, target } = setup();

    press('Delete');

    expect(target.isConnected).toBe(true);
    expect(target.style.opacity).toBe('0');
    expect(document.querySelector('[data-testid="pd-selbox"]')).toBeNull();
    expect(store.getAll()).toHaveLength(1);
    expect(store.getAll()[0]).toMatchObject({
      selector: '#delete-target',
      deleted: true,
      deletion: {
        layout: 'preserve-space',
        docRect: { x: 10, y: 20, w: 100, h: 40 },
      },
    });

    expect(history.undo()).toBe(true);
    expect(target.isConnected).toBe(true);
    expect(target.style.opacity).toBe('');
    expect(store.getAll()).toHaveLength(0);

    expect(history.redo()).toBe(true);
    expect(target.isConnected).toBe(true);
    expect(target.style.opacity).toBe('0');
    expect(store.getAll()[0]).toMatchObject({ selector: '#delete-target', deleted: true });
    box.destroy();
  });

  it('重排策略脱离节点，修改设置后重做仍沿用原策略', () => {
    const { box, history, store, settings, target } = setup({ deletionLayout: 'reflow' });

    press('Delete');

    expect(target.isConnected).toBe(false);
    expect(store.getAll()[0].deletion?.layout).toBe('reflow');

    expect(history.undo()).toBe(true);
    settings.deletionLayout = 'preserve-space';
    expect(history.redo()).toBe(true);
    expect(target.isConnected).toBe(false);
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

    expect(store.getById(annotation.id)).toMatchObject({ deleted: true });
    expect(history.undo()).toBe(true);
    expect([...document.body.children].slice(0, 3)).toEqual([before, target, after]);
    expect(store.getById(annotation.id)).toEqual(annotation);

    expect(history.redo()).toBe(true);
    expect(target.isConnected).toBe(true);
    expect(target.style.opacity).toBe('0');
    expect(store.getById(annotation.id)).toMatchObject({ deleted: true });
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
