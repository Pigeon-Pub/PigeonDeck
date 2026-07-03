# CLAUDE.md

本文件为 Claude Code 提供仓库上下文。编码阶段以 [docs/v1-plan.md](docs/v1-plan.md) 为实施规格。

## 仓库当前阶段

**编码阶段进行中**。设计系统已就绪（[preview/](preview/) 画廊 + [docs/design-system.md](docs/design-system.md)），按 [docs/v1-plan.md](docs/v1-plan.md) 的 15 个阶段逐阶段实施。**阶段 1–9 已完成并合并 main（已 push）**：
- **阶段 1 工程骨架**：Vite 双配置构建（content IIFE + background ES）、Shadow DOM 四层宿主、pigeonlib 设计令牌、i18n 框架、logger。
- **阶段 2 工具盘与悬浮球**：模式控制器状态机、42px 悬浮球、7 按钮工具盘、tooltip、长按拖拽持久化、E2E 测试基建。
- **阶段 3 批注模式**：3a 批注核心 + 3b 修改栏与高级样式（fields.ts 双入口单源、自制下拉/调色盘、样式修改管线→撤销历史、卡片调整项）。
- **阶段 4 直接编辑与内联富文本**：4a 双击文本 contentEditable + Word 式富文本浮条（execCommand + 保选区 + 字号 span 改写）；4b 图片/视频替换弹层 + dataURL >1MB 只活内存。`applyChangesTo` 扩 html/src 分支。
- **阶段 5 区域框选**：长按 300ms 拖金框 → 区域面板 → 持久框+位号；Annotation 加可选 `kind:'region'`+`region{docRect,elements}`；overlay 按 kind 分支跟随。
- **阶段 6 移动模式**：6a move 模式选中 + `.pd-selbox` 八向句柄缩放（→width/height StyleChange）+ visual-units 组件块启发式 + selection 粒度偏移记忆 + 面板 +/- 胶囊；6b 点住即拖 `transform:translate` 预览 + `snap.ts` 纯函数吸附（边缘/中心对齐 4px）+ `.pd-guide` 参考线（白/黑反色）+ Alt free move + 多次移动合并 initial→final。Annotation 加可选 `move?`。
- **阶段 7 撤销/重做**：`History` 加 subscribe（语义不变）；工具盘合并药丸左半撤销/右半重做按 canUndo/canRedo 订阅刷新禁用态；`shortcuts.ts` 全局键盘 Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Esc 仅展开态；`settings.historyLimit`（默认 50）。阶段 3–6 全操作闭环可撤销（清空复合命令留阶段 10）。
- **阶段 8 复制文本**：`format.ts` 纯函数管线（buildOperations 去重合并/Type 组合 `Annotation + Style Modification + Move`/移动只留初始→最终/Changes 表 vs 内容修改分流 → renderTaskList en/zh_CN 模板回退 en，逐字对齐 §7.1+part37）；`copy-text.ts` 点击手势内 `navigator.clipboard.writeText` + 结果弹窗（part37 滚动预览+语言快切+下载.md/再复制）+ `settings.exportLang`。
- **阶段 9 复制图片**：9a `capture.ts` 截图拼接（`chrome.tabs.captureVisibleTab` 滚动拼接、纯函数 `computeCaptureRange`/`planScreens`、总高钳 ≤14000px、后台 ≥600ms 限速、manifest `host_permissions <all_urls>`）；9b canvas 叠加程序化重绘（`layoutOverlay` 纯函数，编号/框/区域/移动幽灵框+连线，逐值照搬 pigeonlib）+ `ClipboardItem` 复制/blob 下载 + 水印 + `settings.imageMethod`。已知妥协：横向滚动页拉伸、fixed 元素重复、自动剪贴板在异步管线后手势失效（弹窗复制按钮可靠）。**随阶段 9 合并的 UI 校准**：新 Logo（白描边鸽）、工具盘顺序照 part02（Logo→撤销/重做→移动→复制文本→复制图片→清空→设置）、移动模式 hover 圆角框、调色盘推荐色不足 7 保持尺寸左对齐。

门禁基线：build ✓ / typecheck ✓ / vitest 260 ✓ / e2e 50 ✓ / i18n ✓。**下一阶段：阶段 10 清空确认（贴工具盘确认弹层，确认=复合命令可撤销，清 store+编号重置+历史清空但清空本身可撤销；点外部/取消关闭；可与阶段 11 设置面板同代理连做）**。

当前根目录有：
- `src/` + `public/` + `scripts/` — 扩展源码、静态资源（manifest/_locales/icons/brand）、构建脚本
- `docs/` — V1 实施计划、设计系统、UI 预览裁决记录、项目规范
- `context/` — 构想蓝图文件（`构想蓝图2.md` 为产品规格的完整定义）
- `preview/` — UI 组件画廊（设计阶段产物，含设计令牌 CSS 和 Web Components 原件）

## PigeonDeck 是什么

面向网页验收、UI 修改反馈和 AI 编码交付的 Chrome/Edge MV3 浏览器扩展。用户在任意网页上标注、框选区域、直接编辑元素文字/样式、移动组件预览，然后一键"复制文本"（生成 Codex/AI 可执行的任务清单，默认英文）或"复制图片"（单页长图叠加批注）。

## 文档导航

