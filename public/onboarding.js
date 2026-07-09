/* ============================================================
   onboarding.js — install/quick-start page (static extension page).
   Fills copy via chrome.i18n, swaps screenshots by language, sets version.
   Degrades gracefully when opened directly via file:// (no chrome.* APIs):
   images use relative paths so they still load; copy falls back to the
   English text baked into the HTML.
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const cr = (typeof chrome !== 'undefined' && chrome.runtime) ? chrome : null;
  const i18n = (cr && chrome.i18n) ? chrome.i18n : null;

  // Language bucket for screenshots (extension UI language → else browser → else en)
  let uiLang = 'en';
  try { uiLang = (i18n && i18n.getUILanguage()) || navigator.language || 'en'; }
  catch { uiLang = navigator.language || 'en'; }
  document.documentElement.lang = uiLang;
  const shotLang = uiLang.toLowerCase().startsWith('zh') ? 'zh' : 'en';

  // Localized copy — only when running as an extension page; otherwise keep HTML defaults
  if (i18n) {
    const title = i18n.getMessage('onboarding_title');
    if (title) document.title = title;
    document.querySelectorAll('[data-i18n]').forEach((el) => {
      const msg = i18n.getMessage(el.getAttribute('data-i18n'));
      if (msg) el.textContent = msg;
    });
    document.querySelectorAll('[data-i18n-alt]').forEach((el) => {
      const msg = i18n.getMessage(el.getAttribute('data-i18n-alt'));
      if (msg) el.setAttribute('alt', msg);
    });
  }

  // Screenshots via RELATIVE path — resolves both as an extension page and via file://
  document.querySelectorAll('img.shot[data-shot]').forEach((img) => {
    img.src = `onboarding/${shotLang}/${img.getAttribute('data-shot')}.webp`;
  });

  // Version from manifest (extension only)
  const versionEl = document.getElementById('version');
  if (versionEl && cr) {
    try { versionEl.textContent = 'v' + cr.runtime.getManifest().version; } catch { /* ignore */ }
  }
});
