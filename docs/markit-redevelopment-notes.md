# MarkIt Redevelopment Notes

> **层级声明**: `context/构想蓝图2.md` 已整合所有决策并成为本项目的单一真相源。本文件中与构想蓝图2 冲突的决策以构想蓝图2 为准。本文件保留作为方向演变的历史记录。

## Current Context

- 构想蓝图2 (`context/构想蓝图2.md`) 已整合蓝图1、PRD、UI 层级/风格文档、pigeonlib 设计系统和 11 轮苏格拉底式问答，成为 PigeonDeck V1 的单一真相源。
- This repository will use MarkIt as the main behavioral base and ClickDeck as a focused reference for move/drag controls.
- A project-level `CLAUDE.md` now exists at the repo root.
- Key product direction decisions must be saved in this note file, not only remembered in chat.
- For future important forks or tradeoff decisions, ask the user with a choice/input prompt when available instead of only asking in plain chat text.

## Design System (pigeonlib)

**最终裁决**：pigeonlib 设计系统全套照搬。`docs/ui-style.md` 的色彩/字体/图标/圆角/阴影/动效参数已被 pigeonlib 覆盖。

关键设计令牌：
- **点睛色**: 邮政金 `#b8842c`（替代淡墨绿）
- **危险色**: 火漆红 `#b23a2e`
- **成功色**: 橄榄绿 `#5c8a4a`（仅复制/保存成功反馈）
- **底色**: 暖纸白 `#f4efe2`
- **字体**: Fraunces + 思源宋体（标题），系统 sans-serif（正文）
- **图标**: Lucide Icons（MIT），轻量线性 SVG，stroke-width 1.5px
- **圆角**: 控件 9px，卡片/浮层 12px
- **动效**: 三档时序 130ms / 190ms / 260ms
- **主题**: 亮/暗双主题 V1 完整实现

## Product Direction

- Rebuild from MarkIt, reusing most of its useful capabilities while making the product smaller and clearer.
- Chosen redevelopment route: start a new maintainable TypeScript implementation from scratch and reproduce MarkIt's useful behavior, instead of trying to split or directly modify the unpacked bundled `content.js`.
- Keep MarkIt as the primary reference for annotation, element editing, feedback capture, popup behavior, and extension basics.
- Add ClickDeck-style move controls: component dragging, snapping, alignment guides, and move-task prompt generation.
- Do not preserve MarkIt's Dev Mode / Prototype Mode split.
- **V1 只做单页面**（多页面统一导出推迟到 V2，但数据结构预留扩展点）。

## Main Plugin UI

The plugin should start as a floating ball（邮政金圆形底色，直径 40px，抽象鸽子 SVG）。Clicking it opens a **single-column vertical toolbar**.

**最终按钮顺序（从上到下，单列纵向，仅图标 + hover tooltip）**：

1. **Logo** — 点击展开/收起；长按拖拽整体。展开时默认进入批注模式。
2. **移动** — 进入拖拽模式。单击=选中组件；点住即拖（默认无阈值）；Alt+拖=自由移动。
3. **复制文本** — 瞬时动作，复制后按钮内短暂反馈。不改变当前模式。
4. **复制图片** — 瞬时动作，生成长图并复制/下载（设置中切换）。不改变当前模式。
5. **撤销/重做** — 合并为一个按钮（左半=撤销，右半=重做）。默认 50 步上限。
6. **清空** — 点击弹出贴工具盘的小确认弹层，确认后清除所有。
7. **设置** — 打开设置面板，贴工具盘出现。

**批注模式**：展开工具盘即默认进入批注模式——无独立批注按钮、无按钮高亮。批注是默认底态。

Before implementation planning, create an HTML UI mockup that expands all plugin UI states on one page so the user can annotate and critique it.

## Annotation

- Clicking page elements can add annotations.
- An annotation's core model is `target + instruction`.
- Selection granularity should be switchable: default to an intelligent visual component block, with an explicit way to switch to the precise DOM element when needed.
- The user wants to preserve MarkIt's existing ability to directly edit element content and styles.
- **修改栏按元素类型智能切换**：文本元素→排版控件，图片/视频→尺寸+替换，按钮/容器→外观+排版，其他→动态。
- **高级样式区 4 分类**：排版 / 尺寸 / 外观 / 调试（左侧导航 + 右侧控件）。
- **双入口规则**：修改栏常驻控件在高级区再次出现，方便集中操作。
- **调色盘**：收起=小色块+色值文本；展开=完整取色器+局部取色推荐（祖先链取 computed color，去重按频率取前 7）+透明度滑杆。
- Long press ≥300ms → drag allows region selection and region annotation.
- Region annotations record: viewport position + document position + **visible element list inside the region** + coordinate range.

## Move Component

- The move tool is button #2 in the toolbar.
- In move mode:
  - Single-click selects a component.
  - **点住即拖（默认无阈值）**——可在设置中开启防误触阈值。
  - Movement is a temporary page preview (real element, not ghost).
  - The generated text prompt should describe the intended source-code change.
