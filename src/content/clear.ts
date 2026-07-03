/* ============================================================
   clear.ts — 清空确认（阶段 10）
   蓝图 §5.6：点「清空」→ 贴工具盘的小确认弹层；确认 = 复合命令，
   清除当前页全部标注/区域/直接编辑/移动预览 + 编号从 1 重置 + 历史清空，
   但清空本身可撤销（§4.4 撤销覆盖清空）。
   视觉照搬 preview/parts/14-clear-confirm.html（.pd-surface.confirm）。
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore } from '../state/annotations';
import { History } from '../state/history';
import { Toast } from './toast';
import { t } from './i18n';
import { mountPopover, PopoverHandle } from './popover';
import { applyChangesTo } from './panel';

export class ClearManager {
  private controller: Controller;
  private store: AnnotationStore;
  private history: History;
  private toast: Toast;
  private controlLayer: HTMLElement;
  private panelLayer: HTMLElement;

  private popover: PopoverHandle | null = null;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    history: History;
    toast: Toast;
    controlLayer: HTMLElement;
    panelLayer: HTMLElement;
  }) {
    this.controller = opts.controller;
    this.store = opts.store;
    this.history = opts.history;
    this.toast = opts.toast;
    this.controlLayer = opts.controlLayer;
    this.panelLayer = opts.panelLayer;

    // 合并进已有回调（setCallbacks 为合并语义，不覆盖其它回调）
    this.controller.setCallbacks({ onClear: () => this.toggle() });
  }

  /** 点「清空」瞬时动作：开着 → 收起；否则开确认弹层（无内容仅轻提示） */
  private toggle(): void {
    if (this.popover) {
      this.popover.close();
      return;
    }
    if (this.store.getAll().length === 0) {
      this.toast.show(t('toast_clear_empty'));
      return;
    }
    this.openConfirm();
  }

  /** 贴清空按钮弹出确认层（照搬 part 14） */
  private openConfirm(): void {
    const clearBtn = this.controlLayer.querySelector<HTMLElement>('[data-testid="pd-btn-clear"]');
    if (!clearBtn) return;

    const surface = document.createElement('div');
    surface.className = 'pd-surface confirm';
    surface.setAttribute('data-testid', 'pd-clear-confirm');

    const msg = document.createElement('div');
    msg.className = 'msg';
    msg.textContent = t('clear_confirm_msg');
    surface.appendChild(msg);

    const row = document.createElement('div');
    row.className = 'row';

    const btnCancel = document.createElement('button');
    btnCancel.className = 'pd-btn ghost';
    btnCancel.setAttribute('data-testid', 'pd-clear-cancel');
    btnCancel.textContent = t('clear_confirm_cancel');
    btnCancel.addEventListener('click', () => this.popover?.close());
    row.appendChild(btnCancel);

    const btnOk = document.createElement('button');
    btnOk.className = 'pd-btn danger';
    btnOk.setAttribute('data-testid', 'pd-clear-ok');
    btnOk.textContent = t('clear_confirm_ok');
    btnOk.addEventListener('click', () => {
      this.performClear();
      this.popover?.close();
    });
    row.appendChild(btnOk);

    surface.appendChild(row);

    // 打开：清空按钮进入危险态；关闭（点外部/取消/确认后）移除
    clearBtn.classList.add('clear-danger');
    this.popover = mountPopover(this.panelLayer, surface, clearBtn, () => {
      clearBtn.classList.remove('clear-danger');
      this.popover = null;
    });
  }

  /**
   * 清空复合命令：可撤销。
   * apply（doClear）：按选择器重新解析每条标注元素 → 样式/内容改回旧值 + 复位移动
   *   transform → store.clear()（编号归 1）。
   * revert（restore）：store.load(snapshot)（恢复标注 + nextNumber）→ 每条重放新值 +
   *   重设移动 transform。
   * doClear/restore 每次都用 selector 重新解析元素（元素可能已被移动/重渲染），
   * 不闭包缓存 element 引用；只缓存 snapshot + anns 元数据。
   */
  private performClear(): void {
    const snapshot = this.store.toPageState();
    const anns = this.store.getAll();

    const doClear = (): void => {
      for (const ann of anns) {
        const el = document.querySelector(ann.selector);
        applyChangesTo(el, ann.changes, 'old');
        if (ann.move && el instanceof HTMLElement) {
          el.style.transform = '';
        }
      }
      this.store.clear();
    };

    const restore = (): void => {
      this.store.load(snapshot);
      for (const ann of anns) {
        const el = document.querySelector(ann.selector);
        applyChangesTo(el, ann.changes, 'new');
        if (ann.move && el instanceof HTMLElement) {
          el.style.transform = `translate(${ann.move.dx}px, ${ann.move.dy}px)`;
        }
      }
    };

    doClear();
    this.history.clear();
    this.history.push({ label: 'clear', apply: doClear, revert: restore });
    this.toast.show(t('toast_cleared'), 'ok');
  }
}
