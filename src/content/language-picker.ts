/* ============================================================
   language-picker.ts — 搜索式语言浮层（阶段 11b）
   蓝图 §8.1：界面语言=可搜索胶囊列表。视觉逐值照搬 preview/parts/29。
   界面语言选项来源 AVAILABLE_LANGUAGES.json。
   （导出语言已改用紧凑 2 项下拉，见 settings-panel.renderOutput / dropdown.ts。）
   ============================================================ */

import { mountPopover, PopoverHandle } from './popover';
import { t } from './i18n';
import { LangEntry, LangMatch, matchLanguages, isoSubtag } from '../shared/languages';
import availableLanguages from '../../public/_locales/AVAILABLE_LANGUAGES.json';

/** 界面语言可选项（AVAILABLE_LANGUAGES.json → LangEntry） */
const UI_ENTRIES: LangEntry[] = Object.entries(
  availableLanguages as Record<string, { name: string; nativeName: string }>
).map(([code, v]) => ({ code, name: v.name, nativeName: v.nativeName }));

const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

export interface LanguagePickerOptions {
  root: HTMLElement;
  anchor: HTMLElement;
  /** 当前选中 code（界面语言：'en'/'zh_CN'） */
  current: string;
  onSelect: (code: string) => void;
  /** 浮层被任何途径关闭时回调（供触发钮清空句柄做开关，逻辑11） */
  onClose?: () => void;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'
  );
}

/** nativeName 按高亮区间渲染为带 <mark> 的 HTML（其余字符转义） */
function highlightNative(text: string, ranges: [number, number][]): string {
  if (ranges.length === 0) return escapeHtml(text);
  let out = '';
  let last = 0;
  for (const [s, e] of ranges) {
    out += escapeHtml(text.slice(last, s));
    out += `<mark>${escapeHtml(text.slice(s, e))}</mark>`;
    last = e;
  }
  out += escapeHtml(text.slice(last));
  return out;
}

/** 构造一个胶囊语言项 */
function buildOpt(
  code: string,
  isoHtml: string,
  isoFollow: boolean,
  nativeHtml: string,
  subText: string | null,
  isOn: boolean,
  onPick: (code: string) => void
): HTMLElement {
  const opt = document.createElement('div');
  opt.className = isOn ? 'opt on' : 'opt';
  opt.setAttribute('data-testid', `pd-lang-opt-${code}`);

  const iso = document.createElement('span');
  iso.className = isoFollow ? 'iso f' : 'iso';
  iso.innerHTML = isoHtml;
  opt.appendChild(iso);

  const nm = document.createElement('span');
  nm.className = 'nm';
  nm.innerHTML = nativeHtml;
  opt.appendChild(nm);

  if (subText !== null) {
    const sub = document.createElement('span');
    sub.className = 'sub';
    sub.textContent = subText;
    opt.appendChild(sub);
  }
  if (isOn) {
    const chk = document.createElement('span');
    chk.className = 'chk';
    chk.innerHTML = ICON_CHECK;
    opt.appendChild(chk);
  }

  opt.addEventListener('click', () => onPick(code));
  return opt;
}

/** 从 LangMatch 构造标准语言项 */
function buildEntryOpt(m: LangMatch, current: string, onPick: (code: string) => void): HTMLElement {
  return buildOpt(
    m.entry.code,
    escapeHtml(isoSubtag(m.entry.code)),
    false,
    highlightNative(m.entry.nativeName, m.ranges),
    m.entry.name,
    m.entry.code === current,
    onPick
  );
}

/**
 * 打开搜索式语言选择器。返回 PopoverHandle（点外部关闭 + 幂等）。
 */
export function openLanguagePicker(opts: LanguagePickerOptions): PopoverHandle {
  const dd = document.createElement('div');
  dd.className = 'pd-surface dd';
  dd.setAttribute('data-testid', 'pd-lang-picker');
  dd.style.width = '228px';

  // 搜索框
  const srch = document.createElement('div');
  srch.className = 'srch';
  srch.innerHTML = ICON_SEARCH;
  const input = document.createElement('input');
  input.setAttribute('data-testid', 'pd-lang-search');
  input.placeholder = t('lang_search_ph');
  srch.appendChild(input);
  const cnt = document.createElement('span');
  cnt.className = 'cnt';
  srch.appendChild(cnt);
  dd.appendChild(srch);

  const listWrap = document.createElement('div');
  dd.appendChild(listWrap);

  let handle: PopoverHandle;
  const pick = (code: string): void => {
    opts.onSelect(code);
    handle.close();
  };

  const renderUi = (query: string): void => {
    const matches = matchLanguages(query, UI_ENTRIES);
    cnt.textContent = t('lang_count').replace('{n}', String(matches.length));
    for (const m of matches) listWrap.appendChild(buildEntryOpt(m, opts.current, pick));
  };

  const render = (): void => {
    listWrap.innerHTML = '';
    renderUi(input.value);
  };

  render();
  handle = mountPopover(opts.root, dd, opts.anchor, opts.onClose);
  input.focus();
  input.addEventListener('input', render);

  return handle;
}
