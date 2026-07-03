/* ============================================================
   copy-text.ts — 复制文本 UI 接线（阶段 8b）
   蓝图 §7.1：点「复制文本」→ 生成任务清单 → 立即写剪贴板 + 轻提示
   → 弹结果窗（可滚动预览 + 语言快切 + 下载 .md + 再复制）。
   格式化管线全在 format.ts（纯函数），本模块只负责取数据/构造上下文/
   剪贴板/DOM 弹窗/语言快切。
   视觉照搬 preview/parts/37-output-text.html（.opanel/.obody/.ofoot）。
   ============================================================ */

import { Controller } from './controller';
import { AnnotationStore } from '../state/annotations';
import { Settings } from '../state/settings';
import { Toast } from './toast';
import { getLocale, t } from './i18n';
import { buildOperations, renderTaskList, PageContext } from './format';
import { mountPopover, PopoverHandle } from './popover';

/** 结果弹窗宽度（part 37 .opanel） */
const PANEL_WIDTH = 452;
const EDGE_MARGIN = 12;

/** 语言快切候选（本阶段仅 en / zh_CN；完整搜索器在阶段 11） */
type ExportLang = 'en' | 'zh_CN';
const LANG_OPTIONS: ReadonlyArray<{ code: ExportLang; name: string }> = [
  { code: 'en', name: 'English' },
  { code: 'zh_CN', name: '简体中文' },
];

/** 语言图标（part 37 .langpick 内联 SVG） */
const ICON_LANG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>`;
const ICON_CHEVRON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;
const ICON_DOWNLOAD = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/></svg>`;
const ICON_COPY = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
const ICON_CHECK = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

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
  private currentText = '';
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

  /** 点「复制文本」瞬时动作 */
  private run(): void {
    const ops = buildOperations(this.store.getAll());
    if (ops.length === 0) {
      // 无内容：轻提示，不弹空窗
      this.toast.show(t('toast_copy_empty'));
      return;
    }

    this.currentLang = resolveLang(this.settings.exportLang);
    const ctx: PageContext = {
      url: location.href,
      title: document.title,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      timestamp: formatTimestamp(),
    };
    this.currentText = renderTaskList(ops, ctx, this.currentLang);

    // 剪贴板：在点击手势内同步调用（不 await 到手势外）
    this.writeClipboard(this.currentText);

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

  private openPanel(): void {
    this.closePanel();

    const panel = document.createElement('div');
    panel.className = 'pd-surface opanel';
    panel.setAttribute('data-testid', 'pd-output');
    panel.setAttribute('data-pd-popover', '');
    panel.style.position = 'absolute';
    panel.style.width = `${PANEL_WIDTH}px`;

    // 正文：可滚动文本预览
    const body = document.createElement('pre');
    body.className = 'obody pd-scroll';
    body.setAttribute('data-testid', 'pd-output-body');
    body.textContent = this.currentText;
    panel.appendChild(body);

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
    langCur.textContent = this.langName(this.currentLang);
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
    btnCopy.addEventListener('click', () => this.writeClipboard(this.currentText));
    acts.appendChild(btnCopy);

    foot.appendChild(acts);
    panel.appendChild(foot);

    this.root.appendChild(panel);
    this.panelEl = panel;

    this.positionPanel();
    this.bindDismiss();
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
  }

  // ---- 语言快切 ----

  private langName(code: ExportLang): string {
    return LANG_OPTIONS.find((o) => o.code === code)?.name ?? code;
  }

  /** 点 langpick → 弹语言浮层（en / zh_CN），选中即重渲正文（不改 settings） */
  private toggleLangMenu(anchor: HTMLElement, curLabel: HTMLElement, body: HTMLElement): void {
    if (this.langPopover) {
      this.langPopover.close();
      this.langPopover = null;
      return;
    }

    const dd = document.createElement('div');
    dd.className = 'pd-surface langdd';
    dd.setAttribute('data-testid', 'pd-output-langdd');

    for (const opt of LANG_OPTIONS) {
      const item = document.createElement('button');
      item.className = 'langopt' + (opt.code === this.currentLang ? ' on' : '');
      item.setAttribute('data-testid', `pd-output-lang-${opt.code}`);
      const iso = document.createElement('span');
      iso.className = 'iso';
      iso.textContent = opt.code === 'zh_CN' ? 'zh' : 'en';
      item.appendChild(iso);
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = opt.name;
      item.appendChild(nm);
      if (opt.code === this.currentLang) {
        item.insertAdjacentHTML('beforeend', `<span class="chk">${ICON_CHECK}</span>`);
      }
      item.addEventListener('click', () => {
        this.setLang(opt.code, curLabel, body);
        this.langPopover?.close();
        this.langPopover = null;
      });
      dd.appendChild(item);
    }

    this.langPopover = mountPopover(this.root, dd, anchor, () => {
      this.langPopover = null;
    });
  }

  /** 切换渲染语言（局部状态，不写 settings）→ 用新语言重渲正文并同步剪贴板 */
  private setLang(lang: ExportLang, curLabel: HTMLElement, body: HTMLElement): void {
    if (lang === this.currentLang) return;
    this.currentLang = lang;
    const ops = buildOperations(this.store.getAll());
    const ctx: PageContext = {
      url: location.href,
      title: document.title,
      viewportW: window.innerWidth,
      viewportH: window.innerHeight,
      timestamp: formatTimestamp(),
    };
    this.currentText = renderTaskList(ops, ctx, lang);
    body.textContent = this.currentText;
    curLabel.textContent = this.langName(lang);
  }

  // ---- 下载 ----

  private download(): void {
    const blob = new Blob([this.currentText], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'pigeondeck-tasks.md';
    a.click();
    URL.revokeObjectURL(url);
  }
}
