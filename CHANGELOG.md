# Changelog

All notable changes to PigeonDeck will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

> **当前阶段：编码进行中。** V1 首个版本号将在功能闭环完成后确定。

### Coding — 阶段 10：清空确认（2026-07-03）

- 清空确认弹层（`src/content/clear.ts`，`ClearManager`）：点工具盘「清空」→ 贴清空按钮**侧边**弹出小确认层（照搬 preview part 14 `.pd-surface.confirm`：说明 + 取消 ghost / 确认清空 danger）；再点清空 = 收起；无标注内容时仅轻提示不弹层；点外部/取消/确认后关闭并移除清空按钮危险态
- 弹层定位（`positionBeside`）：工具盘是屏幕边缘纵向列，弹层贴按钮左侧（靠右缘时）或右侧（放不下时）、竖直居中夹紧视口——避免与工具盘列重叠被 control 层（z-4 > panel z-3）遮挡确认按钮
- **可撤销复合清空命令**（蓝图 §4.4 撤销覆盖清空 + §5.6）：确认 → `snapshot=store.toPageState()` → doClear（按 selector 重解析每条标注元素，样式/内容改回旧值 + 复位移动 `transform` → `store.clear()` 编号归 1）→ `history.clear()` 清旧栈 → push 单条「clear」命令（apply=doClear，revert=`store.load(snapshot)` 恢复标注/编号/nextNumber + 重放新值/移动 transform）；因此清空后 Ctrl+Z 可整体恢复（标注、编号、直接编辑、移动预览全回来），再 Ctrl+Shift+Z 再清
- `applyChangesTo`（`src/content/panel.ts`）改为 `export`，清空命令复用（单一真相源，不复制回放逻辑）
- i18n：确认文案（诚实标注「可撤销」，非「不可撤销」）+ 取消/确认清空 + 无内容/已清空 toast，中英双语
- 单测：`clear.test.ts` 6 条（清空后 store 空 + nextNumber=1 + 可撤销；撤销恢复标注与编号；重做再清；DOM 样式/移动回退与重放）
- E2E：`tests/e2e/clear.spec.ts` 4 用例（确认清空位号全消失、清空后 Ctrl+Z 位号恢复、点外部取消弹层关闭且位号仍在、清空后新标注编号重置为 #1），**默认右下角位置**验证弹层侧边定位可点击；时序断言全轮询

### Coding — 阶段 9：复制图片（2026-07-03）

- 截图拼接管线（`src/content/capture.ts`，9a）：`chrome.tabs.captureVisibleTab` 滚动拼接单页长图，无第三方依赖；纯函数 `computeCaptureRange`（标注文档坐标 min/max ± padding，总高钳 ≤ `MAX_CAPTURE_HEIGHT`=14000px）+ `planScreens`（逐屏 scrollY 序列、末屏对齐范围底）；`captureStitched` 隐藏自身 UI → 逐屏 `scrollTo` + 渲染等待（350ms）→ 后台截图 → 恢复 UI/scroll → canvas 按 `devicePixelRatio` 缩放拼接
- 后台限速（`src/background/service-worker.ts`）：`{type:'pd-capture'}` 消息 → `captureVisibleTab`，**≥600ms/屏节流**（captureVisibleTab 上限 2 次/秒）；`manifest.json` 加 `host_permissions: ["<all_urls>"]`
- 叠加程序化重绘（9b）：编号圆/标注框/区域框/移动预览幽灵框+连线**不截自页面**，按标注文档坐标在拼接 canvas 上重画（更清晰）；纯函数 `layoutOverlay`（文档坐标 → canvas 坐标，Y 减 range.top）；视觉逐值照搬 pigeonlib（邮政金 `#b8842c`、区域软金底、位号圆金底白字+阴影、圆角 6px）；被移动元素反推初始位置=最终−(dx,dy)，主框画初始、幽灵框画最终、虚线连线
- 剪贴板 / 下载（9b）：结果弹窗（照搬 preview part 38 `.opanel-img`）底栏「复制」(`ClipboardItem('image/png')` via `navigator.clipboard.write`) + 「下载」(`toBlob` → blob URL → `pigeondeck-capture.png`)；`settings.imageMethod`（`clipboard`/`download`，默认 clipboard）生成后自动执行一次；可选水印 `settings.watermark`（长图底部「URL · 时间」浅底药丸）；仅产图不附文本
- **已知限制**：① `captureVisibleTab` 仅截视口宽，横向滚动页面长图按文档宽拉伸（V1 妥协）；② fixed 定位元素在拼接图中重复出现（V1 妥协）；③ 自动复制到剪贴板在异步截图管线后用户手势已消耗，真实 Chrome 下可能失败并降级 toast——结果弹窗「复制」按钮在手势内可靠可用
- i18n：截图生成中/无内容/失败 + 已复制/复制失败/已下载 toast，中英双语
- 单测：`capture.test.ts` 20 条（9a 范围/分屏 16 + 9b `layoutOverlay` 坐标换算 4）
- E2E：`tests/e2e/copy-image.spec.ts`（① 无标注 toast 正常；②③ 截图弹窗/关闭在 Playwright persistent-context 下 `captureVisibleTab` 挂起，按 §15 软降级 + DEVIATION 记录，附真实 Chrome 手动冒烟清单）

