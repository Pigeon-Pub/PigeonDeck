# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 仓库当前阶段（重要）

这是一个**尚未开始编码的规划/规格阶段仓库**。根目录只有以下内容：

- `docs/` — PigeonDeck 的产品规格（PRD、UI 层级、UI 风格、方向决策笔记、规范）。
- `context/` — PigeonDeck 的构想蓝图文件，其中 **`构想蓝图2.md` 是本项目的单一真相源**。
- `reference-projects/` — 两个**只读参考**的浏览器扩展，不是本产品源码。

根目录**没有** `package.json`、`src/`、`manifest.json` 或任何构建配置。下面"目标工程形态"一节描述的是将要搭建的东西，不是已存在的东西。

## PigeonDeck 是什么

面向网页验收、UI 修改反馈和 AI 编码交付的 Chrome/Edge MV3 浏览器扩展。用户在任意网页上标注、框选区域、直接编辑元素文字/样式、移动组件预览，然后一键"复制文本"（生成 Codex/AI 可执行的任务清单，默认英文）或"复制图片"（单页长图叠加批注）。

核心是从 MarkIt 重建一个更精简、可维护的 TypeScript 版本，借鉴 ClickDeck 的移动/吸附/参考线和 prompt 输出纪律。

## 文档导航（开工前必读）

- [context/构想蓝图2.md](context/构想蓝图2.md) — **🌐 单一真相源**。整合了蓝图1、PRD、UI 层级/风格文档、pigeonlib 设计系统和 11 轮苏格拉底式问答的所有决策。**当任何其他文档与此文件冲突时，以此文件为准。**
- [docs/prd.md](docs/prd.md) — **功能需求规格**。功能需求、状态/数据规则、验收标准、非目标、V1 范围边界。最终裁决以构想蓝图2 为准。
- [docs/ui-hierarchy.md](docs/ui-hierarchy.md) — UI 层级与信息架构：Shadow DOM 分层、四类 UI 表面、单列纵向工具盘、工具模式互斥关系、各面板从属关系。
- [docs/ui-style.md](docs/ui-style.md) — **视觉语言参考**。色彩/字体/图标/圆角/动效参数已由构想蓝图2 §2 的 pigeonlib 设计系统覆盖（邮政金、Lucide Icons、Fraunces+思源宋体等）。本文件保留作为设计气质说明。
- [docs/ui-preview-prompt.md](docs/ui-preview-prompt.md) — 用于生成单页 HTML UI 预览草稿的提示词（已按构想蓝图2 设计系统更新）。
- [docs/markit-redevelopment-notes.md](docs/markit-redevelopment-notes.md) — **方向决策笔记**。构想蓝图2 的决策已整合到本文中；本文同时保留历史决策演变记录。
- [docs/conventions/INDEX.md](docs/conventions/INDEX.md) — **项目规范索引**。颗粒化规范（git 工作流、忽略策略、文件管理），每条规则一个文件。开工前读一遍。

## 关键工作约定（不在代码里、容易踩坑）

- **规范是颗粒化的、需自更新**：项目规范放在 [docs/conventions/](docs/conventions/INDEX.md)，每条规则一个文件 + `INDEX.md` 索引。**新增或变更任何项目规范时，必须建/改对应单规则文件，并同步更新 `INDEX.md`**——文档不会自更新，靠这条纪律维护。
- **方向决策写入笔记文件**：重要的产品方向、取舍决策必须记录到 [docs/markit-redevelopment-notes.md](docs/markit-redevelopment-notes.md)，不能只停留在聊天里。
- **重大分叉用选择式提问**：遇到重要的分叉或取舍，优先用 choice/input 式提问（AskUserQuestion），而不是只在纯文本里问。
- **`reference-projects/` 不得进入提交**：实现开始前必须把它移出 git 索引（保留本地文件）并加入忽略规则。它不是产品源码。
- **不拆改 MarkIt 的 `content.js`**：它是打包后的产物，作为行为参考；需要时从可读源文件重建，绝不直接编辑/拆分这个 bundle。
- **以构想蓝图2 为最终裁决**：当 `docs/` 下文档与 `context/构想蓝图2.md` 冲突时，以构想蓝图2 为准。

## 参考项目（只读，不要当作产品源码改）

### `reference-projects/markit/` — 主要行为参考

MarkIt 的**已解包扩展产物**（无 TS 源码、无 sourcemap）：`content.js`（263KB 打包脚本）、`popup.html/js`、`service-worker.js`、`manifest.json`。参考其标注、元素编辑、区域批注、popup 行为、右键菜单、file 页面支持。

### `reference-projects/clickdeck/` — 移动/吸附/prompt 参考 + 工程结构样板

