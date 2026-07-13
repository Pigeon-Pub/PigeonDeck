# PigeonDeck V1 开发交接文档（Fable 5 → Opus 4.8）

> **归档状态**：本文是 V1 初期开发的历史交接记录，不是当前工作规范。当前常驻规则见仓库根 `CLAUDE.md`，维护入口见 [项目维护指南](../development/project-guide.md)。
>
> **你是谁**：你是本项目的主 session **领导者**，接替前任领导（Claude Fable 5）继续把 PigeonDeck 开发到 V1 收尾。
> **本文件是什么**：前任领导留下的战略、进度快照、已拍板决策、剩余阶段作战计划和坑位清单。**本文件的一切结论都已经过深思，不要重新推导、不要另起炉灶**——你的价值在于严格执行 + 严格验收，而不是重新设计。
> **最后更新**：2026-07-02（阶段 3b 实现完毕待验收时交接）。

---

## 0. 角色与铁律（每次开工前重读一遍）

**分工模型**：你（主 session）只做四件事——**拆任务书、派代理、验收审查、管 git 与合并**。所有实现工作委派给 Sonnet 子代理（`Agent` 工具，`model: 'sonnet'`，`subagent_type: 'general-purpose'`）。你亲自动手只限于：审查中发现的小修（几十行以内）、git 操作、文档更新。

**十条铁律**：

1. **不亲自写实现**。哪怕看起来很快——你的 token 比 Sonnet 贵得多，且用户额度有限。例外：验收中发现的小 bug 直接修（参考事例：阶段 2 我亲手把拖拽从 setPointerCapture 改成 window 级监听，30 行）。
2. **永远不信任子代理的"全绿"自报**。必须亲自重跑五门禁：`npm run build` / `npm run typecheck` / `npm test` / `npm run e2e` / `npm run i18n:check`。真实事例：3a 前一阶段代理自报 E2E 6/6 绿，我重跑发现用例⑤флaky。
3. **E2E 必须连跑 2-3 遍才算稳定**。修 flaky 的两板斧：①时序断言一律改轮询（`page.waitForFunction`），禁止固定 sleep 后断言；②拖拽/指针类交互监听挂 window 捕获阶段，不依赖 setPointerCapture。
4. **关键路径亲自读代码**（用户拍板的验收档位）：状态层数据模型、导出格式（阶段 8 重点）、撤销栈语义、事件拦截。常规 UI 靠 E2E 门禁把关，不逐行读。
5. **视觉是唯一硬约束**：一切视觉值逐值照搬 `preview/pigeonlib.css` + `docs/design/design-system.md` + `preview/parts/*.html`。任务书里写明"不许自创视觉值"。
6. **大阶段必须拆小**。阶段 3 我拆成 3a/3b 各一个代理任务，事实证明单任务 ~10 万-30 万 subagent token。阶段 6（移动模式）和阶段 8+9（导出）建议同样拆分。
7. **中文提交、颗粒化提交**（每个细分功能一个 commit），commit 末尾加 `Co-Authored-By: Claude Opus <noreply@anthropic.com>`。**不要在阶段中途 push**，每阶段合并回 main 后 push 一次。
8. **每阶段合并前**：CHANGELOG.md `[Unreleased]` 加该阶段中文小节（仿既有格式）+ Future 表对应行划线打 ✅。这是 CLAUDE.md 里的硬约定。
9. **重大分叉用 AskUserQuestion**（选择式提问），不要文本长篇问。已拍板的决策（见 §2）**不要再问**。
10. **每阶段合并后，更新本文件末尾的「交接进度追加区」**，一行记录该阶段完成情况与新坑。CLAUDE.md 的「仓库当前阶段」段落在大节点（如阶段 3、阶段 8 完成后）同步更新。

---

## 1. 当前进度快照（交接时刻）

### 已完成并合并 main + 已 push GitHub
- **阶段 1 工程骨架**：Vite 双配置构建、Shadow DOM 四层宿主、pigeonlib 令牌（我逐值 diff 过与画廊一致）、i18n 运行时、logger。
- **阶段 2 工具盘与悬浮球**：controller.ts 模式状态机（24 单测）、42px 悬浮球、7 按钮工具盘、tooltip、长按拖拽持久化、触底再生长、**E2E 测试基建**（tests/e2e/helpers/extension.ts：launchPersistentContext 加载 dist/ 扩展 + node:http 夹具服务）。

### 当前分支 `feat/p3-annotation`（15 个 commit，未合并）
- **阶段 3a 批注核心（已完成、我已验收）**：dom-utils（选择器生成/元素分类）、annotations store（编号递增/删除不重排/清空重置，我亲自审过）、session（sessionStorage，key=`pigeondeck:`+完整URL）、settings 骨架、overlay（hover 高亮/标签/标注框/位号圆/rAF 跟随）、panel（面板/卡片/右键菜单/四向翻转/capture 阶段点击拦截）、toast。E2E 12 用例我复跑 2 遍全绿。
- **阶段 3b 修改栏与高级样式（实现完毕、⚠️ 未验收）**：8 个 commit 已落（历史栈 history.ts 含 10 单测 / StyleChange+mergeChanges+Store.restore / base.css 控件配方 / 自制下拉+智能识别栏 / 调色盘 / fields.ts 双入口注册表 / 高级样式区 4 分类 / 面板接线+高度动画+未保存回滚+卡片调整项）。
- **⚠️ 未提交文件**：`M tests/fixtures/basic.html`、`?? tests/e2e/style-edit.spec.ts`（3b 的 6 个 E2E 用例，**从未跑过**——实现代理在跑门禁前死于额度耗尽）。
- **⚠️ CHANGELOG 未加 3b 小节**，Future 表第 3 行未打钩。