### 修正 — UI 校准（2026-07-03，随阶段 9 合并）

- Logo 换新：`public/brand/logo.svg` + 工具盘/悬浮球图标改为新描边鸽子（`stroke=currentColor` 继承白色 `#fdf6e6`）
- 工具盘按钮顺序照搬 preview part 02：**Logo → 撤销/重做 → 移动 → 复制文本 → 复制图片 → 清空 → 设置**（原实现误将撤销/重做置于复制图片之后）
- 移动模式补 hover 反馈：鼠标悬浮未选中元素显示圆角高亮框（`.pd-hover`，经选择粒度解析器指向 click 将实际选中的元素），单击后变八向句柄框
- 调色盘局部取色推荐：色块不足 7 个时保持原尺寸并左对齐（原 `flex:1` 会拉伸放大）

### Coding — 阶段 8：复制文本（2026-07-03）

- 复制文本格式化管线（`src/content/format.ts`，纯函数、无 DOM/chrome/i18n 运行时依赖）：`buildOperations(annotations)` → 中间操作模型（按 selector 去重合并、Type 组合固定序 `Annotation + Style Modification + Move`、Region 独立），`renderTaskList(ops, ctx, lang)` → 严格按蓝图 §7.1 + preview part 37 渲染 Codex/AI 可执行任务清单（`[Page Context]` / `[Global Editing Rules]` / `[Operations]`，`--- #N Type ---` 区块头）
- 输出规则：Changes 表 `| cssProp | old | new |`；文本/富文本/媒体（cssProp text/html/src）归 contentChanges 渲染为可读描述（富文本剥标签、dataURL 显 `data:<mime>`、URL 显文件名——不塞原始内容）；移动只输出初始→最终 + 吸附语义/free move；同元素多操作合并为一条；[Global Editing Rules] 固定含「不硬编码 top/left、优先 flex/grid/gap/margin/order、视觉坐标只是线索」
- 导出语言：`renderTaskList` en/zh_CN 双模板，结构 key 恒英文、仅 Global Rules 正文随语言、用户批注原文不翻译，未知语言回退 en；`settings.exportLang`（`en`/`zh_CN`/`auto`，默认 en，auto 跟随界面 locale）
- 复制文本 UI（`src/content/copy-text.ts`）：点工具盘「复制文本」→ 构造 PageContext（url/title/viewport/timestamp）→ 生成清单 → **点击手势内同步 `navigator.clipboard.writeText`** + 轻提示 → 弹结果窗（照搬 part 37 `.opanel`：可滚动 `<pre>` 预览 + 底栏左语言快切 en/zh 即时重渲 + 右下载 `.md`/再复制）；点外部/Esc 关闭；无标注轻提示不弹空窗
- OpenDesign 兼容：输出为纯 Markdown-ish 任务清单，无扩展私有字段污染
- i18n：结果弹窗 + toast 文案，中英双语
- 单测：`format.test.ts` 43 条（Type 组合/去重合并/移动初始→最终/Changes 分流/Region/语言 en·zh·回退/内容修改剥标签/渲染结构，均对实际输出串强断言）
- E2E：`tests/e2e/copy-text.spec.ts` 4 用例（弹窗+正文含 Page Context/Operations/note、**剪贴板 `readText` 断言任务清单结构**、语言快切 en↔zh、样式修改输出 Changes 表），授剪贴板权限、时序轮询

### Coding — 阶段 7：撤销/重做（2026-07-03）

