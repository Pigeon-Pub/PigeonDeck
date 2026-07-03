/* ============================================================
   toolbar.ts — PigeonDeck 工具盘（悬浮球 + 单列纵向工具盘）
   渲染进 control 层，订阅 Controller 状态，管理拖拽 + 位置持久化。
   SVG 图标全部来自 preview/parts/02-toolbar-default.html（Lucide 风格）。
   ============================================================ */

import { Controller } from './controller';
import { t } from './i18n';
import { History } from '../state/history';

const POS_KEY = 'pigeondeck.pos';

/** 默认右下角 16px */
const DEFAULT_RIGHT = 16;
const DEFAULT_BOTTOM = 16;

/** 长按阈值 ms */
const LONG_PRESS_MS = 300;

/* ---- SVG 图标（内联，与 preview part 02 完全一致） ---- */
const ICONS = {
  logo: `<svg viewBox="0 0 630.367 618.433" fill="none" stroke="currentColor" stroke-width="35" stroke-linecap="round" stroke-linejoin="round"><path d="M78 387.5C152.631 368.891 76.4167 392.232 49.7159 390.136C29.1717 388.523 9.13425 371.072 2.55369 390.136C-12.5464 433.88 43.4887 557.5 61.4994 557.5C97.5603 557.5 95.1332 499.399 184.592 475.119C256.159 455.694 409.626 508.071 456.782 345.043C503.939 182.015 572.94 180.281 582.476 175.078C592.011 169.875 556.99 105.184 472.386 130.853C450.907 137.369 435.465 148.71 424.171 156.868C399.875 174.416 397.5 180 389 185.5C380.5 191 368.5 203 313.753 182.016C259.005 161.031 242.331 146.042 189.5 107C156.829 82.8558 176 96.4999 75.369 10.3161C-25.262 -75.8676 145.757 407.479 184.592 365.855C197.353 352.189 196.253 346.982 199.328 332.903C205.612 304.136 206.358 271.572 217.532 286.943C224.842 296.998 237.881 316.154 248.739 335.504C262.601 360.21 276.478 376.261 284.28 374.527C292.081 372.793 325.888 347.298 325.888 335.504C325.888 331.568 324.906 329.488 317.921 320.623C315.251 317.234 311.705 312.855 307 307C287.143 282.288 243.751 226.465 280 273" transform="matrix(0.996195,-0.0871557,0.0871557,0.996195,0,50.899)"/></svg>`,
  move: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9l-3 3 3 3"/><path d="M9 5l3-3 3 3"/><path d="M15 19l-3 3-3-3"/><path d="M19 9l3 3-3 3"/><path d="M2 12h20"/><path d="M12 2v20"/></svg>`,
  copyText: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>`,
  copyImage: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/></svg>`,
  undo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14 4 9l5-5"/><path d="M4 9h11a4 4 0 0 1 0 8h-4"/></svg>`,
  redo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="m15 14 5-5-5-5"/><path d="M20 9H9a4 4 0 0 0 0 8h4"/></svg>`,
  clear: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`,
} as const;

/** 位置（以 right/bottom 存储，便于 resize 重夹紧） */
interface Pos {
  right: number;
  bottom: number;
}

function loadPos(): Pos {
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Pos;
      if (typeof p.right === 'number' && typeof p.bottom === 'number') {
        return p;
      }
    }
  } catch {
    // 静默失败
  }
  return { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
}

function savePos(pos: Pos): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    // 静默失败
  }
}

/** 夹紧坐标在视口内（考虑容器尺寸） */
function clampPos(right: number, bottom: number, w: number, h: number): Pos {
  const maxRight = window.innerWidth - w;
  const maxBottom = window.innerHeight - h;
  return {
    right: Math.max(0, Math.min(right, maxRight)),
    bottom: Math.max(0, Math.min(bottom, maxBottom)),
  };
}

