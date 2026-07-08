# CLAUDE.md

本文件为 Claude Code 提供仓库上下文。编码阶段以 [docs/v1-plan.md](docs/v1-plan.md) 为实施规格。

## 仓库当前阶段

**🎉 V1 全 15 阶段代码闭环完成，全部合并 main。** 设计系统已就绪（[preview/](preview/) 画廊 + [docs/design-system.md](docs/design-system.md)），按 [docs/v1-plan.md](docs/v1-plan.md) 的 15 个阶段逐阶段实施完毕。**剩余为用户手动冒烟（[docs/manual-smoke-checklist.md](docs/manual-smoke-checklist.md)，71 项）+ 打包上架。**

> **2026-07-04：已完成「7.3.1 用户反馈第一轮」修复**（约 50 条真机反馈，拆 7 组顺序实施，含 docs 共 12 个提交在本地 main）。用户拍板：批注模式右键拦截系统菜单、移动吸附=真实 DOM 重父嵌入、快捷键完整重绑、批注模式单击出可交互八句柄框（与移动模式统一）。终态 vitest 351 / 全量 E2E 101/101 ×2。详见 [CHANGELOG](CHANGELOG.md) Bugfix 段与 [HANDOFF §8](HANDOFF.md)。

> **2026-07-07：已完成「7.6.1 用户反馈第二轮」修复**（约 25 条真机反馈，16 个提交在本地 main：`26c63a1`…`8970d03`）。用户拍板：图片单击预览=页内灯箱、富文本=彻底重做（结构化可导出变更 `RichTextChange`）、跨页面/刷新保留=彻底删除（改仅会话内存）。要点：取色器卡死修复（挂起 annotate 拦截）、新建共享 `esc-stack.ts` Esc 优先级栈 + `makeDraggableByHandle`、hover 高亮改挂 overlay 层、系统原生 tooltip、SVG/非标元素出智能样式、导出面板改页内选择（顶栏+X+拖拽+可编辑预览+图片灯箱）、图片导出叠加互不重叠批注卡片、prompt 全局规则补词+操作分隔线本地化、富文本弃 execCommand 全改结构化捕获（提交仅经保存对勾/Ctrl+Enter，Esc 丢弃）。终态 vitest 374 / 全量 E2E 102 passed（`copy-text②`/`full-flow` 剪贴板读 2 例已知环境失败非回归）。详见 [CHANGELOG](CHANGELOG.md) Bugfix 段与 [HANDOFF §8](HANDOFF.md)。**16 提交叠加上轮共领先 origin 约 36 提交，待网络恢复 push + 真机复冒烟本轮 25 项。**

> **2026-07-07：已完成「7.6.2 用户反馈第三轮」修复**（复冒烟反馈，9 个提交在本地 main：`844d8f7`…`61ea914`）。修：取色器仍卡死（先加固再入守卫/notify 快照仍未根治 → **F18c 彻底弃用原生 EyeDropper，改页内 captureVisibleTab 截图 + 覆盖层放大镜取色，覆盖层为自有 DOM 无系统捕获态**，须真机复验）、上轮动画未生效（`animateHeight` 改可靠 rAF FLIP）、上轮高级样式改错（回退并恢复调试内层滚动+各子分类等高）、打印留印子（`@media print` 隐藏宿主）、重选已标注元素隐藏持久框、一批交互约定固化。**关键：新增 [docs/conventions/interaction-invariants.md](docs/conventions/interaction-invariants.md) 固化「浮层再点即关 / 拖面板关派生浮层 / 拖工具盘只关其派生面 / 编辑面 Ctrl+Enter·Esc / 选中已标注隐藏持久框 / 原生 tooltip / 打印隐藏 / 动画 / 导出不自动化 / 仅会话内存」11 条交互不变量，INDEX + CLAUDE 指针，改 UI 前必读——不再逐条重复提醒。** 终态 vitest 385 / 全量 E2E 105 passed / i18n ✓。**⚠️ 取色器卡死修复须真机复验（原生取色器无法自动化）。9 提交叠加前两轮共领先 origin 约 45 提交，待 push。**

> **2026-07-08：Codex 架构重构（分支 `arch-refactor-codex`，9 个重构提交 `76b153d`…`6bb7798`）。** 从巨型模块拆出可单测的纯函数/工具子模块并补行为保护测试（行为等价，门禁全绿）：`capture.ts` → `capture-range.ts`（截图范围）/`capture-client.ts`（截图请求客户端）/`capture-overlay-layout.ts`·`capture-card-layout.ts`（叠加与卡片布局）；`fields.ts` → `field-labels.ts`（轻量标签表）/`field-values.ts`（样式字段值工具）/`field-layout.ts`（字段布局规则）；`panel.ts` → `floating-drag.ts`（`makeDraggableByHandle`）/`theme.ts`（主题切换）/`change-apply.ts`（`applyChangesTo`）/`annotation-summary.ts`（导出摘要）。**改这些领域时优先改拆出的子模块，别把逻辑塞回巨型文件。** 本文件是仓库唯一上下文真相源；`AGENTS.md` 仅为指向本文件的指针。

