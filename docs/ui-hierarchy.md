# PigeonDeck UI 层级关系

> **权威声明**: 本文件描述 PigeonDeck 的 UI 层级与信息架构。最终裁决以 `context/构想蓝图2.md` 为准——当本文件与其冲突时，以构想蓝图2 为准。

## 1. 设计目的

本文定义 PigeonDeck 的 UI 层级、界面入口、状态关系和信息架构。它不决定最终视觉风格、配色、图标、动效或具体尺寸——这些已由 `context/构想蓝图2.md` §2 的 pigeonlib 设计系统裁决。

当前已确认的主入口是：**logo 悬浮球点击后展开单列纵向工具盘**。

## 2. 顶层界面结构

PigeonDeck 有四类 UI 表面：

1. **页面内主 UI**：注入网页，是主要操作入口。
2. **页面内覆盖层**：用于元素选择、区域框选、批注、移动预览、参考线和轻提示。
3. **浏览器 popup**：用于扩展开关、站点禁用、权限提示和禁用列表入口。
4. **安装说明页**：安装后打开，也可从设置中重新打开。

```text
PigeonDeck
├─ Page Surface
│  ├─ Main Entry
│  │  ├─ Collapsed: Logo Floating Ball
│  │  └─ Expanded: Single-Column Toolbar
│  ├─ Context Panels
│  │  ├─ Annotation / Edit Panel
│  │  ├─ Region Annotation Panel
│  │  ├─ Settings Panel
│  │  └─ Clear Confirmation Popover
│  ├─ Page Overlays
│  │  ├─ Hover Highlight
│  │  ├─ Selection Box
│  │  ├─ Region Box
│  │  ├─ Annotation Pins
│  │  ├─ Annotation Cards
│  │  ├─ Connector Lines
│  │  ├─ Move Preview
│  │  ├─ Alignment Guides
│  │  └─ Element Hover Labels
│  └─ Inline Feedback
│     ├─ Button Inline Status
│     └─ Lightweight Hint
├─ Extension Popup
│  ├─ Current Site Status
│  ├─ Global / Site Disable
│  ├─ Permission Notices
│  └─ Disabled Sites Entry
└─ Onboarding Page
   ├─ Quick Start Flow
   ├─ Example Walkthrough
   └─ Feature Overview
```

## 3. 页面内主入口

### 3.1 收起态：Logo 悬浮球

```text
Logo Floating Ball
└─ Click: expand / collapse toolbar
└─ Long Press: drag to reposition
```

规则：

- 收起时页面上只能看到一个纯粹的品牌 logo 悬浮球，不显示文字、工具按钮、提示条或额外装饰。
- 悬浮球品牌 logo（抽象鸽子轮廓 SVG）显示在**邮政金圆形底色**上（`#b8842c`），直径 40px。
- 悬浮球作为品牌 logo 和主入口，点击后展开工具盘。
- 悬浮球和展开后工具栏顶部的 logo 是同一个入口的不同状态。
- 再次点击展开态 logo 收起工具盘。
- **长按悬浮球 → 拖拽移动位置**（展开后整体插件随之移动）。位置持久化到 localStorage。
- 默认停靠右下角，距边缘 16px。

### 3.2 展开态：单列纵向工具盘

展开后显示单列图标栏，不再显示 2x3 网格或顶部横幅。Logo 进入工具栏顶部。

```text
Single-Column Toolbar (top to bottom)
├─ 1. Logo
│     Click: expand / collapse
│     Long Press: drag whole extension
├─ 2. Move
│     Click: enter / exit move mode
├─ 3. Copy Text
│     Click: instant copy task list
├─ 4. Copy Image
│     Click: instant generate long image
├─ 5. Undo / Redo (merged)
│     Left half: undo
│     Right half: redo
├─ 6. Clear
│     Click: show confirmation popover
└─ 7. Settings
      Click: open settings panel
```

展开与定位规则：

- 点击收起态 logo 后，工具栏默认向右下展开。
- 展开后不再额外保留一个独立悬浮球；入口 logo 只出现在工具栏顶部。
- 展开方向：默认向右下；靠近视口底部 → 向上展开；靠近视口右边 → 向左展开。
- 工具栏手动收起为主；选中工具后不自动收起，方便连续操作。

工具按钮规则：

- 按钮仅图标，hover 时在旁边显示 tooltip（文字标签）。
- 当前激活工具按钮高亮（邮政金），并在工具盘外层显示轻量描边。
- **批注模式无按钮高亮**（批注是展开后的默认底态）。
- 复制文本/复制图片是瞬时动作，不改变当前工具模式，成功/失败的反馈在按钮内部短暂变化。
- 清空使用贴工具盘的小确认弹层。