ClickDeck 是**有完整 TS 源码**的 MV3 扩展，PigeonDeck 的工程形态以它为模板。重点参考：
- 移动组件：`src/content/intent-*.ts`（draft-panel、ghost、overlay、region）、`selection.ts`、`visual-units.ts`（视觉组件块粒度）、`region-context.ts`。
- prompt 输出纪律：`src/export/intent-prompt.ts`、`unified-prompt.ts`、`change-summary.ts`。
- 工程结构：`src/{background,content,export,shared,state,diagnostics}/`，每个模块旁边配 `*.test.ts`（vitest）。

注意 PRD 明确**不复制** ClickDeck 的重型部分（多种导出路径、PDF/长图导出、演示模式等）。ClickDeck 的 ghost/预览思路要改为**移动真实元素预览**。

## 目标工程形态（将要搭建，参照 ClickDeck）

技术栈为 **Vite + TypeScript + Manifest V3**，复刻 ClickDeck 的构建模式：

```bash
npm install
npm run build       # vite build → dist/（在浏览器扩展页加载 dist/，需开启开发者模式）
npm run dev         # vite build --watch
npm run typecheck   # tsc --noEmit
npm test            # vitest run src（单测与源码同目录，*.test.ts）
npm run e2e         # playwright test
npm run i18n:check  # validate language files
```

预期约定（来自 ClickDeck 样板）：
- Vite 多入口构建：`background`（service worker）+ `content`，输出扁平为 `[name].js`。
- `tsconfig` 开启 `strict`、`noUnusedLocals`、`noUnusedParameters`；module resolution 用 `Bundler`。
- 运行单个测试文件：`npx vitest run src/content/<file>.test.ts`；单个用例用 `-t "<name>"`。
- `manifest.json` 放 `public/`，用 `default_locale` + `__MSG_*__` 做中英文；静态资源经 `web_accessible_resources` 暴露。

## 架构要点（对齐构想蓝图2）

- **Shadow DOM 隔离**：所有页面内 UI 挂在一个 Shadow Root 下，分四层——Control（悬浮球/单列工具盘）、Panel（批注面板/批注卡片/设置面板/清空确认弹层）、Overlay（hover 高亮、元素 hover 标签、选中框、区域框、位号圆、连线、移动预览、参考线）、Feedback（按钮内反馈、轻提示）。避免网页 CSS 与插件互相污染。
- **展开即默认批注模式**：展开工具盘自动进入批注——批注无独立按钮、无按钮高亮。移动 / 设置与批注互斥；复制文本、复制图片、清空是瞬时动作，不占用模式。切换工具只退出当前交互，不清除已保存的批注/编辑/移动预览。
- **单列纵向工具盘**：7 按钮（Logo / 移动 / 复制文本 / 复制图片 / 撤销重做(合并) / 清空 / 设置），仅图标 + hover tooltip。Logo 点击展开/收起，长按拖拽移动整体位置。
- **合并撤销/重做按钮**：左半=撤销，右半=重做。快捷键 Ctrl+Z / Ctrl+Shift+Z 仅在展开态生效。默认 50 步上限（最高 9999）。
- **状态生命周期按标签页会话**：页面键 = 完整 URL。同一 tab 刷新同一 URL 自动恢复可定位的标注/编辑/移动预览；找不到目标时**不乱改页面**，只轻提示，但任务记录保留、复制文本仍包含该意图。关闭 tab 清理会话。
- **标注编号删除不重排**：编号一旦分配就固定，仅清空后从 1 重置。
- **移动任务合并规则**：同一组件多次移动，**复制文本只输出"初始位置 → 最终位置"**，但撤销历史保留每一步。
- **同元素多操作合并**：若同一元素同时有批注 + 样式修改 + 移动，输出为一条合并操作（Type: `Annotation + Style Modification + Move`），所有信息聚合在同一编号下。
- **复制文本输出纪律**（核心交付物）：任务清单格式，**默认英文**（可设置切换中文或跟随界面），含页面上下文 + 全局编辑规则 + 操作列表 + 每操作定位信息；样式修改以"人类指令 + CSS 属性前后值表"输出；移动任务须含 Source/Target/初始/最终位置 + 吸附或 free move 状态。**必须提示 AI：视觉坐标只是定位线索，不要硬编码 `top/left`，优先用现有布局/flex/grid/gap/margin/order**。
- **复制图片**：只产图、不附文本，**V1=单页长图**，叠加截图+编号+连线+区域框+移动预览。设置中可切换"复制到剪贴板"或"下载为文件"。
- **亮/暗双主题**：V1 完整实现，通过设置面板切换，Shadow DOM 根元素 `data-theme` 属性控制。
- **OpenDesign 兼容**：硬约束——输出格式兼容 OpenDesign 的 prompt 约定；选型避免引入不兼容依赖。

## V1 明确不做（避免过度实现）

不保留 MarkIt 的 Dev/Prototype 双模式；不做 Markdown 导出、下载截图、多模板输出；不做多套 pin 样式、多主题、输出详细度等高级设置；不默认对复制内容脱敏；不做多页面统一导出（V2）；不做多页多图（V2）；不做工具按钮右键快捷设置（V2）；不做多页面清空三次确认（V2）。PDF 页面 V1 只提示不支持。