export class Toolbar {
  private controller: Controller;
  private history: History;
  private root: HTMLElement; // control 层根容器
  private wrapper: HTMLElement; // 位置容器（fixed，right/bottom）
  private ball: HTMLElement;
  private toolbar: HTMLElement;
  private btnMove!: HTMLButtonElement;
  private btnSettings!: HTMLButtonElement;
  private btnUndo!: HTMLButtonElement;
  private btnRedo!: HTMLButtonElement;
  private pos: Pos;
  private unsubscribe: () => void;
  private unsubscribeHistory: () => void;

  // 拖拽状态
  private dragActive = false;
  private longPressTimer: ReturnType<typeof setTimeout> | null = null;
  private dragStartPointer = { x: 0, y: 0 };
  private dragStartPos: Pos = { right: 0, bottom: 0 };
  private dragMoved = false;

  constructor(controller: Controller, controlLayer: HTMLElement, history: History) {
    this.controller = controller;
    this.history = history;
    this.root = controlLayer;
    this.pos = loadPos();

    this.wrapper = document.createElement('div');
    this.wrapper.className = 'pd-wrapper';
    this.wrapper.setAttribute('data-testid', 'pd-wrapper');
    this.applyPos();

    this.ball = this.createBall();
    this.toolbar = this.createToolbarEl();

    this.wrapper.appendChild(this.ball);
    this.wrapper.appendChild(this.toolbar);
    this.root.appendChild(this.wrapper);

    // 初始状态：显示球
    this.syncState();

    this.unsubscribe = this.controller.subscribe(() => this.syncState());
    this.unsubscribeHistory = this.history.subscribe(() => this.refreshUndoRedo());

    // resize 夹紧
    window.addEventListener('resize', this.onResize);
  }

  destroy(): void {
    this.unsubscribe();
    this.unsubscribeHistory();
    window.removeEventListener('resize', this.onResize);
    this.wrapper.remove();
  }

  // ---- 位置管理 ----

  /** 重置悬浮球位置到默认右下角（设置面板「重置位置」调用） */
  resetPosition(): void {
    this.pos = { right: DEFAULT_RIGHT, bottom: DEFAULT_BOTTOM };
    this.applyPos();
    try {
      localStorage.removeItem(POS_KEY);
    } catch {
      // 静默失败
    }
    if (this.controller.getState().expanded) {
      this.updateToolbarDirection();
    }
  }

  private applyPos(): void {
    const el = this.wrapper;
    el.style.position = 'fixed';
    el.style.right = `${this.pos.right}px`;
    el.style.bottom = `${this.pos.bottom}px`;
    el.style.zIndex = '0';
    el.style.pointerEvents = 'auto';
    // 确保不撑大父容器
    el.style.width = 'max-content';
  }

  private onResize = (): void => {
    const rect = this.wrapper.getBoundingClientRect();
    const clamped = clampPos(this.pos.right, this.pos.bottom, rect.width, rect.height);
    if (clamped.right !== this.pos.right || clamped.bottom !== this.pos.bottom) {
      this.pos = clamped;
      this.applyPos();
    }
  };

  // ---- 状态同步 ----

  private syncState(): void {
    const { expanded, mode } = this.controller.getState();

    // 切换球 vs 工具盘可见性
    this.ball.style.display = expanded ? 'none' : 'flex';
    this.toolbar.style.display = expanded ? 'inline-flex' : 'none';

    if (!expanded) return;

    // 激活态按钮
    this.btnMove.classList.toggle('active', mode === 'move');
    this.btnSettings.classList.toggle('active', mode === 'settings');

    // 工具盘描边：move/settings 激活时外描边
    this.toolbar.classList.toggle('is-active', mode === 'move' || mode === 'settings');

    // 展开方向检测（防截断，裁决12 #9）
    this.updateToolbarDirection();
  }

  /** 检测视口空间，更新工具盘展开方向与 tooltip 方向 */
  private updateToolbarDirection(): void {
    const tbRect = this.wrapper.getBoundingClientRect();
    const tbHeight = this.toolbar.scrollHeight || 320; // 预估高度

    const spaceBelow = window.innerHeight - tbRect.bottom;
    const spaceAbove = tbRect.top;

    // 向上展开：下方不够且上方足够
    const openUpward = spaceBelow < tbHeight && spaceAbove > spaceBelow;
    this.toolbar.classList.toggle('open-upward', openUpward);

    // tooltip 方向：靠近右边缘 → tooltip 在左侧
    const nearRight = window.innerWidth - tbRect.right < 160;
    this.toolbar.classList.toggle('tip-left', nearRight);
    this.toolbar.classList.toggle('tip-right', !nearRight);
  }