- [docs/v1-plan.md](docs/v1-plan.md) — **🎯 V1 实施计划**。15 个实施阶段、文件模块清单、验收标准。编码阶段的单一真相源。
- [context/构想蓝图2.md](context/构想蓝图2.md) — 产品定位、设计系统（pigeonlib）、交互规格、输出格式的完整定义。V1 计划的规格基础。
- [docs/design-system.md](docs/design-system.md) — 设计令牌、UI 组件配方、控件规格的详细参考。编码 UI 时的视觉真相源。
- [docs/ui-preview-rulings.md](docs/ui-preview-rulings.md) — UI 预览 11 轮裁决记录（控件/布局层面的历史决策，实施参考）。
- [docs/conventions/INDEX.md](docs/conventions/INDEX.md) — 项目规范索引（颗粒化规范）。
- [preview/](preview/) — UI 组件画廊。`pigeonlib.css`（设计令牌 + 控件配方）+ `pigeon-components.js`（Web Components 原件）+ `index.html`（画廊宿主）+ `parts/`（38 个 UI 表面卡）。

## 目标工程形态

技术栈为 **Vite + TypeScript + Manifest V3**：

```bash
npm install
npm run build       # vite build → dist/
npm run dev         # vite build --watch
npm run typecheck   # tsc --noEmit
npm test            # vitest run src（单测与源码同目录，*.test.ts）
npm run e2e         # playwright test
npm run i18n:check  # validate language files
```

- Vite 多入口构建：`background`（service worker）+ `content`，输出扁平为 `[name].js`
- `tsconfig` 开启 `strict`、`noUnusedLocals`、`noUnusedParameters`；module resolution 用 `Bundler`
- `manifest.json` 放 `public/`，用 `default_locale` + `__MSG_*__` 做中英文
- 静态资源经 `web_accessible_resources` 暴露

## Agent Routing

- **主 session 职责**：任务拆分、规划、协调、审查、管理 git worktree 与合并。不直接执行实现任务。
- **子代理委派**：将所有实现任务委派给子代理。大多数任务使用 background subagent 并行执行；仅当任务足够小且与当前上下文高度耦合时，才在主线程直接执行。
- **子代理生命周期**：探索 → 规划 → 实现 → 检查 → 测试，循环直至任务完成，然后交由主 session 审查合并。任务足够简单时可省略中间过程。
- **隔离策略**：每个任务在独立 git worktree 中运行，完成后再合并到主分支。

## 架构要点

- **Shadow DOM 隔离**：所有页面内 UI 挂在一个 Shadow Root 下，分四层——Control（悬浮球/工具盘）、Panel（批注面板/卡片/设置/清空确认）、Overlay（hover 高亮/标签/选中框/区域框/位号圆/连线/移动预览/参考线）、Feedback（按钮内反馈/轻提示）。
- **展开即默认批注**：展开工具盘自动进入批注模式（无独立批注按钮、无按钮高亮）。移动/设置与批注互斥；复制文本/复制图片/清空是瞬时动作。切换工具只退出当前交互，不清除已保存内容。
- **单列纵向工具盘**：7 按钮（Logo / 移动 / 复制文本 / 复制图片 / 撤销重做(合并) / 清空 / 设置），仅图标 + hover tooltip。
- **合并撤销/重做**：左半=撤销，右半=重做。快捷键 Ctrl+Z/Ctrl+Shift+Z 仅展开态生效。默认 50 步上限（最高 9999）。
- **状态生命周期按标签页会话**：页面键 = 完整 URL。刷新恢复可定位内容；找不到目标不乱改页面，轻提示 + 任务记录保留。关闭 tab 清理。
- **标注编号删除不重排**：编号分配即固定，仅清空后从 1 重置。
- **移动任务合并**：同一组件多次移动，输出只含"初始→最终"，撤销保留每步。
- **同元素多操作合并**：批注+样式修改+移动 → 一条输出（Type: `Annotation + Style Modification + Move`）。
- **复制文本输出**：任务清单格式，默认英文（可设中文/跟随界面），含页面上下文+全局编辑规则+操作列表。必须提示 AI 不要硬编码 top/left，优先 flex/grid/gap/margin/order。
- **复制图片**：只产图不附文本，V1=单页长图，叠加截图+编号+连线+区域框+移动预览。
- **亮/暗双主题**：V1 完整实现，Shadow DOM `data-theme` 属性切换。
- **OpenDesign 兼容**：输出格式兼容 OpenDesign prompt 约定；选型避免不兼容依赖。

## V1 明确不做

不做多页面统一导出（V2）、多页多图（V2）、工具按钮右键快捷设置（V2）、多页面清空三次确认（V2）。PDF 页面仅提示不支持。

## 关键工作约定

- **规范颗粒化、需自更新**：项目规范在 [docs/conventions/](docs/conventions/INDEX.md)，每条规则一个文件 + INDEX.md 索引。新增/变更规范时必须同步更新索引。
- **重大分叉用选择式提问**：遇到重要取舍，用 AskUserQuestion 而不是纯文本提问。
- **以 v1-plan.md 为实施准则**：编码阶段以 [docs/v1-plan.md](docs/v1-plan.md) 和 [context/构想蓝图2.md](context/构想蓝图2.md) 为准。设计细节见 [docs/design-system.md](docs/design-system.md)。
- **Git 提交**：每完成一个细分功能提交一次。提交信息用中文。
- **测试门禁**：`npm test` 全过 + 核心 E2E 全绿后方可合并。
- **CHANGELOG 维护**：每完成一个实施阶段，合并回 main 前在 [CHANGELOG.md](CHANGELOG.md) 的 `[Unreleased]` 段新增该阶段小节（中文，记录用户可见变化与关键架构落地），并勾掉「Future — Planned for v1.0.0」表中对应行。
