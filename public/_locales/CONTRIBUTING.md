# PigeonDeck 多语言贡献指南

## 快速上手

1. 复制 `_locales/en/messages.json` → `_locales/<语言代码>/messages.json`
2. 翻译每个 entry 的 `message` 字段，保持 `placeholders` 结构不变
3. 在 `_locales/AVAILABLE_LANGUAGES.json` 中添加你的语言条目
4. 提交 PR

## 语言代码规范
使用 BCP 47 语言标签：zh_CN、ja、ko、fr、de、es、pt_BR ...

## messages.json 结构

```json
{
  "key_name": {
    "message": "翻译文案",
    "description": "描述用途，帮助译者理解上下文"
  }
}
```

## 约束
- `message` 中的 `$PLACEHOLDER$` 占位符必须原样保留，不可翻译
- `description` 字段只需翻译内容，不要改动
- 不允许新增或删除 key（必须与 en/messages.json 严格一致）

## 优先级
按使用频率，推荐优先翻译：
1. 工具盘按钮 tooltip
2. 面板标题与标签
3. 设置面板各选项
4. 复制文本输出标题（Page Context、Global Editing Rules 等）
5. 轻提示与错误信息

## 验证
提交前运行 `npm run i18n:check` 确保所有 key 完整
