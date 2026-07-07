/* ============================================================
   popover.ts — 面板层浮层通用挂载（自制下拉 / 调色盘共用）
   - 锚点下方弹出，放不下翻到上方，水平/垂直夹紧视口
   - 点浮层与锚点之外任意处关闭；closeAllPopovers 供面板关闭时统一清理
   - data-pd-popover 标记：panel.ts 的"点外部关面板"判定放行浮层内点击
   ============================================================ */

import { pushEsc } from './esc-stack';

const EDGE = 8;
const GAP = 4;

const openClosers = new Set<() => void>();

/** 关闭当前所有浮层（面板关闭/切换时调用） */
export function closeAllPopovers(): void {
  for (const close of [...openClosers]) close();
}

export interface PopoverHandle {
  el: HTMLElement;
  close: () => void;
}

/**
 * 将浮层挂载进 root 并定位到 anchor 附近。
 * 返回句柄；重复 close 幂等。onClose 在浮层被任何途径关闭时回调。
 */
export function mountPopover(
  root: HTMLElement,
  el: HTMLElement,
  anchor: HTMLElement,
  onClose?: () => void
): PopoverHandle {
  el.setAttribute('data-pd-popover', '');
  el.style.position = 'absolute';
  root.appendChild(el);

  // 定位：锚点下方 → 上方兜底 → 视口夹紧
  const rect = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = rect.left;
  let top = rect.bottom + GAP;
  if (top + h > vh - EDGE) {
    top = rect.top - GAP - h;
  }
  left = Math.max(EDGE, Math.min(left, vw - w - EDGE));
  top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  let closed = false;
  let popEsc: (() => void) | null = null;
  const close = (): void => {
    if (closed) return;
    closed = true;
    openClosers.delete(close);
    window.removeEventListener('mousedown', onMouseDown, true);
    popEsc?.(); // 从 Esc 栈移除（Esc 触发时已弹出 → 幂等）
    el.remove();
    onClose?.();
  };

  const onMouseDown = (ev: MouseEvent): void => {
    const path = ev.composedPath();
    if (path.includes(el) || path.includes(anchor)) return;
    close();
  };
  window.addEventListener('mousedown', onMouseDown, true);
  openClosers.add(close);
  // Esc 关闭（栈顶优先）：下拉/浮层先于 shortcuts 的模式退出被关掉
  popEsc = pushEsc(close);

  return { el, close };
}

/**
 * 触发钮「点击开关」语义（逻辑11，全站统一）：绑一次即可——
 * - 浮层未开：调 open(onClose) 打开，并把返回句柄记在闭包里；
 * - 浮层已开（同一触发钮再次点击）：关闭并返回，绝不叠开第二个（修复 Settings 语言选择器
 *   等触发钮反复点击层层堆叠的 bug）。
 * open 必须把收到的 onClose 接到浮层（mountPopover / openDropdown / openColorPicker /
 * openLanguagePicker 的 onClose 参数），使浮层被任何途径关闭（点外部/Esc/内部选择/
 * closeAllPopovers）时本地句柄归零，下次点击重新打开。
 * 点「别的」触发钮切换：mountPopover 的点外部逻辑会关掉旧浮层（其 onClose 归零对应句柄），
 * 新触发钮再开自己的——不会双开。
 */
export function bindPopoverToggle(
  trigger: HTMLElement,
  open: (onClose: () => void) => PopoverHandle
): void {
  let handle: PopoverHandle | null = null;
  trigger.addEventListener('click', () => {
    if (handle) {
      handle.close(); // onClose 同步归零 handle
      return;
    }
    handle = open(() => {
      handle = null;
    });
  });
}
