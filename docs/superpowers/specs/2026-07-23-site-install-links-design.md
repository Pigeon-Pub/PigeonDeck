# 官网安装入口自适应设计

日期：2026-07-23

## 目标

将 `site/index.html` 中仍标记为“即将上线”的安装入口替换为已发布的正式链接：

- Edge 商店：https://microsoftedge.microsoft.com/addons/detail/pigeondeck/nicemhopdfhnjodfkkibnbodjccohmob
- crxsoso 镜像：https://www.crxsoso.com/addon/detail/nicemhopdfhnjodfkkibnbodjccohmob

修改后发布到现有 Cloudflare Pages 项目 `pigeondeck`，线上地址为 https://deck.pigeon.pub。

## 交互设计

### 主安装按钮

首屏与收尾 CTA 的主安装按钮统一加 `data-install-link` 标记，并在页面初始化时自适应：

- Microsoft Edge：显示“Edge 商店” / “Edge Add-ons”，链接到 Edge 商店。
- 其他浏览器：显示“crxsoso 镜像” / “crxsoso Mirror”，链接到 crxsoso。

浏览器判断优先使用 `navigator.userAgentData.brands` 中的 `Microsoft Edge`，不支持 Client Hints 时回退到 `navigator.userAgent` 中的 `Edg/` 标记。判断失败时按非 Edge 处理，展示镜像链接。

### 页脚

页脚固定同时展示两个可点击链接：Edge 商店、crxsoso 镜像。移除两者的“即将/Soon”状态，不做浏览器自适应，方便用户主动切换渠道。

### 保留行为

- GitHub 与“从源码运行”入口保持不变。
- 所有新外链使用 `target="_blank" rel="noopener"`。
- 保持现有按钮样式、布局、主题切换与中英文切换。
- 不增加依赖，不引入额外文件或抽象。

## 实现范围

仅修改 `site/index.html`：

1. 将首屏和收尾的禁用按钮改为链接。
2. 将页脚的禁用占位改为两个正式链接。
3. 在现有内联脚本中增加安装入口选择逻辑，并使文案继续受现有 `applyLang` 机制管理。

不修改扩展源码、商店发布流程、Cloudflare 配置或其他页面。

## 验证

1. 静态检查页面中不再存在安装入口的“即将/Soon”占位。
2. 模拟 Edge Client Hints/UA，确认两个 `data-install-link` 均指向 Edge 商店且文案正确。
3. 模拟普通 Chrome/无 Client Hints，确认两个主按钮均指向 crxsoso 且文案正确。
4. 确认页脚同时包含两个固定正式链接。
5. 用现有部署命令发布 `site/` 到 Cloudflare Pages。
6. 请求 https://deck.pigeon.pub，确认 HTTP 200、页面包含两个正式 URL，并在实际 Edge/非 Edge 环境至少验证一种浏览器分支。
