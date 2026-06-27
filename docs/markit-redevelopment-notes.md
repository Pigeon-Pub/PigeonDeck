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
3. ✅ ~~Before entering plan mode, create one HTML page that shows all plugin UI elements and states for user critique.~~（已交付为**组件画廊** `preview/`，按用户选择采用画廊形式而非单页集成；见下方「UI 预览草稿」小节）
4. ~~Only after the PRD and UI critique are stable should implementation planning begin.~~（当前阶段）

## UI 预览草稿与初期视觉方向（2026-06-27 会话裁决）

**交付物**：`preview/` 组件画廊。`preview/pigeonlib.css`（设计令牌 + 基础控件配方）+ `preview/index.html`（画廊宿主，复刻 `ui-extract/components.html` 形式）+ `preview/parts/01–16-*.html`（16 个 PD 表面，各自渲染在中性网页背景上）。验证方式：在 `preview/` 起静态服务后用浏览器/Playwright 截图逐卡核对。

**裁决 1 — 初期视觉方向：MarkIt 形态 + 邮政金皮肤**
- 初期先做 MarkIt 的「小改款」：沿用 MarkIt 的**形状与布局**（上下圆形 pill 胶囊工具盘、圆形悬浮球、面板/控件比例、控件行/分段/开关/左导航等结构），配色用已裁决的 pigeonlib（暖纸白 + 邮政金 + 宋体标题 + Lucide）。
- **PD 自己的特色留到后期**再做。
- 玻璃拟态仍属构想蓝图2 禁区，**不**沿用 MarkIt 的深色玻璃质感。
- V1 砍掉的 MarkIt 功能确认不进预览：开发/原型双模式、AI/Bug/PRD 输出模板、输出详细度、多 pin 样式、Markdown 导出、隐藏标注。

**裁决 2 — 批注/编辑面板去顶栏**
- 删掉 MarkIt 的 `markit-pnl-hdr` 顶部栏（拖拽条 + 「开发标注 #1」标题 + AI/Bug/PRD 模板按钮 + 关闭 ✕）——「这里没有任何有用信息」。
- 面板**无显式关闭按钮**：靠 Esc / 点击面板外 / 保存关闭。
- 需要显示的信息与操作集成到**底栏**：左 `位号 · 元素类型 · 位置(px)`，右 删除 + 保存。该底栏模式与批注卡片底栏统一（卡片底栏右侧为 删除 + 修改）。

**裁决 3 — 第二轮收紧（2026-06-27 截图批注）**
总原则：**这是悬浮工具，占用最小视线成本**——全局更紧凑、减少「廉价」的横线分割。
- **悬浮球/工具盘**：悬浮球收到与 MarkIt 触发球同尺寸 **42px**；工具盘列宽与悬浮球一致（按钮 34px border-box + padding 3 + 边 1 = 42）。
- **工具盘按钮顺序**：撤销/重做移到 **Logo 与「移动」之间**，做成**横向药丸**（左半撤销 / 右半重做）；**Logo 展开态也用金底浅羽**（与收起球一致）；**设置图标改齿轮**；**去掉 pill 内的短横线分割**。
- **批注/编辑面板**：去掉顶部「希望 AI 怎么改」**标题**（标题无信息量）。~~去掉 prose 输入框~~ → 见裁决 4 修正：**文本框保留**，只去标题。
- **高级样式区**：① 加**底框**（导航 + 控件收进一个浅底容器，内部调色盘去内边框避免卡片套卡片）；② **删除**底部 Before/After 总览；③ 左侧分类导航在该类有改动时显示**变更角标**（左竖条 + 计数点）；④ 变更说明改为**贴在小节标题右侧**、精简为「旧 → 新」（如 `圆角 7px → 12px`）。
- **设置面板**：加**分类导航**（通用/交互/输出/帮助，**圆形选中样式**、更窄更紧凑）；**限定长度**（按分类收敛，不再一长条）；**去掉逐行横线**，靠留白 + 分组标题分隔。
- **区域批注**：删除按钮改**垃圾桶图标**（与面板/卡片底栏统一）。
- 预览复核：用无依赖 CDP 脚本（Node 24 全局 WebSocket 驱动 `chrome-headless-shell`）量测各表面真实高度并截图，回填 `index.html` 的 iframe 高度。

