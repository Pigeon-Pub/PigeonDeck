/* ============================================================
   advanced-styles.ts — 高级样式区（4 分类左导航 + 控件区）
   蓝图 §5.1 / design-system §5.18/§6.3 / preview parts 12/20/21/22/36：
   - 排版 / 尺寸 / 外观 / 调试，左侧 46px 窄竖导航（圆形选中 + 变更角标）
   - 控件与修改栏同一注册表实例化（双入口单源）
   - 调试分类 = 只读 computed style + DOM 信息，默认全英文；
     导航「调试」下方翻译图标，点击标签译中文（值保持原样）
   - 刻意排除 position/top/left/z-index
   ============================================================ */

import { t } from './i18n';
import {
  FieldsSession,
  ControlContext,
  FIELD_CATEGORY,
  AdvCategory,
  advancedRows,
  renderRows,
} from './fields';

/* ---- 图标（Lucide，与 preview/pigeon-components.js 一致） ---- */
const NAV_ICONS: Record<AdvCategory, string> = {
  typography:
    '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
  size: '<path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/>',
  appearance:
    '<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1a1.6 1.6 0 0 1 1.6-1.6H16c3 0 5.5-2.5 5.5-5.5C21.9 6 17.5 2 12 2Z"/>',
  debug:
    '<path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.5 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M21 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
};
const LANGUAGES_ICON =
  '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>';

function svg(inner: string, sw = 1.6): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}

const CATEGORIES: Array<{ cat: AdvCategory; labelKey: string }> = [
  { cat: 'typography', labelKey: 'adv_cat_typography' },
  { cat: 'size', labelKey: 'adv_cat_size' },
  { cat: 'appearance', labelKey: 'adv_cat_appearance' },
  { cat: 'debug', labelKey: 'adv_cat_debug' },
];

/* ---- 调试 readout 标签对照（默认英文 / 翻译态中文；值不翻译） ---- */

const DEBUG_HEADINGS: Record<string, [string, string]> = {
  domInfo: ['DOM INFO', 'DOM 信息'],
  computed: ['COMPUTED STYLE', '计算样式'],
};
const DOM_LABELS: Array<{ key: 'tagName' | 'class' | 'id' | 'attributes'; en: string; zh: string }> = [
  { key: 'tagName', en: 'tagName', zh: '标签名' },
  { key: 'class', en: 'class', zh: '类名' },
  { key: 'id', en: 'id', zh: 'ID' },
  { key: 'attributes', en: 'attributes', zh: '属性' },
];
/** 调试计算样式清单（preview part 22 的 11 行；刻意排除 position/top/left/z-index 之外的定位细节） */
const CS_PROPS: Array<{ prop: string; en: string; zh: string }> = [
  { prop: 'display', en: 'display', zh: '显示' },
  { prop: 'width', en: 'width', zh: '宽度' },
  { prop: 'height', en: 'height', zh: '高度' },
  { prop: 'padding', en: 'padding', zh: '内边距' },
  { prop: 'margin', en: 'margin', zh: '外边距' },
  { prop: 'border', en: 'border', zh: '边框' },
  { prop: 'border-radius', en: 'border-radius', zh: '圆角' },
  { prop: 'box-shadow', en: 'box-shadow', zh: '阴影' },
  { prop: 'font-size', en: 'font-size', zh: '字号' },
  { prop: 'color', en: 'color', zh: '颜色' },
  { prop: 'position', en: 'position', zh: '定位' },
];

export interface AdvancedBoxOptions {
  session: FieldsSession;
  ctx: ControlContext;
  /** 内容变化引起高度变化时的包装（面板高度动画）；默认直接执行 */
  animate?: (mutate: () => void) => void;
}