### 新会话立即待办（按此顺序，预计半天）
1. `git status` 确认上述状态；读一遍 `tests/e2e/style-edit.spec.ts` 和 panel.ts 最后一个 commit（b5fbbcf）的 diff——重点审查三处：**FieldsSession 双入口同步**、**未保存关面板回滚预览**、**卡片调整项渲染**。
2. `npm run build` → `npm run e2e` 跑通 style-edit 6 用例（大概率要修：轮询断言、Shadow DOM 选择器穿透、时序）。修到连跑 2 遍全绿（含既有 12 用例）。
3. 跑满五门禁 → 提交未提交文件（中文 message）→ CHANGELOG 加 3b 小节 + Future 表第 3 行打 ✅ → 提交。
4. `git checkout main && git merge --no-ff feat/p3-annotation -m "阶段3：批注模式合并（...）"` → 删分支 → `git push origin main`（若网络失败不阻塞，下次再推）。
5. 更新 CLAUDE.md「仓库当前阶段」→ 开阶段 4。

---

## 2. 用户已拍板的决策（勿再问、勿推翻）

| 决策点 | 结论 |
|--------|------|
| 悬浮球注入 | **默认所有网页显示**（content_scripts `<all_urls>`），Popup 里做全局/站点禁用 |
| 领导介入深度 | **关键路径亲自把关**：架构/状态模型/导出格式/合并前 diff 亲自审，常规 UI 靠测试门禁 |
| 自托管 .crx 分发管线 | **V1 只留 manifest update_url 占位**（已写），真正上架时再搭 |
| Git 推送 | **每阶段合并回 main 后 push 一次** |
| 执行模型 | 实现全部委派 **Sonnet**；机械琐事可用 haiku；主 session 只领导 |
| 测试方式 | 子代理用 Playwright 模拟点击（E2E 基建已就绪）；真实网站手动冒烟最终由用户自己做（阶段 15 给用户出清单即可） |

---

## 3. 既定架构（已实现，勿重新设计）

- **构建**：两份 Vite 配置顺序跑——`vite.content.config.ts`（lib 模式 IIFE → dist/content.js，emptyOutDir:true）+ `vite.background.config.ts`（ES → dist/background.js，emptyOutDir:false, copyPublicDir:false）。`npm run dev` 用 concurrently 双 watch。
- **CSS 进 Shadow DOM**：`design-tokens.css` + `base.css` 以 `?inline` import 成字符串塞 `<style>`。没有独立 css 产物。
- **宿主**：`#pd-host` 挂 documentElement，fixed + inset:0 + pointer-events:none + z-index 2147483647，open shadow root，四层 `[data-layer="control|panel|overlay|feedback"]`，主题 `data-theme` 在 host 上（`setTheme()` 已导出）。
- **i18n**：构建期 import 两份 messages.json，运行时 `t(key)`，语言存 chrome.storage.local（`uiLocale`），默认 `zh_CN`，缺失回退 en。**不用 chrome.i18n 做界面文案**（不支持运行时切换）；manifest 的 name/desc 例外（`__MSG_*__`）。
- **状态层**（`src/state/`）：
  - `annotations.ts`：`Annotation { id, number, selector, elementType, summary, note, changes: StyleChange[], createdAt, viewportPos }`；编号递增/删除不重排/清空重置；`restore()` 供撤销删除用（原编号放回、nextNumber 不回退）；`mergeChanges(prev,next)` 同 prop 合并（保留最初 oldValue+最新 newValue，改回原值剔除）。
  - `session.ts`：sessionStorage（tab 会话天然匹配刷新恢复+关tab清理），载荷 `{version:1, pages:{[pageKey]:{nextNumber,annotations}}}`——**V2 多页扩展点在此**。300ms 防抖。
  - `history.ts`：命令模式 `{label, apply(), revert()}`；**push 时动作已执行（push 不调 apply）**；undo→revert / redo→apply / 新命令清空 redo 栈；默认上限 50，setLimit 立即截断。
  - `settings.ts`：chrome.storage.local，目前只有 hoverLabel/cardDefaultExpanded，阶段 11 扩全。
- **选择器策略**（dom-utils.buildSelector）：id 锚（验证唯一）→ 唯一 class 组合（跳过 css-/jsx- 哈希类）→ tag:nth-of-type 链，深度上限 8，生成后 querySelector 验证唯一。
- **事件拦截**：window **capture 阶段** mousedown/click 监听；`composedPath()` 含宿主 → 自身 UI 放行；批注模式下页面事件 preventDefault+stopPropagation 再开面板（阻断链接跳转）。"点外部关闭"同样基于 composedPath。
- **覆盖层跟随**：window scroll(capture)+resize → rAF 节流；每目标 ResizeObserver + body MutationObserver 兜底；目标消失 → UI 隐藏数据保留。
- **E2E 基建**：`tests/e2e/helpers/extension.ts`（launchPersistentContext + `--load-extension=dist`，夹具走本地 http 随机端口，**不用 file://**）；playwright.config 单 worker；`.playwright-profile/` 已 gitignore。
- **控件体系（3b）**：`fields.ts` 统一注册表 + FieldsSession（双入口单源：修改栏=按元素类型的高频子集，高级样式=全集，同 field 共享值与监听）；自制下拉 `.pd-dd`（≥7 行可见；字体/字重/边框类字段顶部智能识别栏=祖先链 computed 采样去重频次前 5，采不到自隐）；调色盘（收起色块/展开取色器+推荐前 7+RGB+透明度）；数值控件大胶囊套小圆胶囊。高级样式 4 分类（排版/尺寸/外观/调试），**刻意排除 position/top/left/z-index**；调试分类只读 readout 默认英文+翻译图标。
- **样式修改管线**：控件改动 → inline style 即时预览 → `StyleChange{prop, cssProp, oldValue, newValue}` → 保存写入 annotation.changes（mergeChanges 合并）→ push 历史命令；未保存关面板回滚本次会话预览。

