/* ============================================================
   direct-edit.ts — 直接编辑文本（阶段 4a）
   双击文本元素 → contentEditable 内联编辑 + 富文本浮条。
   单击延迟协议：文本类型单击延迟 250ms（PanelManager.cancelPendingOpen 抢占）。
   触发 dblclick 时抢占待定 open，进入编辑态。
   编辑结束：blur/点外部/Esc → 提交 richText StyleChange → 撤销历史。
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore, mergeChanges } from '../state/annotations';
import { History } from '../state/history';
import { Overlay } from './overlay';
import { Settings } from '../state/settings';
import { Toast } from './toast';
import { PanelManager } from './panel';
import { RichTextBar } from './inline-richtext';
import { buildSelector, classifyElement, getElementSummary } from '../shared/dom-utils';

export class DirectEditManager {
  private controller: Controller;
  private store: AnnotationStore;
  private history: History;
  private panelLayer: HTMLElement;
  private panel: PanelManager;

  /** 当前正在编辑的元素（null = 未在编辑） */
  private editEl: HTMLElement | null = null;
  /** 编辑前快照 innerHTML */
  private snapshot: string = '';
  /** 当前富文本浮条实例 */
  private rtBar: RichTextBar | null = null;
  /** Shadow 宿主（isOwnUi 判断） */
  private shadowHost: Element;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    history: History;
    overlay: Overlay;
    panelLayer: HTMLElement;
    settings: Settings;
    toast: Toast;
    panel: PanelManager;
  }) {
    this.controller = opts.controller;
    this.store = opts.store;
    this.history = opts.history;
    this.panelLayer = opts.panelLayer;
    this.panel = opts.panel;
    this.shadowHost = (opts.panelLayer.getRootNode() as ShadowRoot).host;

    window.addEventListener('dblclick', this.onDblClick, true);
    window.addEventListener('keydown', this.onKeyDown, true);
  }

  destroy(): void {
    window.removeEventListener('dblclick', this.onDblClick, true);
    window.removeEventListener('keydown', this.onKeyDown, true);
    this.exitEdit(false);
  }

  private isOwnUi(ev: Event): boolean {
    return ev.composedPath().includes(this.shadowHost);
  }

  private isActive(): boolean {
    const { expanded, mode } = this.controller.getState();
    return expanded && mode === 'annotate';
  }

  private onDblClick = (ev: MouseEvent): void => {
    if (!this.isActive() || this.isOwnUi(ev)) return;

    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === document.documentElement || target === document.body) return;

    // 只处理 text 类型
    if (classifyElement(target) !== 'text') return;

    // 阻止默认行为（选词）+ 抢占单击延迟
    ev.preventDefault();
    ev.stopPropagation();
    this.panel.cancelPendingOpen();

    // 如果点的是另一个元素，先提交当前编辑
    if (this.editEl && this.editEl !== target) {
      this.exitEdit(true);
    }

    if (!this.editEl) {
      this.enterEdit(target);
    }
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.editEl) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.exitEdit(false); // Esc = 取消，恢复快照不记录
    }
  };

  private enterEdit(el: HTMLElement): void {
    this.snapshot = el.innerHTML;
    el.contentEditable = 'true';
    el.dataset['pdEditing'] = '';
    el.focus();
    this.editEl = el;
    this.panel.setInlineEditActive(el);

    // 监听 blur 和 mousedown（点外部）
    el.addEventListener('blur', this.onEditBlur, { capture: true, once: true });
    window.addEventListener('mousedown', this.onOutsideMouseDown, true);

    // 富文本浮条
    this.rtBar = new RichTextBar({ panelLayer: this.panelLayer, editEl: el });
  }

  /** 编辑元素 blur（切焦点时提交） */
  private onEditBlur = (): void => {
    // 若焦点转入 panelLayer 内部（浮条/popover），不提交
    setTimeout(() => {
      const active = document.activeElement;
      if (active && this.panelLayer.contains(active)) return;
      if (this.editEl) this.exitEdit(true);
    }, 0);
  };

  /** 点编辑区外且非浮条/面板时提交 */
  private onOutsideMouseDown = (ev: MouseEvent): void => {
    if (!this.editEl) return;
    const path = ev.composedPath();
    // 点在编辑元素或其子元素内 → 不处理
    if (path.includes(this.editEl)) return;
    // 点在 shadow（面板层/浮条）内 → 不处理（浮条按钮 mousedown 已 preventDefault）
    if (this.isOwnUi(ev)) return;
    this.exitEdit(true);
  };

  /** 提交或取消内联编辑 */
  private exitEdit(commit: boolean): void {
    const el = this.editEl;
    if (!el) return;

    // 清理事件
    el.removeEventListener('blur', this.onEditBlur, true);
    window.removeEventListener('mousedown', this.onOutsideMouseDown, true);

    // 销毁浮条
    this.rtBar?.destroy();
    this.rtBar = null;

    // 读新内容
    const newHtml = el.innerHTML;

    // 退出编辑态
    el.contentEditable = 'inherit';
    delete el.dataset['pdEditing'];
    this.editEl = null;
    this.panel.setInlineEditActive(null);

    if (!commit) {
      // Esc：恢复快照
      el.innerHTML = this.snapshot;
      return;
    }

    // 无变化：跳过
    if (newHtml === this.snapshot) return;

    const oldHtml = this.snapshot;
    const selector = buildSelector(el);
    const existing = this.store.getBySelector(selector);

    // 构建 richText StyleChange
    const change = {
      prop: 'richText',
      cssProp: 'html',
      oldValue: oldHtml,
      newValue: newHtml,
    };

    const resolveEl = (): HTMLElement | null => {
      try {
        const matches = document.querySelectorAll(selector);
        return matches.length === 1 && matches[0] instanceof HTMLElement ? matches[0] : null;
      } catch {
        return null;
      }
    };

    if (existing) {
      // 合并入已有标注（保留 richText 属性的 oldValue 来自最初快照，newValue 为最新）
      const merged = mergeChanges(existing.changes, [change]);
      const savedAnnotation = this.store.update(existing.id, { changes: merged });
      if (savedAnnotation) {
        const after = savedAnnotation;
        const before = existing;
        this.history.push({
          label: 'richtext:update',
          apply: () => {
            const t = resolveEl();
            if (t) t.innerHTML = after.changes.find((c) => c.prop === 'richText')?.newValue ?? newHtml;
            this.store.update(after.id, { changes: after.changes });
          },
          revert: () => {
            const t = resolveEl();
            if (t) t.innerHTML = before.changes.find((c) => c.prop === 'richText')?.oldValue ?? oldHtml;
            this.store.update(before.id, { changes: before.changes });
          },
        });
      }
    } else {
      const rect = el.getBoundingClientRect();
      const added = this.store.add({
        selector,
        elementType: classifyElement(el),
        summary: getElementSummary(el),
        note: '',
        changes: [change],
        viewportPos: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        },
      });
      this.history.push({
        label: 'richtext:add',
        apply: () => {
          const t = resolveEl();
          if (t) t.innerHTML = newHtml;
          this.store.restore(added);
        },
        revert: () => {
          const t = resolveEl();
          if (t) t.innerHTML = oldHtml;
          this.store.remove(added.id);
        },
      });
    }
  }
}