### 3.3 清空确认弹层

```text
Clear Confirmation Popover
├─ Message
├─ Confirm Clear
└─ Cancel
```

规则：

- 第一次点击清空后，在工具盘旁出现小确认弹层。
- 确认后清除当前页标注、区域、直接编辑、移动预览、历史记录和编号。
- 取消或点击外部区域关闭确认弹层。

## 4. 页面层级与 Shadow DOM

页面内 UI 应挂在 Shadow DOM 下，避免网页 CSS 污染插件，也避免插件样式影响网页。

```text
PigeonDeck Shadow Root
├─ Control Layer
│  └─ Main Entry
│     ├─ Collapsed: Logo Floating Ball
│     └─ Expanded: Single-Column Toolbar
├─ Panel Layer
│  ├─ Annotation / Edit Panel
│  ├─ Annotation Card
│  ├─ Region Annotation Panel
│  ├─ Settings Panel
│  └─ Clear Confirmation Popover
├─ Overlay Layer
│  ├─ Hover Highlight
│  ├─ Element Hover Label
│  ├─ Selection Box
│  ├─ Region Box
│  ├─ Annotation Pins
│  ├─ Connector Lines
│  ├─ Move Preview
│  └─ Alignment Guides
└─ Feedback Layer
   ├─ Button Inline Status
   ├─ Lightweight Hint
   └─ Unsupported Page Notice
```

## 5. 工具模式层级

同一时间只有一个主工具模式处于激活态。**展开工具盘即默认进入批注模式**——批注无独立按钮、无按钮高亮。复制文本、复制图片和清空是瞬时动作，不长期占用模式。

```text
Active Mode
├─ Annotation Mode (default, no button highlight)
├─ Move Mode
├─ Settings Mode
└─ (Copy Text / Copy Image / Clear — instant actions, not modes)
```

切换规则：

- 展开工具盘 → 自动进入批注模式（默认底态）。
- 点击移动按钮 → 进入移动模式，移动按钮高亮。再点移动 → 取消选中，回到默认批注态。
- 点击设置 → 进入设置模式。关闭设置面板 → 回到默认批注态。
- 切换工具只退出当前交互，不清除已保存批注、编辑或移动预览。
- 设置面板打开时，暂停页面选择和拖动。
- 复制文本/复制图片不改变当前工具模式。
- 收起工具盘 → 退出当前激活模式，但已批注内容保留在页面上。

## 6. 标注与编辑面板

### 6.1 面板定位

批注/编辑面板贴近目标元素出现，并智能翻转避让视口边界。

```text
Annotation / Edit Panel
├─ Header
│  ├─ Annotation Number
│  ├─ Target Summary
│  └─ Close
├─ Primary Instruction
│  └─ Instruction Textarea
├─ Modification Bar (smart switch by element type)
├─ Advanced Style Area
└─ Actions
   ├─ Save / Update
   └─ Delete
```

规则：

- 面板打开后默认聚焦批注输入框。
- 批注输入优先，样式编辑服务于批注和视觉预览。
- 如果面板遮挡目标或超出视口，优先自动翻转到目标上下左右的可见位置。

### 6.2 修改栏（智能切换）

修改栏按目标元素类型自动切换显示的控件，不折叠始终可见：

```text
Modification Bar (smart switch by element type)
├─ Text elements → text content edit + typography controls
├─ Images → size / border / radius + replace button
├─ Videos → size / border / radius + replace button
├─ Buttons / Containers → appearance + typography / spacing
└─ Others → dynamic most-relevant controls
```

| 元素类型 | 修改栏内容 |
|----------|-----------|
| 文本元素 | 文字内容编辑框 + 排版控件（字体/字号/字重/颜色/对齐/行高/字距/margin/padding） |
| 图片 | 尺寸/边框/圆角 + 替换图片按钮 |
| 视频 | 尺寸/边框/圆角 + 替换视频按钮 |
| 按钮/容器 | 外观控件（边框/圆角/阴影/不透明度）+ 排版/间距控件 |
| 其他 | 根据当前 CSS 属性动态列出最相关控件 |

### 6.3 高级样式区

高级样式区用左侧导航控制复杂度，4 个分类按使用频率从上到下排列。

```text
Advanced Style Area
├─ Left Navigation
│  ├─ Typography
│  ├─ Size
│  ├─ Appearance
│  └─ Debug
└─ Current Section
   ├─ Controls
   └─ Before / After Values
```