---

## 4. 每阶段工作循环（照此执行）

```
1. git checkout -b feat/pN-<slug>（从 main）
2. 写任务书 → Agent(model:'sonnet', run_in_background 视情况)
3. 等完成通知；若断流/超时 → 先 git status + git log 查断点，再 SendMessage 续跑（附断点状态与剩余清单）
4. 验收：亲跑五门禁 + E2E×2；关键路径读 diff；发现小问题自己修，大问题写清单让代理返工
5. CHANGELOG 小节 + Future 表打钩（若代理没做）
6. git checkout main && git merge --no-ff feat/pN-xxx -m "阶段N：xxx合并（要点）" && git branch -d && git push
7. 更新本文件「交接进度追加区」
```

**任务书模板要素**（每份都要有，参考价值极高，别偷懒）：
- 开头：角色 + 工作目录 + 当前分支 + "不要切分支、不要 push" + 已有基础一句话
- 「必读文件」：v1-plan 对应阶段 + 蓝图具体 § 号 + design-system 具体 § 号 + preview/parts 具体文件名 + 相关既有源码
- 「核心规格/架构决策（已定死，照做）」：**把你替它想好的实现方案写死**，尤其是容易踩坑的（这是质量的最大杠杆）
- 「交付物」逐条 + 单测/E2E 用例逐条列出
- 「约束」：视觉照搬/最小实现/kebab-case/中文颗粒提交/禁改 preview\docs\context
- 「验收门禁」五条 + 「最终报告」格式（文件清单/git log/门禁输出/架构决定/偏离遗留）

**故障处置**：
- 子代理断流（API stall / timeout）：SendMessage 续跑，先让它 git status 自查断点。同一代理可多次续（阶段 3b 续了 3 次）。
- 额度 403：停止派代理，把当前状态写进本文件后收工，等额度重置。
- 权限分类器暂不可用（Bash 被拒）：等几分钟重试，期间做只读工作（读规格/审代码）。
- GitHub push 超时：本地网络问题，不阻塞，下阶段合并时一起推。

---

## 5. 剩余阶段作战计划（4 → 15）

> 每阶段先读 v1-plan.md 对应节 + 下面列的蓝图 §。以下「已定决策」是我替你想好的实现方案，写进任务书。

### 阶段 4：直接编辑与内联富文本（1 个代理任务）
- **规格**：蓝图 §4.2（双击）、§5.1（内联富文本浮条）、§5.5（替换图片/视频）；parts 24（inline-edit）、25（replace-media）。
- **已定决策**：
  - 单击/双击区分：单击动作延迟 ~250ms 等待双击窗口（常量可调）。
  - 文本编辑：目标元素临时 contentEditable，进入前快照 innerHTML；blur/点外部提交 → 内容变化记为 `StyleChange{cssProp:'text'}` 进该元素 annotation（无则创建 note 为空的标注）→ push 历史命令（revert=恢复快照）。
  - 富文本浮条：**用 document.execCommand**（已废弃但全浏览器可用，V1 最省事的逐字符方案），`styleWithCSS` 开；双行布局照 part 24；定位在 `getSelection().getRangeAt(0).getBoundingClientRect()` 上方，翻转避让。
  - 图片/视频替换：input[type=file] → FileReader dataURL 或粘贴 URL；旧 src→新 src 记 StyleChange。**坑**：dataURL 超大会撑爆 sessionStorage（~5MB）——超过 ~1MB 的替换只保留在内存、标记刷新不可恢复（toast 提示），任务书写明。
- **E2E**：双击编辑文本→提交→卡片出现内容调整项；选中字符→浮条出现→加粗只影响选区；双击图片→替换入口出现。

### 阶段 5：区域框选（1 个代理任务，小）
- **规格**：蓝图 §4.2 长按、§5.2；part 08。
- **已定决策**：Annotation 加 `kind: 'element' | 'region'` 判别字段 + region 附加字段（docRect/viewportRect/elements: selector[] 上限 30 个可见元素）；编号与元素标注共用（store 已天然支持）。长按 300ms（读 settings，默认值先写死常量位）后拖出金框；**pointerup 后抑制紧随的 click**（标志位），否则会误开批注面板。松手弹一句话说明的小面板。
- **E2E**：长按拖拽出区域→填说明→区域框+位号出现；区域与元素编号连续。

### 阶段 6：移动模式（拆 2 个任务：6a 选中+粒度+句柄缩放；6b 拖拽+吸附+参考线）
- **规格**：蓝图 §4.3 全节（细读）、§3.3 移动按钮行为；parts 03/05/09/10；v1-plan 模块清单 move/snap/selection/visual-units。
- **已定决策**：
  - **移动预览用 transform: translate()**，不改 position/top/left（不破坏布局、易回滚）。记录 initial/final rect + 吸附语义描述。
  - `snap.ts` 做成**纯函数**（输入拖拽矩形+候选矩形集，输出吸附位置+参考线+语义标签如"水平居中对齐/8px 间距"），阈值 4px，重点单测。
  - `visual-units.ts` 智能组件块启发式：从命中元素上爬到最近"组件块"（有边框/背景/阴影/圆角或语义标签，尺寸设上限）；单元素基准=命中节点。
  - 面板底栏 +/- 粒度胶囊（裁决12 #3）：沿 DOM 链多级；**相对偏移记忆**应用到后续选择；仅智能块基准显示。
  - 八向句柄拖拽 → 改 width/height，走 StyleChange 管线（与面板尺寸控件等价、同历史）。
  - Alt+拖=free move（无吸附无参考线，记 freeMove 标志）。参考线虚线白/黑按页面背景自动反色。
  - 同组件多次移动：move 记录只更新 final（保留最初 initial），历史栈保留每步。