- 撤销/重做接线（`src/content/main.ts`）：`controller.setCallbacks({ onUndo, onRedo })` 接到 `history.undo()`/`redo()`；`History` 在 `Toolbar` 之前实例化并注入
- 历史栈订阅（`src/state/history.ts`）：新增 `subscribe(listener)` + `notify()`，在 `push/undo/redo/clear/setLimit` 后触发；既有命令模式语义不变（push 不调 apply、undo→revert、redo→apply、新命令清 redo 栈）
- 工具盘按钮禁用态（`src/content/toolbar.ts`）：合并撤销/重做药丸的左半(撤销)/右半(重做) 按 `canUndo()`/`canRedo()` 实时刷新禁用态，订阅 history 变化驱动；初始栈空 → 两半均禁用
- 键盘快捷键（`src/content/shortcuts.ts`）：window capture 监听，**仅展开态生效**——`Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Shift+Z` 重做、`Esc` 退出当前工具（移动/设置 → 回默认批注态）；内联编辑的 Esc 由 direct-edit 在 capture 段先消费，互不冲突
- 覆盖范围：阶段 3–6 全部操作（标注保存/删除、富文本编辑、图片/视频替换、区域批注、句柄缩放、拖拽移动）均已 push 撤销命令，闭环可撤销/重做（清空的复合命令留待阶段 10）
- 历史上限（`src/state/settings.ts`）：新增 `historyLimit`（默认 50），`new History(settings.historyLimit)` 消费（完整设置 UI 阶段 11）
- 单测：`history.test.ts` 补 2 条（subscribe 触发计数 / 取消订阅安全），共 12 条
- E2E：`tests/e2e/undo-redo.spec.ts` 4 用例（初始按钮禁用、点击 undo/redo 位号消失/恢复闭环、快捷键 Ctrl+Z/Ctrl+Shift+Z 闭环、收起态 Ctrl+Z 不生效），时序断言轮询

### Coding — 阶段 6：移动模式（2026-07-03）

- 移动模式选中（`src/content/move.ts`）：工具盘移动按钮进入移动模式后，单击页面元素 → 邮政金选中框 `.pd-selbox` + 八向缩放句柄（四角 + 四边中点）；overlay 层渲染、scroll/resize 跟随；点空白/切模式/收起取消选中
- 选择粒度（`src/content/visual-units.ts` + `src/content/selection.ts`）：`defaultGranularity` 设置（智能组件块 / 单元素）；`resolveComponentBlock` 启发式——沿祖先链找最近「组件块」（可见背景/边框/阴影 或语义标签，超视口 98%×50% 阈值即页面容器停止）；`SelectionResolver` 维护相对偏移并记忆、应用到后续选择
- 选择粒度 +/- 胶囊（`src/content/panel.ts`）：批注面板底栏最左（仅智能块基准显示），沿 DOM 链多级放大(祖先)/缩小(子)并重指向标注目标；**始终以稳定的原始命中元素 + 累加偏移解析**（避免多级过冲）
- 八向句柄缩放：拖四角/四边句柄改 width/height，走 `StyleChange` 管线（与面板尺寸控件等价、同进撤销历史）；window 捕获段监听（不用 setPointerCapture）
- 拖拽移动（阶段 6b）：选中元素本体点住即拖，**用 `transform: translate()` 预览**（绝不改 position/top/left，不破坏布局、易回滚）；松手记录移动进标注 + 撤销历史；**同元素多次移动合并**——保留最初 initialRect、只更新累计位移/finalRect
- 吸附与参考线（`src/content/snap.ts` 纯函数）：拖拽实时扫描视口内可见块级元素，`snapDrag` 计算边缘 / 中心对齐（阈值 4px，取最小修正量）→ 吸附到位并画虚线参考线 `.pd-guide` + 方位语义标签（左/右/顶/底边对齐、水平/垂直居中）；参考线颜色按页面背景亮度自动白/黑反色
- Alt+拖拽 = 自由移动：跳过吸附、不画参考线、显 `.pd-freehint` 轻提示、记 freeMove
- 数据模型：Annotation 新增可选 `move?: { dx, dy, initialRect, finalRect, snap, freeMove }`（向后兼容）；`applyChangesTo` 的样式回放支持 width/height（既有 else 分支）
- i18n：粒度胶囊、参考线语义、自由移动提示，中英双语
- 单测：`snap.ts` 14 条（各对齐类型 / 阈值边界 3吸4吸5不吸 / XY 同吸 / 多候选取最近 / 空候选 / 参考线并集）+ `visual-units` 8 条 + `selection` 9 条
- E2E：`tests/e2e/move.spec.ts` 8 用例（selbox+8 句柄出现、句柄缩放 width/height 变化、缩放进 store 出位号、切模式 selbox 消失、**多级 +/- 粒度不过冲落在正确 2 级祖先**、拖拽出 translate+位号、拖到对齐处出参考线、Alt 拖无参考线+free hint）

