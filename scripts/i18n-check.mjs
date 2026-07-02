/**
 * i18n-check.mjs — 校验各语言 messages.json 的 key 集合与 en 严格一致，
 * 并校验所有语言都已登记在 AVAILABLE_LANGUAGES.json。
 * 不一致时非零退出并列出差异。
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesDir = path.join(__dirname, '..', 'public', '_locales');

async function readJSON(filePath) {
  const content = await fs.readFile(filePath, 'utf8');
  return JSON.parse(content);
}

let hasError = false;

function reportError(msg) {
  console.error('[i18n-check] ERROR:', msg);
  hasError = true;
}

// 读取基准（en）
const enPath = path.join(localesDir, 'en', 'messages.json');
const enMessages = await readJSON(enPath);
const enKeys = new Set(Object.keys(enMessages));

// 读取 AVAILABLE_LANGUAGES.json
const availPath = path.join(localesDir, 'AVAILABLE_LANGUAGES.json');
const available = await readJSON(availPath);
const registeredLocales = Object.keys(available);

// 扫描 _locales 目录下的所有语言目录
const entries = await fs.readdir(localesDir, { withFileTypes: true });
const localeDirs = entries
  .filter(e => e.isDirectory())
  .map(e => e.name);

for (const locale of localeDirs) {
  const messagesPath = path.join(localesDir, locale, 'messages.json');

  // 检查文件是否存在
  try {
    await fs.access(messagesPath);
  } catch {
    reportError(`${locale}/messages.json not found`);
    continue;
  }

  const messages = await readJSON(messagesPath);
  const keys = new Set(Object.keys(messages));

  // 与 en 对比 key 集合
  const missing = [...enKeys].filter(k => !keys.has(k));
  const extra = [...keys].filter(k => !enKeys.has(k));

  if (missing.length > 0) {
    reportError(`${locale}/messages.json is missing keys: ${missing.join(', ')}`);
  }
  if (extra.length > 0) {
    reportError(`${locale}/messages.json has extra keys not in en: ${extra.join(', ')}`);
  }

  // 检查是否登记在 AVAILABLE_LANGUAGES.json
  if (!registeredLocales.includes(locale)) {
    reportError(`Locale "${locale}" exists but is not registered in AVAILABLE_LANGUAGES.json`);
  }
}

// 检查 AVAILABLE_LANGUAGES.json 中登记的语言是否都有对应目录
for (const locale of registeredLocales) {
  if (!localeDirs.includes(locale)) {
    reportError(`Locale "${locale}" is registered in AVAILABLE_LANGUAGES.json but has no directory in _locales/`);
  }
}

if (hasError) {
  process.exit(1);
} else {
  console.log('[i18n-check] All locales OK.');
}
