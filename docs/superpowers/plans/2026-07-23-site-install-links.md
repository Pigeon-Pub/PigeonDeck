# 官网安装入口自适应 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 PigeonDeck 官网的主安装按钮按浏览器自动指向 Edge 商店或 crxsoso 镜像，并把两个正式渠道固定展示在页脚，随后发布到 Cloudflare Pages。

**Architecture:** 只修改 `site/index.html`。两个主 CTA 使用统一的 `data-install-link` 标记；页面初始化时以 Client Hints 优先、UA 回退的方式判定 Edge，并统一设置链接。页脚直接写入两个固定正式链接。现有 `data-zh` / `data-en` 机制继续负责中英文文案。

**Tech Stack:** 单文件静态 HTML/CSS/原生 JavaScript；Cloudflare Pages / wrangler。

## Global Constraints

- 仅修改 `site/index.html`，不增加依赖或新运行时代码文件。
- 不修改扩展源码、商店发布流程、Cloudflare 配置或无关未跟踪文件。
- Edge 商店 URL：`https://microsoftedge.microsoft.com/addons/detail/pigeondeck/nicemhopdfhnjodfkkibnbodjccohmob`。
- crxsoso URL：`https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob`。
- 首屏与收尾 CTA 自适应；页脚固定同时展示两个渠道。
- 新外链均使用 `target="_blank" rel="noopener"`。
- GitHub、从源码运行、主题、中英文及现有布局保持不变。
- 不提交或改动当前无关未跟踪的 `artifact*.html*` 和 Word 文档。

---

### Task 1: 实现并本地验证安装入口

**Files:**
- Modify: `site/index.html:219-223`
- Modify: `site/index.html:271-277`
- Modify: `site/index.html:285-290`
- Modify: `site/index.html:294-324`

**Interfaces:**
- Consumes: 现有 `applyLang(lang)`，它按元素的 `data-zh` / `data-en` 更新 `innerHTML`。
- Produces: 两个带 `data-install-link` 的 `<a>`；初始化后的 `href` 和双语文案按 Edge/非 Edge 分支一致；页脚含两个固定渠道链接。

- [ ] **Step 1: 记录修改前的失败检查**

运行：

```powershell
$src = Get-Content site/index.html -Raw
if (($src -split 'title="即将上线"').Count - 1 -ne 2) { throw '预期当前有 2 个主按钮即将上线占位' }
if (($src -split '<span class="soon"').Count - 1 -ne 2) { throw '预期当前页脚有 2 个即将上线占位' }
if ($src -match 'data-install-link') { throw '预期当前尚无自适应安装入口' }
'BASELINE OK: 当前页面仍是待替换占位'
```

Expected: 输出 `BASELINE OK: 当前页面仍是待替换占位`。这确认检查会在实现后因占位消失而不再成立。

- [ ] **Step 2: 将两个主 CTA 改为统一的自适应链接**

把首屏第一个禁用按钮替换为：

```html
<a class="btn btn-gold" data-install-link href="https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob" target="_blank" rel="noopener">
  <span data-zh="crxsoso 镜像" data-en="crxsoso Mirror">crxsoso 镜像</span>
</a>
```

把收尾 CTA 的禁用按钮替换为：

```html
<a class="btn btn-gold" data-install-link href="https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob" target="_blank" rel="noopener">
  <span data-zh="crxsoso 镜像" data-en="crxsoso Mirror">crxsoso 镜像</span>
</a>
```

默认 HTML 使用镜像链接，确保 JavaScript 不执行时仍有可用安装入口；Edge 初始化后再覆盖为商店链接。

- [ ] **Step 3: 将页脚占位改为两个固定正式链接**

用以下内容替换页脚两个 `.soon`：

```html
<a href="https://microsoftedge.microsoft.com/addons/detail/pigeondeck/nicemhopdfhnjodfkkibnbodjccohmob" target="_blank" rel="noopener"><span data-zh="Edge 商店" data-en="Edge Add-ons">Edge 商店</span></a>
<a href="https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob" target="_blank" rel="noopener"><span data-zh="crxsoso 镜像" data-en="crxsoso Mirror">crxsoso 镜像</span></a>
```

- [ ] **Step 4: 在现有内联脚本中加入 Edge 判定与入口初始化**

在 `var root=document.documentElement;` 之后、主题初始化之前加入：

```js
  /* 安装入口：Edge 走官方商店，其它浏览器走 crxsoso 镜像 */
  var EDGE_URL='https://microsoftedge.microsoft.com/addons/detail/pigeondeck/nicemhopdfhnjodfkkibnbodjccohmob';
  var MIRROR_URL='https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob';
  function isEdge(){
    var brands=navigator.userAgentData&&navigator.userAgentData.brands;
    if(brands&&brands.some(function(b){return b.brand==='Microsoft Edge'}))return true;
    return /Edg\//.test(navigator.userAgent||'');
  }
  var edge=isEdge();
  document.querySelectorAll('[data-install-link]').forEach(function(link){
    link.href=edge?EDGE_URL:MIRROR_URL;
    var label=link.querySelector('[data-zh]');
    if(label){
      label.setAttribute('data-zh',edge?'Edge 商店':'crxsoso 镜像');
      label.setAttribute('data-en',edge?'Edge Add-ons':'crxsoso Mirror');
    }
  });
```

