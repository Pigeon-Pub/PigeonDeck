/* ============================================================
   toolbar.ts — PigeonDeck 工具盘（悬浮球 + 单列纵向工具盘）
   渲染进 control 层，订阅 Controller 状态，管理拖拽 + 位置持久化。
   SVG 图标全部来自 preview/parts/02-toolbar-default.html（Lucide 风格）。
   ============================================================ */

import { Controller } from './controller';
import { t } from './i18n';
import { History } from '../state/history';
import { LOGO_SVG } from './logo';

const POS_KEY = 'pigeondeck.pos';

/** 默认右下角 16px */
const DEFAULT_RIGHT = 16;
const DEFAULT_BOTTOM = 16;

/** 悬浮球尺寸（px，与 base.css .pd-ball 一致），展开方向计算用 */
const BALL_SIZE = 42;

/** 拖拽启动位移阈值（px）：点住后首次移动超过即进入拖拽（点住即拖，无长按延时） */
const DRAG_THRESHOLD_PX = 4;

/* ---- SVG 图标（内联，与 preview part 02 完全一致） ---- */
const ICONS = {
  logo: LOGO_SVG,
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
  /** 拖拽真正开始时的回调（INVARIANT 3：关闭工具盘派生的面板/浮层，不动内容面板）。 */
  private onDragStart?: () => void;
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
  private armed = false;
  private dragStartPointer = { x: 0, y: 0 };
  private dragStartPos: Pos = { right: 0, bottom: 0 };
  private dragMoved = false;

  constructor(controller: Controller, controlLayer: HTMLElement, history: History, onDragStart?: () => void) {
    this.controller = controller;
    this.history = history;
    this.root = controlLayer;
    this.onDragStart = onDragStart;
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
    // 底锚（球始终锚右下）；展开向下时 updateToolbarDirection 会改为顶锚
    el.style.top = 'auto';
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

    // 切换球 vs 工具盘：display 由 CSS（.pd-wrapper.pd-open）驱动，
    // 配合 @starting-style 做淡入/缩放进入动画（收起态瞬时隐藏，保证 E2E 可见性断言稳定）
    this.wrapper.classList.toggle('pd-open', expanded);

    if (!expanded) {
      // 收起：恢复底锚（可能上次向下展开切到了顶锚）
      this.applyPos();
      return;
    }

    // 激活态按钮
    this.btnMove.classList.toggle('active', mode === 'move');
    this.btnSettings.classList.toggle('active', mode === 'settings');

    // 工具盘描边：move/settings 激活时外描边
    this.toolbar.classList.toggle('is-active', mode === 'move' || mode === 'settings');

    // 展开方向检测（防截断，裁决12 #9）
    this.updateToolbarDirection();
  }

  /** 检测视口空间，更新工具盘展开方向（Logo 始终贴球锚点） */
  private updateToolbarDirection(): void {
    const el = this.wrapper;
    const tbHeight = this.toolbar.scrollHeight || 320; // 预估高度
    const vh = window.innerHeight;

    // 球锚点（收起态球的视口纵向范围，以 pos.bottom 换算）
    const ballTop = vh - this.pos.bottom - BALL_SIZE;
    const ballBottom = vh - this.pos.bottom;
    const roomBelow = vh - ballTop; // 从球上沿向下的可用空间
    const roomAbove = ballBottom; // 从球下沿向上的可用空间

    // 优先向下展开；下方放不下且上方更宽裕 → 向上
    const openUpward = roomBelow < tbHeight && roomAbove > roomBelow;
    this.toolbar.classList.toggle('open-upward', openUpward);

    if (openUpward) {
      // 底锚：工具盘底部对齐球底部（CSS column-reverse 让 Logo 落在底部＝球位置，工具向上叠）
      el.style.top = 'auto';
      el.style.bottom = `${this.pos.bottom}px`;
    } else {
      // 顶锚：工具盘顶部对齐球顶部（正常 column，Logo 在顶＝球位置，工具向下延伸）
      el.style.bottom = 'auto';
      el.style.top = `${Math.max(0, ballTop)}px`;
    }
  }

  // ---- 创建 DOM ----

  private createBall(): HTMLElement {
    const ball = document.createElement('div');
    ball.className = 'pd-ball';
    ball.setAttribute('data-testid', 'pd-ball');
    ball.setAttribute('role', 'button');
    ball.setAttribute('aria-label', t('tb_logo'));
    ball.title = t('tb_logo');
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
    tb.className = 'pd-toolbar';
    tb.setAttribute('data-testid', 'pd-toolbar');
    // 显隐由 CSS（.pd-wrapper.pd-open）驱动，默认 base.css .pd-toolbar { display:none }

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
    // F3：改用原生系统 tooltip（title），移除不稳定的自制 .pd-tip 浮层。
    btn.title = t(i18nKey);
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
    this.btnUndo.title = t('tb_undo');
    this.btnUndo.innerHTML = ICONS.undo;
    this.btnUndo.addEventListener('click', () => {
      if (!this.btnUndo.disabled) this.controller.triggerUndo();
    });

    this.btnRedo = document.createElement('button');
    this.btnRedo.setAttribute('data-testid', 'pd-btn-redo');
    this.btnRedo.setAttribute('aria-label', t('tb_redo'));
    this.btnRedo.title = t('tb_redo');
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

  // ---- 拖拽（点住即拖：首次移动超过阈值即启动，无长按延时） ----

  private bindDrag(el: HTMLElement): void {
    el.addEventListener('pointerdown', this.onPointerDown);
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;

    this.armed = true;
    this.dragActive = false;
    this.dragMoved = false;
    this.dragStartPointer = { x: e.clientX, y: e.clientY };
    this.dragStartPos = { ...this.pos };

    // 监听挂 window（捕获阶段）：光标移出元素/Shadow DOM 也能持续收到事件；
    // 松手/取消无条件解绑（不依赖 setPointerCapture，杜绝松手后仍跟随光标的顽疾）。
    window.addEventListener('pointermove', this.onPointerMove, true);
    window.addEventListener('pointerup', this.endDrag, true);
    window.addEventListener('pointercancel', this.endDrag, true);
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.armed) return;

    const dx = e.clientX - this.dragStartPointer.x;
    const dy = e.clientY - this.dragStartPointer.y;

    // 未启动拖拽：等首次移动超过阈值再进入（点住即拖，同时抑制随后的 click）
    if (!this.dragActive) {
      if (Math.abs(dx) <= DRAG_THRESHOLD_PX && Math.abs(dy) <= DRAG_THRESHOLD_PX) return;
      this.dragActive = true;
      this.dragMoved = true;
      // INVARIANT 3：真实拖拽开始（过阈值，非单击）→ 关闭工具盘派生的面板/浮层
      // （设置/复制文本/复制图片/清空确认 + 全部浮层），内容面板不动。
      this.onDragStart?.();
    }

    const rect = this.wrapper.getBoundingClientRect();
    // 位置以 right/bottom 存储（向左/向上为正方向）：dx 向右为正 → right 减；dy 向下为正 → bottom 减
    const newRight = this.dragStartPos.right - dx;
    const newBottom = this.dragStartPos.bottom - dy;

    this.pos = clampPos(newRight, newBottom, rect.width, rect.height);
    this.applyPos();
    // F7：展开态拖拽时按当前展开方向重锚。applyPos 强制底锚，向下展开（顶锚、整条高）时
    // 会把底部＝设置钮钉在球偏移处 → 整条上跳；重算方向让顶/底锚与展开方向一致，拖动不跳。
    if (this.controller.getState().expanded) {
      this.updateToolbarDirection();
    }
  };

  /** 松手/取消：无条件解绑窗口监听并结束拖拽，移动过则持久化并重算展开方向 */
  private endDrag = (): void => {
    this.armed = false;
    window.removeEventListener('pointermove', this.onPointerMove, true);
    window.removeEventListener('pointerup', this.endDrag, true);
    window.removeEventListener('pointercancel', this.endDrag, true);

    if (!this.dragActive) return;
    this.dragActive = false;

    if (this.dragMoved) {
      savePos(this.pos);
      // 展开后重计方向（拖拽中为底锚，松手回正确方向）
      if (this.controller.getState().expanded) {
        this.updateToolbarDirection();
      }
    }
  };
}
