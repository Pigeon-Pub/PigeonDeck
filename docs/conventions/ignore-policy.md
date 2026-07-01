---
name: ignore-policy
description: 哪些文件/目录被 .gitignore 排除以及为什么
---

# 规则：忽略策略

**以下目录/文件由 `.gitignore` 排除，不进任何提交：**

- `node_modules/` — 依赖包，由 `package.json` 管理
- `dist/` / `build/` — 构建产物
- `coverage/` / `.vite/` — 测试覆盖与构建缓存
- `*.log` / `npm-debug.log*` — 日志文件
- `.DS_Store` / `Thumbs.db` / `.idea/` / `.vscode/` — 操作系统与编辑器文件

新增任何"不应入库"的目录时，先更新根 `.gitignore`，再在本文件补一句说明。相关提交边界见 [[git-workflow]]。