/** 创建高级样式区（.advbox = 左导航 + 右控件列） */
export function createAdvancedBox(opts: AdvancedBoxOptions): HTMLElement {
  const { session, ctx } = opts;
  const animate = opts.animate ?? ((mutate: () => void): void => mutate());

  let active: AdvCategory = 'typography';
  let translated = false;

  const box = document.createElement('div');
  box.className = 'advbox';
  box.setAttribute('data-testid', 'pd-advbox');

  const nav = document.createElement('div');
  nav.className = 'pd-nav';
  nav.setAttribute('data-testid', 'pd-adv-nav');
  const scon = document.createElement('div');
  scon.className = 'scon pd-scroll';
  box.appendChild(nav);
  box.appendChild(scon);

  /** 分类变更计数（导航角标） */
  const categoryCounts = (): Partial<Record<AdvCategory, number>> => {
    const counts: Partial<Record<AdvCategory, number>> = {};
    for (const key of session.changedKeys()) {
      const cat = FIELD_CATEGORY[key];
      if (cat) counts[cat] = (counts[cat] ?? 0) + 1;
    }
    return counts;
  };

  const renderNav = (): void => {
    nav.innerHTML = '';
    const counts = categoryCounts();
    for (const { cat, labelKey } of CATEGORIES) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-testid', `pd-adv-nav-${cat}`);
      const count = counts[cat as keyof typeof counts];
      btn.className = [cat === active ? 'on' : '', count ? 'chg' : ''].filter(Boolean).join(' ');
      btn.innerHTML =
        (count ? `<span class="cnt">${count}</span>` : '') + `<span class="ic">${svg(NAV_ICONS[cat])}</span>`;
      btn.appendChild(document.createTextNode(t(labelKey)));
      btn.addEventListener('click', () => {
        if (cat === active) return;
        animate(() => {
          active = cat;
          renderNav();
          renderContent();
        });
      });
      nav.appendChild(btn);
    }
    // 调试分类激活时，导航底部出翻译开关（part 22/36）
    if (active === 'debug') {
      const sep = document.createElement('div');
      sep.className = 'navsep';
      nav.appendChild(sep);
      const tr = document.createElement('button');
      tr.type = 'button';
      tr.className = 'tr' + (translated ? ' on' : '');
      tr.setAttribute('data-testid', 'pd-adv-translate');
      tr.title = t('adv_translate_tip');
      tr.innerHTML = `<span class="ic">${svg(LANGUAGES_ICON)}</span>`;
      tr.appendChild(document.createTextNode(t('adv_translate')));
      tr.addEventListener('click', () => {
        translated = !translated;
        renderNav();
        renderContent(); // 翻译只换标签不改高度（行数/max-height 不变），无需动画
      });
      nav.appendChild(tr);
    }
  };

  const renderContent = (): void => {
    scon.innerHTML = '';
    if (active === 'debug') {
      scon.appendChild(buildDebugReadout(session.target, translated));
    } else {
      renderRows(scon, session, advancedRows(active), ctx);
    }
  };

  renderNav();
  renderContent();

  // 变更角标跟随任意字段改动
  session.subscribeAny(() => renderNav());

  return box;
}

/* ---- 调试 readout ---- */

function kvRow(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'kv';
  const k = document.createElement('span');
  k.className = 'k';
  k.textContent = label;
  const v = document.createElement('span');
  v.className = 'v';
  const code = document.createElement('code');
  code.textContent = value;
  v.appendChild(code);
  row.appendChild(k);
  row.appendChild(v);
  return row;
}

function buildDebugReadout(target: HTMLElement, translated: boolean): HTMLElement {
  const idx = translated ? 1 : 0;
  const wrap = document.createElement('div');
  wrap.setAttribute('data-testid', 'pd-adv-debug');
  if (translated) wrap.setAttribute('data-translated', '');

  const domH = document.createElement('div');
  domH.className = 'dom-h';
  domH.textContent = DEBUG_HEADINGS.domInfo[idx];
  wrap.appendChild(domH);

  const attrs = [...target.attributes]
    .filter((a) => !['class', 'id', 'style'].includes(a.name))
    .map((a) => `${a.name}="${a.value}"`)
    .join(' ');
  const domValues: Record<string, string> = {
    tagName: target.tagName.toLowerCase(),
    class: target.getAttribute('class') ?? '—',
    id: target.id || '—',
    attributes: attrs || '—',
  };
  for (const row of DOM_LABELS) {
    wrap.appendChild(kvRow(translated ? row.zh : row.en, domValues[row.key]));
  }

  const grp = document.createElement('div');
  grp.className = 'csgrp';
  const csH = document.createElement('div');
  csH.className = 'dom-h';
  csH.textContent = DEBUG_HEADINGS.computed[idx];
  grp.appendChild(csH);

  const list = document.createElement('div');
  list.className = 'cslist';
  const cs = target.ownerDocument.defaultView!.getComputedStyle(target);
  for (const item of CS_PROPS) {
    let value: string;
    if (item.prop === 'border') {
      value = `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`;
    } else {
      value = cs.getPropertyValue(item.prop) || '—';
    }
    const row = document.createElement('div');
    row.className = 'csrow';
    const p = document.createElement('span');
    p.className = 'p';
    p.textContent = translated ? item.zh : item.en;
    const v = document.createElement('span');
    v.className = 'val';
    v.textContent = value;
    row.appendChild(p);
    row.appendChild(v);
    list.appendChild(row);
  }
  grp.appendChild(list);
  wrap.appendChild(grp);
  return wrap;
}
