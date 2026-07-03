/* ============================================================
   shortcuts.ts — 全局键盘快捷键（仅展开态响应）
   蓝图 §4.4/§4.5：
     Ctrl/Cmd+Z          → 撤销（仅展开态）
     Ctrl/Cmd+Shift+Z    → 重做（仅展开态）
     Esc                 → 退出当前工具（move/settings → annotate；annotate 不处理）
   注意：direct-edit 内联编辑的 Esc 在 capture 阶段 stopPropagation 先消费，
   此处注册在 capture 阶段但注册晚于 direct-edit，通过 stopPropagation 顺序化解。
   ============================================================ */

import { Controller } from './controller';
import { History } from '../state/history';

/** 注册快捷键监听器，返回卸载函数。 */
export function setupShortcuts(controller: Controller, history: History): () => void {
  const handler = (e: KeyboardEvent): void => {
    // 仅展开态响应
    if (!controller.getState().expanded) return;

    const ctrl = e.ctrlKey || e.metaKey;

    if (ctrl && !e.shiftKey && e.key === 'z') {
      e.preventDefault();
      history.undo();
      return;
    }

    if (ctrl && e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      history.redo();
      return;
    }

    if (e.key === 'Escape') {
      const { mode } = controller.getState();
      if (mode === 'move' || mode === 'settings') {
        // toggleMode 再次点同一模式 → 回 annotate
        controller.toggleMode(mode);
      }
      // annotate 态 Esc 不处理（留给各 manager 自己的 Esc）
    }
  };

  window.addEventListener('keydown', handler, true);
  return () => window.removeEventListener('keydown', handler, true);
}
