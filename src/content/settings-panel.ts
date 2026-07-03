/* ============================================================
   settings-panel.ts — SettingsManager（阶段 11a）
   蓝图 §9：设置面板骨架（4 分区导航）+ 非语言控件 + 接线。
   展开且 mode==='settings' → 贴工具盘侧边弹出大面板；点外部/关闭/切模式/Esc 关闭。
   视觉照搬 preview/parts/13/17/18/19 + pigeonlib.css。
   语言选择器（界面语言/导出语言）本阶段仅显示当前值，搜索式选择器留阶段 11b。
   ============================================================ */

import { Controller } from './controller';
import { Settings, saveSettings, clampNumber } from '../state/settings';
import { Overlay } from './overlay';
import { History } from '../state/history';
import { SelectionResolver } from './selection';
import { Toast } from './toast';
import { setTheme } from './main';
import { t, getLocale, setLocale } from './i18n';
import { openLanguagePicker } from './language-picker';
import { BCP47_LANGUAGES } from '../shared/languages';

/** 扩展版本号（about 区展示；manifest 为发布号，V1 展示固定 1.0.0） */
const VERSION = '1.0.0';

const svg = (inner: string, sw = 1.6): string =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

/* ---- 内联 Lucide 图标（逐值照搬 preview） ---- */
const IC = {
  close: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  navGeneral:
    '<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
  navInteraction: '<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/>',
  navOutput:
    '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
  navHelp:
    '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  clipboard:
    '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
  download:
    '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
  plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
  minus: '<path d="M5 12h14"/>',
} as const;

const BALL_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4.6 15.2Q10 9.2 17 10.1Q12.8 14.2 7.4 16.1Q5.7 16.6 4.6 15.2ZM9 12.6Q12 5.9 18.8 5Q16.4 9.8 12.4 11.7Q10.5 12.7 9 12.6ZM16.7 10L20.4 8.9 17.2 11.4Z"/></svg>';

type Section = 'general' | 'interaction' | 'output' | 'help';

export interface SettingsManagerOptions {
  controller: Controller;
  settings: Settings;
  panelLayer: HTMLElement;
  controlLayer: HTMLElement;
  overlay: Overlay;
  history: History;
  resolver: SelectionResolver;
  toast: Toast;
  onResetPosition: () => void;
  onOpenOnboarding: () => void;
}

export class SettingsManager {
  private controller: Controller;
  private settings: Settings;
  private panelLayer: HTMLElement;
  private controlLayer: HTMLElement;
  private overlay: Overlay;
  private history: History;
  private resolver: SelectionResolver;
  private toast: Toast;
  private onResetPosition: () => void;
  private onOpenOnboarding: () => void;
  private shadowHost: Element;

  private panelEl: HTMLElement | null = null;
  private sconEl: HTMLElement | null = null;
  private section: Section = 'general';
  private navButtons: Record<Section, HTMLButtonElement> | null = null;
  private unsubscribe: () => void;

  constructor(opts: SettingsManagerOptions) {
    this.controller = opts.controller;
    this.settings = opts.settings;
    this.panelLayer = opts.panelLayer;
    this.controlLayer = opts.controlLayer;
    this.overlay = opts.overlay;
    this.history = opts.history;
    this.resolver = opts.resolver;
    this.toast = opts.toast;
    this.onResetPosition = opts.onResetPosition;
    this.onOpenOnboarding = opts.onOpenOnboarding;
    this.shadowHost = (opts.panelLayer.getRootNode() as ShadowRoot).host;

    this.unsubscribe = this.controller.subscribe(() => this.sync());
    this.sync();
  }

  destroy(): void {
    this.unsubscribe();
    this.close();
  }

  /** 模式同步：展开且 settings 模式 → 打开；否则关闭 */
  private sync(): void {
    const { expanded, mode } = this.controller.getState();
    if (expanded && mode === 'settings') {
      if (!this.panelEl) this.open();
    } else {
      this.close();
    }
  }

  // ---- 打开 / 关闭 ----

