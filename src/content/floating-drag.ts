import { closeAllPopovers } from './popover';

export function makeDraggableByHandle(
  panelEl: HTMLElement,
  handleEl: HTMLElement,
  onDrag?: (left: number, top: number) => void
): () => void {
  let start: { mx: number; my: number; left: number; top: number } | null = null;
  let dragged = false;
  const onDown = (ev: PointerEvent): void => {
    if ((ev.target as Element | null)?.closest('button, input, textarea, select, a')) return;
    ev.preventDefault();
    handleEl.setPointerCapture?.(ev.pointerId);
    dragged = false;
    start = { mx: ev.clientX, my: ev.clientY, left: panelEl.offsetLeft, top: panelEl.offsetTop };
  };
  const onMove = (ev: PointerEvent): void => {
    if (!start) return;
    if (!dragged) {
      dragged = true;
      closeAllPopovers();
    }
    const left = start.left + (ev.clientX - start.mx);
    const top = start.top + (ev.clientY - start.my);
    panelEl.style.left = `${left}px`;
    panelEl.style.top = `${top}px`;
    onDrag?.(left, top);
  };
  const end = (ev: PointerEvent): void => {
    if (!start) return;
    start = null;
    if (handleEl.hasPointerCapture?.(ev.pointerId)) handleEl.releasePointerCapture(ev.pointerId);
  };
  handleEl.addEventListener('pointerdown', onDown);
  handleEl.addEventListener('pointermove', onMove);
  handleEl.addEventListener('pointerup', end);
  handleEl.addEventListener('pointercancel', end);
  return () => {
    handleEl.removeEventListener('pointerdown', onDown);
    handleEl.removeEventListener('pointermove', onMove);
    handleEl.removeEventListener('pointerup', end);
    handleEl.removeEventListener('pointercancel', end);
  };
}