- **E2E**：选中出八向句柄；拖拽吸附出参考线；Alt 拖无参考线；句柄缩放进历史。

### 阶段 7：撤销/重做（1 个小任务）
- **规格**：蓝图 §4.4/§4.5。
- **已定决策**：接线撤销重做按钮两半（canUndo/canRedo 订阅刷新禁用态）+ Ctrl+Z / Ctrl+Shift+Z / Esc（**仅展开态**，window capture 键盘监听）；确认阶段 4/5/6 所有操作已 push 命令（3a/3b 已覆盖保存/删除/样式）；清空=复合命令可撤销。历史上限接 settings.setLimit。
- **E2E**：标注→撤销→重做闭环；样式/移动/区域各自可撤销；快捷键收起态不生效。

### 阶段 8：复制文本（⭐ 全项目最关键路径——format.ts 和 copy-text.ts 的 diff 你必须逐行亲自审查）
- **规格**：蓝图 §7.1 **原文照抄进任务书**（输出结构模板）、§6.3/§6.4（合并去重）、§11.2（OpenDesign）；parts 37/39；裁决12 #7/#10。
- **已定决策**：
  - 纯函数管线：store 数据 → 中间操作模型（去重/合并）→ 模板渲染字符串。全部重度单测（这是 vitest 主战场：同元素多操作合并成 `Annotation + Style Modification + Move`、移动只留初始→最终、Changes 表格式 `| prop | old | new |`、Region 的 Scope 列表）。
  - [Global Editing Rules] 固定含：不硬编码 top/left、优先 flex/grid/gap/margin/order、视觉坐标只是定位线索。
  - 导出语言：V1 实际只有 en/zh_CN 模板，选择器展示全量 BCP47 但选了没模板的语言回退 en（此点若用户在意可 AskUserQuestion）。
  - 复制走 navigator.clipboard.writeText（按钮点击手势内，content script 可用）；结果弹窗按 part 37 通用版式（底部靠右下载 .md+复制，左侧语言快切）。
- **E2E**：造标注+样式+移动 → 复制文本 → 剪贴板内容结构断言（Playwright 授剪贴板权限：context.grantPermissions(['clipboard-read','clipboard-write'])）。

### 阶段 9：复制图片（拆 2 个任务：9a 截图拼接管线；9b 叠加绘制+剪贴板/下载）
- **规格**：蓝图 §7.2；part 38。
- **已定决策**：
  - **chrome.tabs.captureVisibleTab 滚动拼接**（不引 html2canvas 类依赖）。content 编排：隐藏自身 UI → 逐屏 scrollTo + 等待 ~350ms 渲染稳定 → 发消息让 background captureVisibleTab → 收集 dataURL → canvas 拼接（devicePixelRatio 缩放对齐）。
  - **限速坑**：captureVisibleTab 每秒最多 2 次，节流 ≥600ms/屏。
  - manifest 阶段 9 加 host_permissions `["<all_urls>"]`（captureVisibleTab 需要）。
  - 标注叠加（编号/连线/区域框/移动预览）**不截自页面**，在拼接后的 canvas 上按文档坐标程序化重绘（更清晰）。
  - 长图范围=标注元素文档坐标的 min/max ± padding；总高钳制 ≤14000px（canvas 尺寸上限防线）。
  - fixed 定位元素会在拼接图中重复出现——V1 已知妥协，CHANGELOG 注明。
  - 剪贴板 ClipboardItem('image/png') / 下载 blob URL 按设置切换；水印（URL/时间）按设置。
- **E2E**：标注两个相距一屏的元素 → 复制图片 → 断言产出图片尺寸覆盖两者（下载模式落文件断言存在与尺寸）。

### 阶段 10：清空确认（小，可与 11 同一代理连做）
- 蓝图 §5.6；part 14。贴工具盘小弹层；确认=复合命令（清 store+编号重置+历史清空但清空本身可撤销——细读 §4.4"覆盖清空"）；点外部/取消关闭。

### 阶段 11：设置面板
- 蓝图 §9 设置清单全表 + §8.2 语言搜索；parts 13/17/18/19/29/39/32。
- settings.ts 扩全表并接线各消费点（长按时长/拖拽阈值/历史上限 setLimit/hover 标签/卡片默认展开/主题 setTheme/快捷键/导出语言/图片方式/水印/重置位置/粒度基准）。语言选择器=搜索过滤（模糊/首字母/ISO）+胶囊选项；导出语言顶部钉「英文/跟随界面」。面板打开暂停页面选择（mode=settings 已互斥）。**原生 select 禁用规则的唯一例外就是这里也不用原生**——语言选择器也是自制浮层。

### 阶段 12：安装说明页（小）
- 蓝图 §13。**决策**：public/ 下静态 onboarding.html+js（不走 vite 入口，文案用 chrome.i18n.getMessage 即可——说明页跟浏览器语言可接受）；background onInstalled → chrome.tabs.create；设置「帮助」分区开同页。

### 阶段 13：Popup 与后台
- 蓝图 §12；part 16。**决策**：popup 也走 public/ 静态 html+js + chrome.i18n；全局/站点禁用存 chrome.storage.local，content main.ts 注入前查禁用态 + onChanged 响应实时启停；右键菜单「用 PigeonDeck 快速标注」→ 消息 → content 展开工具盘；file:// 提示用 chrome.extension.isAllowedFileSchemeAccess；PDF 页面 content script 不会注入（Chrome 内置查看器），Popup 检测 URL .pdf 显示不支持提示。截图消息转发（阶段 9 已建）归位到 service-worker。

### 阶段 14：i18n 完整化（小）
- 全库扫硬编码文案；`_locales/CONTRIBUTING.md`/`AVAILABLE_LANGUAGES.json` 阶段 1 已建，核对即可；i18n:check 全绿。