该代码必须位于首次 `applyLang(sl||'zh')` 之前，以便语言初始化读取已经选好的渠道文案。

- [ ] **Step 5: 运行静态结构检查**

运行：

```powershell
$src = Get-Content site/index.html -Raw
if (($src -split 'data-install-link').Count - 1 -ne 2) { throw '主安装入口数量不是 2' }
if ($src -match 'title="即将上线"|class="soon"') { throw '仍存在安装入口即将上线占位' }
$edge = 'https://microsoftedge.microsoft.com/addons/detail/pigeondeck/nicemhopdfhnjodfkkibnbodjccohmob'
$mirror = 'https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob'
if (($src -split [regex]::Escape($edge)).Count - 1 -lt 2) { throw 'Edge 正式链接数量不足' }
if (($src -split [regex]::Escape($mirror)).Count - 1 -lt 3) { throw '镜像正式链接数量不足' }
if ($src -notmatch "navigator\.userAgentData" -or $src -notmatch "/Edg\\//") { throw '缺少 Client Hints + UA 回退判断' }
'STRUCTURE OK'
```

Expected: 输出 `STRUCTURE OK`。

- [ ] **Step 6: 在浏览器中验证两个分支与语言切换**

使用 Playwright 或浏览器运行 `site/index.html`：

1. 普通 Chromium 上下文加载页面：两个 `[data-install-link]` 的 `href` 都等于 crxsoso URL，中文显示“crxsoso 镜像”；切换语言后显示“crxsoso Mirror”。
2. Edge 模拟上下文：在文档脚本执行前把 `navigator.userAgent` 覆盖为包含 `Edg/130.0.0.0`，加载页面后两个 `href` 都等于 Edge URL，中文显示“Edge 商店”；切换语言后显示“Edge Add-ons”。
3. 页脚始终同时存在 Edge 与 crxsoso 两个链接。
4. 主题切换、GitHub、“从源码运行”链接仍正常。

Expected: 上述断言全部通过，浏览器控制台无错误。

- [ ] **Step 7: 检查差异并提交实现**

运行：

```bash
git diff --check -- site/index.html
git diff -- site/index.html
git status --short
```

确认只有 `site/index.html` 被修改；无关未跟踪文件仍未暂存。随后：

```bash
git add -- site/index.html
git commit -m "feat: 官网按浏览器展示安装渠道"
```

Expected: 创建一个只包含 `site/index.html` 的提交。

---

### Task 2: 部署到 Cloudflare Pages 并验证线上

**Files:**
- No repository file changes expected.
- Read credentials from: `.secrets/deploy-credentials.md`（不得暂存或提交）。

**Interfaces:**
- Consumes: Task 1 已提交的 `site/` 静态站；Cloudflare Pages 项目 `pigeondeck`；账号 ID `4000221f6c135fb1ab5517d47552e45d`。
- Produces: https://deck.pigeon.pub 上线新版页面，HTTP 200，含两个正式渠道 URL 与自适应脚本。

- [ ] **Step 1: 部署前验证凭据仍被 Git 忽略**

运行：

```bash
git check-ignore -v .secrets/deploy-credentials.md
git status --short
```

Expected: 第一条命中 `/.secrets/` 规则；凭据文件不出现在 `git status` 中。

- [ ] **Step 2: 发布 `site/` 到现有 Pages 项目**

在 PowerShell 设置 `.secrets/deploy-credentials.md` 中带 `Cloudflare Pages:Edit` 权限的 token：

```powershell
$env:CLOUDFLARE_API_TOKEN  = '<从 .secrets/deploy-credentials.md 读取>'
$env:CLOUDFLARE_ACCOUNT_ID = '4000221f6c135fb1ab5517d47552e45d'
npx wrangler pages deploy site --project-name pigeondeck --branch main --commit-dirty=true
```

Expected: wrangler 输出 `Deployment complete` 以及新的 `*.pigeondeck.pages.dev` 部署 URL。

- [ ] **Step 3: 验证线上 HTML 与 HTTPS**

运行：

```powershell
$r = Invoke-WebRequest 'https://deck.pigeon.pub/' -UseBasicParsing -TimeoutSec 30
if ($r.StatusCode -ne 200) { throw "线上 HTTP $($r.StatusCode)" }
$src = $r.Content
$edge = 'https://microsoftedge.microsoft.com/addons/detail/pigeondeck/nicemhopdfhnjodfkkibnbodjccohmob'
$mirror = 'https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob'
if ($src -notmatch [regex]::Escape($edge)) { throw '线上缺少 Edge 商店链接' }
if ($src -notmatch [regex]::Escape($mirror)) { throw '线上缺少 crxsoso 镜像链接' }
if ($src -notmatch 'data-install-link' -or $src -notmatch 'navigator\.userAgentData') { throw '线上缺少安装入口自适应逻辑' }
"ONLINE OK: HTTP $($r.StatusCode), bytes=$($r.RawContentLength)"
```

Expected: 输出 `ONLINE OK: HTTP 200`。

- [ ] **Step 4: 最终仓库检查**

运行：

```bash
git status --short
git log -2 --oneline
```

Expected: 本任务没有额外未提交改动；原有无关未跟踪文件仍原样存在且未被提交。报告实现提交哈希、Pages 部署 URL 与 `deck.pigeon.pub` 验证结果。