  // ---- 创建 DOM ----

  private createBall(): HTMLElement {
    const ball = document.createElement('div');
    ball.className = 'pd-ball';
    ball.setAttribute('data-testid', 'pd-ball');
    ball.setAttribute('role', 'button');
    ball.setAttribute('aria-label', t('tb_logo'));
    ball.innerHTML = ICONS.logo;
    ball.style.cursor = 'pointer';
    ball.style.pointerEvents = 'auto';

    this.bindDrag(ball);
    ball.addEventListener('click', () => {
      if (!this.dragMoved) {
        this.controller.toggleExpanded();
      }
    });

    return ball;
  }

  private createToolbarEl(): HTMLElement {
    const tb = document.createElement('div');
    tb.className = 'pd-toolbar tip-right';
    tb.setAttribute('data-testid', 'pd-toolbar');
    tb.style.display = 'none';

    // Logo 按钮（顶部，点击收起）
    const btnLogo = this.createTbtn('pd-tbtn brand', ICONS.logo, 'tb_logo');
    btnLogo.setAttribute('data-testid', 'pd-btn-logo');
    this.bindDrag(btnLogo);
    btnLogo.addEventListener('click', () => {
      if (!this.dragMoved) {
        this.controller.collapse();
      }
    });
    tb.appendChild(btnLogo);

    // 撤销/重做（合并药丸，紧邻 Logo —— 顺序照搬 preview part 02）
    const undoredo = this.createUndoRedo();
    tb.appendChild(undoredo);

    // 移动按钮
    this.btnMove = this.createTbtn('pd-tbtn', ICONS.move, 'tb_move');
    this.btnMove.setAttribute('data-testid', 'pd-btn-move');
    this.btnMove.addEventListener('click', () => this.controller.toggleMode('move'));
    tb.appendChild(this.btnMove);

    // 复制文本
    const btnCopyText = this.createTbtn('pd-tbtn', ICONS.copyText, 'tb_copy_text');
    btnCopyText.setAttribute('data-testid', 'pd-btn-copy-text');
    btnCopyText.addEventListener('click', () => this.controller.triggerCopyText());
    tb.appendChild(btnCopyText);

    // 复制图片
    const btnCopyImage = this.createTbtn('pd-tbtn', ICONS.copyImage, 'tb_copy_image');
    btnCopyImage.setAttribute('data-testid', 'pd-btn-copy-image');
    btnCopyImage.addEventListener('click', () => this.controller.triggerCopyImage());
    tb.appendChild(btnCopyImage);

    // 清空
    const btnClear = this.createTbtn('pd-tbtn', ICONS.clear, 'tb_clear');
    btnClear.setAttribute('data-testid', 'pd-btn-clear');
    btnClear.addEventListener('click', () => this.controller.triggerClear());
    tb.appendChild(btnClear);

    // 设置
    this.btnSettings = this.createTbtn('pd-tbtn', ICONS.settings, 'tb_settings');
    this.btnSettings.setAttribute('data-testid', 'pd-btn-settings');
    this.btnSettings.addEventListener('click', () => this.controller.toggleMode('settings'));
    tb.appendChild(this.btnSettings);

    return tb;
  }

  private createTbtn(className: string, iconSvg: string, i18nKey: string): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = className;
    btn.innerHTML = iconSvg;
    btn.setAttribute('aria-label', t(i18nKey));

    // Tooltip span
    const tip = document.createElement('span');
    tip.className = 'pd-tip';
    tip.textContent = t(i18nKey);
    btn.appendChild(tip);