  private open(): void {
    const surface = document.createElement('div');
    surface.className = 'pd-surface spanel';
    surface.setAttribute('data-testid', 'pd-settings');
    surface.setAttribute('data-pd-popover', '');
    surface.style.position = 'absolute';
    surface.style.width = '340px';

    // 头部
    const head = document.createElement('div');
    head.className = 'shead';
    const title = document.createElement('span');
    title.className = 't';
    title.textContent = t('settings_title');
    head.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'pd-iconbtn';
    closeBtn.setAttribute('data-testid', 'pd-settings-close');
    closeBtn.setAttribute('aria-label', t('settings_close'));
    closeBtn.title = t('settings_close');
    closeBtn.innerHTML = svg(IC.close);
    closeBtn.addEventListener('click', () => this.controller.toggleMode('settings'));
    head.appendChild(closeBtn);
    surface.appendChild(head);

    // 主体：左导航 + 右内容
    const body = document.createElement('div');
    body.className = 'sbody';

    const nav = document.createElement('div');
    nav.className = 'pd-nav';
    const navDefs: Array<[Section, string, string]> = [
      ['general', IC.navGeneral, t('set_nav_general')],
      ['interaction', IC.navInteraction, t('set_nav_interaction')],
      ['output', IC.navOutput, t('set_nav_output')],
      ['help', IC.navHelp, t('set_nav_help')],
    ];
    const navButtons = {} as Record<Section, HTMLButtonElement>;
    for (const [key, icon, label] of navDefs) {
      const btn = document.createElement('button');
      btn.setAttribute('data-testid', `pd-set-nav-${key}`);
      btn.innerHTML = `<span class="ic">${svg(icon)}</span>${label}`;
      btn.addEventListener('click', () => this.switchSection(key));
      nav.appendChild(btn);
      navButtons[key] = btn;
    }
    this.navButtons = navButtons;
    body.appendChild(nav);

    const scon = document.createElement('div');
    scon.className = 'scon pd-scroll';
    body.appendChild(scon);
    this.sconEl = scon;

    surface.appendChild(body);
    this.panelLayer.appendChild(surface);
    this.panelEl = surface;

    this.renderSection();
    this.positionBeside(surface);

    window.addEventListener('mousedown', this.onOutside, true);
  }

  private close(): void {
    if (!this.panelEl) return;
    window.removeEventListener('mousedown', this.onOutside, true);
    this.panelEl.remove();
    this.panelEl = null;
    this.sconEl = null;
    this.navButtons = null;
  }

  /** 点面板/自身 UI 之外 → 退出设置模式（回 annotate，sync 关闭面板） */
  private onOutside = (ev: MouseEvent): void => {
    const path = ev.composedPath();
    if (path.includes(this.panelEl as EventTarget) || path.includes(this.shadowHost as EventTarget)) {
      return;
    }
    this.controller.toggleMode('settings');
  };

  /** 贴设置按钮侧边定位（左优先，放不下改右），顶部对齐并夹紧视口 */
  private positionBeside(surface: HTMLElement): void {
    const anchor = this.controlLayer.querySelector<HTMLElement>('[data-testid="pd-btn-settings"]');
    const GAP = 10;
    const EDGE = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = surface.offsetWidth;
    const h = surface.offsetHeight;

    if (!anchor) {
      surface.style.left = `${Math.max(EDGE, vw - w - EDGE)}px`;
      surface.style.top = `${EDGE}px`;
      return;
    }
    const rect = anchor.getBoundingClientRect();
    let left = rect.left - GAP - w;
    if (left < EDGE) {
      const right = rect.right + GAP;
      left = right + w <= vw - EDGE ? right : Math.max(EDGE, vw - w - EDGE);
    }
    let top = rect.top;
    top = Math.max(EDGE, Math.min(top, vh - h - EDGE));
    surface.style.left = `${left}px`;
    surface.style.top = `${top}px`;
  }

  // ---- 分区切换 ----

  private switchSection(section: Section): void {
    this.section = section;
    this.renderSection();
  }

  private renderSection(): void {
    if (!this.sconEl || !this.navButtons) return;
    for (const key of Object.keys(this.navButtons) as Section[]) {
      this.navButtons[key].classList.toggle('on', key === this.section);
    }
    this.sconEl.innerHTML = '';
    const cat = document.createElement('div');
    cat.className = 'scat';
    this.sconEl.appendChild(cat);
    switch (this.section) {
      case 'general':
        cat.textContent = t('set_nav_general');
        this.renderGeneral(this.sconEl);
        break;
      case 'interaction':
        cat.textContent = t('set_nav_interaction');
        this.renderInteraction(this.sconEl);
        break;
      case 'output':
        cat.textContent = t('set_nav_output');
        this.renderOutput(this.sconEl);
        break;
      case 'help':
        cat.textContent = t('set_nav_help');
        this.renderHelp(this.sconEl);
        break;
    }
    // 内容变化后可能高度变化，重新夹紧定位
    if (this.panelEl) this.positionBeside(this.panelEl);
  }

  // ---- 各分区 ----