### Coding — 阶段 5：区域框选（2026-07-03）

- 长按框选（`src/content/region-select.ts`）：批注模式下长按 ≥300ms（`LONG_PRESS_MS` 常量，阶段 11 接设置）→ 拖拽实时品牌金框（`.pd-region` 半透明预览）→ 松手弹小型区域批注面板（照搬 preview part 08 `.rpanel`：自适应 textarea + 保存/删除）；松手后 `suppressNextClick` 抑制紧随的 click，避免误开元素面板；小于 6px 视为误触取消
- 区域数据模型（`src/state/annotations.ts`）：Annotation 新增可选 `kind?: 'element' | 'region'` + `region?: { docRect, elements }`（向后兼容旧数据，无 kind = 元素）；区域记录 docRect（文档坐标，跨滚动复现）+ 框内可见元素选择器列表（`isVisible` + 矩形相交，上限 30，供复制文本 AI 精准定位）；**区域批注与元素标注共用同一套编号系统**（递增/删除不重排/清空重置天然生效）
- 覆盖层区域渲染（`src/content/overlay.ts`）：按 `kind` 分支——区域用 `.pd-region` 框（不建 markbox、不解析目标元素、不挂 ResizeObserver），位号贴区域左上角；滚动/resize 时按 `docRect − scroll` 跟随、恒可见；区域标注不计入「未定位」轻提示
- 撤销历史：区域批注保存/删除均进撤销栈（apply=restore、revert=remove）；卡片底栏 meta 用「区域 / Region」标签替代元素类型
- i18n：新增 `region_note_placeholder`、`region_label`，中英双语
- 单测：区域标注模型 4 条（kind/region 字段保留、编号接续元素、序列化往返、旧数据兼容）
- E2E：`tests/e2e/region.spec.ts` 3 用例（长按拖出实时金框→弹面板、保存后持久区域框+位号、区域编号接续元素编号），长按用轮询等金框出现、时序断言全部轮询

### Coding — 阶段 4：直接编辑与内联富文本（2026-07-03）

- 双击文本内联编辑（`src/content/direct-edit.ts`）：双击文本元素 → 目标临时 `contentEditable` 进入页内编辑（进入前快照 `innerHTML`）；blur/点外部提交、Esc 取消（恢复快照）；内容变化记为 `StyleChange{cssProp:'html'}` 并入该元素标注（无则新建 note 空标注）→ push 撤销历史（revert 恢复快照）
- 单击/双击区分：文本/图片/视频元素单击延迟 250ms 让出双击时间窗口，双击触发时抢占取消待定单击；内联编辑期间落在编辑元素上的事件豁免批注模式拦截（光标/选区可用）
- Word 式双行富文本浮条（`src/content/inline-richtext.ts`，视觉照搬 preview part 24）：选中字符即贴选区上方弹出，翻转避让；第一行字体/字号/字色/高亮、第二行 B/I/U/S/上标/下标/对齐/列表，`document.execCommand`（`styleWithCSS`）逐字符生效；**弹层类命令（字体/字号/字色/高亮/对齐）保存并恢复选区 Range**（否则弹层交互塌陷选区致命令失效）；字号经 `<font size=7>` → `<span style="font-size:Npx">` 改写实现任意 px（纯函数 + 单测）
- 图片/视频替换（`src/content/replace-media.ts`，视觉照搬 preview part 25）：双击图片/视频 → 替换弹层（本地文件 `FileReader`→dataURL 或粘贴 URL）→ 即时预览 + 记 `StyleChange{cssProp:'src'}` + 撤销历史
- dataURL 持久化上限（`src/state/session.ts`）：`sanitizeForPersist` 纯函数在序列化前剔除 `src` 且 dataURL 超 ~1MB 的修改（只活内存、刷新不恢复，避免撑爆 sessionStorage 致整页丢失），替换命中上限时 toast 提示「刷新不可恢复」；6 条单测
- 撤销/重做回放扩展（`applyChangesTo`）：新增 `html`（`innerHTML`）与 `src`（`setAttribute`）两分支，使富文本编辑与媒体替换的撤销/重做/删除回退都能正确复原
- 卡片调整项：富文本内容变更用「文本内容」标签 + 纯文本 old→new 呈现（不露原始 HTML）；媒体替换 src 用精简摘要（dataURL 显 `data:<mime>`、URL 显文件名）避免撑爆卡片
- i18n：新增富文本浮条 + 替换弹层 + toast 文案 key，中英双语同步
- 单测：字号改写纯函数 11 条 + `sanitizeForPersist` 6 条
- E2E：`tests/e2e/direct-edit.spec.ts` 8 用例（双击进编辑/选区弹浮条/加粗只影响选区/**字号弹层命令只作用于选区**/点外部提交出位号/单击仍弹面板/双击图片出替换弹层/URL 替换即时预览/本地文件 `setInputFiles` 替换），时序断言全部轮询；夹具新增 `<img>`

