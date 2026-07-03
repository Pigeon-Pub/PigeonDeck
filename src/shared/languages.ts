/* ============================================================
   languages.ts — BCP47 语言数据 + 搜索匹配（纯函数）
   蓝图 §8.2：搜索支持模糊（子串）/ 首字母（前缀）/ ISO 代码前缀匹配。
   语言数据为 curated 常用子集（非真·全量 180 种，V1 最小可用），
   社区可按需扩充 BCP47_LANGUAGES。regional 变体沿用项目下划线约定
   （zh_CN / zh_TW / pt_BR），确保导出语言选 zh_CN → 命中中文模板。
   ============================================================ */

export interface LangEntry {
  /** BCP47 code（regional 变体用下划线，如 zh_CN / pt_BR） */
  code: string;
  /** 英文名（用于英文名/首字母搜索与副标题展示） */
  name: string;
  /** 母语名（列表主显示，命中处高亮） */
  nativeName: string;
}

/** curated 常用子集（约 42 种），社区可扩充 */
export const BCP47_LANGUAGES: LangEntry[] = [
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'zh_CN', name: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'zh_TW', name: 'Chinese (Traditional)', nativeName: '繁體中文' },
  { code: 'ja', name: 'Japanese', nativeName: '日本語' },
  { code: 'ko', name: 'Korean', nativeName: '한국어' },
  { code: 'fr', name: 'French', nativeName: 'Français' },
  { code: 'de', name: 'German', nativeName: 'Deutsch' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' },
  { code: 'pt_BR', name: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'ru', name: 'Russian', nativeName: 'Русский' },
  { code: 'it', name: 'Italian', nativeName: 'Italiano' },
  { code: 'nl', name: 'Dutch', nativeName: 'Nederlands' },
  { code: 'pl', name: 'Polish', nativeName: 'Polski' },
  { code: 'tr', name: 'Turkish', nativeName: 'Türkçe' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'th', name: 'Thai', nativeName: 'ไทย' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', nativeName: 'Bahasa Melayu' },
  { code: 'uk', name: 'Ukrainian', nativeName: 'Українська' },
  { code: 'cs', name: 'Czech', nativeName: 'Čeština' },
  { code: 'sv', name: 'Swedish', nativeName: 'Svenska' },
  { code: 'da', name: 'Danish', nativeName: 'Dansk' },
  { code: 'fi', name: 'Finnish', nativeName: 'Suomi' },
  { code: 'nb', name: 'Norwegian Bokmål', nativeName: 'Norsk bokmål' },
  { code: 'el', name: 'Greek', nativeName: 'Ελληνικά' },
  { code: 'he', name: 'Hebrew', nativeName: 'עברית' },
  { code: 'ro', name: 'Romanian', nativeName: 'Română' },
  { code: 'hu', name: 'Hungarian', nativeName: 'Magyar' },
  { code: 'sk', name: 'Slovak', nativeName: 'Slovenčina' },
  { code: 'bg', name: 'Bulgarian', nativeName: 'Български' },
  { code: 'hr', name: 'Croatian', nativeName: 'Hrvatski' },
  { code: 'sr', name: 'Serbian', nativeName: 'Српски' },
  { code: 'fa', name: 'Persian', nativeName: 'فارسی' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'ta', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'ur', name: 'Urdu', nativeName: 'اردو' },
  { code: 'fil', name: 'Filipino', nativeName: 'Filipino' },
  { code: 'ca', name: 'Catalan', nativeName: 'Català' },
];

export interface LangMatch {
  entry: LangEntry;
  /** nativeName 上命中的高亮字符区间（半开 [start, end)）；无命中则空 */
  ranges: [number, number][];
}

/** code 的语言主标签（下划线/连字符前的部分，用于 ISO 前缀匹配与 .iso 展示） */
export function isoSubtag(code: string): string {
  return code.split(/[_-]/)[0].toLowerCase();
}

/**
 * 语言搜索匹配（纯函数）。
 * - query 空 → 全部返回（ranges 空，保持原顺序）
 * - 否则大小写不敏感，按 name / nativeName 子串（模糊/首字母）+ code 前缀（ISO）过滤
 * - 相关度排序：ISO code 前缀 > name/nativeName 前缀 > 子串命中
 * - ranges 仅当命中落在 nativeName 上时计算（供 <mark> 高亮）
 */
export function matchLanguages(query: string, entries: LangEntry[]): LangMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return entries.map((entry) => ({ entry, ranges: [] }));
  }

  const scored: Array<{ match: LangMatch; score: number; index: number }> = [];
  entries.forEach((entry, index) => {
    const name = entry.name.toLowerCase();
    const native = entry.nativeName.toLowerCase();
    const iso = isoSubtag(entry.code);
    const codeFull = entry.code.toLowerCase().replace(/_/g, '-');

    const isoHit = iso.startsWith(q) || codeFull.startsWith(q);
    const namePrefix = name.startsWith(q) || native.startsWith(q);
    const nameSub = name.includes(q) || native.includes(q);

    if (!isoHit && !nameSub) return;

    // 分数越小越靠前
    let score: number;
    if (isoHit) score = 0;
    else if (namePrefix) score = 1;
    else score = 2;

    // 高亮 ranges：命中落在 nativeName 上时标出（大小写折叠不改 CJK 长度，索引对齐）
    const ranges: [number, number][] = [];
    const nativeIdx = native.indexOf(q);
    if (nativeIdx !== -1) {
      ranges.push([nativeIdx, nativeIdx + q.length]);
    }

    scored.push({ match: { entry, ranges }, score, index });
  });

  scored.sort((a, b) => (a.score !== b.score ? a.score - b.score : a.index - b.index));
  return scored.map((s) => s.match);
}