> **2026-07-08：已完成「7.6.3 用户反馈第四轮」修复**（真机第四轮，8 个提交：`fdc35b3`…`9fcecfc`）。6 组并行 worktree 子代理实现 → 主 session 逐条 cherry-pick 到重构后 HEAD 审查合并。修：移动模式选择粒度对齐批注（offset=0 选原始命中）+ 拦截全部页面点击 + 清空还原 DOM 重父位置（D1/D3）；导出图片移动方向改实线箭头 + 叠加水平对齐（D2）；图片批注「替换图片」按钮修复 + 导出提示词显示上传文件名而非 `data:image/png`（N8/D4）；富文本浮条字号/字体实时回显 + 下划线/删除线可同键取消（N6/N7）；批注面板展开动画顺滑 + 首次定位后内容变化不再移位 + 单击已标注元素 toggle 面板（N3/N4/N5）；高级样式调试页计算样式去内层小滚动改整页滚动（**反转上轮 R7**）+ 工具盘收起动画（N1/N2）。终态 vitest 449 / 全量 E2E 110 passed / i18n ✓。

各阶段要点：
- **阶段 1 工程骨架**：Vite 双配置构建（content IIFE + background ES）、Shadow DOM 四层宿主、pigeonlib 设计令牌、i18n 框架、logger。
- **阶段 2 工具盘与悬浮球**：模式控制器状态机、42px 悬浮球、7 按钮工具盘、tooltip、长按拖拽持久化、E2E 测试基建。
- **阶段 3 批注模式**：3a 批注核心 + 3b 修改栏与高级样式（fields.ts 双入口单源、自制下拉/调色盘、样式修改管线→撤销历史、卡片调整项）。
- **阶段 4 直接编辑与内联富文本**：4a 双击文本 contentEditable + Word 式富文本浮条（execCommand + 保选区 + 字号 span 改写）；4b 图片/视频替换弹层 + dataURL >1MB 只活内存。`applyChangesTo` 扩 html/src 分支。
- **阶段 5 区域框选**：长按 300ms 拖金框 → 区域面板 → 持久框+位号；Annotation 加可选 `kind:'region'`+`region{docRect,elements}`；overlay 按 kind 分支跟随。
- **阶段 6 移动模式**：6a move 模式选中 + `.pd-selbox` 八向句柄缩放（→width/height StyleChange）+ visual-units 组件块启发式 + selection 粒度偏移记忆 + 面板 +/- 胶囊；6b 点住即拖 `transform:translate` 预览 + `snap.ts` 纯函数吸附（边缘/中心对齐 4px）+ `.pd-guide` 参考线（白/黑反色）+ Alt free move + 多次移动合并 initial→final。Annotation 加可选 `move?`。
- **阶段 7 撤销/重做**：`History` 加 subscribe（语义不变）；工具盘合并药丸左半撤销/右半重做按 canUndo/canRedo 订阅刷新禁用态；`shortcuts.ts` 全局键盘 Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Esc 仅展开态；`settings.historyLimit`（默认 50）。阶段 3–6 全操作闭环可撤销（清空复合命令留阶段 10）。
- **阶段 8 复制文本**：`format.ts` 纯函数管线（buildOperations 去重合并/Type 组合 `Annotation + Style Modification + Move`/移动只留初始→最终/Changes 表 vs 内容修改分流 → renderTaskList en/zh_CN 模板回退 en，逐字对齐 §7.1+part37）；`copy-text.ts` 点击手势内 `navigator.clipboard.writeText` + 结果弹窗（part37 滚动预览+语言快切+下载.md/再复制）+ `settings.exportLang`。
- **阶段 9 复制图片**：9a `capture.ts` 截图拼接（`chrome.tabs.captureVisibleTab` 滚动拼接、纯函数 `computeCaptureRange`/`planScreens`、总高钳 ≤14000px、后台 ≥600ms 限速、manifest `host_permissions <all_urls>`）；9b canvas 叠加程序化重绘（`layoutOverlay` 纯函数，编号/框/区域/移动幽灵框+连线，逐值照搬 pigeonlib）+ `ClipboardItem` 复制/blob 下载 + 水印 + `settings.imageMethod`。已知妥协：横向滚动页拉伸、fixed 元素重复、自动剪贴板在异步管线后手势失效（弹窗复制按钮可靠）。**随阶段 9 合并的 UI 校准**：新 Logo（白描边鸽）、工具盘顺序照 part02（Logo→撤销/重做→移动→复制文本→复制图片→清空→设置）、移动模式 hover 圆角框、调色盘推荐色不足 7 保持尺寸左对齐。
- **阶段 10 清空确认**：`clear.ts` ClearManager 贴工具盘**侧边**确认弹层（照 part14，`positionBeside` 避免被 control 层遮挡）；**可撤销复合命令**（snapshot→doClear[DOM 回退+store.clear 编号归 1]→history.clear→push clear 命令，revert=store.load 恢复标注/编号/DOM）；`applyChangesTo` 导出复用。
- **阶段 11 设置面板**：`settings-panel.ts` 4 分区（通用/交互/输出/帮助）贴工具盘侧边；全部设置项 live-apply（单一 settings 对象共享引用：主题 setTheme/粒度/长按/拖拽阈值/历史 setLimit/hover/图片/水印/导出语言）；`language-picker.ts` + `languages.ts` 搜索式语言选择器（`matchLanguages` 模糊/首字母/ISO + BCP47 curated 子集）；新增 settings 字段 theme/longPressMs/dragThreshold，exportLang 加宽为 string。V1 简化：快捷键只读、界面语言仅 en/zh_CN 有翻译、界面语言切换非全局实时重渲。
- **阶段 12 安装说明页**：`public/onboarding.html`+js 自包含品牌教程（chrome.i18n），background onInstalled 首装自动开页 + `pd-open-onboarding` 消息；设置 Help 分区重开。
- **阶段 13 Popup 与后台**：`public/popup.html`+js（全局/站点禁用开关、禁用列表、file/PDF 提示，照 part16）；`disable.ts` 纯函数 `isPageDisabled` + storage 模型；main.ts 注入守卫 + `storage.onChanged` reload 实时启停；右键菜单「快速标注」→ SW onClicked → content `expand()`；manifest 加 action + contextMenus 权限。
- **阶段 14 i18n 完整化**：全库审计零用户可见硬编码文案（仅字形 A/快捷键名/品牌名 3 处不可翻译字面量）；en/zh_CN 各 278 键严格一致；CONTRIBUTING.md + AVAILABLE_LANGUAGES.json 齐备；i18n:check 持续绿。
- **阶段 15 测试收尾**：夹具补齐（表单/图片网格/嵌套 flex/绝对定位，既有元素不动）；`full-flow.spec.ts` 全链路集成 E2E（标注→样式→移动→区域→复制文本剪贴板真断言→撤销→清空/恢复→刷新恢复→设置）；`docs/manual-smoke-checklist.md` 71 项手动冒烟清单；playwright `retries:1` 负载安全网（retries=0 下亦 71×2 绿）。