    return btn;
  }

  private createUndoRedo(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'pd-undoredo';
    wrap.setAttribute('data-testid', 'pd-undoredo');
    wrap.setAttribute('aria-label', `${t('tb_undo')} / ${t('tb_redo')}`);

    this.btnUndo = document.createElement('button');
    this.btnUndo.setAttribute('data-testid', 'pd-btn-undo');
    this.btnUndo.setAttribute('aria-label', t('tb_undo'));
    this.btnUndo.innerHTML = ICONS.undo;
    this.btnUndo.addEventListener('click', () => {
      if (!this.btnUndo.disabled) this.controller.triggerUndo();
    });

    this.btnRedo = document.createElement('button');
    this.btnRedo.setAttribute('data-testid', 'pd-btn-redo');
    this.btnRedo.setAttribute('aria-label', t('tb_redo'));
    this.btnRedo.innerHTML = ICONS.redo;
    this.btnRedo.addEventListener('click', () => {
      if (!this.btnRedo.disabled) this.controller.triggerRedo();
    });

    wrap.appendChild(this.btnUndo);
    wrap.appendChild(this.btnRedo);

    // 根据当前 history 状态初始化禁用态
    this.refreshUndoRedo();

    return wrap;
  }

  /** 根据 history.canUndo/canRedo 刷新按钮禁用态 */
  private refreshUndoRedo(): void {
    const canUndo = this.history.canUndo();
    const canRedo = this.history.canRedo();
    this.btnUndo.disabled = !canUndo;
    this.btnUndo.classList.toggle('disabled', !canUndo);
    this.btnRedo.disabled = !canRedo;
    this.btnRedo.classList.toggle('disabled', !canRedo);
  }

  // ---- 拖拽（长按 ≥ 300ms） ----

  private bindDrag(el: HTMLElement): void {
    el.addEventListener('pointerdown', this.onPointerDown);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    // el = the element the listener was attached to (ball or logo btn)
    const el = e.currentTarget as HTMLElement;

    this.dragMoved = false;
    this.dragStartPointer = { x: e.clientX, y: e.clientY };
    this.dragStartPos = { ...this.pos };

    // 取消时清定时器
    const cancelOnce = (): void => {
      if (this.longPressTimer) {
        clearTimeout(this.longPressTimer);
        this.longPressTimer = null;
      }
      el.removeEventListener('pointerup', cancelOnce);
      el.removeEventListener('pointermove', checkMove);
    };

    const checkMove = (ev: Event): void => {
      const pe = ev as PointerEvent;
      const dx = Math.abs(pe.clientX - this.dragStartPointer.x);
      const dy = Math.abs(pe.clientY - this.dragStartPointer.y);
      if (dx > 4 || dy > 4) cancelOnce();
    };

    this.longPressTimer = setTimeout(() => {
      // 长按达成 → 进入拖拽。监听挂 window（捕获阶段）：
      // 不依赖 setPointerCapture（从 setTimeout 内调用时机不可靠），
      // 光标移出元素/Shadow DOM 也能持续收到事件。
      el.removeEventListener('pointerup', cancelOnce);
      el.removeEventListener('pointermove', checkMove);
      this.dragActive = true;
      window.addEventListener('pointermove', this.onPointerMove, true);
      window.addEventListener('pointerup', this.onPointerUp, true);
    }, LONG_PRESS_MS);

    el.addEventListener('pointerup', cancelOnce, { once: true });
    el.addEventListener('pointermove', checkMove);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.dragActive) return;

    const dx = e.clientX - this.dragStartPointer.x;
    const dy = e.clientY - this.dragStartPointer.y;

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      this.dragMoved = true;
    }

    const rect = this.wrapper.getBoundingClientRect();
    const newRight = this.dragStartPos.right - dx;
    const newBottom = this.dragStartPos.bottom + dy;

    this.pos = clampPos(newRight, newBottom, rect.width, rect.height);
    this.applyPos();
  };

  private onPointerUp = (): void => {
    if (!this.dragActive) return;

    this.dragActive = false;
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.onPointerUp, true);

    if (this.dragMoved) {
      savePos(this.pos);
      // 展开后重计方向
      if (this.controller.getState().expanded) {
        this.updateToolbarDirection();
      }
    }
  };
}
