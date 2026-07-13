# 项目素材

本目录保存 README、商店页面、宣传页面和内容制作使用的源素材与输出素材，不包含扩展运行时资源。

- `banner.html` / `banner.png`：仓库 README 横幅源文件和输出图。
- `screenshots/`：README 与教程使用的产品截图源。
- `covers/`：宣传封面、生成模板和输出图；其中 `covers/build/` 是忽略的中间产物。
- `references/`：设计和内容制作参考图，不参与产品构建。
- `pigeondeck-logo-source.svg`：用户提供的 Logo 源稿；运行时版本位于 `public/brand/`。

新增素材应使用能描述用途的文件名。扩展运行时依赖必须放入 `public/`，不要从这里直接引用。
