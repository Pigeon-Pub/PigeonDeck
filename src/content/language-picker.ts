/* ============================================================
   language-picker.ts — 搜索式语言浮层（阶段 11b）
   蓝图 §8.1：界面语言=可搜索胶囊列表；导出语言=同款全量选择器，
   顶部钉住「英文 / 跟随界面」。视觉逐值照搬 preview/parts/29 + /39。
   界面语言选项来源 AVAILABLE_LANGUAGES.json；导出全量来源 BCP47_LANGUAGES。
   ============================================================ */

import { mountPopover, PopoverHandle } from './popover';
import { t, getLocale } from './i18n';
import { BCP47_LANGUAGES, LangEntry, LangMatch, matchLanguages, isoSubtag } from '../shared/languages';
import availableLanguages from '../../public/_locales/AVAILABLE_LANGUAGES.json';

/** 界面语言可选项（AVAILABLE_LANGUAGES.json → LangEntry） */
const UI_ENTRIES: LangEntry[] = Object.entries(
  availableLanguages as Record<string, { name: string; nativeName: string }>
).map(([code, v]) => ({ code, name: v.name, nativeName: v.nativeName }));

const ICON_SEARCH =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>';
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';
const ICON_TRANSLATE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/></svg>';

export interface LanguagePickerOptions {
  root: HTMLElement;
  anchor: HTMLElement;
  mode: 'ui' | 'export';
  /** 当前选中 code（ui: 'en'/'zh_CN'；export: BCP47 code 或 'auto'） */
  current: string;
  onSelect: (code: string) => void;
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
  dd.style.width = opts.mode === 'ui' ? '228px' : '238px';

  // 搜索框
  const srch = document.createElement('div');
  srch.className = 'srch';
  srch.innerHTML = ICON_SEARCH;
  const input = document.createElement('input');
  input.setAttribute('data-testid', 'pd-lang-search');
  input.placeholder = t('lang_search_ph');
  srch.appendChild(input);
  let cnt: HTMLElement | null = null;
  if (opts.mode === 'ui') {
    cnt = document.createElement('span');
    cnt.className = 'cnt';
    srch.appendChild(cnt);
  }
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
    if (cnt) cnt.textContent = t('lang_count').replace('{n}', String(matches.length));
    for (const m of matches) listWrap.appendChild(buildEntryOpt(m, opts.current, pick));
  };

  const renderExport = (query: string): void => {
    const q = query.trim().toLowerCase();

    // 钉住组「常用」：英文 + 跟随界面
    const uiEntry = UI_ENTRIES.find((e) => e.code === getLocale());
    const followNative = uiEntry ? uiEntry.nativeName : getLocale();
    const enHit = !q || 'en'.includes(q) || t('opt_export_en').toLowerCase().includes(q);
    const autoHit =
      !q ||
      'auto'.includes(q) ||
      'follow'.includes(q) ||
      t('export_follow').toLowerCase().includes(q);

    if (enHit || autoHit) {
      const h = document.createElement('div');
      h.className = 'grp-h';
      h.textContent = t('export_pinned');
      listWrap.appendChild(h);
      const list = document.createElement('div');
      list.className = 'list';
      if (enHit) {
        list.appendChild(
          buildOpt('en', escapeHtml('en'), false, escapeHtml(t('opt_export_en')), null, opts.current === 'en', pick)
        );
      }
      if (autoHit) {
        const subEq = t('export_follow_eq').replace('{lang}', followNative);
        list.appendChild(
          buildOpt('auto', ICON_TRANSLATE, true, escapeHtml(t('export_follow')), subEq, opts.current === 'auto', pick)
        );
      }
      listWrap.appendChild(list);
    }

    // 分隔线
    const allMatches = matchLanguages(query, BCP47_LANGUAGES);
    if ((enHit || autoHit) && allMatches.length > 0) {
      const sep = document.createElement('div');
      sep.className = 'sep';
      listWrap.appendChild(sep);
    }

    // 全部语言组
    if (allMatches.length > 0) {
      const h = document.createElement('div');
      h.className = 'grp-h';
      h.textContent = t('export_all');
      listWrap.appendChild(h);
      const list = document.createElement('div');
      list.className = 'list';
      for (const m of allMatches) list.appendChild(buildEntryOpt(m, opts.current, pick));
      listWrap.appendChild(list);
    }
  };

  const render = (): void => {
    listWrap.innerHTML = '';
    if (opts.mode === 'ui') renderUi(input.value);
    else renderExport(input.value);
  };

  render();
  handle = mountPopover(opts.root, dd, opts.anchor);
  input.focus();
  input.addEventListener('input', render);

  return handle;
}