### 阶段 15：测试收尾
- 夹具补齐（表单/图片网格/嵌套 flex/绝对定位）；全链路 E2E 大场景（标注→编辑→区域→移动→复制文本→复制图片→撤销→清空→刷新恢复→设置）；单测补盲区（选区粒度/吸附/导出）。
- **file:// E2E 坑**：扩展的 file 访问是浏览器 per-extension 设置，Playwright 不能直接开——尝试在 persistent context 的 profile Preferences 预埋；搞不定就降级为「用户手动冒烟项」并在报告里记偏离（别死磕）。
- 产出「真实网站手动冒烟清单」md 给用户（用户自己跑）。

---

## 6. 已知坑清单（真实踩过）

| 坑 | 处置 |
|----|------|
| Playwright 固定 1.60.0 | 本机网络下不去更新的 chromium rev，**别升级**。所有依赖版本都别乱动 |
| Vite CJS deprecation 警告 | 良性，忽略 |
| 子代理 API 断流/超时 | SendMessage 续跑（先查 git 断点）；同一代理可续多次 |
| TaskOutput 阻塞等待超时会把子代理 JSONL 转录灌进你的上下文 | **不要阻塞轮询后台代理**，等 task-notification |
| GitHub push 间歇超时 | 本地网络，不阻塞，攒着下次推 |
| E2E 固定 sleep 断言 | 一律轮询 waitForFunction |
| setPointerCapture 从 setTimeout 调不可靠 | 拖拽监听挂 window 捕获阶段 |
| sessionStorage ~5MB | dataURL 替换资源超限只留内存（阶段 4） |
| captureVisibleTab 限速 2 次/秒 | 节流 ≥600ms（阶段 9） |
| Windows 下 worktree 并行要重复 npm install | 顺序阶段直接在主 checkout 开功能分支；并行才用 worktree（本项目结论：顺序执行，别并行——dist/ 和 .playwright-profile 会打架） |
| 权限分类器偶发不可用（Bash 被拒） | 稍等重试，期间做只读工作 |

---

## 7. 给 Opus 的能力补偿建议（认真读）

你比 Fable 更容易犯的错，以及对策：

1. **想自己上手写代码的冲动**——忍住。你的正确用法是把"想清楚的方案"写进任务书让 Sonnet 执行。任务书写得越具体（参考 §5 每阶段的"已定决策"），产出质量越接近 Fable 亲写。
2. **规格漂移**——每阶段开工前把蓝图对应 § 完整读一遍再写任务书，任务书里引用 § 号让代理也读。凡与 v1-plan/蓝图冲突的"优化想法"，一律放弃或 AskUserQuestion。
3. **验收放水**——五门禁必须亲跑，E2E 必须 ×2。代理说"全绿"时它可能只跑了新用例、可能环境残留、可能根本没跑。
4. **过度设计**——本项目哲学是最小实现（用户 CLAUDE.md 全局约束）。加任何规格外的抽象/配置/依赖都是错。零运行时依赖是现状，保持。
5. **上下文管理**——别读大文件全文除非必要；蓝图/design-system 读过一次后靠 § 号定位；子代理转录永远不读。
6. **迷路时**——回到 `docs/development/v1-plan.md`（当时的实施 SSOT）和本文件。冲突裁决顺序：产品规格 > v1-plan > design-system（视觉）> 本文件（流程）。

---

## 8. 交接进度追加区（每阶段合并后加一行）