- Snapping and guides:
  - Default movement uses alignment and snapping.
  - Reference lines: dashed, auto-switch white/black per page background, show alignment name (e.g. "水平居中", "8px 间距").
  - Snapping threshold default 4px.
  - Hold `Alt` to disable snapping and free-move.
  - While `Alt` is held, hide/cancel alignment guides.

## Copy Text

- Copy text should produce a complete AI task package.
- **默认语言为英文**（设置中可切换中文或跟随界面）。
- It should include annotations, direct text/style edits, region annotations, and move previews.
- Output structure: Page Context + Global Editing Rules + Operations.
- 样式修改输出为「人类指令 + CSS 属性前后值表」。
- **同元素多操作合并**：若同一元素同时有批注+样式修改+移动，输出为一条合并操作，不拆成两条。
- **去重规则**：同一元素多处修改自动去重合并；去重维度 = 元素选择器 + 修改类型。
- Borrow the useful parts of ClickDeck's prompt discipline:
  - Page context (including viewport resolution)
  - Operation list
  - Location hints (优先使用语义术语，不硬编码坐标)
  - Global editing rules (提示 AI 不要硬编码 top/left)
  - Per-operation target, locator, and instruction

## Copy Image

- Copy image should copy only an image, with no extra text.
- **V1 = 单页长图**（基于标注元素的文档坐标计算范围）。
- Overlays: current page screenshot + annotation numbers + connector lines + region boxes + move previews.
- 设置中可切换「复制到剪贴板」或「下载为文件」。
- 元数据水印（URL/时间）由设置开关控制。

## Move Task Merging

- Same component moved multiple times: copy text only outputs initial → final position.
- Undo/redo history retains each step.

## Clear

- Clear must require a second confirmation (popover attached to toolbar).
- **不设自动清空**：所有清空由用户手动触发，或浏览器 tab 关闭时资源自然释放。
- 确认后清除当前页标注、区域、直接编辑、移动预览、撤销/重做历史；编号从 1 重置。

## Settings

Settings keep minimal V1 scope（4 分区，对齐构想蓝图2 §9）：

| 分组 | 设置项 | 默认值 |
|------|--------|--------|
| 通用 | 界面语言 / 主题(亮/暗) / 选择粒度 / 重置位置 | 中文 / 亮色 / 智能组件块 |
| 交互 | 长按时长 / 拖拽阈值 / 撤销上限 / 标注卡片默认展开 / hover标签 / 快捷键 | 300ms / 0ms / 50步 / 关闭 / 开启 |
| 输出 | 导出语言 / 复制图片方式 / 水印 | 英文 / 剪贴板 / 关闭 |
| 帮助 | 打开安装说明页 | — |

## i18n

- 从第一天起原生支持中/英双语（MV3 标准 `__MSG_*__`）。
- 导出语言独立设置：英文（默认）/ 中文 / 跟随界面。
- 语言选择器支持实时搜索过滤。
- 多语言贡献指南：`_locales/CONTRIBUTING.md` + `AVAILABLE_LANGUAGES.json`。

## Engineering

- 技术栈：Vite + TypeScript + Chrome/Edge MV3。
- 测试：Vitest（单测）+ Playwright（E2E）+ 手动冒烟。
- 测试夹具：本地固定 HTML 夹具覆盖按钮组、卡片列表、表单控件、图片网格、嵌套 flex 布局、绝对定位元素。
- file:// 协议 E2E 验证。
- 构建命令：`npm run build` / `npm run dev` / `npm run typecheck` / `npm test` / `npm run e2e` / `npm run i18n:check`。
- Git 提交策略：每完成一个细分功能提交一次。
- **OpenDesign 兼容**：硬约束——复制文本输出格式兼容 OpenDesign 的 prompt 约定；选型避免引入不兼容依赖。

## V1/V2 Boundary

| 功能 | V1 | V2 |
|------|-----|-----|
| 多页面统一导出 | ❌（数据预留扩展点） | ✅ |
| 长图（单页） | ✅ | — |
| 多页多图 | ❌ | ✅ |
| 工具按钮右键快捷设置 | ❌ | ✅ |
| 暗色主题 | ✅ | — |

## Reference Project Research Needed

Before further brainstorming or PRD finalization, dispatch subagents to study the reference projects:

- MarkIt research:
  - Map actual features and user flows.
  - Identify which capabilities are valuable and should be reused.
  - Identify duplicated or low-value logic caused by dual modes, tutorials, output templates, screenshot/export paths, and settings.
  - Summarize the main content-script modules that need to be rebuilt from the bundled `content.js`.
- ClickDeck research:
  - Map move/drag/region-selection behavior.
  - Extract snapping, alignment-guide, region-context, and prompt-output logic worth adapting.
  - Identify which parts are too heavy and should not be copied.

## Next Deliverables

1. ✅ ~~Continue brainstorming after reference-project research.~~（构想蓝图2 已整合所有决策）
2. ✅ ~~Produce a complete PRD for Codex target mode.~~（`docs/prd.md` 已按蓝图2 更新）
3. ~~Before entering plan mode, create one HTML page that shows all plugin UI elements and states for user critique.~~（待执行）
4. ~~Only after the PRD and UI critique are stable should implementation planning begin.~~（当前阶段）