**裁决 4 — 第三轮（2026-06-27 截图批注，先提交首版再改）**
- **先提交**：改动前先把首版预览提交一次（提交信息**不提及参考项目名**），再迭代。
- **悬浮球/Logo 尺寸锁定**：收起态悬浮球 **42px 不变**；展开后 Logo 金底球也**保持 42px、不变大也不缩小**；工具盘其余按钮放大到 38px，整体**适当加宽**。
- **撤销/重做药丸**：箭头太淡 → **加深（正文色）+ 加粗（stroke 1.9）**，合并药丸放大到 38×24。
- **批注文本框保留**：只去掉「希望 AI 怎么改」标题，**文本框本身保留**，占位提示改为 **`补充修改说明…`**（主态/高级态都保留）。
- **面板内减少圆角矩形**：**单行控件统一改药丸形**（输入框 / 下拉 / 数字步进 / 分段 / 按钮 / 图标按钮 / 色值条 / 粒度切换）；**多行文本框与分组容器**（modbar、高级样式底框）**保留圆角矩形**，避免全药丸失去层次。
- **数字步进顺序**：改为 `输入 → 步进(+/−) → 单位`（加减放单位前面）。
- **有图标的分段用图标**：如对齐 左/居中/右 改用对齐图标（Lucide align-left/center/right）。
- **清空确认弹层修复**：原弹层工具盘仍是旧版（旧顺序 + 短横线 + 旧设置图标），且箭头未对准清空键 → 同步为新工具盘布局，清空按钮置危险态，弹层箭头重新对准清空键。

**裁决 5 — 多状态补全 + 右键菜单 + 暗色 + 缩放句柄（2026-06-27 第四轮）**
本轮把组件画廊从「每个多状态表面只画一态」扩成「每个状态/子页各自成卡」，并补齐蓝图里还没画的表面。新增 `preview/parts/17–32-*.html`，`pigeonlib.css` 增 `.pd-menu`/`.pd-menu-item`（上下文菜单）与 `.pd-range`（滑杆）两个基元。
- **设置 4 子页各自成卡**：通用 / 交互 / 输出 / 帮助（原 13 保留为交互页）。**帮助页新增「检查更新」行**（用户要求）。**导出语言**确认为多语言分段「英文 / 中文 / 跟随」、**默认英文**（用户要求）。
- **高级样式 4 子页各自成卡**：排版 / 尺寸 / 外观 / 调试（原 12 保留为外观页）。调试页 = 只读 DOM 信息 + computed style，computed 区 `.pd-scroll` 限高、按行整齐截断。
- **新表面**：调色盘展开（取色器 + 局部取色推荐 7 色 + 透明度滑杆）、双击文本内联编辑、图片/视频替换流程、语言选择+搜索（输入「中」高亮命中）。
- **右键菜单（仅这两处；§14 的「工具按钮右键快捷设置」属 V2，不做）**：位号圆右键「修改批注 / 删除批注」（删除项火漆红）、浏览器右键嵌入「用 PigeonDeck 快速标注」（金底高亮 + Alt+P，与原生项拉开）。
- **页面级轻提示族**：复制成功(橄榄绿√) / 保存成功 / 找不到目标元素(中性金) / PDF 不支持(火漆红)。
- **暗色版关键面板**：批注主面板 / 高级样式 / 设置 各出一张 `data-theme="dark"` 卡，dark host 底，验证双主题。
- **选中框四角方块 = 可缩放句柄（方向变更）**：用户裁决移动模式下**拖四角直接改尺寸**，不再只在面板里调 width/height。**这超出原蓝图2「改尺寸只在面板调」的范围**，已同步更新蓝图2 §4.3。预览中选中框四角方块视觉本就在，正好对应此语义。
- **截断修复纪律**：逐卡 CDP 截图复核，凡 `scrolling=no` 下被切的（替换弹层、浏览器右键菜单、帮助页、`.num-sm` 的「px」单位等）回填高度/宽度直至不切。
- **粒度（元素/容器）的作用**（解释，已记入认知）：网页 DOM 深层嵌套，单击一处可能命中很深的节点。PigeonDeck 默认选「智能组件块」并给「元素↔容器」切换，让用户**不必精确点中目标 DOM 节点**即可选对范围；移动/缩放/批注的 Target 选择器随之确定。
- **待补（本轮内，待用户裁决后落地）**：富文本内联编辑增强（见裁决 6）。

**裁决 6 — 逐字符富文本内联编辑（2026-06-27 第五轮）**
- 诉求：双击文本进入编辑后，**选中其中几个字**即可单独改格式（参考 Word/Docs 的选区浮条），不止整段统一改。
- 形态裁决：**双行全功能浮条**，贴在选区上方。第一行 字体▾ / 字号▾ / 字色(A+色条) / 高亮▾；第二行 B I U S / 上标 x² 下标 x₂ / 对齐▾ / 列表。
- 语义：浮条对**选中字符 run**生效（逐字符富文本），与修改栏的元素级排版**并行**——浮条管选区、修改栏管整个文本元素。改动即时预览、进撤销历史。
- 落地：预览 `preview/parts/24-inline-edit.html` 改为该双行浮条 + 选区 run（「今日截止」放大+加粗+品牌金）；蓝图2 §4.2、§5.1 已补「内联富文本浮条」规格。