### Coding — 阶段 3b：修改栏与高级样式（2026-07-02）

- 属性控件注册表（`src/content/fields.ts`）：`FIELD_DEFS` 全集单一真相源（文字/字号/字重/颜色/对齐/装饰/行高/字距/列表/大小写/宽高/显示/溢出/背景/边框/圆角/阴影/透明度/模糊/内外边距…）；`FieldsSession` **双入口单源**——修改栏（按元素类型的高频子集）与高级样式（全集）实例化同一 field 时共享当前值与监听，改一处两处同步；控件改动即时 inline 预览 + 基线快照，`getChanges` 同属性合并为一条（最初 oldValue、最新 newValue，改回原值自动剔除）
- 修改栏智能切换（`buildModbox`）：文本 / 图片视频 / 按钮容器分别列高频控件；陌生元素（other）按 computed style 动态挑前 4 项并挂「自动」角标 + 自动适配说明条
- 高级样式折叠区（`src/content/advanced-styles.ts`）：4 分类左导航（排版 / 尺寸 / 外观 / 调试）+ 变更角标计数；折叠/展开与切分类走面板高度柔和动画（px→auto，`interpolate-size` 190ms）；调试分类 = 只读 computed + DOM 信息 readout，默认全英文，点翻译图标就地切中文标签（值保持原样）
- 自制下拉浮层（`src/content/dropdown.ts`）：≥7 行可见滚动；字体/字重/边框类字段顶部智能识别栏 = 祖先链 computed 采样去重取频次前 5，采不到自隐
- 调色盘浮层（`src/content/color-picker.ts`）：收起色块 → 展开取色器（饱和度面板 + 色相条）+ 局部推荐色前 7（页面采样）+ RGB/HEX + 透明度滑杆 + EyeDropper 取色
- 样式修改管线：控件 → inline style 即时预览 → `StyleChange{prop, cssProp, oldValue, newValue}` → 保存写入 `annotation.changes`（`mergeChanges` 合并）→ push 撤销历史命令；**未保存关面板（点外部）回滚本次会话全部预览**（原本无内联样式的属性回滚为移除，非留空）；删除标注回退其已保存样式并进撤销历史
- 批注卡片调整项：卡片下半区渲染「原值 → 新值」精简 diff 行（`.pd-diff`），字段名走 i18n 标签，超长值截断
- 撤销历史（`src/state/history.ts`）：命令模式 `{label, apply, revert}`，push 不重复执行动作，新命令清空 redo 栈，默认上限 50；10 个单测
- 控件配方移植（`src/content/base.css`）：下拉 / 数值胶囊 / 分段 / 颜色 / 导航 / 调色盘 / 调试 readout 逐值照搬画廊
- i18n：新增高级样式 / 控件 / 选项 / 提示大批文案 key，中英双语同步
- 单测：`fields.test.ts`（21）+ `dropdown.test.ts`（12）+ `color-picker.test.ts`（9）+ `history.test.ts`（10）+ annotations `StyleChange`/`mergeChanges`/`restore` 扩充
- E2E：`tests/e2e/style-edit.spec.ts` 6 用例（排版修改栏即时改字号、调色盘推荐色改背景→保存→卡片调整项行、高级样式 4 分类切换 + 字体下拉智能识别栏、未保存关面板回滚、陌生元素「自动」角标控件、调试分类英中翻译切换），时序断言全部轮询；夹具页新增陌生元素卡

