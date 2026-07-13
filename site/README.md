# 独立宣传站点

`site/` 是可独立部署的静态宣传站点，入口为 `index.html`。

- `assets/` 保存站点自身的 Logo 和中英文产品截图。
- `preview.png` 是站点预览图。
- `index.html.artifact.json` 是站点生成工具的元数据。

站点内截图与根 `assets/screenshots/` 的重复是有意的部署边界：部署 `site/` 时不得依赖仓库外层路径。新增站点资源必须放在 `site/assets/` 并使用相对链接。