  private renderGeneral(root: HTMLElement): void {
    // 界面语言：搜索式选择器（仅 AVAILABLE_LANGUAGES：en / zh_CN）
    const langName = getLocale() === 'zh_CN' ? '简体中文' : 'English';
    root.appendChild(
      this.srow(
        t('set_ui_language'),
        null,
        this.selectDisplay(langName, 'pd-set-ui-lang', (anchor) => {
          openLanguagePicker({
            root: this.panelLayer,
            anchor,
            mode: 'ui',
            current: getLocale(),
            onSelect: async (code) => {
              await setLocale(code);
              this.rebuild();
              this.toast.show(t('toast_lang_switched'), 'ok');
            },
          });
        })
      )
    );

    // 主题：亮/暗（立即应用 + 持久）
    root.appendChild(
      this.srow(
        t('set_theme'),
        null,
        this.segIcons(
          [
            { value: 'light', icon: IC.sun, title: t('set_theme_light'), testid: 'pd-set-theme-light' },
            { value: 'dark', icon: IC.moon, title: t('set_theme_dark'), testid: 'pd-set-theme-dark' },
          ],
          this.settings.theme,
          (v) => {
            this.settings.theme = v as 'light' | 'dark';
            saveSettings({ theme: this.settings.theme });
            setTheme(this.settings.theme);
          }
        )
      )
    );

    // 默认选择粒度
    root.appendChild(
      this.srow(
        t('set_granularity'),
        null,
        this.segText(
          [
            { value: 'smart', label: t('set_gran_smart'), testid: 'pd-set-gran-smart' },
            { value: 'element', label: t('set_gran_element'), testid: 'pd-set-gran-element' },
          ],
          this.settings.defaultGranularity,
          (v) => {
            this.settings.defaultGranularity = v as 'smart' | 'element';
            saveSettings({ defaultGranularity: this.settings.defaultGranularity });
            this.resolver.setGranularity(this.settings.defaultGranularity);
          }
        )
      )
    );

    // 插件位置：重置位置
    const resetBtn = document.createElement('button');
    resetBtn.className = 'pd-btn';
    resetBtn.setAttribute('data-testid', 'pd-set-reset-pos');
    resetBtn.textContent = t('set_reset_position');
    resetBtn.addEventListener('click', () => {
      this.onResetPosition();
      this.toast.show(t('toast_position_reset'), 'ok');
    });
    root.appendChild(this.srow(t('set_position'), t('set_position_sub'), resetBtn));
  }

  private renderInteraction(root: HTMLElement): void {
    // 长按时长
    root.appendChild(
      this.srow(
        t('set_longpress'),
        t('set_longpress_sub'),
        this.numControl(this.settings.longPressMs, t('set_unit_ms'), 50, 50, 2000, 'pd-set-longpress', (v) => {
          this.settings.longPressMs = v;
          saveSettings({ longPressMs: v });
        })
      )
    );

    // 拖拽防误触阈值
    root.appendChild(
      this.srow(
        t('set_drag_threshold'),
        null,
        this.numControl(this.settings.dragThreshold, t('set_unit_ms'), 50, 0, 2000, 'pd-set-drag', (v) => {
          this.settings.dragThreshold = v;
          saveSettings({ dragThreshold: v });
        })
      )
    );

    // 撤销历史上限
    root.appendChild(
      this.srow(
        t('set_history_limit'),
        null,
        this.numControl(this.settings.historyLimit, t('set_unit_steps'), 10, 1, 9999, 'pd-set-history', (v) => {
          this.settings.historyLimit = v;
          saveSettings({ historyLimit: v });
          this.history.setLimit(v);
        })
      )
    );

    // 标注卡片默认展开
    root.appendChild(
      this.srow(
        t('set_card_expand'),
        null,
        this.switchControl(this.settings.cardDefaultExpanded, 'pd-set-card-expand', (on) => {
          this.settings.cardDefaultExpanded = on;
          saveSettings({ cardDefaultExpanded: on });
        })
      )
    );

    // 元素 hover 标签
    root.appendChild(
      this.srow(
        t('set_hover_label'),
        null,
        this.switchControl(this.settings.hoverLabel, 'pd-set-hover', (on) => {
          this.settings.hoverLabel = on;
          saveSettings({ hoverLabel: on });
          this.overlay.updateSettings(this.settings);
        })
      )
    );

    // 快捷键（V1 只读参考，不可重绑）
    const scBtn = document.createElement('button');
    scBtn.className = 'pd-btn';
    scBtn.setAttribute('data-testid', 'pd-set-shortcuts');
    scBtn.textContent = 'Ctrl+Z / Ctrl+⇧+Z / Esc';
    // V1 简化：展示按钮，点击无操作（重绑留 V2）
    root.appendChild(this.srow(t('set_shortcuts'), t('set_shortcuts_sub'), scBtn));
  }

