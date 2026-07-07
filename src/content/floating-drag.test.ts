// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mountPopover } from './popover';
import { makeDraggableByHandle } from './floating-drag';

describe('makeDraggableByHandle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('does not start dragging from interactive controls', () => {
    const panel = document.createElement('div');
    const handle = document.createElement('div');
    const button = document.createElement('button');
    const onDrag = vi.fn();
    handle.appendChild(button);
    panel.appendChild(handle);
    document.body.appendChild(panel);
    makeDraggableByHandle(panel, handle, onDrag);

    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 20, clientY: 20 }));

    expect(onDrag).not.toHaveBeenCalled();
  });

  it('closes derived popovers when dragging starts', () => {
    const root = document.createElement('div');
    const panel = document.createElement('div');
    const handle = document.createElement('div');
    const popover = document.createElement('div');
    document.body.append(root, panel);
    panel.appendChild(handle);
    mountPopover(root, popover, handle);
    makeDraggableByHandle(panel, handle);

    handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: 10, clientY: 10 }));
    handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX: 20, clientY: 20 }));

    expect(root.contains(popover)).toBe(false);
  });
});
