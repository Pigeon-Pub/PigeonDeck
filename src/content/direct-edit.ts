/* ============================================================
   direct-edit.ts — 直接编辑文本 + 图片/视频替换（阶段 4a/4b · F21 重写）
   双击文本元素 → contentEditable 内联编辑 + 富文本浮条。
   双击图片/视频 → 替换弹层（本地文件 / URL）。
   单击延迟协议：text/image/video 单击延迟 250ms（PanelManager.cancelPendingOpen 抢占）。
   触发 dblclick 时抢占待定 open，进入编辑/替换。
   F21 提交/退出模型：进入编辑后，**除**点保存对勾或按 Ctrl/Cmd+Enter（提交）、
   或按 Esc（丢弃）外，任何操作都不退出编辑——不再有 blur 自动提交、点外部自动提交、
   双击另一元素自动提交（编辑中双击一律忽略）。
   提交：从富文本浮条读结构化 RichTextChange[] + 纯文本变化 → 并入标注 richText[]/changes[]
   + DOM 还原载体（本会话 innerHTML/text-align 快照）→ 撤销历史（单步还原到本会话进入前）。
   替换执行：记 replaceMedia StyleChange（cssProp='src'）→ 撤销历史。
   ============================================================ */

import { Controller } from './controller';
import {
  AnnotationStore,
  mergeChanges,
  mergeRichText,
  StyleChange,
  RichTextDomSnapshot,
  RICHTEXT_DOM_CSSPROP,
} from '../state/annotations';
import { History } from '../state/history';
import { Overlay } from './overlay';
import { Settings } from '../state/settings';
import type { PanelManager } from './panel';
import { applyChangesTo } from './change-apply';
import { RichTextBar } from './inline-richtext';
import { openReplaceMedia } from './replace-media';
import { buildSelector, classifyElement, getElementSummary } from '../shared/dom-utils';

/** 富文本 DOM 还原快照序列化（editEl innerHTML + 自身 text-align） */
function serializeSnap(html: string, textAlign: string): string {
  const snap: RichTextDomSnapshot = { html, textAlign };
  return JSON.stringify(snap);
}

