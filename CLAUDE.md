# CLAUDE.md

本文件为 Claude Code 提供仓库上下文。编码阶段以 [docs/v1-plan.md](docs/v1-plan.md) 为实施规格。

## 仓库当前阶段

**编码阶段刚开始**。设计系统已就绪（[preview/](preview/) 画廊 + [docs/design-system.md](docs/design-system.md)），V1 实施计划已确定（[docs/v1-plan.md](docs/v1-plan.md)），工程骨架搭建是第一项任务。

当前根目录有：
- `docs/` — V1 实施计划、设计系统、UI 预览裁决记录、项目规范
- `context/` — 构想蓝图文件（`构想蓝图2.md` 为产品规格的完整定义）
- `preview/` — UI 组件画廊（设计阶段产物，含设计令牌 CSS 和 Web Components 原件）

根目录**尚无** `package.json`、`src/`、`manifest.json`，这些将在阶段 1（工程骨架）创建。

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
