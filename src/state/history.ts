/* ============================================================
   history.ts — 撤销/重做历史栈（命令模式）
   蓝图 §5.5：默认 50 步上限（设置可调最高 9999）。
   本阶段只建核心栈；工具盘按钮/快捷键接线在阶段 7。
   约定：命令 push 时动作已执行（push 不调 apply）；
   undo → revert()，redo → apply()；新命令清空 redo 栈。
   ============================================================ */

/** 一条可撤销命令：apply=重做该操作，revert=撤销该操作 */
export interface Command {
  label: string;
  apply(): void;
  revert(): void;
}

export class History {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private limit: number;

  constructor(limit = 50) {
    this.limit = Math.max(1, limit);
  }

  /** 记录一条已执行的命令：清空 redo，超上限丢弃最旧 */
  push(cmd: Command): void {
    this.undoStack.push(cmd);
    this.redoStack = [];
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
  }

  /** 撤销栈顶命令；无可撤销返回 false */
  undo(): boolean {
    const cmd = this.undoStack.pop();
    if (!cmd) return false;
    cmd.revert();
    this.redoStack.push(cmd);
    return true;
  }

  /** 重做最近撤销的命令；无可重做返回 false */
  redo(): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.apply();
    this.undoStack.push(cmd);
    return true;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 清空全部历史（清空操作/关闭 tab 用） */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  /** 调整上限（设置项）：立即截断最旧的超额命令 */
  setLimit(limit: number): void {
    this.limit = Math.max(1, limit);
    if (this.undoStack.length > this.limit) {
      this.undoStack.splice(0, this.undoStack.length - this.limit);
    }
  }
}
