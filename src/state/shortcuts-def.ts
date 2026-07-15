/* ============================================================
   shortcuts-def.ts — 快捷键单一数据源（建议6：全量可重绑）
   仅存 i18n key 字符串，不 import content 层 / i18n，避免 state→content
   循环依赖，使 settings.ts 可在模块加载期引用 buildDefaultShortcuts()。
   combo 串格式见 content/shortcuts.formatCombo：Mod/Shift/Alt 固定序 + 主键。
   `Mod` = Ctrl（Win/Linux）/ Cmd（Mac），一份绑定跨平台通用。
   ============================================================ */

/** 快捷键分类（设置面板 + 教程页分组用）。 */
export type ShortcutCategory = 'global' | 'editing' | 'selection' | 'move';

/**
 * 快捷键种类：
 * 'combo'    = 完整组合键（可录制重绑，走 formatCombo/matchCombo）。
 * 'modifier' = 按住的单一修饰键（如 Alt 自由移动），从鼠标/键盘事件读修饰属性，
 *              「重绑」= 改选哪个修饰键（Alt/Mod/Shift/Meta），不走录制。
 */
export type ShortcutKind = 'combo' | 'modifier';

export interface ShortcutDef {
  id: string;
  /** 默认绑定：combo 串（如 'Mod+Z'）或修饰 token（如 'Alt'）。 */
  defaultCombo: string;
  category: ShortcutCategory;
  /** i18n key（渲染时经 t() 解析），不在此调用 t()。 */
  labelKey: string;
  descKey: string;
  kind: ShortcutKind;
  /** 护栏：录制时若组合无修饰键则拒绝（防裸 Enter 吞掉文本框换行）。 */
  requireModifier?: boolean;
}

/** 全部快捷键定义（唯一真相源）。 */
export const SHORTCUT_DEFS = [
  { id: 'undo', defaultCombo: 'Mod+Z', category: 'global', labelKey: 'tb_undo', descKey: 'set_tip_sc_undo', kind: 'combo' },
  { id: 'redo', defaultCombo: 'Mod+Shift+Z', category: 'global', labelKey: 'tb_redo', descKey: 'set_tip_sc_redo', kind: 'combo' },
  { id: 'exit', defaultCombo: 'Escape', category: 'global', labelKey: 'set_sc_exit', descKey: 'set_tip_sc_exit', kind: 'combo' },
  { id: 'save', defaultCombo: 'Mod+Enter', category: 'editing', labelKey: 'set_sc_save', descKey: 'set_tip_sc_save', kind: 'combo', requireModifier: true },
  { id: 'delete', defaultCombo: 'Delete', category: 'selection', labelKey: 'set_sc_delete', descKey: 'set_tip_sc_delete', kind: 'combo' },
  { id: 'moveFree', defaultCombo: 'Alt', category: 'move', labelKey: 'set_sc_movefree', descKey: 'set_tip_sc_movefree', kind: 'modifier' },
] as const satisfies readonly ShortcutDef[];

export type ShortcutId = (typeof SHORTCUT_DEFS)[number]['id'];

/** 可选修饰 token（modifier 类选择器用；展示走 displayCombo）。 */
export const MODIFIER_TOKENS = ['Mod', 'Alt', 'Shift', 'Meta'] as const;

/** 从 registry 构建完整默认绑定表（DEFAULT_SETTINGS.shortcuts 与 loadSettings 补全共用）。 */
export function buildDefaultShortcuts(): Record<ShortcutId, string> {
  return Object.fromEntries(SHORTCUT_DEFS.map((d) => [d.id, d.defaultCombo])) as Record<ShortcutId, string>;
}

/** combo 是否含至少一个修饰键（或本身即裸修饰 token）。 */
export function comboHasModifier(combo: string): boolean {
  const head = combo.split('+')[0];
  return combo.includes('+') || (MODIFIER_TOKENS as readonly string[]).includes(head);
}

/**
 * registry 驱动的冲突检测：返回冲突动作 id，无冲突返回 null。
 * 仅在 kind:'combo' 之间比较（modifier 类与组合键不共命名空间），忽略自身。
 */
export function findShortcutConflict(
  shortcuts: Record<string, string>,
  selfId: string,
  combo: string
): string | null {
  const lc = combo.toLowerCase();
  for (const d of SHORTCUT_DEFS) {
    if (d.kind !== 'combo' || d.id === selfId) continue;
    if ((shortcuts[d.id] ?? '').toLowerCase() === lc) return d.id;
  }
  return null;
}
