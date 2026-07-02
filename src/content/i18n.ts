/* ============================================================
   i18n.ts — 运行时界面语言切换
   方案：构建期 import JSON，运行时按当前语言查 key，缺失回退 en。
   语言设置存 chrome.storage.local，默认 'zh_CN'（规格：界面语言默认中文）。
   注意：chrome.i18n 只跟浏览器语言，不支持用户在设置中切换，故不用。
   ============================================================ */

import enMessages from '../../public/_locales/en/messages.json';
import zhCNMessages from '../../public/_locales/zh_CN/messages.json';

type Messages = Record<string, { message: string; description?: string }>;

const LOCALE_MAP: Record<string, Messages> = {
  en: enMessages,
  zh_CN: zhCNMessages,
};

const FALLBACK_LOCALE = 'en';

let currentLocale: string = 'zh_CN';

/** 从 chrome.storage.local 加载语言设置，找不到则保持默认 zh_CN */
export async function loadLocale(): Promise<void> {
  try {
    const result = await chrome.storage.local.get('uiLocale');
    if (result['uiLocale'] && typeof result['uiLocale'] === 'string') {
      currentLocale = result['uiLocale'];
    }
  } catch {
    // storage 不可用时静默使用默认值
  }
}

/** 持久化语言设置并立即应用 */
export async function setLocale(locale: string): Promise<void> {
  currentLocale = locale;
  try {
    await chrome.storage.local.set({ uiLocale: locale });
  } catch {
    // 静默失败，内存中的值已更新
  }
}

/** 获取当前语言 */
export function getLocale(): string {
  return currentLocale;
}

/**
 * 翻译 key → 文案字符串。
 * 查找顺序：currentLocale → en → key 本身（最终兜底）。
 */
export function t(key: string): string {
  const messages = LOCALE_MAP[currentLocale];
  if (messages && key in messages) {
    return messages[key].message;
  }
  // 回退到英文
  const fallback = LOCALE_MAP[FALLBACK_LOCALE];
  if (fallback && key in fallback) {
    return fallback[key].message;
  }
  return key;
}