  private renderOutput(root: HTMLElement): void {
    // 导出语言：搜索式全量选择器（钉住 英文 / 跟随界面）
    root.appendChild(
      this.srow(
        t('set_export_language'),
        t('set_export_lang_sub'),
        this.selectDisplay(this.exportLangLabel(this.settings.exportLang), 'pd-set-export-lang', (anchor) => {
          openLanguagePicker({
            root: this.panelLayer,
            anchor,
            mode: 'export',
            current: this.settings.exportLang,
            onSelect: (code) => {
              this.settings.exportLang = code;
              saveSettings({ exportLang: code });
              this.renderSection();
            },
          });
        })
      )
    );

    // 复制图片方式
    root.appendChild(
      this.srow(
        t('set_image_method'),
        null,
        this.segIcons(
          [
            { value: 'clipboard', icon: IC.clipboard, title: t('set_image_clipboard'), testid: 'pd-set-imgmethod-clipboard' },
            { value: 'download', icon: IC.download, title: t('set_image_download'), testid: 'pd-set-imgmethod-download' },
          ],
          this.settings.imageMethod,
          (v) => {
            this.settings.imageMethod = v as 'clipboard' | 'download';
            saveSettings({ imageMethod: this.settings.imageMethod });
          }
        )
      )
    );

    // 图片元数据水印
    root.appendChild(
      this.srow(
        t('set_watermark'),
        t('set_watermark_sub'),
        this.switchControl(this.settings.watermark, 'pd-set-watermark', (on) => {
          this.settings.watermark = on;
          saveSettings({ watermark: on });
        })
      )
    );
  }

  private renderHelp(root: HTMLElement): void {
    // 安装说明页
    const onboardBtn = document.createElement('button');
    onboardBtn.className = 'pd-btn';
    onboardBtn.setAttribute('data-testid', 'pd-set-onboarding');
    onboardBtn.textContent = t('set_onboarding_open');
    onboardBtn.addEventListener('click', () => this.onOpenOnboarding());
    root.appendChild(this.srow(t('set_onboarding'), t('set_onboarding_sub'), onboardBtn));

    // 检查更新（V1 占位：toast 当前已是最新）
    const updateBtn = document.createElement('button');
    updateBtn.className = 'pd-btn';
    updateBtn.setAttribute('data-testid', 'pd-set-check-update');
    updateBtn.textContent = t('set_check_update_btn');
    updateBtn.addEventListener('click', () => this.toast.show(t('toast_update_latest'), 'ok'));
    root.appendChild(this.srow(t('set_check_update'), t('set_check_update_sub'), updateBtn));

    // 反馈与问题（V1 占位）
    const feedbackBtn = document.createElement('button');
    feedbackBtn.className = 'pd-btn';
    feedbackBtn.setAttribute('data-testid', 'pd-set-feedback');
    feedbackBtn.textContent = t('set_feedback_btn');
    feedbackBtn.addEventListener('click', () => this.toast.show(t('toast_coming_soon')));
    root.appendChild(this.srow(t('set_feedback'), null, feedbackBtn));

    // 关于区
    const about = document.createElement('div');
    about.className = 'about';
    const ball = document.createElement('span');
    ball.className = 'ball';
    ball.innerHTML = BALL_SVG;
    const info = document.createElement('div');
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = 'PigeonDeck';
    const ver = document.createElement('div');
    ver.className = 'ver';
    ver.textContent = `${t('set_version')} ${VERSION} · V1`;
    info.appendChild(nm);
    info.appendChild(ver);
    about.appendChild(ball);
    about.appendChild(info);
    root.appendChild(about);
  }

  // ---- 控件工厂 ----

  private srow(label: string, sub: string | null, control: HTMLElement): HTMLElement {
    const row = document.createElement('div');
    row.className = 'pd-srow';
    const k = document.createElement('span');
    k.className = 'k';
    k.textContent = label;
    if (sub) {
      const small = document.createElement('small');
      small.textContent = sub;
      k.appendChild(small);
    }
    row.appendChild(k);
    row.appendChild(control);
    return row;
  }

