---
name: file-management
description: 目录归属与文件命名约定
---

# 规则：文件管理

**每类内容有固定归属，命名用小写短横线（kebab-case）。**

- `src/` — 产品源码（按 `background/content/export/state/popup/shared/diagnostics` 分模块）
- `public/` — 静态资源（`manifest.json`、图标、`_locales/`）
- `tests/fixtures/` — E2E 测试用的本地 HTML 夹具
- `docs/` — 规划与规范文档（实施计划、设计系统、裁决记录）
- `context/` — 构想蓝图（产品规格定义）
- `preview/` — UI 组件画廊（设计阶段产物，供实施参考）

文件命名一律 kebab-case（如 `v1-plan.md`、`design-system.md`、`git-workflow.md`）。规范文件名应与其 `name:` 头部一致，便于 `[[name]]` 互链。
