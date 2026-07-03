/* ============================================================
   settings.ts — 极简设置存取（chrome.storage.local）
   本阶段仅 hoverLabel / cardDefaultExpanded 两项，结构留好扩展。
   ============================================================ */

export interface Settings {
  /** 元素 hover 标签（默认开启） */
  hoverLabel: boolean;
  /** 标注卡片默认展开（默认关闭） */
  cardDefaultExpanded: boolean;
  /**
   * 移动/批注模式默认选择粒度：
   * 'smart'   = 智能组件块（resolveComponentBlock 启发式爬升）
   * 'element' = 命中元素本身（不爬升）
   * 阶段 11 再做设置 UI，本阶段只加字段 + 消费。
   */
  defaultGranularity: 'smart' | 'element';
  /**
   * 撤销/重做历史步数上限（默认 50，最高 9999）。
   * 阶段 11 再做设置 UI，本阶段只加字段 + 消费。
   */
  historyLimit: number;
  /**
   * 复制文本导出语言（蓝图 §7.1：默认英文，可切中文或跟随界面）：
   * 'en' / 'zh_CN' = 固定语言；'auto' = 跟随界面语言（i18n locale，回退 en）。
   * 完整设置 UI 在阶段 11，本阶段只加字段 + 消费 + 结果弹窗快切。
   */
  exportLang: 'en' | 'zh_CN' | 'auto';
  /**
   * 复制图片输出方式（蓝图 §7.2）：
   * 'clipboard' = 写入剪贴板（默认）；'download' = 下载为 PNG 文件。
   * 生成后按此项自动执行一次；结果弹窗仍同时提供两个按钮。
   */
  imageMethod: 'clipboard' | 'download';
  /**
   * 复制图片元数据水印（蓝图 §7.2）：开启后在长图底部叠加
   * 「URL · 时间戳」小字。默认关闭。
   */
  watermark: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  hoverLabel: true,
  cardDefaultExpanded: false,
  defaultGranularity: 'smart',
  historyLimit: 50,
  exportLang: 'en',
  imageMethod: 'clipboard',
  watermark: false,
};

const STORAGE_KEY = 'settings';

/** 读取设置：storage 值与默认值合并，storage 不可用时返回默认值 */
export async function loadSettings(): Promise<Settings> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const stored = result[STORAGE_KEY];
    if (stored && typeof stored === 'object') {
      return { ...DEFAULT_SETTINGS, ...(stored as Partial<Settings>) };
    }
  } catch {
    // storage 不可用时静默使用默认值
  }
  return { ...DEFAULT_SETTINGS };
}

/** 局部更新设置并持久化 */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await loadSettings();
  const next = { ...current, ...patch };
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: next });
  } catch {
    // 静默失败，返回内存中的合并结果
  }
  return next;
}