  /** 语言选择器行：显示当前值 + 箭头，点击打开搜索式浮层 */
  private selectDisplay(
    value: string,
    testid: string,
    onOpen?: (anchor: HTMLElement) => void
  ): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'pd-sel';
    wrap.style.width = '150px';
    wrap.setAttribute('data-testid', testid);
    const btn = document.createElement('button');
    btn.className = 'pd-select';
    btn.type = 'button';
    btn.innerHTML = `<span class="v">${value}</span>`;
    const arrow = document.createElement('span');
    arrow.className = 'pd-sel-arrow';
    arrow.innerHTML = svg('<path d="m6 9 6 6 6-6"/>', 2);
    wrap.appendChild(btn);
    wrap.appendChild(arrow);
    if (onOpen) {
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onOpen(wrap);
      });
    }
    return wrap;
  }

  /** 导出语言 code → 展示名（auto/en/zh_CN 用 i18n，其它查 BCP47 nativeName） */
  private exportLangLabel(code: string): string {
    if (code === 'auto') return t('opt_export_auto');
    if (code === 'en') return t('opt_export_en');
    if (code === 'zh_CN') return t('opt_export_zh');
    const entry = BCP47_LANGUAGES.find((e) => e.code === code);
    return entry ? entry.nativeName : code;
  }

  /** 界面语言切换后重建面板，使已渲染文案立即切到新语言 */
  private rebuild(): void {
    this.close();
    this.open();
  }

  private segIcons(
    opts: Array<{ value: string; icon: string; title: string; testid: string }>,
    current: string,
    onSelect: (value: string) => void
  ): HTMLElement {
    const seg = document.createElement('div');
    seg.className = 'pd-seg accent icons';
    for (const o of opts) {
      const btn = document.createElement('button');
      if (o.value === current) btn.classList.add('on');
      btn.title = o.title;
      btn.setAttribute('data-testid', o.testid);
      btn.innerHTML = svg(o.icon, 1.7);
      btn.addEventListener('click', () => {
        for (const child of seg.children) child.classList.remove('on');
        btn.classList.add('on');
        onSelect(o.value);
      });
      seg.appendChild(btn);
    }
    return seg;
  }

  private segText(
    opts: Array<{ value: string; label: string; testid: string }>,
    current: string,
    onSelect: (value: string) => void
  ): HTMLElement {
    const seg = document.createElement('div');
    seg.className = 'pd-seg';
    for (const o of opts) {
      const btn = document.createElement('button');
      if (o.value === current) btn.classList.add('on');
      btn.setAttribute('data-testid', o.testid);
      btn.textContent = o.label;
      btn.addEventListener('click', () => {
        for (const child of seg.children) child.classList.remove('on');
        btn.classList.add('on');
        onSelect(o.value);
      });
      seg.appendChild(btn);
    }
    return seg;
  }

  private switchControl(
    on: boolean,
    testid: string,
    onToggle: (on: boolean) => void
  ): HTMLElement {
    const btn = document.createElement('button');
    btn.className = on ? 'pd-switch on' : 'pd-switch';
    btn.setAttribute('data-testid', testid);
    btn.setAttribute('aria-pressed', String(on));
    btn.addEventListener('click', () => {
      const next = !btn.classList.contains('on');
      btn.classList.toggle('on', next);
      btn.setAttribute('aria-pressed', String(next));
      onToggle(next);
    });
    return btn;
  }

  private numControl(
    value: number,
    unit: string,
    step: number,
    min: number,
    max: number,
    testid: string,
    onChange: (value: number) => void
  ): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'pd-num';
    wrap.setAttribute('data-testid', testid);

    const input = document.createElement('input');
    input.value = String(value);
    input.setAttribute('inputmode', 'numeric');

    const unitSpan = document.createElement('span');
    unitSpan.className = 'unit';
    unitSpan.textContent = unit;

    const stepWrap = document.createElement('span');
    stepWrap.className = 'step';
    const minus = document.createElement('button');
    minus.title = '−';
    minus.innerHTML = svg(IC.minus, 2.1);
    const plus = document.createElement('button');
    plus.title = '+';
    plus.innerHTML = svg(IC.plus, 2.1);
    stepWrap.appendChild(plus);
    stepWrap.appendChild(minus);

    let current = clampNumber(value, min, max, value);

    const commit = (next: number): void => {
      current = clampNumber(next, min, max, current);
      input.value = String(current);
      onChange(current);
    };

    input.addEventListener('change', () => commit(parseFloat(input.value)));
    plus.addEventListener('click', () => commit(current + step));
    minus.addEventListener('click', () => commit(current - step));

    wrap.appendChild(input);
    wrap.appendChild(unitSpan);
    wrap.appendChild(stepWrap);
    return wrap;
  }
}
