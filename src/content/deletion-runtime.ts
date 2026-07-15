import type { DeletionLayout } from '../state/settings';

interface DeletionEntry {
  element: HTMLElement;
  parent: Node;
  nextSibling: Node | null;
  opacity: string;
  pointerEvents: string;
  inert: boolean;
  ariaHidden: string | null;
}

class DeletionRuntime {
  private entries = new Map<string, DeletionEntry>();

  capture(id: string, element: HTMLElement): void {
    const parent = element.parentNode;
    if (!parent) return;
    this.entries.set(id, {
      element,
      parent,
      nextSibling: element.nextSibling,
      opacity: element.style.opacity,
      pointerEvents: element.style.pointerEvents,
      inert: Boolean(element.inert),
      ariaHidden: element.getAttribute('aria-hidden'),
    });
  }

  apply(id: string, layout: DeletionLayout): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (layout === 'reflow') {
      entry.element.remove();
    } else {
      entry.element.style.opacity = '0';
      entry.element.style.pointerEvents = 'none';
      entry.element.inert = true;
      entry.element.setAttribute('aria-hidden', 'true');
    }
    return true;
  }

  restore(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!entry.element.isConnected) {
      if (entry.nextSibling?.parentNode === entry.parent) {
        entry.parent.insertBefore(entry.element, entry.nextSibling);
      } else {
        entry.parent.appendChild(entry.element);
      }
    }
    entry.element.style.opacity = entry.opacity;
    entry.element.style.pointerEvents = entry.pointerEvents;
    entry.element.inert = entry.inert;
    if (entry.ariaHidden === null) entry.element.removeAttribute('aria-hidden');
    else entry.element.setAttribute('aria-hidden', entry.ariaHidden);
    return true;
  }

  reset(): void {
    this.entries.clear();
  }
}

export const deletionRuntime = new DeletionRuntime();