| # | 分类 | 包含控件 |
|---|------|----------|
| 1 | **排版** | 字体、字号、字重、颜色、对齐方式、行高、字距、margin、padding、列表样式 |
| 2 | **尺寸** | width、height、min/max 尺寸、display 模式切换 |
| 3 | **外观** | 背景色、背景图、边框、圆角、阴影、透明度、替换图片/视频 |
| 4 | **调试** | 完整 computed style、DOM 信息（tagName、className、ID、属性列表） |

**双入口规则**：已在修改栏常驻区出现过的控件（如颜色），在高级区的「排版」和「外观」中再次出现——方便用户在高级区集中操作。

高级区原则：

- 每项修改都应能即时预览并进入撤销/重做历史。
- 输出给 AI 时保留人类说明和 CSS 属性前后值。
- **调色盘**：收起 = 小色块 + 色值文本；展开 = 完整取色器 + 局部取色推荐（从当前元素及祖先链取色，去重按频率排序取前 7）+ 透明度滑杆。
- **数值控件**：文本框 + 右侧 `+`/`-` 按钮 + 原生滚轮微调。

## 7. 标注框与批注卡片

### 7.1 标注框与位号

- 每个已标注/编辑的元素显示**圆角矩形边框**（邮政金 `--c1`，线宽 1.5px）。
- 边框左上角附**圆形位号标记**（邮政金填充 + 白色数字）。
- 位号按全局标注顺序递增分配，删除不重排。
- 点击位号圆 → **展开/收起该标注的批注卡片**（默认收起，设置中可改为默认展开）。
- 右键位号圆 → **上下文菜单**"删除批注"和"修改批注"。

### 7.2 批注卡片

展开后的紧凑矩形框，结构：

| 区域 | 内容 | 显示条件 |
|------|------|----------|
| 上半部分 | 完整批注文本 | 有批注时显示 |
| 下半部分 | `调整项：原值 → 新值`，每项一行 | 有样式/内容修改时显示 |
| 底部栏 | 左：位号 · 元素类型 · 位置(px)；右：SVG 删除按钮 + SVG 修改按钮 | 始终显示 |

**布局规则**：
- 文本自适应高度，不截断。
- 有内容的区域才显示，无批注则不显示上半部分，无修改则不显示下半部分。
- **定位**：四向翻转选择最佳方向；不遮挡其他已标注元素（含其边框、位号、卡片）；所有邻近方向都被占用时画虚线箭头连接回位号圆。
- **删除/修改入口双通道**：右键位号圆菜单 + 卡片底栏按钮共存。

## 8. 元素 hover 标签

- 工具盘展开后，鼠标 hover 任意页面元素，在其高亮描边框上方显示元素类型标识（`div`、`img`、`span` 等）。
- 样式：9px 字号、半透明深色背景、邮政金描边、跟随鼠标位置实时移动。
- 设置中提供开关（默认开启）。收起工具盘时不显示。

## 9. 区域批注层级

区域批注是批注模式下的框选分支，不是独立工具。

```text
Region Annotation
├─ Drag Region Box (gold border + light fill)
├─ Region Annotation Panel
│  ├─ One-sentence Instruction
│  ├─ Save
│  └─ Delete
└─ Saved Region
   ├─ Region Outline
   ├─ Number Pin
   └─ Connector Line
```

规则：

- 长按 ≥300ms 后拖拽框选区域。
- 实时显示品牌金边框 + 浅金填充矩形预览。
- 松手后弹出区域批注面板，用户只填写一句修改说明。
- 内部记录：视口位置 + 文档位置（相对 body）+ 框内可见元素列表 + 坐标范围。
- 区域批注和元素标注共用同一套编号系统。
- 区域批注同时参与复制文本和复制图片。

## 10. 移动组件层级

移动模式保留真实元素移动预览，默认无拖拽阈值（点住即拖），但覆盖层保持克制。

```text
Move Mode
├─ Component Selection
│  ├─ Selection Box
│  └─ Granularity Switch
├─ Dragging
│  ├─ Real Element Preview
│  └─ Alignment Guides (dashed, auto-color)
├─ Free Move (Alt held)
│  ├─ Real Element Preview (no guides)
│  └─ Free Move Indicator
└─ Saved Move Task
   ├─ Initial Position
   └─ Final Position
```

规则：

- 单击选中组件，显示邮政金选中框 + 粒度切换按钮。
- 点住即拖（默认无阈值，设置中可开启防误触阈值）。
- 元素本身跟随移动，用户能看到真实预览。
- 默认显示参考线：虚线，颜色根据页面背景自动切换白/黑，显示对齐方位名称（如「水平居中」「8px 间距」）。
- 按住 Alt 时隐藏参考线并取消吸附，记录为 free move。
- 吸附算法：扫描当前视口内所有可见块级元素 → 计算距离 → 阈值内（默认 4px）自动吸附到对齐位。
- 松手自动生成移动任务，不弹出确认卡片。
- 同一组件多次移动时，输出合并为初始位置到最终位置；撤销历史仍保留每一步。