/** HTML 片段 → 归一化纯文本（判定纯文本内容是否变化，供导出 Content 行） */
function htmlToPlainText(html: string): string {
  const div = document.createElement('div');
  div.innerHTML = html;
  return (div.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** 进入编辑时临时写在 editEl 内联样式上的「编辑态观感 + 最小重置」属性（退出精确还原，绝不整段抹写） */
const CHROME_PROPS = [
  'outline',
  'outline-offset',
  'border-radius',
  'user-select',
  '-webkit-user-modify',
  'cursor',
  'pointer-events',
  'white-space',
] as const;

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
  /** 编辑前 editEl 自身内联 text-align（'' = 无）——对齐落此，退出/还原需要 */
  private enterTextAlign: string = '';
  /**
   * 编辑态临时 chrome 属性的原始内联值（value+priority），退出时逐条精确还原
   * （仅动这几条，绝不整段快照/抹写 style 属性——那会连带抹掉用户在编辑期间
   * 施加的 text-align/字号等真实修改，正是 F21 要修的老 bug）。
   */
  private chromeOrig: Array<{ prop: string; value: string; priority: string }> = [];
  /** 当前富文本浮条实例 */
  private rtBar: RichTextBar | null = null;
  /** 当前替换弹层句柄 */
  private replaceHandle: { close: () => void } | null = null;
  /** Shadow 宿主（isOwnUi 判断） */
  private shadowHost: Element;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    history: History;
    overlay: Overlay;
    panelLayer: HTMLElement;
    settings: Settings;
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
    this.replaceHandle?.close();
    this.replaceHandle = null;
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

    // F21：编辑进行中——任何双击都忽略（唯一退出=保存对勾/Ctrl+Enter/Esc）
    if (this.editEl) {
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }

    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (target === document.documentElement || target === document.body) return;

    const type = classifyElement(target);

    // 图片/视频 → 替换弹层（不进 contentEditable）
    if (type === 'image' || type === 'video') {
      ev.preventDefault();
      ev.stopPropagation();
      this.panel.cancelPendingOpen();
      this.openReplace(target, type);
      return;
    }

    // 只处理 text 类型
    if (type !== 'text') return;

    // 阻止默认行为（选词）+ 抢占单击延迟
    ev.preventDefault();
    ev.stopPropagation();
    this.panel.cancelPendingOpen();

    this.enterEdit(target);
  };

  private onKeyDown = (ev: KeyboardEvent): void => {
    if (!this.editEl) return;
    if (ev.key === 'Escape') {
      ev.preventDefault();
      ev.stopPropagation();
      this.exitEdit(false); // Esc = 丢弃，还原进入前状态、不记录
      return;
    }
    // F21：Ctrl/Cmd+Enter = 提交（与保存对勾等价；普通 Enter 仍在块内换行）
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      ev.stopPropagation();
      this.exitEdit(true);
    }
  };

  private enterEdit(el: HTMLElement): void {
    this.snapshot = el.innerHTML;
    // 进入前 editEl 自身内联 text-align（对齐会写这里；退出/还原以此为基准）
    this.enterTextAlign = el.style.textAlign;
    this.applyEditingStyles(el);
    el.contentEditable = 'true';
    el.dataset['pdEditing'] = '';
    el.focus();
    this.editEl = el;
    this.panel.setInlineEditActive(el);

    // 编辑态内屏蔽 <a> 跳转（框选/点击链接文本只落光标，不导航）
    el.addEventListener('click', this.onEditAnchorNav, true);
    el.addEventListener('auxclick', this.onEditAnchorNav, true);

    // 富文本浮条（保存对勾 → 提交）
    this.rtBar = new RichTextBar({
      panelLayer: this.panelLayer,
      editEl: el,
      onCommit: () => this.exitEdit(true),
    });
  }

  /**
   * 编辑元素在 light DOM，base.css（仅注入 shadow）里的 [data-pd-editing]
   * 金边规则对它无效；且元素会继承宿主任意 CSS（user-select:none、
   * -webkit-user-modify、pointer-events:none 等），导致无法编辑或样式错乱。
   * 这里用内联样式（多数场景可压过宿主规则，必要处加 !important）打上编辑态
   * 观感 + 最小重置。金色取 --c1 令牌具体值（light DOM 无法解析 var()）。
   * 施加前逐条记录原始内联值，退出时精确还原（F21：绝不整段快照/抹写 style）。
   */
  private applyEditingStyles(el: HTMLElement): void {
    const s = el.style;
    this.chromeOrig = CHROME_PROPS.map((p) => ({
      prop: p,
      value: s.getPropertyValue(p),
      priority: s.getPropertyPriority(p),
    }));
    // 金边观感（照 [data-pd-editing]：1.5px 实线 + 偏移 + 小圆角）
    s.setProperty('outline', '1.5px solid #b8842c', 'important');
    s.setProperty('outline-offset', '3px', 'important');
    s.setProperty('border-radius', '4px');
    // 最小重置：确保可选中/可编辑/可点/不被裁剪
    s.setProperty('user-select', 'text', 'important');
    s.setProperty('-webkit-user-modify', 'read-write', 'important');
    s.setProperty('cursor', 'text', 'important');
    s.setProperty('pointer-events', 'auto', 'important');
    s.setProperty('white-space', 'normal');
  }

  /**
   * 退出编辑：逐条精确还原编辑态 chrome 属性到进入前的内联值
   * （有原值 → 还原；原本没有 → removeProperty），
   * 用户在编辑期间对 text-align/字号等的真实修改一律不动（不在此列表中）。
   */
  private restoreEditingStyles(el: HTMLElement): void {
    const s = el.style;
    for (const { prop, value, priority } of this.chromeOrig) {
      if (value) s.setProperty(prop, value, priority);
      else s.removeProperty(prop);
    }
    this.chromeOrig = [];
  }

  /** 编辑态内点/中键点链接：阻止导航（不 stopPropagation，保住光标定位） */
  private onEditAnchorNav = (ev: MouseEvent): void => {
    if (!this.editEl) return;
    const inAnchor = ev
      .composedPath()
      .some((n) => n instanceof HTMLElement && n.tagName === 'A');
    if (inAnchor) ev.preventDefault();
  };

  /**
   * 提交（commit=true，保存对勾/Ctrl+Enter）或丢弃（commit=false，Esc）内联编辑。
   * 提交：从浮条读结构化 richText[] + 纯文本变化 → 并入标注 + DOM 还原载体 + 撤销历史。
   */
  private exitEdit(commit: boolean): void {
    const el = this.editEl;
    if (!el) return;

    // 清理事件
    el.removeEventListener('click', this.onEditAnchorNav, true);
    el.removeEventListener('auxclick', this.onEditAnchorNav, true);

    // 提交前读浮条结构化修改（销毁前）
    const richText = this.rtBar?.getChanges() ?? [];
    this.rtBar?.destroy();
    this.rtBar = null;

    // 退出编辑态（先清 contentEditable/金边，再取“干净”提交快照）
    el.contentEditable = 'inherit';
    delete el.dataset['pdEditing'];
    this.restoreEditingStyles(el);
    this.editEl = null;
    this.panel.setInlineEditActive(null);

    const enterHtml = this.snapshot;
    const enterAlign = this.enterTextAlign;

    if (!commit) {
      // Esc：丢弃——还原 innerHTML + 自身 text-align 到进入前
      el.innerHTML = enterHtml;
      el.style.textAlign = enterAlign;
      return;
    }

    const commitHtml = el.innerHTML;
    const commitAlign = el.style.textAlign;

    // 纯文本内容变化（供导出 Content 行 + 卡片文本内容行）
    const textOld = htmlToPlainText(enterHtml);
    const textNew = htmlToPlainText(commitHtml);
    const textChanged = textOld !== textNew;

    // 无实质修改（无格式修改、无文本变化）→ 不落盘（net-zero 格式如加粗又取消也走这里）
    if (richText.length === 0 && !textChanged) return;

    // DOM 还原载体（本会话 enter/commit 快照；撤销/删除/清空复用 applyChangesTo）
    const carrier: StyleChange = {
      prop: 'richtext',
      cssProp: RICHTEXT_DOM_CSSPROP,
      oldValue: serializeSnap(enterHtml, enterAlign),
      newValue: serializeSnap(commitHtml, commitAlign),
    };
    const sessionChanges: StyleChange[] = [];
    if (textChanged) {
      sessionChanges.push({ prop: 'text', cssProp: 'text', oldValue: textOld, newValue: textNew });
    }
    sessionChanges.push(carrier);

    const selector = buildSelector(el);
    const existing = this.store.getBySelector(selector);

    const resolveEl = (): HTMLElement | null => {
      try {
        const matches = document.querySelectorAll(selector);
        return matches.length === 1 && matches[0] instanceof HTMLElement ? matches[0] : null;
      } catch {
        return null;
      }
    };

    if (existing) {
      // 并入已有标注：changes 按 prop 合并（保留最初 old、取最新 new），richText 结构化归并。
      const before = existing;
      const mergedChanges = mergeChanges(before.changes, sessionChanges);
      const mergedRich = mergeRichText(before.richText ?? [], richText);
      const saved = this.store.update(before.id, { changes: mergedChanges, richText: mergedRich });
      if (saved) {
        const after = saved;
        this.history.push({
          label: 'richtext:update',
          // 撤销粒度：DOM 用**本会话** enter/commit 快照（[carrier]），单次撤销回到本会话进入前，
          // store 恢复 before/after 整条标注 —— DOM 与 store 一致。
          apply: () => {
            applyChangesTo(resolveEl(), [carrier], 'new');
            this.store.update(after.id, { changes: after.changes, richText: after.richText });
          },
          revert: () => {
            applyChangesTo(resolveEl(), [carrier], 'old');
            this.store.update(before.id, { changes: before.changes, richText: before.richText });
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
        changes: sessionChanges,
        richText,
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
          applyChangesTo(resolveEl(), [carrier], 'new');
          this.store.restore(added);
        },
        revert: () => {
          applyChangesTo(resolveEl(), [carrier], 'old');
          this.store.remove(added.id);
        },
      });
    }
  }

  // ---- 图片/视频替换（阶段 4b） ----

  /** 打开替换弹层，选定新 src 后走 applyReplace */
  private openReplace(el: HTMLElement, kind: 'image' | 'video'): void {
    this.replaceHandle?.close();
    this.replaceHandle = openReplaceMedia({
      root: this.panelLayer,
      anchor: el,
      kind,
      onReplace: (newSrc) => {
        this.replaceHandle = null;
        this.applyReplace(el, newSrc);
      },
    });
  }

  /** 执行替换：即时预览 + 记 replaceMedia StyleChange + 撤销历史 */
  private applyReplace(el: HTMLElement, newSrc: string): void {
    const oldSrc = el.getAttribute('src') ?? '';
    if (newSrc === oldSrc) return;

    // 即时预览
    el.setAttribute('src', newSrc);

    const selector = buildSelector(el);
    const existing = this.store.getBySelector(selector);
    const change: StyleChange = {
      prop: 'replaceMedia',
      cssProp: 'src',
      oldValue: oldSrc,
      newValue: newSrc,
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
      const merged = mergeChanges(existing.changes, [change]);
      const savedAnnotation = this.store.update(existing.id, { changes: merged });
      if (savedAnnotation) {
        const after = savedAnnotation;
        const before = existing;
        this.history.push({
          label: 'replace:update',
          apply: () => {
            const node = resolveEl();
            if (node) node.setAttribute('src', after.changes.find((c) => c.prop === 'replaceMedia')?.newValue ?? newSrc);
            this.store.update(after.id, { changes: after.changes });
          },
          revert: () => {
            const node = resolveEl();
            if (node) node.setAttribute('src', before.changes.find((c) => c.prop === 'replaceMedia')?.oldValue ?? oldSrc);
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
        label: 'replace:add',
        apply: () => {
          const node = resolveEl();
          if (node) node.setAttribute('src', newSrc);
          this.store.restore(added);
        },
        revert: () => {
          const node = resolveEl();
          if (node) node.setAttribute('src', oldSrc);
          this.store.remove(added.id);
        },
      });
    }
  }
}
