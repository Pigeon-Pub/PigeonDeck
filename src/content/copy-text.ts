/* ============================================================
   copy-text.ts — 复制文本 UI 接线（阶段 8b）
   蓝图 §7.1：点「复制文本」→ 生成任务清单 → 弹结果窗（可编辑预览 +
   语言快切 + 下载 .md + 复制）。F9：不再自动写剪贴板，复制/下载由用户
   在面板内选择。格式化管线全在 format.ts（纯函数），本模块只负责取数据/
   构造上下文/剪贴板/DOM 弹窗/语言快切。
   视觉照搬 preview/parts/37-output-text.html（.opanel/.obody/.ofoot）。
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore } from '../state/annotations';
import { Settings } from '../state/settings';
import { Toast } from './toast';
import { getLocale, t } from './i18n';
import { buildOperations, renderTaskList, PageContext } from './format';
import { PopoverHandle } from './popover';
import { openDropdown } from './dropdown';
import { makeDraggableByHandle } from './floating-drag';

/** 结果弹窗宽度（part 37 .opanel） */
const PANEL_WIDTH = 452;
const EDGE_MARGIN = 12;

/** 渲染语言（仅 en / zh_CN 有模板，其余回退 en） */
type ExportLang = 'en' | 'zh_CN';

/** 语言图标（part 37 .langpick 内联 SVG） */
const ICON_LANG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`;

/** 'YYYY-MM-DD HH:mm' 本地时间戳 */
function formatTimestamp(d = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** settings.exportLang → 实际渲染语言（'auto' 取界面 locale；仅 zh_CN 有中文模板，其余回退 en） */
function resolveLang(setting: Settings['exportLang']): ExportLang {
  const code = setting === 'auto' ? getLocale() : setting;
  return code === 'zh_CN' ? 'zh_CN' : 'en';
}

export class CopyTextManager {
  private controller: Controller;
  private store: AnnotationStore;
  private settings: Settings;
  private toast: Toast;
  private root: HTMLElement; // panel 层

  // 当前结果弹窗（一次一个）
  private panelEl: HTMLElement | null = null;
  private bodyEl: HTMLElement | null = null;
  private currentText = '';
  /** 导出语言选择（'en' | 'auto' | 旧存值）；resolveLang 归一为渲染语言 */
  private currentChoice: string = 'en';
  private currentLang: ExportLang = 'en';
  private langPopover: PopoverHandle | null = null;
  private outsideHandler: ((ev: MouseEvent) => void) | null = null;
  private keyHandler: ((ev: KeyboardEvent) => void) | null = null;

  constructor(opts: {
    controller: Controller;
    store: AnnotationStore;
    settings: Settings;
    toast: Toast;
    panelLayer: HTMLElement;
  }) {
    this.controller = opts.controller;
    this.store = opts.store;
    this.settings = opts.settings;
    this.toast = opts.toast;
    this.root = opts.panelLayer;

    // 合并进已有回调（onUndo/onRedo 已在 main.ts 注册，setCallbacks 是合并语义）
    this.controller.setCallbacks({ onCopyText: () => this.run() });
  }

  /** 点「复制文本」瞬时动作：只生成并弹面板，复制/下载由用户在面板内选择（F9） */
  private run(): void {
    const ops = buildOperations(this.store.getAll());
    if (ops.length === 0) {
      // 无内容：轻提示，不弹空窗
      this.toast.show(t('toast_copy_empty'));
      return;
    }

    this.currentChoice = this.settings.exportLang;
    this.currentLang = resolveLang(this.currentChoice);
    const ctx: PageContext = {
      url: location.href,
      title: document.title,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      timestamp: formatTimestamp(),
    };
    this.currentText = renderTaskList(ops, ctx, this.currentLang);

    this.openPanel();
  }

  /** 写剪贴板（手势内同步触发，成功/失败均轻提示） */
  private writeClipboard(text: string): void {
    navigator.clipboard.writeText(text).then(
      () => this.toast.show(t('toast_copy_ok'), 'ok'),
      () => this.toast.show(t('toast_copy_failed'))
    );
  }

  // ---- 结果弹窗 ----

  /** 供工具盘拖拽时关闭结果弹窗（INVARIANT 3）。幂等（未开时 closePanel 直接返回）。 */
  close(): void {
    this.closePanel();
  }

  private openPanel(): void {
    this.closePanel();

    const panel = document.createElement('div');
    panel.className = 'pd-surface opanel';
    panel.setAttribute('data-testid', 'pd-output');
    panel.setAttribute('data-pd-popover', '');
    panel.style.position = 'absolute';
    panel.style.width = `${PANEL_WIDTH}px`;

    // 顶栏：标题 + 关闭 X（照设置面板 .shead）
    const head = document.createElement('div');
    head.className = 'shead';
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = t('tb_copy_text');
    head.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'pd-iconbtn';
    closeBtn.setAttribute('data-testid', 'pd-output-close');
    closeBtn.setAttribute('aria-label', t('panel_cancel'));
    closeBtn.title = t('panel_cancel');
    closeBtn.innerHTML = ICON_CLOSE;
    closeBtn.addEventListener('click', () => this.closePanel());
    head.appendChild(closeBtn);
    panel.appendChild(head);

    // 正文：可编辑 + 可滚动文本预览（F25：复制/下载前就地微调，关闭不保留）
    const body = document.createElement('pre');
    body.className = 'obody pd-scroll';
    body.setAttribute('data-testid', 'pd-output-body');
    body.contentEditable = 'true';
    body.spellcheck = false;
    body.textContent = this.currentText;
    panel.appendChild(body);
    this.bodyEl = body;

    // 底栏：左语言快切 + 右（下载 + 复制）
    const foot = document.createElement('div');
    foot.className = 'ofoot';

    const langBtn = document.createElement('button');
    langBtn.className = 'langpick';
    langBtn.setAttribute('data-testid', 'pd-output-lang');
    langBtn.title = t('output_lang_title');
    langBtn.innerHTML = ICON_LANG;
    const langCur = document.createElement('span');
    langCur.className = 'cur';
    langCur.textContent = this.choiceLabel(this.currentChoice);
    langBtn.appendChild(langCur);
    langBtn.insertAdjacentHTML('beforeend', `<span class="cd">${ICON_CHEVRON}</span>`);
    langBtn.addEventListener('click', () => this.toggleLangMenu(langBtn, langCur, body));
    foot.appendChild(langBtn);

    const acts = document.createElement('span');
    acts.className = 'acts';

    const btnDownload = document.createElement('button');
    btnDownload.className = 'pd-iconbtn';
    btnDownload.setAttribute('data-testid', 'pd-output-download');
    btnDownload.title = t('output_download');
    btnDownload.setAttribute('aria-label', t('output_download'));
    btnDownload.innerHTML = ICON_DOWNLOAD;
    btnDownload.addEventListener('click', () => this.download());
    acts.appendChild(btnDownload);

    const btnCopy = document.createElement('button');
    btnCopy.className = 'pd-btn primary';
    btnCopy.setAttribute('data-testid', 'pd-output-copy');
    btnCopy.innerHTML = ICON_COPY;
    btnCopy.appendChild(document.createTextNode(t('output_copy')));
    btnCopy.addEventListener('click', () => this.writeClipboard(this.liveText()));
    acts.appendChild(btnCopy);

    foot.appendChild(acts);
    panel.appendChild(foot);

    this.root.appendChild(panel);
    this.panelEl = panel;

    this.positionPanel();
    // 顶栏可拖动整面板（X 按钮/输入类子元素由 makeDraggableByHandle 忽略）
    makeDraggableByHandle(panel, head);
    this.bindDismiss();
  }

  /** 当前预览区实时文本（F25：读用户就地编辑后的值，回退渲染值） */
  private liveText(): string {
    return this.bodyEl?.textContent ?? this.currentText;
  }

  /** 居中放置，视口夹紧 */
  private positionPanel(): void {
    if (!this.panelEl) return;
    const w = this.panelEl.offsetWidth;
    const h = this.panelEl.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const left = Math.max(EDGE_MARGIN, Math.min((vw - w) / 2, vw - w - EDGE_MARGIN));
    const top = Math.max(EDGE_MARGIN, Math.min((vh - h) / 2, vh - h - EDGE_MARGIN));
    this.panelEl.style.left = `${left}px`;
    this.panelEl.style.top = `${top}px`;
  }

  /** 点外部 / Esc 关闭（浮层内点击放行，镜像 panel.ts 逻辑） */
  private bindDismiss(): void {
    this.outsideHandler = (ev: MouseEvent): void => {
      if (!this.panelEl) return;
      const path = ev.composedPath();
      if (path.includes(this.panelEl)) return;
      // 语言浮层等 data-pd-popover 内点击不算外部
      const inPopover = path.some(
        (n) => n instanceof HTMLElement && n !== this.panelEl && n.hasAttribute('data-pd-popover')
      );
      if (inPopover) return;
      this.closePanel();
    };
    this.keyHandler = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        this.closePanel();
        return;
      }
      // INVARIANT 4：Ctrl/Cmd+Enter = 提交（可编辑预览的「提交」= 复制到剪贴板，与编辑面板统一）
      if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        this.writeClipboard(this.liveText());
      }
    };
    window.addEventListener('mousedown', this.outsideHandler, true);
    window.addEventListener('keydown', this.keyHandler, true);
  }

  private closePanel(): void {
    this.langPopover?.close();
    this.langPopover = null;
    if (this.outsideHandler) {
      window.removeEventListener('mousedown', this.outsideHandler, true);
      this.outsideHandler = null;
    }
    if (this.keyHandler) {
      window.removeEventListener('keydown', this.keyHandler, true);
      this.keyHandler = null;
    }
    if (this.panelEl) {
      this.panelEl.remove();
      this.panelEl = null;
    }
    this.bodyEl = null;
  }

  // ---- 语言快切（F11：紧凑 2 项下拉，英文 / 跟随界面） ----

  /** 导出语言选择 code → 展示名（照 settings-panel.exportLangLabel） */
  private choiceLabel(choice: string): string {
    if (choice === 'auto') return t('opt_export_auto');
    if (choice === 'en') return t('opt_export_en');
    if (choice === 'zh_CN') return t('opt_export_zh');
    return choice;
  }

  /** 点 langpick → 弹紧凑 2 项下拉（en / auto），选中即重渲正文（不改 settings） */
  private toggleLangMenu(anchor: HTMLElement, curLabel: HTMLElement, body: HTMLElement): void {
    if (this.langPopover) {
      this.langPopover.close();
      this.langPopover = null;
      return;
    }
    this.langPopover = openDropdown({
      root: this.root,
      anchor,
      plain: true,
      current: this.currentChoice,
      items: [
        { value: 'en', label: t('opt_export_en') },
        { value: 'auto', label: t('opt_export_auto') },
      ],
      onPick: (choice) => this.setChoice(choice, curLabel, body),
      onClose: () => {
        this.langPopover = null;
      },
    });
  }

  /** 切换导出语言选择（局部状态，不写 settings）→ 归一渲染语言、重渲正文 */
  private setChoice(choice: string, curLabel: HTMLElement, body: HTMLElement): void {
    this.currentChoice = choice;
    this.currentLang = resolveLang(choice);
    const ops = buildOperations(this.store.getAll());
    const ctx: PageContext = {
      url: location.href,
      title: document.title,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      timestamp: formatTimestamp(),
    };
    this.currentText = renderTaskList(ops, ctx, this.currentLang);
    body.textContent = this.currentText;
    curLabel.textContent = this.choiceLabel(choice);
  }

  // ---- 下载 ----

  private download(): void {
    const blob = new Blob([this.liveText()], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pigeondeck-tasks.md';
    a.click();
    URL.revokeObjectURL(url);
  }
}
