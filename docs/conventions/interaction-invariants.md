---
name: interaction-invariants
description: 页面内 UI 的交互不变量（浮层/拖拽/编辑/选中/打印/动画），实现新 UI 必须遵守
---

# 规则：交互不变量（UI Interaction Invariants）

**这些是反复出现的交互约定。新增或改动任何页面内 UI 时必须遵守，不要让用户再逐条提醒。** 每条列出「规则」+「由谁强制」（现有实现锚点），改代码时优先复用这些机制而非另起炉灶。

## 1. Shadow DOM 四层与层级
- 层级唯一真相：`src/content/base.css` `[data-layer]` —— control(z4 工具盘/悬浮球) / panel(z3 卡片/设置/导出) / overlay(z2 hover/标签/选框/区域/参考线/位号) / feedback(z5 最高，仅灯箱等全屏件)。
- **hover 高亮/标签挂 overlay 层（z2）**，绝不盖住工具盘或面板。由 `src/content/overlay.ts` 决定挂载根。

## 2. hover 抑制
- 鼠标悬浮**当前已选中的元素**时不重复画 hover 框：批注模式经 `PanelManager.getSelectedTarget()` 注入 `Overlay`；移动模式比对 `SelectionBox.getSelected()`。
- **重新选中已标注元素**时，隐藏该标注的持久框/位号（避免与八句柄框重叠），关闭时恢复。由 `Overlay.setSuppressedMark()` + `PanelManager.openPanel/closePanel` 强制。

## 3. 浮层（popover/下拉/调色盘/语言选择器）
- **再点即关（toggle，绝不叠开）**：每个触发钮用 `bindPopoverToggle(trigger, open)`（`src/content/popover.ts`）。点开着的触发钮 = 关闭；点别的触发钮 = 关旧开新。禁止裸调 `openDropdown/openColorPicker/...` 而不经 toggle 包装。
- **Esc 分层**：浮层经 `mountPopover` 自动 `pushEsc` 入 [[esc-stack]]。Esc 先关最顶层浮层（`stopImmediatePropagation`），栈空后下一次 Esc 才由 `shortcuts.ts` 退模式/关面板。
- **紧凑 2 项菜单**用 `openDropdown({ plain:true })`（无「全部/智能」分组头）。

## 4. 拖拽关闭规则
- **拖拽任意面板** → 关闭其派生浮层：`makeDraggableByHandle`（`src/content/panel.ts`）在真正开拖时 `closeAllPopovers()`。
- **拖拽工具盘/悬浮球** → 关闭**工具盘派生面**（设置 / 复制文本 / 复制图片 / 清空确认）+ 所有浮层；**但不关**内容面板（批注卡片/面板、移动选中、区域面板）。由 `Toolbar` 的 `onDragStart`（越过拖拽阈值时触发）→ `main.ts` 关设置模式 + `copyText/copyImage.close()` + `closeAllPopovers()` 强制。

## 5. 编辑面统一按键
- **所有文字编辑面：`Ctrl/Cmd+Enter` = 保存/提交，`Esc` = 不保存退出。** 覆盖：批注说明 textarea、区域说明、内联富文本、替换媒体、复制文本可编辑预览。新加任何编辑面必须两键齐备。

## 6. 顶栏可拖
- 带上边栏/把手的卡片（批注面板、区域面板、设置、导出面板）可**按住上边栏空白区拖动**：统一用 `makeDraggableByHandle(panelEl, handleEl)`，它自动忽略落在 `button/input/textarea/select/a` 上的按下。

## 7. 工具盘按钮
- **系统原生 `title` tooltip**（不用自制浮层 tip）。
- 禁用态（撤销/重做不可用）**不改变鼠标光标形状**（无 `not-allowed`），仅降透明度 + 不可点。
- 键盘 Esc 退模式后**不留焦点框**（`.pd-tbtn:focus-visible { outline:none }`）。
- 向下展开时拖拽悬浮球，工具盘按当前展开方向锚定，**不整体上抬**。

## 8. 导出不自动化
- 「复制文本」「复制图片」点击后**不直接写剪贴板/下载**，一律开页内面板由用户选「复制」或「下载」。导出面板：顶栏（标题 + 右上 X，无「取消」）+ 可拖 + 可编辑预览（编辑不跨重开保留）+ 图片单击出页内灯箱。

## 9. 打印
- 打印页面时**扩展 UI 不得留印子**：`main.ts` 向页面 `document.head` 注入 `@media print { #pd-host { display:none !important } }`，隐藏 Shadow 宿主。

## 10. 动画
- 卡片/面板**长度变化 + 弹出**走统一动画：高度用 `animateHeight`（`panel.ts`，显式 px→px 的 rAF FLIP + `transitionend` 收尾，勿在设终值后同步读 `offsetHeight`/重定位，否则过渡不触发）；进入用 `@starting-style` 淡入（`.panel/.acard/[data-pd-popover]`）。时序用 `--t-mid`/`--ease`。

## 11. 状态生命周期
- 批注**仅存当前 tab 会话内存**，无跨页面、无刷新保留（已彻底移除持久化）。刷新即清空。

相关实现：[[esc-stack]] 机制、`popover.ts`（`bindPopoverToggle`/`closeAllPopovers`/`mountPopover`）、`panel.ts`（`makeDraggableByHandle`/`animateHeight`）。