- 2026-07-02（Fable）：阶段 1、2 合并已推送；阶段 3a+3b 在 feat/p3-annotation 待验收合并（style-edit.spec.ts 未跑过）。交接给 Opus 4.8。
- 2026-07-03（Opus）：**阶段 3 验收完成并合并 main**（merge 7c4dd92）。style-edit.spec.ts 6 用例首跑即全绿，全量 E2E 18 用例连跑 2 遍稳定；五门禁全过（vitest 143）。CHANGELOG 补 3b 小节 + Future 表第 3 行打钩。审查确认三处关键路径无误：FieldsSession 双入口单源（`subscribe(key)` 共享值+监听）、未保存 `closePanel→session.rollback()`（原本无内联样式的属性回滚为移除）、卡片 `.pd-diff` 调整项渲染。分支已删。**⚠️ push 因本机网络重置失败，main 7c4dd92 仅在本地，待下次网络恢复推送**（`git push origin main`）。下一步：阶段 4。
- 2026-07-03（Opus）：**阶段 4 完成并合并 main**（merge ac47fe1）。拆 4a（双击文本编辑+富文本浮条）+ 4b（图片/视频替换+dataURL 上限）两个 Sonnet 子任务、同一分支 feat/p4-direct-edit、一次合并。复验各揪出真 bug 退回返工：4a **富文本浮条弹层类命令（字体/字号/字色/高亮/对齐）不保选区致 execCommand 对选区无效**（只测了 bold 漏网——验收放水典型），退回加 saveSelection/restoreSelection + 硬断言 E2E（子代理还自查出 styleWithCSS=true 时 fontSize 生成 xxx-large 关键字无法设 px、改用 styleWithCSS=false 修好）。终态五门禁全过：vitest 160、E2E 27 连跑 2 遍稳定。CHANGELOG 补阶段 4 小节 + Future 第 4 行打钩。**⚠️ push 仍网络阻塞，main 累积 13 个未推提交（阶段 3+doc+阶段 4），全部仅在本地**。下一步：阶段 5 区域框选（见 §5 已定决策）。
- 2026-07-03（Opus）：**阶段 5 区域框选完成并合并 main**（merge 1f5227f）。单个 Sonnet 子任务、feat/p5-region。Annotation 加可选 kind/region 向后兼容、编号与元素共用；region-select.ts 长按 300ms+实时金框+框内元素收集≤30+区域面板+撤销历史；overlay 按 kind 分支 docRect−scroll 跟随；panel suppressNextClick 抑制松手误开面板。子代理自报「④ direct-edit 单次抖动系阶段 4 预存 flaky」——我不信（阶段 4 我 27×2 全绿），亲自全量 E2E **连跑 3 遍 30×3 全绿**，确认 ④ 稳定（该用例已充分轮询），子代理那次是它跑测时机器争用的偶发。终态：vitest 164、E2E 30×3。CHANGELOG 补阶段 5 + Future 第 5 行打钩。**✅ 网络恢复，push 成功——阶段 3+4+5+doc 全部已推 origin/main（1f5227f），本地与远端同步。** 下一步：阶段 6 移动模式（§5 建议拆 6a/6b）。
- 2026-07-03（Opus）：**阶段 6 移动模式完成并合并 main**（merge 08c0351）。拆 6a（选中+粒度+句柄缩放）+ 6b（拖拽+吸附+参考线）两个 Sonnet 子任务、同一分支 feat/p6-move、一次合并。6a 复验揪出 **+/- 多级粒度过冲 bug**（每次用已移动过的 panelTarget+累加 offset 复合叠加，深 DOM 越级；单次正确故没 E2E 覆盖漏网）→ 退回改「稳定原始命中 granHitEl + 累加 offset 解析」+ 补 ⑤ 守卫用例（子代理注入 bug 验证会红）。6b 核心 snap.ts 纯函数（边缘/中心对齐 4px、14 单测）+ transform:translate 移动预览（不碰 position/top/left）+ 多次移动合并 initial→final；间距对齐按 §5「余力再加」未做。终态：vitest 195、E2E 38×3。**期间 Bash 安全分类器多次持续宕机，E2E 门禁一度卡住——坚持不在 E2E 未亲跑下合并，等分类器恢复补跑 38×3 才合并。** CHANGELOG 补阶段 6 + Future 第 6 行打钩，**已 push origin/main（08c0351）**。下一步：阶段 7 撤销/重做（§5 已定决策：接线按钮两半 + Ctrl+Z/Ctrl+Shift+Z/Esc 仅展开态 + 确认阶段 3–6 所有操作已 push 命令 + 清空复合命令可撤销 + 历史上限接 settings.setLimit）。
- 2026-07-03（Opus）：**阶段 7 撤销/重做完成并合并 main**（merge 7131c62）。单个 Sonnet 子任务、feat/p7-undo-redo（纯接线小任务）。History 加 subscribe/notify（语义不变，既有 10 单测仍绿 + 补 2 条）；controller.setCallbacks 接 undo/redo；toolbar 药丸左半撤销/右半重做按 canUndo/canRedo 订阅刷新禁用态（main.ts 重排 History 先于 Toolbar 建）；shortcuts.ts 全局键盘 Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z / Esc 仅展开态（内联编辑 Esc 由 direct-edit capture 先消费，无冲突）；settings.historyLimit 默认 50。复验：五门禁全绿、vitest 197、E2E 42×3 我亲跑稳定；shortcuts/subscribe/禁用态关键路径读过无误。CHANGELOG 补阶段 7 + Future 第 7 行打钩，**已 push origin/main（7131c62）**。下一步：**阶段 8 复制文本（⭐全项目最关键路径）**——HANDOFF §5 阶段 8：format.ts/copy-text.ts 纯函数管线（store→中间模型去重合并→模板渲染），重度 vitest（同元素多操作合并成 `Annotation + Style Modification + Move`、移动只留初始→最终、Changes 表 `| prop | old | new |`、Region 的 Scope）；[Global Editing Rules] 固定含不硬编码 top/left；导出语言 en/zh_CN 模板、选没模板的回退 en（此点若用户在意可 AskUserQuestion）；navigator.clipboard.writeText。**主 session 必须逐行亲审 format.ts/copy-text.ts diff。**
- 2026-07-03（Opus）：**阶段 9 复制图片完成并合并 main**（merge b02b546）。拆 9a（截图拼接管线）+ 9b（叠加绘制/剪贴板/下载/水印/imageMethod），同一分支 feat/p9-copy-image，一次合并。9a `capture.ts` 纯函数 computeCaptureRange/planScreens（16 单测）+ captureStitched 编排 + 后台 ≥600ms 限速 + manifest host_permissions；9b `layoutOverlay` 坐标纯函数（4 单测）+ drawOverlays 程序化重绘（编号/框/区域/移动幽灵框+连线，逐值照搬 pigeonlib 金 #b8842c）+ ClipboardItem/blob 下载 + 水印 + settings.imageMethod。我读了 capture.ts 全文（关键路径：坐标换算/拼接 dpr/剪贴板手势）——逻辑正确。**captureVisibleTab 在 Playwright persistent-context 挂起（§15 已知坑）→ copy-image ②③ 软降级 + DEVIATION + 手动冒烟清单**，① 无标注 toast 正常。已知妥协记 CHANGELOG：横向滚动拉伸、fixed 元素重复、**自动剪贴板在异步截图管线后手势失效**（弹窗复制按钮在手势内可靠）。终态五门禁我亲跑：build/typecheck/**vitest 260**/i18n ✓、**E2E 50×2 稳定**。**随本阶段合并的 UI 校准（用户冒烟发现，我直接修）**：① 新 Logo 换描边鸽 stroke=currentColor 继承白；② 工具盘顺序照 part02 修正（撤销/重做错放复制图片后 → 移到紧邻 Logo）；③ 移动模式补 hover 圆角框（MoveManager 自绘 .pd-hover，经 resolver 指向将选中元素，E2E ⑨ 覆盖）；④ 调色盘推荐色不足 7 保持尺寸左对齐（原 flex:1 拉伸）。CHANGELOG 补阶段 9 + UI 校准小节 + Future 第 9 行打钩。**待 push origin/main（b02b546）**。下一步：阶段 10 清空确认（§5：贴工具盘确认弹层、确认=复合命令可撤销、清 store+编号重置+历史清空但清空本身可撤销、点外部/取消关闭；可与阶段 11 同代理连做）。⚠️ `assets/pigeondeck-logo-source.svg` 是用户投递的 Logo 源文件，已内联消费。
- 2026-07-03（Opus）：**阶段 10–15 全部完成并合并 main —— 🎉 V1 全 15 阶段代码闭环完成**。10=2441653 清空确认（可撤销复合命令；子代理弹层被工具盘遮挡的定位缺陷我复验揪出并改 positionBeside 侧边定位）；11=694aa0c 设置面板（拆 11a 骨架+控件+接线 / 11b 搜索式语言选择器，matchLanguages 纯函数 + BCP47 curated 子集；exportLang 加宽 string 我核 format.ts normalizeLang 回退无误）；12 安装说明页（onboarding 静态页 + onInstalled）；13=d96e64c Popup 与后台（popup + disable.ts 注入守卫 reload 实时启停 + 右键菜单；isPageDisabled 纯函数）；14 i18n 完整化（审计确认零硬编码 + 278 键一致，无新增代码）；15=f10f35e 测试收尾（夹具补齐 + full-flow.spec 全链路集成 E2E 剪贴板真断言 + 71 项手动冒烟清单 docs/development/manual-smoke-checklist.md）。终态门禁：vitest 298、**E2E 71（--retries=0 下亲跑 ×2 全绿，非依赖重试）**。**关键复验战果**：① 阶段 11 发现 move ②/⑤ 高负载下 flaky（main 上同样存在的既有时序敏感），亲跑定位后加固（stableHandleCenter 连帧稳定 + 分段拖拽 + ⑤ 轮询断言），非阶段引入；② 阶段 15 子代理加 retries:1 掩盖 flaky，我 --retries=0 复跑 71×2 证实加固已确定性绿，retries:1 仅作负载安全网保留（不掩盖确定性回归）；③ 每阶段亲跑五门禁 + 读关键路径（clear 复合命令 / disable 注入守卫 / format 语言加宽 / background 消息）+ E2E×2。push 中途网络多次中断攒批重试，11–13 已 push（d96e64c），14/15/docs 待网络恢复补推。**V1 后续（非编码）**：用户按 manual-smoke-checklist.md 真机冒烟（复制图片 captureVisibleTab / file:// / Popup 禁用 reload / 右键菜单均 persistent-context 不可自动验）→ 修真机问题 → 定版本号 → 打包上架（Chrome/Edge 商店 + 自托管 .crx）。
- 2026-07-04（Opus）：**7.3.1 用户反馈第一轮修复完成（6 组 9 提交，全在本地 main）**。真机反馈约 50 条，先并行 5 个 Explore 子代理逐条映射到 file:line，再拆 6 组（W1 工具盘/动画/logo/拖拽 1136b9d；W2 面板卡片 cbf74cf + 修改栏/样式/调色盘 76c5eb3；W3 富文本环境 dca664e + 命令 900ab1e；W4 移动 选框/DOM 嵌入/Alt e62ed42；W5 区域/清空/复制 8014053 + 会话恢复重放/撤销重建/变黄 08d70d3；W6 粒度/隐藏修改栏/滚动 46d5cda + 快捷键重绑 ffd88a6），**顺序执行**（base.css/panel.ts/overlay.ts 等被多组共改，并行 worktree 必冲突），每组子代理实现→我亲跑五门禁 + 通读关键路径 diff + E2E ×2 才提交。**用户拍板决策（AskUserQuestion）**：右键=拦截系统菜单；移动吸附=**真实 DOM 重父嵌入**（非仅视觉）；快捷键=完整重绑。**关键复验战果**：① 子代理多次报 vitest「20/21/22 failed no tests」——实为 Windows tinypool worker 偶发崩溃，重跑即 20+ files 全绿（非代码问题，但每次都亲自重跑确认）；② `copy-text②`/`full-flow` 剪贴板**读**断言失败——**亲自 bisect 到 pre-W1（3be6450，上轮报绿的 commit）同样失败**，确认是本机 headed 环境不授予 clipboard read 的环境限制，非任何一组回归（write 路径正常，test① 弹窗正文断言过）；③ W4 真实重父的撤销用**捕获的元素引用**（非选择器，抗重父后 selector 漂移）+ 导出 `Into: 容器` 结构先于坐标；④ W5b 刷新恢复**重放 DOM 副作用 + 重建撤销栈**（原只恢复数据，故移动元素回弹 + 不可撤销）。终态门禁：build/typecheck/**vitest 351**/i18n ✓、**全量 E2E 96 passed ×2（仅上述 2 例已知剪贴板环境失败，确定性）**。**两处未解**（当时无法解读，已请用户澄清并解决）：逻辑区两条纯截图 bullet = 逻辑2（高级样式展开未隐藏普通样式）+ 逻辑9（无阴影不显示「无」）的配图，均已在 W2b 修复；建议6 澄清为「两模式统一：悬浮圆角框→单击出可交互八句柄框，已批注元素同样」→ 追加 **W7（2cf0762）**：抽共享 SelectionBox 组件，批注模式单击在开面板同时出可交互八句柄框（句柄缩放并入标注+撤销），移动模式逐值不变，补齐原 交互3。终态更新：vitest 351 / 全量 E2E **101/101 ×2**。**⚠️ 全部 11 提交（W1–W7 + docs）+ 上轮 14/15/docs 仍在本地 main，待网络恢复 push origin/main（领先约 19 个提交）。** 下一步：真机复冒烟（尤其真实 DOM 重父嵌入、快捷键重绑、刷新恢复、批注模式八句柄缩放）。
- 2026-07-07（Opus）：**7.6.1 用户反馈第二轮修复完成（16 提交，全在本地 main：26c63a1…8970d03）**。真机约 25 条，先并行 3 Explore 子代理映射 file:line + 1 子代理对富文本做**第一性原理对抗式审查**（产出 C1–C2/H1–H3/M/L 缺陷清单 + 结构化重写设计），再拆组实施。**用户拍板（AskUserQuestion）**：图片单击预览=**页内灯箱**；富文本=**彻底重做**（结构化可导出变更）；跨页面/刷新保留=**彻底删除**。**编排策略**：因 base.css/panel.ts/messages.json/capture.ts 被多组共改、且本地领先 origin 20 提交（worktree 默认从 origin 分叉会取到陈旧代码），采取**主 session 顺序委派子代理直接在主工作树实施**（关键路径 F18 取色器 + 删除 F22 先行 → 共享件 esc-stack/dropdown → 工具盘 A → 面板 C → 设置 B → 导出 D1/D2 → 富文本 E → 图标 G），仅图标(仅动 public/icons)与富文本审查(只读)在后台并行。每组子代理实现+自跑门禁+提交，我逐组核结果，末尾整合全跑。**关键点**：① F18 取色器卡死根因为 annotate 全页 capture 拦截吞取点点击（推断，须真机确认；已实现挂起/恢复 + 无 API 隐藏按钮）；② 新建共享 **`esc-stack.ts`** Esc 优先级栈（LIFO，capture 早注册，栈非空拦截、空则回落 shortcuts 模式退出）供 A/B/D 复用，接入 popover 后弹层普遍获 Esc 分层关闭；③ 抽出可复用 **`makeDraggableByHandle`**（panel.ts）供区域/设置/导出顶栏拖动；④ 富文本弃 execCommand 全改标记 span + 结构化 `RichTextChange`（存 `annotation.richText[]`、非 innerHTML blob）+ 提交仅经保存对勾/Ctrl+Enter + 光标态作用整元素 + 精确清理编辑期 chrome 样式（修复对齐被抹），`format.ts` 逐条本地化描述导出；⑤ 图片导出 F10 叠加互不重叠批注卡片（纯函数 `computeCardLayout`/`wrapText` + 画布纳入卡片矩形）。终态整合门禁（主 session 亲跑）：build/typecheck/**vitest 374**/i18n ✓、**全量 E2E 102 passed（仅 `copy-text②`/`full-flow` 剪贴板**读**2 例已知环境失败，同上轮，非回归）**。**⚠️ 全部 16 提交仍在本地 main，叠加上轮共领先 origin 约 36 提交，待网络恢复 push。** **手动冒烟重点**（子代理无法真机验）：取色器不再卡死、hover 不遮工具盘/面板、向下展开拖拽不上抬、导出面板选择流+图片灯箱、富文本各格式在 prompt 精确描述+字号/对齐产生批注框、图片导出批注卡片布局、rect/SVG 出样式入口、刷新后批注清空、新图标。下一步：用户真机复冒烟本轮 25 项 → 修真机问题 → 定版本号 → 打包上架。
- 2026-07-07（Opus）：**7.6.2 用户反馈第三轮修复完成（9 提交，全在本地 main：844d8f7…61ea914）**。第二轮复冒烟发现几处上轮未真正落地 + 一批交互约定要求固化。**关键复验战果**：① **取色器仍卡死**——上轮 F18 判断错向（挂起拦截无用；症状「颜色变了再卡死」证明取点成功、原生遮罩已关一次，推翻「capture 吞取点」假设）；主 session 亲自静态追代码定真因=**挂起期取点的落点点击穿透到 6 个取色按钮之一 → 二次 `EyeDropper.open()` → 原生遮罩重占全屏输入（连浏览器关闭键都点不了）**；加固=模块级再入守卫 + 挂起期禁用取色按钮指针命中 + `open()` try/catch + `notify` 遍历监听器快照（消顽固重入隐患）——**须真机复验（原生取色器不可自动化）**。② **动画上轮没生效**——根因 `animateHeight` 设 `height:auto` 后同步 `positionPanel()` 读 `offsetHeight` 强制回流、起终值并帧、过渡从不触发；主 session 亲改**可靠 rAF FLIP**（显式 px→px + transitionend/280ms 兜底 + 代际标记）。③ **高级样式上轮改错**——回退「调试并入单滚动」，恢复调试计算样式内层滚动+原尺寸，各子分类等高 300px。④ 打印 `@media print` 隐藏宿主；⑤ 重选已标注元素 `Overlay.setSuppressedMark` 隐藏持久框出八句柄框；⑥ 交互不变量 4 条落地（浮层 `bindPopoverToggle` 再点即关、拖面板 `closeAllPopovers`、拖工具盘 `onDragStart` 只关派生面、编辑面 Ctrl+Enter/Esc）。**编排**：延续主 session 顺序委派子代理直接在主工作树（本地领先 origin 太多，worktree 会取陈旧基）；R1/R3+R4/R5/R7+R2 委派子代理，R6 动画诊断 + R8 固化文档主 session 亲做（子代理两次 API 超时，主 session 兜底）。**R8：新增 [交互不变量](../conventions/interaction-invariants.md)（11 条交互不变量）+ INDEX + CLAUDE「改 UI 前必读」指针——回应用户「把常提的 UI 约束固定在一起，别每次让我讲」。** 终态整合门禁（主 session 亲跑）：build/typecheck/**vitest 385**/i18n ✓、**全量 E2E 105 passed（本次 0 失败，剪贴板读环境 flake 未复现）**。**⚠️ 9 提交叠加前两轮共领先 origin 约 45 提交，待 push。取色器卡死修复须真机复验；动画/高级样式等高/打印/灯箱等视觉项须真机眼看。** 下一步：用户真机复冒烟本轮（尤其取色器）→ 修真机问题 → push → 打包上架。
