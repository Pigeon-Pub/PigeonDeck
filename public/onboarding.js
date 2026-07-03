/* ============================================================
   onboarding.js — 安装说明页脚本（静态扩展页，不走 vite 入口）
   阶段 12：用 chrome.i18n 填充文案 + 设置 logo/版本号，不硬编码中英文。
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  // 文档标题（chrome.i18n，与 HTML data-i18n 同机制）
  const title = chrome.i18n.getMessage('onboarding_title');
  if (title) document.title = title;

  // <html lang> 跟随界面语言（en / zh-CN 等）
  const uiLang = chrome.i18n.getUILanguage();
  if (uiLang) document.documentElement.lang = uiLang;

  // 所有带 data-i18n 的元素：填 chrome.i18n 文案（有则覆盖 HTML 兜底文本）
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (!key) return;
    const msg = chrome.i18n.getMessage(key);
    if (msg) el.textContent = msg;
  });

  // 品牌 logo：扩展内资源 URL
  const logo = document.getElementById('brand-logo');
  if (logo) logo.src = chrome.runtime.getURL('brand/logo.svg');

  // 版本号：读 manifest
  const versionEl = document.getElementById('version');
  if (versionEl) {
    const v = chrome.runtime.getManifest().version;
    versionEl.textContent = 'v' + v;
  }
});
