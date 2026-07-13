# 仓库脚本

本目录保存可重复执行的资源生成与仓库检查脚本。

- `i18n-check.mjs`：校验语言文件。
- `gen-icons.mjs`、`generate-icons.mjs`、`extract-logo.mjs`：品牌图标处理。
- `shot-*.mjs`、`shots-*.mjs`：用 Playwright 生成横幅、封面、教程或产品截图。
- `onboarding-images.mjs`：把截图源转换为教程资源。

脚本应使用 Node 标准库和现有依赖，输入输出路径必须在文件顶部或用法说明中明确。一次性失效脚本不要长期保留。