## 11. 设置面板层级

设置面板从工具盘的设置按钮打开，并贴近工具盘出现。它采用分区短表单，不做重型设置中心。

```text
Settings Panel
├─ General
│  ├─ Interface Language
│  ├─ Theme (Light / Dark)
│  ├─ Default Selection Granularity
│  └─ Reset Plugin Position
├─ Interaction
│  ├─ Long Press Duration (region select)
│  ├─ Drag Threshold (anti-mistouch)
│  ├─ Undo History Limit
│  ├─ Annotation Card Default Expand
│  ├─ Element Hover Label
│  └─ Shortcuts
├─ Output
│  ├─ Export Language
│  ├─ Copy Image Method
│  └─ Image Metadata Watermark
└─ Help
   └─ Open Onboarding Page
```

规则：

- 设置面板打开时暂停页面选择和拖动。
- "重新打开教程"打开安装说明页新标签。
- V1 不在设置中展示复杂主题、多 pin 样式、多输出模板或输出详细度。

## 12. 安装说明页

教程以安装说明页为主，不在页面内做完整教程浮层。

```text
Onboarding Page
├─ Quick Start Flow
│  ├─ Open Toolbar
│  ├─ Add Annotation
│  ├─ Move Component
│  ├─ Copy Text / Image
│  └─ Clear / Undo / Redo
├─ Example Walkthrough
│  └─ One Complete Page-change Scenario
└─ Feature Overview
   ├─ Annotation
   ├─ Move
   ├─ Copy
   ├─ Settings
   └─ Popup Controls
```

入口：

- 安装后自动打开说明页。
- 设置面板中可以重新打开说明页新标签。

## 13. 浏览器 Popup 层级

浏览器 popup 只做状态与开关为主，不承载完整设置。

```text
Extension Popup
├─ Header
│  ├─ Product Name
│  └─ Current Site
├─ Status
│  ├─ Extension Running / Disabled
│  └─ Page Support Notice
├─ Controls
│  ├─ Global Disable Toggle
│  └─ Disable Current Site Toggle
├─ Disabled Sites
│  └─ Open / Manage List
└─ Notices
   ├─ File Permission Notice
   └─ PDF Unsupported Notice
```

规则：

- popup 不管理页面内批注。
- popup 不重复页面内设置项。
- popup 需要清楚表达 file 权限和 PDF 不支持状态。

## 14. 智能防截断

所有悬浮 UI 元素（工具栏、批注卡片、设置面板、上下文菜单、tooltip）必须检测与视口边界的距离，超出时自动翻转方向。每个面板/弹出组件独立计算边界。

## 15. 悬浮元素跟随

标注框、位号标记、批注卡片等叠加在被标注元素上的 UI，必须跟随被标注元素的实时位置移动（页面滚动、resize、DOM 变动时更新）。

## 16. 状态互斥关系

- 标注模式（默认底态）和移动模式互斥。
- 设置面板打开时，页面选择和拖动暂停。
- 清空确认弹层只影响清空动作，不切换当前工具模式。
- 复制文本/复制图片不切换当前工具模式。
- Unsupported notice 优先级高于工具激活态。
- 工具盘展开状态与工具激活状态分离：展开即批注态，独立激活移动或设置。
- 收起工具盘退出激活模式，但已批注内容保留。

## 17. 设计系统已确认项

以下 UI 风格项已由 `context/构想蓝图2.md` §2 pigeonlib 设计系统裁决，不再待定：

- **logo 悬浮球**：邮政金圆形底色 + 抽象鸽子 SVG 线稿。
- **工具盘布局**：单列纵向（仅图标，hover tooltip）。
- **主色**：邮政金 `#b8842c`（点睛色 / 激活态 / 选中框 / 参考线 / 位号圆）。
- **危险色**：火漆红 `#b23a2e`。
- **成功色**：橄榄绿 `#5c8a4a`（仅复制/保存成功反馈）。
- **字体**：Fraunces + 思源宋体（标题）、系统 sans-serif（正文）。
- **图标**：Lucide Icons（MIT），轻量线性 SVG。
- **圆角**：控件 9px，卡片/浮层 12px。
- **动效**：三档时序 130ms / 190ms / 260ms，统一 token。
- **主题**：亮/暗双主题完整实现。
- **编号圆点**：邮政金填充圆 + 白色数字。
- **参考线**：虚线，白/黑按页面背景自动切换。