### Coding — 阶段 3a：批注核心链路（2026-07-02）

- DOM 工具（`src/shared/dom-utils.ts`）：`buildSelector` 稳定唯一选择器（id 锚点 → 唯一 class 组合 → nth-of-type 链，软深度上限 + querySelector 唯一性验证，跳过 css-hash 噪音类）；`classifyElement` 六类元素分类（text/image/video/button/container/other）；`getElementSummary` / `isVisible`；23 个 vitest 单测全绿
- 标注状态层（`src/state/annotations.ts`）：Annotation 数据模型（changes 预留 3b 填充）+ Store（add/update/remove/clear/getAll/getBySelector + subscribe 订阅）；**编号规则全实现：递增分配、删除不重排、清空后从 1 重置**；28 个单测覆盖编号规则/增删改查/序列化往返
- 会话持久化（`src/state/session.ts`）：sessionStorage 天然匹配 tab 会话（刷新在、关 tab 清），key = `pigeondeck:` + 完整 URL，序列化顶层按 pageKey 组织（V2 多页扩展点）；store 变化 300ms 防抖写入，解绑冲刷
- 极简设置（`src/state/settings.ts`）：chrome.storage.local 存取，本阶段 `hoverLabel: true` + `cardDefaultExpanded: false` 两项，默认值合并留好扩展
- 覆盖层（`src/content/overlay.ts`）：批注模式 hover 高亮框（`--c1-edge` 1.5px + `--c1-soft` 底）+ 元素标签（9px 白字深色半透明底 + `--c1` 描边，显示 tagName 跟随鼠标，settings.hoverLabel 控制）；已保存标注渲染标注框（`--c1` 1.5px 圆角 6px）+ 位号圆（22px 金底白字，左上角）；**跟随机制**：scroll（capture 段含嵌套滚动）/resize rAF 节流 + ResizeObserver + MutationObserver 兜底；目标元素消失隐藏 UI 保留数据、自动尝试重解析；composedPath 过滤自身 Shadow UI
- 批注面板（`src/content/panel.ts`）：单击页面元素弹出（capture 段拦截 click/mousedown，阻止链接跳转等页面默认行为）；结构 = 批注 textarea（field-sizing 自适应高度）+ 底栏（`#位号 · 元素类型 · x,y px` + 删除/保存）；四向翻转避让视口（右→下→左→上）；点外部关闭放弃未保存内容；已有标注再单击预填内容
- 批注卡片：点位号圆展开/收起（`.pd-surface` 卡片：批注文本 + 底栏删除/修改），默认展开态读 settings.cardDefaultExpanded；四向翻转防截断，放不下夹紧视口并画 `.pd-connector` 虚线连回位号圆；跟随目标元素滚动
- 位号圆右键菜单：`.pd-menu` 上弹（修改批注 / 删除批注危险色），点外部关闭；删除不重排编号，新标注继续用下一个号
- 恢复与轻提示：注入时按 selector 重新定位挂标注 UI，找不到的目标数据保留、UI 跳过，feedback 层 `.pd-toast` 轻提示「N 条标注未能定位」（190ms 进出，2.5s 自动消失）
- i18n：新增 5 个批注文案 key（panel_note_placeholder / panel_save / menu_edit_annotation / menu_delete_annotation / toast_restore_missing），中英双语同步
- E2E 测试：`tests/e2e/annotation.spec.ts` 6 用例（hover 高亮+标签、单击面板保存出位号、卡片开合、右键菜单删除+编号不复用、刷新恢复、链接点击拦截不导航），时序断言全部轮询；夹具页新增带 href 链接卡
- 测试基建：引入 jsdom（DOM 类单测环境，per-file `@vitest-environment` 注解）

### Coding — 阶段 2：工具盘与悬浮球（2026-07-02）

