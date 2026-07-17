# CLAUDE.md

本文件是 PigeonDeck 编码代理的常驻上下文入口。`AGENTS.md` 只负责指向本文件；专题背景按任务从 `docs/` 加载，不要把阶段流水账重新堆回这里。

## 项目与阶段

PigeonDeck 是面向网页验收、UI 修改反馈和 AI 编码交付的 Chrome/Edge Manifest V3 扩展。

V1 功能开发已经结束，当前处于**维护、真机验证和发布**阶段。已完成的实施基线见 [V1 实施计划](docs/development/v1-plan.md)，历史过程见 [开发交接记录](docs/history/v1-development-handoff.md) 和 [CHANGELOG](CHANGELOG.md)。

## 常驻工作规则

- 先理解现有行为与调用关系，再实施最小且可验证的改动；不要顺手重构无关代码。
- 改任何页面内 UI 前，必须先读 [交互不变量](docs/conventions/interaction-invariants.md)。
- 涉及视觉值时，以 [设计系统](docs/design/design-system.md) 为当前权威来源；`preview/` 仅为失真的历史画廊。
- 新增或变更项目规范时，同步更新 [规范索引](docs/conventions/README.md)。
- 每个独立功能使用颗粒化提交，提交信息使用中文；不要提交构建产物、本机工具状态或临时文件。
- 合并前至少保证 `npm run typecheck`、`npm test` 和受影响的核心 E2E 通过。
- 用户可见变化或关键架构变化写入 `CHANGELOG.md` 的 `[Unreleased]`；普通文档搬迁不伪装成功能变化。

## 按任务加载文档

| 任务 | 必读文档 |
| --- | --- |
| 产品行为、范围或输出格式 | [产品规格](docs/product/product-spec.md) |
| 页面内 UI 或交互 | [交互不变量](docs/conventions/interaction-invariants.md)、[设计系统](docs/design/design-system.md) |
| 架构、模块边界或维护入口 | [项目维护指南](docs/development/project-guide.md) |
| V1 既有实现与验收基线 | [V1 实施计划](docs/development/v1-plan.md) |
| 手动真机验证 | [手动冒烟清单](docs/development/manual-smoke-checklist.md) |
| 文件、Git 或忽略规则 | [项目规范](docs/conventions/README.md) |
| 历史决策与反馈来源 | [历史记录](docs/history/README.md) |

完整导航见 [docs/README.md](docs/README.md)。

## 工程与验证

技术栈：Vite + TypeScript + Manifest V3。

```bash
npm install
npm run build
npm run dev
npm run typecheck
npm test
npm run e2e
npm run i18n:check
```

- `src/`：扩展源码；单测与源码同目录，命名为 `*.test.ts`。
- `public/`：manifest、浏览器页面、本地化和运行时静态资源。
- `tests/`：Playwright E2E 与本地夹具。
- `scripts/`：资源生成和仓库检查脚本。
- `assets/`：README、商店和宣传使用的源素材及生成素材。

## 站点部署（宣传站 `site/`）

`site/` 是独立的纯静态宣传站，托管在 **Cloudflare Pages**（项目名 `pigeondeck`）。
线上地址：**https://deck.pigeon.pub** （备用直连 https://pigeondeck.pages.dev ）。

改完 `site/` 内容后，用 wrangler 一条命令重新发布（Windows PowerShell）：

```powershell
$env:CLOUDFLARE_API_TOKEN  = '<带 Cloudflare Pages:Edit 权限的 token，见 .secrets/>'
$env:CLOUDFLARE_ACCOUNT_ID = '4000221f6c135fb1ab5517d47552e45d'
npx wrangler pages deploy site --project-name pigeondeck --branch main --commit-dirty=true
```

- 域名 `pigeon.pub` 的 DNS 已整域托管在 Cloudflare；`deck` 是指向 Pages 的橙云 CNAME。
- 凭证只放本机 `.secrets/deploy-credentials.md`（已被 `.gitignore` 忽略）；**任何凭证与 `.secrets/` 都不得提交**。

## 扩展发布（Edge Add-ons）

发布受「发 GitHub Release」这道明确授权闸门控制：在 GitHub 发布 Release 时，`.github/workflows/edge-publish.yml` 自动构建并通过 Edge Publish API 推送新版本。日常 push / PR 不会触发发布。

发布一版：
1. 抬高 `public/manifest.json` 的 `version`（须大于商店线上版本）。
2. 提交并在 GitHub 上 **Publish release**（tag 如 `v1.0.1`）。
3. Actions 自动：`npm ci` → `npm run build` → 打包 `dist/` → 上传 → 轮询 → 发布；之后由微软审核（数小时~数天）。

密钥存于 GitHub 仓库 Secrets：`EDGE_API_KEY` / `EDGE_CLIENT_ID` / `EDGE_PRODUCT_ID`（API Key 会过期，重建后需更新 Secret）。

本地手动兜底（须自设同名环境变量作为显式授权）：

```powershell
$env:EDGE_API_KEY='<见 .secrets/>'; $env:EDGE_CLIENT_ID='<见 .secrets/>'; $env:EDGE_PRODUCT_ID='<见 .secrets/>'
powershell -ExecutionPolicy Bypass -File scripts/edge-publish.ps1   # 可加 -SkipBuild / -Notes "说明"
```

- 脚本只打包 `dist/`（`manifest.json` 在 zip 根）；首次上架需在 Partner Center 手动完成，API 仅用于版本更新。
- 有提交处于审核中时不能再发（会报错），需等审核结束。
