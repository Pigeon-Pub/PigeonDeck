/* ============================================================
   esc-stack.ts — Esc 优先级栈（LIFO）
   单一 window capture 阶段 keydown 监听（main.ts 早于 setupShortcuts 安装）。
   按 Escape 时：栈非空 → 弹出栈顶处理器执行 + preventDefault + stopImmediatePropagation
   （下游 shortcuts 模式退出、各 manager 自带 Esc 都不再触发）；栈空 → 放行（不拦截）。
   浮层入栈（见 popover.ts）：栈顶先关（下拉先关），再按一次 Esc 才轮到 shortcuts 关设置。
   direct-edit/copy-text/capture 不入栈：其活动期间栈恒空，本模块放行，各自 Esc 照常工作。
   ============================================================ */

type EscHandler = () => void;

const stack: EscHandler[] = [];
let installed = false;

function onKeyDown(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (stack.length === 0) return; // 栈空放行，交给下游监听器（shortcuts 模式退出等）
  const handler = stack.pop()!;
  e.preventDefault();
  e.stopImmediatePropagation();
  handler();
}

/** 安装唯一的 capture 阶段 keydown 监听（幂等）。须在 main.ts 早于 setupShortcuts 调用。 */
export function initEscStack(): void {
  if (installed) return;
  installed = true;
  window.addEventListener('keydown', onKeyDown, true);
}

/**
 * 压入一个 Esc 处理器（置于栈顶）。返回 pop 函数：调用即按引用移除本处理器
 * （按身份移除，非盲弹，可乱序拆卸而不误删他人；重复调用幂等）。
 */
export function pushEsc(handler: EscHandler): () => void {
  stack.push(handler);
  return (): void => {
    const i = stack.lastIndexOf(handler);
    if (i !== -1) stack.splice(i, 1);
  };
}
