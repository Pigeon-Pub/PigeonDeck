---
name: file-management
description: 目录归属与文件命名约定
---

# 规则：文件管理

**每类内容有固定归属，命名用小写短横线（kebab-case）。**

- `src/` — 产品源码（按 `background/content/export/state/popup/shared/diagnostics` 分模块）
- `public/` — 静态资源（`manifest.json`、图标、`_locales/`）
- `tests/fixtures/` — E2E 测试用的本地 HTML 夹具
- `docs/product/` — 当前产品规格
- `docs/design/` — 设计系统与 UI 裁决记录
- `docs/development/` — 维护指南、实施基线与验证文档
- `docs/conventions/` — 持续生效的项目规范，`README.md` 为索引
- `docs/history/` / `docs/archive/` — 历史记录与被取代的早期文档
- `assets/` — README、商店和宣传素材；运行时资源仍放 `public/`
- `site/` — 可独立部署的静态宣传站点
- `preview/` — 已失真的 UI 组件画廊归档，不作编码参考

文档文件命名一律使用小写 kebab-case（如 `v1-plan.md`、`design-system.md`、`git-workflow.md`）；历史反馈按 `feedback-YYYY-MM-DD.md` 命名。规范文件名应与其 `name:` 头部一致，便于互链。

根目录只保留项目入口、包与构建配置、许可证、变更记录和代理入口等标准仓库文件。新增长期文件前先确认是否已有明确分类目录。
