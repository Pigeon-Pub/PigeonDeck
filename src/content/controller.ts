/* ============================================================
   controller.ts — PigeonDeck 模式控制器（极简状态机）
   蓝图 §4.1：展开即批注、移动/设置互斥、瞬时按钮不占模式
   ============================================================ */

export type Mode = 'annotate' | 'move' | 'settings';

export interface ControllerState {
  expanded: boolean;
  mode: Mode;
}

export type Listener = (state: ControllerState) => void;

/** 瞬时动作回调挂点（本阶段 no-op，后续阶段接入） */
export interface ActionCallbacks {
  onCopyText?: () => void;
  onCopyImage?: () => void;
  onClear?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
}

export class Controller {
  private state: ControllerState = {
    expanded: false,
    mode: 'annotate',
  };

  private listeners: Set<Listener> = new Set();
  private callbacks: ActionCallbacks = {};

  /** 订阅状态变化。返回取消订阅函数。 */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    const snapshot = { ...this.state };
    for (const l of this.listeners) {
      l(snapshot);
    }
  }

  /** 注册瞬时动作回调 */
  setCallbacks(callbacks: ActionCallbacks): void {
    this.callbacks = { ...this.callbacks, ...callbacks };
  }

  getState(): ControllerState {
    return { ...this.state };
  }

  /** 展开工具盘 → 自动进入 annotate 模式 */
  expand(): void {
    if (this.state.expanded) return;
    this.state = { expanded: true, mode: 'annotate' };
    this.notify();
  }

  /** 收起工具盘 → 退出当前模式（不清内容） */
  collapse(): void {
    if (!this.state.expanded) return;
    this.state = { expanded: false, mode: 'annotate' };
    this.notify();
  }

  /** 切换展开/收起 */
  toggleExpanded(): void {
    if (this.state.expanded) {
      this.collapse();
    } else {
      this.expand();
    }
  }

  /**
   * 切换某个互斥模式（move / settings）。
   * 再次点击同一模式 → 回 annotate。
   * 非展开状态调用无效。
   */
  toggleMode(mode: 'move' | 'settings'): void {
    if (!this.state.expanded) return;
    const next: Mode = this.state.mode === mode ? 'annotate' : mode;
    if (this.state.mode === next) return;
    this.state = { ...this.state, mode: next };
    this.notify();
  }

  /** 瞬时动作：复制文本（不占模式） */
  triggerCopyText(): void {
    this.callbacks.onCopyText?.();
  }

  /** 瞬时动作：复制图片（不占模式） */
  triggerCopyImage(): void {
    this.callbacks.onCopyImage?.();
  }

  /** 瞬时动作：清空（不占模式） */
  triggerClear(): void {
    this.callbacks.onClear?.();
  }

  /** 瞬时动作：撤销（不占模式） */
  triggerUndo(): void {
    this.callbacks.onUndo?.();
  }

  /** 瞬时动作：重做（不占模式） */
  triggerRedo(): void {
    this.callbacks.onRedo?.();
  }
}
