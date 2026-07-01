/* ============================================================
   pigeon-components.js — PigeonDeck 预览的「调用式」组件原件
   原生 Web Components，渲染到 light DOM（复用全局 pigeonlib.css）。
   各 part 只「调用」 <pd-…>，改这里 = 所有引用处同步。
   单一真相源配合 pigeonlib.css（外壳类）+ 本文件（结构/控件/图标）。
   ============================================================ */
(function () {
  'use strict';

  /* ---- 内联 Lucide 图标（单一真相源） ---- */
  const I = {
    type:'<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    ruler:'<path d="M21.3 15.3 8.7 2.7a1 1 0 0 0-1.4 0L2.7 7.3a1 1 0 0 0 0 1.4l12.6 12.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4Z"/><path d="m14.5 12.5 2-2"/><path d="m11.5 9.5 2-2"/><path d="m8.5 6.5 2-2"/>',
    palette:'<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.6-.7 1.6-1.7 0-.4-.2-.8-.4-1.1-.3-.3-.4-.6-.4-1.1a1.6 1.6 0 0 1 1.6-1.6H16c3 0 5.5-2.5 5.5-5.5C21.9 6 17.5 2 12 2Z"/>',
    bug:'<path d="M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.5 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M21 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
    languages:'<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    sliders:'<line x1="21" x2="14" y1="4" y2="4"/><line x1="10" x2="3" y1="4" y2="4"/><line x1="21" x2="12" y1="12" y2="12"/><line x1="8" x2="3" y1="12" y2="12"/><line x1="21" x2="16" y1="20" y2="20"/><line x1="12" x2="3" y1="20" y2="20"/><line x1="14" x2="14" y1="2" y2="6"/><line x1="8" x2="8" y1="10" y2="14"/><line x1="16" x2="16" y1="18" y2="22"/>',
    mouse:'<rect x="5" y="2" width="14" height="20" rx="7"/><path d="M12 6v4"/>',
    upload:'<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" x2="12" y1="2" y2="15"/>',
    help:'<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" x2="12.01" y1="17" y2="17"/>',
    eyedropper:'<path d="m2 22 1-1h3l9-9"/><path d="M3 21v-3l9-9"/><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z"/>',
    trash:'<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    blk:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/>',
    flx:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="15" x2="15" y1="3" y2="21"/>',
    grd:'<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" x2="21" y1="9" y2="9"/><line x1="3" x2="21" y1="15" y2="15"/><line x1="9" x2="9" y1="3" y2="21"/><line x1="15" x2="15" y1="3" y2="21"/>',
    inl:'<line x1="3" x2="21" y1="6" y2="6"/><path d="M3 12h15a3 3 0 1 1 0 6h-4"/><polyline points="16 16 14 18 16 20"/><line x1="3" x2="11" y1="18" y2="18"/>',
    alL:'<line x1="21" x2="3" y1="6" y2="6"/><line x1="15" x2="3" y1="12" y2="12"/><line x1="17" x2="3" y1="18" y2="18"/>',
    alC:'<line x1="21" x2="3" y1="6" y2="6"/><line x1="17" x2="7" y1="12" y2="12"/><line x1="19" x2="5" y1="18" y2="18"/>',
    alR:'<line x1="21" x2="3" y1="6" y2="6"/><line x1="21" x2="9" y1="12" y2="12"/><line x1="21" x2="7" y1="18" y2="18"/>',
    alJ:'<line x1="3" x2="21" y1="6" y2="6"/><line x1="3" x2="21" y1="12" y2="12"/><line x1="3" x2="21" y1="18" y2="18"/>',
    chevR:'<path d="m9 18 6-6-6-6"/>',
    chevD:'<path d="m6 9 6 6 6-6"/>',
    plus:'<path d="M5 12h14"/><path d="M12 5v14"/>',
    minus:'<path d="M5 12h14"/>',
    info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    image:'<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'
  };
  const svg = (inner, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.6}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

  /* ---- 工具 ---- */
  function hexA(hex, pct) {
    const h = (hex || '#000').replace('#', '');
    const n = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
    const r = parseInt(n.slice(0, 2), 16) || 0, g = parseInt(n.slice(2, 4), 16) || 0, b = parseInt(n.slice(4, 6), 16) || 0;
    return `rgba(${r},${g},${b},${(pct / 100).toFixed(2)})`;
  }
  function diffHTML(d) {
    if (!d) return '';
    const i = d.indexOf('→');
    if (i < 0) return '';
    return `<span class="pd-diff">${d.slice(0, i)}<i>→</i><b>${d.slice(i + 1)}</b></span>`;
  }
  function segHTML(opts, active, accent) {
    return `<div class="pd-seg${accent ? ' accent' : ''}">${opts.map(o => `<button class="${o === active ? 'on' : ''}">${o}</button>`).join('')}</div>`;
  }
  function parseBadges(s) {
    const m = {}; (s || '').split(',').forEach(p => { const [k, v] = p.split(':'); if (k) m[k.trim()] = (v || '').trim(); }); return m;
  }
  function attr(el, name, def) { return el.hasAttribute(name) ? el.getAttribute(name) : def; }

  /* ---- 定义助手：渲染到 light DOM，子节点搬入 [data-slot]（无则搬到宿主） ---- */
  function comp(tag, render) {
    if (customElements.get(tag)) return;
    customElements.define(tag, class extends HTMLElement {
      connectedCallback() {
        if (this._up) return; this._up = true;
        const kids = Array.prototype.slice.call(this.childNodes)
          .filter(n => !(n.nodeType === 3 && !n.nodeValue.trim()));
        this.innerHTML = render(this) || '';
        const slot = this.querySelector('[data-slot]') || this;
        kids.forEach(k => slot.appendChild(k));
      }
    });
  }

  /* ============================================================
     属性原件注册表（双入口单源）：修改栏与高级样式都用 <pd-prop field="…">
     ============================================================ */
  const FIELDS = {
    text:       { label: '文字内容', ctl: el => `<textarea class="pd-textarea" rows="2">${attr(el, 'value', '限时优惠 · 今日截止')}</textarea>` },
    font:       { label: '字体',     ctl: el => `<pd-select value="${attr(el, 'value', '系统默认')}"></pd-select>` },
    fontSize:   { label: '字号',     ctl: el => `<pd-num value="${attr(el, 'value', '24')}" unit="px"></pd-num>` },
    fontWeight: { label: '字重',     ctl: el => `<pd-select value="${attr(el, 'value', '600 半粗')}"></pd-select>` },
    color:      { label: '颜色',     ctl: el => `<pd-color value="${attr(el, 'value', '#23262e')}"></pd-color>` },
    align:      { label: '对齐',     ctl: el => `<pd-seg-align active="${attr(el, 'value', 'center')}"></pd-seg-align>` },
    decoration: { label: '文字装饰', ctl: el => `<pd-seg-deco active="${attr(el, 'value', 'b')}"></pd-seg-deco>` },
    lineHeight: { label: '行高',     ctl: el => `<pd-num value="${attr(el, 'value', '1.4')}" unit="em"></pd-num>` },
    letter:     { label: '字距',     ctl: el => `<pd-num value="${attr(el, 'value', '0.2')}" unit="px"></pd-num>` },
    listStyle:  { label: '列表样式', ctl: el => `<pd-select value="${attr(el, 'value', '无')}"></pd-select>` },
    transform:  { label: '大小写',   ctl: el => `<pd-select value="${attr(el, 'value', '原样')}"></pd-select>` },
    width:      { label: '宽度',     ctl: el => `<pd-num value="${attr(el, 'value', '240')}" unit="px"></pd-num>` },
    height:     { label: '高度',     ctl: el => `<pd-num value="${attr(el, 'value', 'auto')}" unit="px"></pd-num>` },
    minW:       { label: '最小宽',   ctl: el => `<pd-num value="${attr(el, 'value', '160')}" unit="px"></pd-num>` },
    maxW:       { label: '最大宽',   ctl: el => `<pd-num value="${attr(el, 'value', '320')}" unit="px"></pd-num>` },
    display:    { label: '显示',     ctl: el => `<pd-seg-display active="${attr(el, 'value', 'flex')}"></pd-seg-display>` },
    objectFit:  { label: '填充方式', ctl: el => segHTML(['cover', 'contain', 'fill'], attr(el, 'value', 'cover'), true) },
    overflow:   { label: '溢出',     ctl: el => segHTML(['可见', '隐藏', '滚动'], attr(el, 'value', '可见'), true) },
    bgColor:    { label: '背景色',   ctl: el => `<pd-color value="${attr(el, 'value', '#b8842c')}"${el.hasAttribute('alpha') ? ` alpha="${el.getAttribute('alpha')}"` : ''}></pd-color>` },
    bgImage:    { label: '背景图',   ctl: el => `<button class="pd-btn" style="width:100%">${svg(I.image, 1.6)}选择背景图</button>` },
    border:     { label: '边框',     ctl: el => `<pd-select value="${attr(el, 'value', '无')}"></pd-select>` },
    borderColor:{ label: '边框色',   ctl: el => `<pd-color value="${attr(el, 'value', '#d9d3c4')}"></pd-color>` },
    radius:     { label: '圆角',     ctl: el => `<pd-num value="${attr(el, 'value', '12')}" unit="px"></pd-num>` },
    shadow:     { label: '阴影',     ctl: el => segHTML(['无', '轻', '中', '重'], attr(el, 'value', '轻'), true) },
    shadowColor:{ label: '阴影色',   ctl: el => `<pd-color value="${attr(el, 'value', '#3c2e12')}" alpha="22"></pd-color>` },
    opacity:    { label: '不透明度', ctl: el => `<div class="opwrap"><pd-range value="${attr(el, 'value', '100')}"></pd-range><span class="opval">${attr(el, 'value', '100')}%</span></div>` },
    blur:       { label: '模糊',     ctl: el => `<div class="opwrap"><pd-range value="${attr(el, 'value', '0')}"></pd-range><span class="opval">${attr(el, 'value', '0')}px</span></div>` },
    margin:     { label: '外边距',   ctl: el => `<pd-num value="${attr(el, 'value', '0')}" unit="px"></pd-num>` },
    padding:    { label: '内边距',   ctl: el => `<pd-num value="${attr(el, 'value', '14')}" unit="px"></pd-num>` },
    replaceImg: { label: '图片源',   ctl: () => `<button class="pd-btn" style="width:100%">${svg(I.image, 1.6)}替换图片（本地 / URL）</button>` }
  };

  /* ============================================================
     控件原件
     ============================================================ */
  comp('pd-color', el => {
    el.classList.add('pd-color');
    const v = attr(el, 'value', '#b8842c');
    const a = el.getAttribute('alpha');
    const fill = a != null ? hexA(v, +a) : v;
    return `<button class="sw" title="点击展开调色盘"><i class="fill" style="background:${fill}"></i></button>`
      + `<input class="val" value="${v}">`
      + `<button class="eye" title="取色">${svg(I.eyedropper)}</button>`;
  });

  comp('pd-num', el => {
    el.classList.add('pd-num');
    return `<input value="${attr(el, 'value', '')}"><span class="unit">${attr(el, 'unit', 'px')}</span><span class="step"><button title="增加">${svg(I.plus, 2.1)}</button><button title="减少">${svg(I.minus, 2.1)}</button></span>`;
  });

  comp('pd-select', el => {
    el.classList.add('pd-sel');
    const v = el.getAttribute('value');
    const inner = v != null ? `<option>${v}</option>` : '';
    return `<select class="pd-select" data-slot>${inner}</select><span class="pd-sel-arrow">${svg(I.chevD, 2)}</span>`;
  });

  comp('pd-range', el => {
    el.classList.add('pd-range');
    return `<span class="knob" style="left:${attr(el, 'value', '100')}%"></span>`;
  });

  comp('pd-seg-display', el => {
    el.classList.add('pd-seg', 'accent', 'icons');
    const a = attr(el, 'active', 'flex');
    const o = [['block', '块级 block', I.blk], ['flex', '弹性 flex', I.flx], ['grid', '网格 grid', I.grd], ['inline', '行内 inline', I.inl]];
    return o.map(x => `<button class="${x[0] === a ? 'on' : ''}" title="${x[1]}">${svg(x[2], 1.7)}</button>`).join('');
  });

  comp('pd-seg-align', el => {
    el.classList.add('pd-seg', 'accent', 'icons');
    const a = attr(el, 'active', 'center');
    const o = [['left', '左对齐', I.alL], ['center', '居中对齐', I.alC], ['right', '右对齐', I.alR], ['justify', '两端对齐', I.alJ]];
    return o.map(x => `<button class="${x[0] === a ? 'on' : ''}" title="${x[1]}">${svg(x[2], 1.7)}</button>`).join('');
  });

  comp('pd-seg-deco', el => {
    el.classList.add('pd-seg', 'accent', 'deco');
    const a = (attr(el, 'active', 'b')).split(/[ ,]+/);
    const o = [['b', 'B', '粗体'], ['i', 'I', '斜体'], ['u', 'U', '下划线'], ['s', 'S', '删除线']];
    return o.map(x => `<button class="${a.indexOf(x[0]) >= 0 ? 'on' : ''} d-${x[0]}" title="${x[2]}">${x[1]}</button>`).join('');
  });

  /* ============================================================
     外壳原件
     ============================================================ */
  comp('pd-foot', el => {
    el.classList.add('pfoot');
    return `<span class="meta">${attr(el, 'meta', '')}</span>`
      + `<span class="acts"><button class="pd-iconbtn danger" title="删除批注">${svg(I.trash)}</button><button class="pd-btn primary">保存</button></span>`;
  });

  comp('pd-adv-nav', el => {
    el.classList.add('pd-nav');
    const a = attr(el, 'active', ''), b = parseBadges(el.getAttribute('badges'));
    const cats = [['排版', I.type], ['尺寸', I.ruler], ['外观', I.palette], ['调试', I.bug]];
    let h = cats.map(c => {
      const cnt = b[c[0]], cls = [c[0] === a ? 'on' : '', cnt ? 'chg' : ''].filter(Boolean).join(' ');
      return `<button class="${cls}">${cnt ? `<span class="cnt">${cnt}</span>` : ''}<span class="ic">${svg(c[1])}</span>${c[0]}</button>`;
    }).join('');
    if (el.hasAttribute('translate'))
      h += `<div class="navsep"></div><button class="tr${el.hasAttribute('translated') ? ' on' : ''}" title="翻译为中文"><span class="ic">${svg(I.languages)}</span>翻译</button>`;
    return h;
  });

  comp('pd-set-nav', el => {
    el.classList.add('pd-nav');
    const a = attr(el, 'active', '');
    const cats = [['通用', I.sliders], ['交互', I.mouse], ['输出', I.upload], ['帮助', I.help]];
    return cats.map(c => `<button class="${c[0] === a ? 'on' : ''}"><span class="ic">${svg(c[1])}</span>${c[0]}</button>`).join('');
  });

  comp('pd-panel', el => {
    el.classList.add('pd-surface', 'panel');
    const w = el.getAttribute('width'); if (w) el.style.width = w + 'px';
    return '';
  });

  comp('pd-modbox', el => {
    el.classList.add('modbox');
    return `<div class="modbox-h">${attr(el, 'title', '')}</div>`;
  });

  comp('pd-advbox', el => {
    el.classList.add('advbox');
    const a = attr(el, 'active', ''), b = attr(el, 'badges', ''), tr = el.hasAttribute('translate') ? ' translate' : '', td = el.hasAttribute('translated') ? ' translated' : '';
    return `<pd-adv-nav active="${a}" badges="${b}"${tr}${td}></pd-adv-nav><div class="scon" data-slot></div>`;
  });

  comp('pd-prop', el => {
    el.classList.add('prop');
    const field = el.getAttribute('field'), f = field && FIELDS[field];
    let label = el.getAttribute('label'); if (f && label == null) label = f.label;
    const auto = el.hasAttribute('auto') ? '<span class="auto">自动</span>' : '';
    const dh = diffHTML(el.getAttribute('diff'));
    const ctl = f ? f.ctl(el) : '';
    return `<div class="prop-h"><span class="t">${label || ''}${auto}</span>${dh}</div><div class="ctl" data-slot>${ctl}</div>`;
  });
})();
