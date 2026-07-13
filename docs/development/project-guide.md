# 项目维护指南

本文集中保存不需要每次加载、但维护代码时仍有价值的架构上下文。产品行为以 [产品规格](../product/product-spec.md) 为准，页面内交互以 [交互不变量](../conventions/interaction-invariants.md) 为准。

## 工程形态

- Vite 双入口构建：`content` 输出 IIFE，`background` 输出 ES service worker。
- TypeScript 开启严格检查；模块解析使用 `Bundler`。
- Manifest V3 文件和运行时静态资源位于 `public/`。
- 页面内 UI 注入一个 Shadow Root，分为 control、panel、overlay、feedback 四层。
- 界面文案由运行时 i18n 处理；manifest 文案使用 `__MSG_*__`。

## 主要模块

- `src/content/`：页面注入、选择、批注、移动、编辑、导出和 UI。
- `src/background/`：service worker、截图协调和浏览器级入口。
- `src/state/`：批注、历史、设置、禁用规则和快捷键定义。
- `src/shared/`：跨模块纯函数与 DOM 工具。
- `src/diagnostics/`：诊断日志。
- `tests/e2e/`：扩展主流程 Playwright 验证。

大型模块已拆出可单测子模块。修改截图范围、截图客户端、叠加布局、字段布局和值处理、浮层拖拽、主题、变更应用或导出摘要时，优先修改对应的小模块，不要把逻辑塞回编排文件。

## 关键行为边界

- 页面内 UI 必须保持 Shadow DOM 隔离，并遵守四层职责。
- 展开工具盘即进入默认批注模式；移动和设置与批注互斥，导出与清空是瞬时动作。
- 状态仅在标签页会话内存在；关闭标签页即清理，不做跨页面或长期持久化恢复。
- 标注编号删除后不重排，仅清空后从 1 重新开始。
- 同元素的批注、样式和移动在输出中合并；移动输出保留初始到最终状态。
- 导出文本优先描述布局语义，禁止引导 AI 硬编码 `top`/`left`。
- 导出图片为单页长图，叠加编号、连线、区域和移动预览。

## 维护流程

1. 根据任务从 `CLAUDE.md` 的导航表读取专题文档。
2. 搜索调用方和相邻测试，确认行为边界。
3. 用最小改动实现，并补充与风险匹配的测试。
4. 运行类型检查、单测和受影响的 E2E。
5. 用户可见变化或关键架构变化更新 `CHANGELOG.md`。