门禁基线：build ✓ / typecheck ✓ / vitest 298 ✓ / e2e 71（retries=0 下 ×2 稳定）✓ / i18n ✓。**V1 代码闭环完成。下一步（非编码）：用户按 [docs/manual-smoke-checklist.md](docs/manual-smoke-checklist.md) 真机冒烟 → 修真机暴露的问题 → 定版本号 → 打包上架（Chrome/Edge 商店 + 自托管 .crx）。已知妥协见各阶段 CHANGELOG。**

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
- **改任何页面内 UI 前，先读 [docs/conventions/interaction-invariants.md](docs/conventions/interaction-invariants.md)**：浮层再点即关、拖面板关派生浮层、拖工具盘只关其派生面、编辑面统一 Ctrl+Enter 保存 / Esc 不保存退出、选中已标注元素隐藏持久框出八句柄框、原生 tooltip、打印隐藏 UI、长度/弹出动画等交互不变量已固化于此，不要让用户逐条重复提醒。
- **重大分叉用选择式提问**：遇到重要取舍，用 AskUserQuestion 而不是纯文本提问。
- **以 v1-plan.md 为实施准则**：编码阶段以 [docs/v1-plan.md](docs/v1-plan.md) 和 [context/构想蓝图2.md](context/构想蓝图2.md) 为准。设计细节见 [docs/design-system.md](docs/design-system.md)。
- **Git 提交**：每完成一个细分功能提交一次。提交信息用中文。
- **测试门禁**：`npm test` 全过 + 核心 E2E 全绿后方可合并。
- **CHANGELOG 维护**：每完成一个实施阶段，合并回 main 前在 [CHANGELOG.md](CHANGELOG.md) 的 `[Unreleased]` 段新增该阶段小节（中文，记录用户可见变化与关键架构落地），并勾掉「Future — Planned for v1.0.0」表中对应行。
