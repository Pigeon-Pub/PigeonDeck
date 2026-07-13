---
name: git-workflow
description: 什么该提交 / 不该提交，以及提交与分支习惯
---

# 规则：Git 工作流

**只提交产品源码与项目资产。**

- **该跟踪**：`src/`、`public/`、`docs/`、`assets/`、`site/`、`preview/`、`CLAUDE.md`、`.gitignore`、包与构建配置、测试文件
- **永不提交**：`node_modules/`、`dist/`、`build/`、`coverage/`、`.vite/`、日志文件（见 [[ignore-policy]]）
- **提交时机**：仅在用户明确要求时提交或推送，不主动提交
- **提交信息**：用中文，一句话说清"做了什么"，必要时附简短理由
- **默认分支**：`main`。一次性、可丢弃的实验放独立分支，不污染 `main`