- 模式控制器（`src/content/controller.ts`）：极简状态机 `mode: annotate/move/settings + expanded`，展开自动进入 annotate，move/settings 互斥，收起重置；瞬时动作回调挂点；subscribe() 订阅机制；24 个 vitest 单测全绿
- 悬浮球（`src/content/toolbar.ts`）：42px 邮政金圆形底色 + 白色鸽子 SVG，阴影按 design-system §5.1，默认右下角 16px；点击展开，长按 ≥300ms 拖拽，位置持久化 localStorage，resize 夹紧，刷新恢复
- 单列纵向工具盘：药丸容器（radius 999px、padding 5px、gap 3px），7 按钮（Logo/移动/复制文本/复制图片/撤销重做/清空/设置），SVG 图标从 preview part 02 完整照搬；撤销重做横向合并药丸（42×23），本阶段禁用占位
- 激活态：move/settings 按钮 `--c1-soft` 底 + `--c1-edge` 边框 + 工具盘容器外描边；annotate 默认态无高亮
- Tooltip：hover 显示（130ms），工具盘靠右边缘自动翻到左侧
- 展开方向防截断（裁决12 #9）：向下空间不足时工具盘底边贴视口，内容超视口高则内部滚动（隐藏滚动条）
- i18n：8 个 tooltip key（tb_logo / tb_move / tb_copy_text / tb_copy_image / tb_undo / tb_redo / tb_clear / tb_settings），中英双语同步，`i18n:check` 通过
- E2E 测试基建（`tests/e2e/helpers/extension.ts` + `tests/fixtures/basic.html` + `playwright.config.ts`）：chromium 持久化上下文加载扩展，随机端口本地 HTTP 服务
- E2E 测试：`tests/e2e/toolbar.spec.ts` 6 用例（球尺寸/位置、展开收起、tooltip、激活高亮、拖拽持久化、视口边界防截断）

### Coding — 阶段 1：工程骨架（2026-07-02）

- Vite + TypeScript + MV3 工程落地：双配置顺序构建（content → IIFE，background → ES module），输出扁平 `dist/content.js` + `dist/background.js`
- `manifest.json`（MV3）：`__MSG_*__` 国际化、`default_locale: en`、`storage` 权限、自托管 `update_url` 占位（裁决12 #2）
- Shadow DOM 宿主注入：防重复注入 + 四层容器（Control / Panel / Overlay / Feedback）+ `setTheme()` 亮暗切换出口
- pigeonlib 设计令牌完整移植（`src/content/design-tokens.css`，亮/暗双主题变量 + `interpolate-size: allow-keywords`），逐值与画廊比对一致
- i18n 运行时（构建期打包语言 JSON，运行时可切换，缺失回退 en）+ `scripts/i18n-check.mjs` 完整性校验
- 品牌资产：`public/brand/logo.svg`（画廊鸽子线稿提取）+ 四尺寸 icon PNG（sharp 生成，邮政金圆底）
- 极简分级 logger；vitest 单测 9 例全绿；`build` / `typecheck` / `test` / `i18n:check` 四门禁全过

### Design System — pigeonlib

- 建立完整设计令牌体系（CSS 变量）：色彩 / 字体 / 圆角 / 阴影 / 动效
- 确定邮政金 `#b8842c` 为品牌点睛色
- 确定 Fraunces + 思源宋体 为标题字体栈
- 确定 Lucide Icons 为图标库（内联 SVG）
- 亮/暗双主题完整定义，通过 `data-theme` 属性切换
- 沉淀可复用控件配方：`.pd-color`（色块·色值·取色器）、`.pd-menu`、`.pd-range`

### UI Preview Gallery

- 搭建 UI 组件画廊宿主（`preview/index.html`）
- 产出 **38 张 UI 表面卡**，覆盖全部 V1 交互态：
  - 悬浮球与工具盘（默认态 / 移动态）
  - 批注面板（主态 / 高级样式 / 暗色版）
  - 元素类型适配（文本 / 图片 / 按钮容器 / 陌生元素）
  - 内联编辑与富文本浮条
  - 位号圆与右键上下文菜单
  - 区域框选
  - 移动吸附 / 自由移动 / 参考线
  - 清空确认弹层
  - 设置面板（4 分区：通用 / 交互 / 输出 / 帮助 + 暗色版）
  - hover 标签 / 调色盘 / 轻提示 / Popup / 输出示意
- 完成首轮 + 第二轮 UI 收紧（药丸控件、面板紧凑化、撤销重做合并按钮）
- 高级样式区 4 分类左导航（排版 / 尺寸 / 外观 / 调试）独立成卡
- 调色盘完整实现（色块→展开取色器+局部推荐色+透明度+RGB）

### Documentation

- 完成 V1 实施计划（[docs/v1-plan.md](docs/v1-plan.md)）：15 个实施阶段、文件模块清单、验收标准
- 完成设计系统参考文档（[docs/design-system.md](docs/design-system.md)）
- 完成 11 轮 UI 预览裁决记录（[docs/ui-preview-rulings.md](docs/ui-preview-rulings.md)）
- 建立颗粒化项目规范系统（[docs/conventions/INDEX.md](docs/conventions/INDEX.md)）
- 建立仓库级 CLAUDE.md 索引（项目指令 + 文档导航 + 架构要点）

### Architecture Decisions

- 确定技术栈：Vite + TypeScript + Manifest V3，多入口构建（background + content）
- 确定 Shadow DOM 四层隔离架构（Control / Panel / Overlay / Feedback）
- 确定展开即默认批注模式（无独立批注按钮）
- 确定单列纵向工具盘（7 按钮，仅图标 + hover tooltip）
- 确定合并撤销/重做按钮（左撤销·右重做，默认 50 步上限）
- 确定状态生命周期按标签页会话（URL 键 → 刷新恢复 → 关 tab 清理）
- 确定标注编号删除不重排策略
- 确定同元素多操作合并输出策略
- 确定移动任务合并策略（多次移动 → 初始→最终）
- 确定 OpenDesign 兼容为硬约束
- 确定 V1/V2 功能边界：不做多页面统一导出、多页多图、PDF 支持

---

## [0.1.0] — Design Phase Complete

### Added

- **`preview/`** — UI 组件画廊（38 张表面卡，含 pigeonlib.css + pigeon-components.js）
- **`docs/v1-plan.md`** — V1 实施计划（15 阶段 + 验收标准）
- **`docs/design-system.md`** — 设计令牌与控件规格
- **`docs/ui-preview-rulings.md`** — 11 轮 UI 裁决记录
- **`docs/conventions/`** — 颗粒化项目规范
- **`context/构想蓝图2.md`** — 产品规格完整定义
- **`CLAUDE.md`** — 仓库级 AI 编码指令
- 设计系统 pigeonlib 全套令牌与控件配方
- Light/Dark 双主题完整定义
- V1 架构决策全部落地

---

## Future — Planned for v1.0.0

> 以下为 V1 实施计划中的 15 个开发阶段，将在后续版本中逐步完成。
> 详细验收标准见 [docs/v1-plan.md §4](docs/v1-plan.md#4-验收标准)。

| Phase | Scope |
|-------|-------|
| ~~1~~ | ~~工程骨架：Vite + TS + MV3 + Shadow DOM 宿主 + 设计令牌移植~~ ✅ |
| ~~2~~ | ~~工具盘与悬浮球：Logo 球 + 展开/收起 + 拖拽移位 + 位置持久化~~ ✅ |
| ~~3~~ | ~~批注模式：单击标注 + 修改栏 + 高级样式 + 调色盘 + 批注卡片/位号~~ ✅ |
| ~~4~~ | ~~直接编辑：双击文本编辑 + 内联富文本浮条 + 图片/视频替换~~ ✅ |
| ~~5~~ | ~~区域框选：长按 ≥300ms 拖拽 + 区域批注面板~~ ✅ |
| ~~6~~ | ~~移动模式：选中 + 拖拽 + 吸附/参考线 + 八向缩放句柄~~ ✅ |
| ~~7~~ | ~~撤销/重做：合并按钮 + 全操作覆盖 + Ctrl+Z / Ctrl+Shift+Z~~ ✅ |
| ~~8~~ | ~~复制文本：Codex/AI 任务清单生成 + 去重合并~~ ✅ |
| 9 | ~~复制图片：单页长图 + 批注叠加~~ ✅ |
| 10 | ~~清空确认：贴工具盘确认弹层~~ ✅ |
| 11 | 设置面板：4 分区 + 贴工具盘 |
| 12 | 安装说明页：首次自动打开 + 设置可重看 |
| 13 | Popup 与后台：Service Worker + 右键菜单 + file:// + PDF 提示 |
| 14 | i18n 完整化：中英双语全覆盖 |
| 15 | 测试：Vitest 单测 + Playwright E2E + 手动冒烟 |

---

[Unreleased]: https://github.com/HELUOO404/PigeonDeck/compare/v0.1.0...HEAD
