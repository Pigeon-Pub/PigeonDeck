# 删除布局策略与设置提示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复删除标注在页面、图片导出和清空恢复中的状态缺失，并让用户在设置中选择保留布局或页面重排，同时为全部设置项提供悬浮解释。

**Architecture:** `Annotation.deletion` 保存可跨模块消费的文档坐标与删除策略，`deletionRuntime` 只保存当前 tab 的原 DOM 节点现场并负责应用/恢复。Overlay、Capture 和 ClearManager 只读取这两个明确来源；设置面板沿用现有原生 `title` 机制，不新增 tooltip 组件。

**Tech Stack:** TypeScript 5.5、Chrome MV3、Vitest + jsdom、Playwright、原生 DOM API、Chrome storage。

## Global Constraints

- `deletionLayout` 默认值必须是 `preserve-space`；旧设置自动补默认值。
- 设置切换只影响之后的新删除；已有删除按记录内策略保持不变。
- `preserve-space` 保留原节点布局，但节点不可见、不可点击、不可聚焦。
- `reflow` 脱离原节点并允许页面重排；删除框使用删除前文档坐标。
- 清空恢复原节点；撤销清空重新删除；重做清空再次恢复。
- 图片导出必须包含删除框、位号和本地化删除卡片。
- 所有设置行必须有中英文原生 `title` 解释，不新增 tooltip 浮层。
- 不新增依赖，不修改无关代码，不暂存用户现有的 `.gitignore`、`CLAUDE.md` 或素材改动。
- 用户可见变化写入 `CHANGELOG.md` 的 `[Unreleased]`；提交信息使用中文。

---

### Task 1: 删除策略与标注元数据

**Files:**
- Modify: `src/state/settings.ts`
- Modify: `src/state/settings.test.ts`
- Modify: `src/state/annotations.ts`

**Interfaces:**
- Produces: `DeletionLayout = 'preserve-space' | 'reflow'`
- Produces: `Settings.deletionLayout: DeletionLayout`
- Produces: `Annotation.deletion?: { layout: DeletionLayout; docRect: ViewportPos }`

- [ ] **Step 1: 写默认设置和兼容合并的失败测试**

在 `src/state/settings.test.ts` 增加：

```ts
it('deletionLayout 默认保留原位置', () => {
  expect(DEFAULT_SETTINGS.deletionLayout).toBe('preserve-space');
});

it('旧存储缺少 deletionLayout 时回退默认值', () => {
  const stored: Partial<Settings> = { theme: 'dark' };
  const merged = { ...DEFAULT_SETTINGS, ...stored };
  expect(merged.deletionLayout).toBe('preserve-space');
});
```

- [ ] **Step 2: 运行测试并确认因字段缺失失败**

Run: `npx vitest run src/state/settings.test.ts`

Expected: FAIL，提示 `deletionLayout` 不存在或得到 `undefined`。

- [ ] **Step 3: 添加最小类型和默认值**

在 `src/state/settings.ts` 添加：

```ts
export type DeletionLayout = 'preserve-space' | 'reflow';

// Add this required field to Settings:
deletionLayout: DeletionLayout;

// Add this entry to DEFAULT_SETTINGS:
deletionLayout: 'preserve-space',
```

在 `src/state/annotations.ts` 添加：

```ts
import type { DeletionLayout } from './settings';

export interface DeletionData {
  layout: DeletionLayout;
  docRect: ViewportPos;
}

// Add this field immediately after Annotation.deleted:
deletion?: DeletionData;
```

- [ ] **Step 4: 运行设置测试和类型检查**

Run: `npx vitest run src/state/settings.test.ts`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS；所有现有 `Settings` 构造都通过 `DEFAULT_SETTINGS` 展开获得新字段。

- [ ] **Step 5: 独立提交**

```powershell
git add -- src/state/settings.ts src/state/settings.test.ts src/state/annotations.ts
git commit -m "feat: 增加删除布局策略数据"
```

---

### Task 2: 删除现场运行时与 Delete 历史

**Files:**
- Create: `src/content/deletion-runtime.ts`
- Create: `src/content/deletion-runtime.test.ts`
- Modify: `src/content/selection-box.ts`
- Modify: `src/content/selection-box.test.ts`

**Interfaces:**
- Consumes: `DeletionLayout`、`Annotation.deletion`
- Produces: `deletionRuntime.capture(id: string, element: HTMLElement): void`
- Produces: `deletionRuntime.apply(id: string, layout: DeletionLayout): boolean`
- Produces: `deletionRuntime.restore(id: string): boolean`
- Produces: `deletionRuntime.reset(): void`，仅用于测试隔离和内容脚本销毁场景

- [ ] **Step 1: 写运行时两种策略的失败测试**

新建 `src/content/deletion-runtime.test.ts`，使用真实 DOM：

```ts
// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { deletionRuntime } from './deletion-runtime';

beforeEach(() => {
  deletionRuntime.reset();
  document.body.innerHTML = '<div id="parent"><div id="target" style="opacity:.5"></div><div id="next"></div></div>';
});

it('preserve-space 隐藏并禁用原节点，restore 原样恢复', () => {
  const target = document.querySelector<HTMLElement>('#target')!;
  deletionRuntime.capture('a', target);
  expect(deletionRuntime.apply('a', 'preserve-space')).toBe(true);
  expect(target.isConnected).toBe(true);
  expect(target.style.opacity).toBe('0');
  expect(target.style.pointerEvents).toBe('none');
  expect(target.inert).toBe(true);
  deletionRuntime.restore('a');
  expect(target.style.opacity).toBe('0.5');
  expect(target.style.pointerEvents).toBe('');
  expect(target.inert).toBe(false);
});

it('reflow 脱离节点，restore 插回原后继节点之前', () => {
  const target = document.querySelector<HTMLElement>('#target')!;
  const next = document.querySelector('#next')!;
  deletionRuntime.capture('b', target);
  deletionRuntime.apply('b', 'reflow');
  expect(target.isConnected).toBe(false);
  deletionRuntime.restore('b');
  expect(target.nextElementSibling).toBe(next);
});
```

- [ ] **Step 2: 运行测试并确认模块缺失**

Run: `npx vitest run src/content/deletion-runtime.test.ts`

Expected: FAIL，提示无法解析 `./deletion-runtime`。

- [ ] **Step 3: 实现最小会话注册表**

新建 `src/content/deletion-runtime.ts`，只保存恢复必需状态：

```ts
import type { DeletionLayout } from '../state/settings';

interface Entry {
  element: HTMLElement;
  parent: Node;
  nextSibling: Node | null;
  opacity: string;
  pointerEvents: string;
  inert: boolean;
  ariaHidden: string | null;
}

class DeletionRuntime {
  private entries = new Map<string, Entry>();

  capture(id: string, element: HTMLElement): void {
    const parent = element.parentNode;
    if (!parent) return;
    this.entries.set(id, {
      element,
      parent,
      nextSibling: element.nextSibling,
      opacity: element.style.opacity,
      pointerEvents: element.style.pointerEvents,
      inert: element.inert,
      ariaHidden: element.getAttribute('aria-hidden'),
    });
  }

  apply(id: string, layout: DeletionLayout): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (layout === 'reflow') entry.element.remove();
    else {
      entry.element.style.opacity = '0';
      entry.element.style.pointerEvents = 'none';
      entry.element.inert = true;
      entry.element.setAttribute('aria-hidden', 'true');
    }
    return true;
  }

  restore(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    if (!entry.element.isConnected) {
      if (entry.nextSibling?.parentNode === entry.parent) entry.parent.insertBefore(entry.element, entry.nextSibling);
      else entry.parent.appendChild(entry.element);
    }
    entry.element.style.opacity = entry.opacity;
    entry.element.style.pointerEvents = entry.pointerEvents;
    entry.element.inert = entry.inert;
    if (entry.ariaHidden === null) entry.element.removeAttribute('aria-hidden');
    else entry.element.setAttribute('aria-hidden', entry.ariaHidden);
    return true;
  }

  reset(): void {
    this.entries.clear();
  }
}

export const deletionRuntime = new DeletionRuntime();
```

- [ ] **Step 4: 运行运行时测试并确认通过**

Run: `npx vitest run src/content/deletion-runtime.test.ts`

Expected: PASS。

- [ ] **Step 5: 写 SelectionBox 删除元数据和策略固定的失败测试**

在 `src/content/selection-box.test.ts` 的 setup 中每次调用 `deletionRuntime.reset()`，并增加：

```ts
it('默认策略保留布局，并保存删除前文档坐标', () => {
  const { box, store, target } = setup();
  Object.defineProperty(target, 'getBoundingClientRect', {
    value: () => new DOMRect(10, 20, 100, 40),
  });
  press('Delete');
  expect(target.isConnected).toBe(true);
  expect(target.style.opacity).toBe('0');
  expect(store.getAll()[0].deletion).toEqual({
    layout: 'preserve-space',
    docRect: { x: 10 + window.scrollX, y: 20 + window.scrollY, w: 100, h: 40 },
  });
  box.destroy();
});

it('重排策略脱离节点，修改设置后重做仍沿用原策略', () => {
  const { box, history, store, settings, target } = setup({ deletionLayout: 'reflow' });
  press('Delete');
  expect(target.isConnected).toBe(false);
  expect(store.getAll()[0].deletion?.layout).toBe('reflow');
  history.undo();
  settings.deletionLayout = 'preserve-space';
  history.redo();
  expect(target.isConnected).toBe(false);
  box.destroy();
});
```

- [ ] **Step 6: 运行 SelectionBox 测试并确认按旧行为失败**

Run: `npx vitest run src/content/selection-box.test.ts`

Expected: FAIL；默认删除仍断开节点且 `deletion` 不存在。

- [ ] **Step 7: 用 deletionRuntime 改写删除闭包**

在 `src/content/selection-box.ts`：

```ts
import { deletionRuntime } from './deletion-runtime';

const docRect = {
  x: Math.round(rect.x + window.scrollX),
  y: Math.round(rect.y + window.scrollY),
  w: Math.round(rect.width),
  h: Math.round(rect.height),
};
const layout = this.settings.deletionLayout;
// deletedRecord 同时写入 deleted:true 与 deletion:{ layout, docRect }
deletionRuntime.capture(deletedRecord.id, el);

const remove = (): void => {
  deletionRuntime.apply(deletedRecord.id, deletedRecord.deletion!.layout);
  if (annotation) this.store.remove(annotation.id);
  this.store.restore(deletedRecord);
};
const restore = (): void => {
  deletionRuntime.restore(deletedRecord.id);
  this.store.remove(deletedRecord.id);
  if (annotation) this.store.restore(annotation);
};
```

新记录初次创建时先取得 Store 分配的 ID，再 capture/apply；已有标注复用原 ID。不要读取重做时的当前设置。

- [ ] **Step 8: 运行目标测试**

Run: `npx vitest run src/content/deletion-runtime.test.ts src/content/selection-box.test.ts`

Expected: PASS，且原有 Delete 输入保护与撤销/重做测试继续通过。

- [ ] **Step 9: 独立提交**

```powershell
git add -- src/content/deletion-runtime.ts src/content/deletion-runtime.test.ts src/content/selection-box.ts src/content/selection-box.test.ts
git commit -m "fix: 保留删除现场并支持布局策略"
```

---

### Task 3: 删除占位框与图片导出

**Files:**
- Modify: `src/content/overlay.ts`
- Modify: `src/content/overlay.test.ts`
- Modify: `src/content/i18n.ts`
- Modify: `src/content/capture.ts`
- Modify: `src/content/capture.test.ts`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`

**Interfaces:**
- Consumes: `Annotation.deletion.docRect`
- Produces: `tIn(locale: string, key: string): string`
- Produces for deterministic tests: exported `collectOverlayItems(annotations: Annotation[], locale: string): OverlayItem[]`

- [ ] **Step 1: 写断连删除目标仍可定位的失败测试**

在 `src/content/overlay.test.ts` 添加一条 `deleted:true`、`deletion.docRect:{ x:110,y:220,w:80,h:30 }` 的标注，不创建目标 DOM，并断言：

```ts
expect(overlay.getTargetRect(ann.id)).toEqual(new DOMRect(110 - window.scrollX, 220 - window.scrollY, 80, 30));
expect(layer.querySelector<HTMLElement>('[data-number="1"]')?.style.display).not.toBe('none');
```

测试需用现有 rAF 刷新 helper 推进一次刷新。

- [ ] **Step 2: 运行 Overlay 测试并确认目标断连时失败**

Run: `npx vitest run src/content/overlay.test.ts`

Expected: FAIL；`getTargetRect` 返回 `null`，标注框隐藏。

- [ ] **Step 3: Overlay 使用 deletion.docRect 作为回退**

在 `src/content/overlay.ts` 的 `getTargetRect` 中增加：

```ts
if (entry.target?.isConnected) return entry.target.getBoundingClientRect();
const deletion = entry.annotation.deletion;
if (entry.annotation.deleted && deletion) {
  const r = deletion.docRect;
  return new DOMRect(r.x - window.scrollX, r.y - window.scrollY, r.w, r.h);
}
return null;
```

`refresh()` 在重新解析目标后统一调用 `getTargetRect(entry.annotation.id)`；只有该结果为 `null` 或尺寸为 0 时才隐藏。`getUnresolvedCount()` 不把带删除坐标的记录计为 unresolved。

- [ ] **Step 4: 运行 Overlay 测试并确认通过**

Run: `npx vitest run src/content/overlay.test.ts`

Expected: PASS。

- [ ] **Step 5: 写删除导出项和中英文卡片的失败测试**

先在 `src/content/capture.test.ts` 从 `./capture` 引入 `collectOverlayItems`，增加：

```ts
it('删除记录使用保存的文档坐标并生成删除卡片', () => {
  const store = new AnnotationStore();
  const ann = store.add({
    selector: '#gone', elementType: 'container', summary: 'div', note: '', changes: [],
    viewportPos: { x: 1, y: 2, w: 3, h: 4 }, deleted: true,
    deletion: { layout: 'reflow', docRect: { x: 100, y: 200, w: 80, h: 30 } },
  });
  expect(collectOverlayItems([ann], 'en')[0]).toMatchObject({
    box: { x: 100, y: 200, w: 80, h: 30 },
    card: { typeLabel: 'Delete' },
  });
  expect(collectOverlayItems([ann], 'zh_CN')[0].card?.typeLabel).toBe('删除');
});
```

- [ ] **Step 6: 运行 Capture 测试并确认函数不可用或卡片缺失**

Run: `npx vitest run src/content/capture.test.ts`

Expected: FAIL；`collectOverlayItems` 未导出，或删除记录没有卡片。

- [ ] **Step 7: 添加按指定 locale 翻译和删除卡片**

在 `src/content/i18n.ts` 提取：

```ts
export function tIn(locale: string, key: string): string {
  const messages = LOCALE_MAP[locale];
  if (messages && key in messages) return messages[key].message;
  const fallback = LOCALE_MAP[FALLBACK_LOCALE];
  return fallback && key in fallback ? fallback[key].message : key;
}

export function t(key: string): string {
  return tIn(currentLocale, key);
}
```

在中英文 locale 增加 `card_type_delete`。在 `src/content/capture.ts`：

```ts
// Change the declaration from `interface OverlayItem` to:
export interface OverlayItem {
  number: number;
  kind: 'element' | 'region';
  box: DocRect;
  ghost?: DocRect;
  card?: CardContent;
}

function cardTypeLabel(a: Annotation, locale: string): string {
  if (a.deleted) return tIn(locale, 'card_type_delete');
  if (a.kind === 'region') return tIn(locale, 'region_label');
  const parts: string[] = [];
  if (a.note.trim()) parts.push(tIn(locale, 'card_type_annotation'));
  if (a.changes.length > 0) parts.push(tIn(locale, 'card_type_style'));
  if (a.move) parts.push(tIn(locale, 'card_type_move'));
  return parts.join(' + ');
}

function composeCard(a: Annotation, locale: string): CardContent | undefined {
  const note = a.note.trim();
  const lines = a.kind === 'region' ? [] : composeCardChangeLines(a);
  if (!a.deleted && !note && lines.length === 0) return undefined;
  return { typeLabel: cardTypeLabel(a, locale), note, lines };
}

export function collectOverlayItems(annotations: Annotation[], locale: string): OverlayItem[] {
  // deleted + deletion: use deletion.docRect before any selector lookup
}
```

`CopyImageManager` 调用时把 `settings.exportLang === 'auto' ? getLocale() : settings.exportLang` 传入；不支持的 locale 由 `tIn` 回退英文。

- [ ] **Step 8: 运行 Overlay、Capture 和 i18n 检查**

Run: `npx vitest run src/content/overlay.test.ts src/content/capture.test.ts`

Expected: PASS。

Run: `npm run i18n:check`

Expected: PASS，中英文 key 完全一致。

- [ ] **Step 9: 独立提交**

```powershell
git add -- src/content/overlay.ts src/content/overlay.test.ts src/content/i18n.ts src/content/capture.ts src/content/capture.test.ts public/_locales/en/messages.json public/_locales/zh_CN/messages.json
git commit -m "fix: 在页面和图片中显示删除标注"
```

---

### Task 4: 清空恢复删除内容

**Files:**
- Modify: `src/content/clear.ts`
- Modify: `src/content/clear.test.ts`

**Interfaces:**
- Consumes: `deletionRuntime.restore(id)`、`deletionRuntime.apply(id, layout)`
- Keeps: ClearManager 现有 `doClear` / `restore` History 命令语义

- [ ] **Step 1: 写两种删除清空与历史的失败测试**

在 `src/content/clear.test.ts` 的 Harness 中重置并使用共享 `deletionRuntime`。建立两个真实节点和带 `deletion` 的标注，先 capture/apply，再确认清空：

```ts
it.each(['preserve-space', 'reflow'] as const)('清空恢复 %s 删除，撤销和重做保持语义', (layout) => {
  const h = setup();
  const target = document.createElement('div');
  target.id = `deleted-${layout}`;
  document.body.appendChild(target);
  const ann = h.store.add({
    selector: `#${target.id}`, elementType: 'container', summary: 'div', note: '', changes: [],
    viewportPos: { x: 0, y: 0, w: 100, h: 40 }, deleted: true,
    deletion: { layout, docRect: { x: 0, y: 0, w: 100, h: 40 } },
  });
  deletionRuntime.capture(ann.id, target);
  deletionRuntime.apply(ann.id, layout);

  triggerAndConfirm(h);
  expect(target.isConnected).toBe(true);
  expect(target.style.opacity).not.toBe('0');

  h.history.undo();
  expect(layout === 'reflow' ? target.isConnected : target.style.opacity === '0').toBeTruthy();

  h.history.redo();
  expect(target.isConnected).toBe(true);
  expect(target.style.opacity).not.toBe('0');
});
```

- [ ] **Step 2: 运行 Clear 测试并确认删除节点未恢复**

Run: `npx vitest run src/content/clear.test.ts`

Expected: FAIL；重排节点仍断开，或保留节点仍透明。

- [ ] **Step 3: 在清空命令中恢复和重放删除**

在 `src/content/clear.ts`：

```ts
import { deletionRuntime } from './deletion-runtime';

// Insert as the first branch inside doClear's `for (const ann of anns)` loop:
if (ann.deleted && ann.deletion) {
  deletionRuntime.restore(ann.id);
  continue;
}

// Insert as the first branch inside restore's `for (const ann of anns)` loop:
if (ann.deleted && ann.deletion) {
  deletionRuntime.apply(ann.id, ann.deletion.layout);
  continue;
}
```

删除分支必须位于 selector 查询之前，确保重排节点不依赖 selector 找回。

- [ ] **Step 4: 运行 Clear 与删除目标测试**

Run: `npx vitest run src/content/clear.test.ts src/content/deletion-runtime.test.ts src/content/selection-box.test.ts`

Expected: PASS。

- [ ] **Step 5: 独立提交**

```powershell
git add -- src/content/clear.ts src/content/clear.test.ts
git commit -m "fix: 清空时恢复被删除内容"
```

---

### Task 5: 设置控件、全部悬浮解释与发布说明

**Files:**
- Modify: `src/content/settings-panel.ts`
- Modify: `src/state/shortcuts-def.ts`
- Modify: `public/_locales/en/messages.json`
- Modify: `public/_locales/zh_CN/messages.json`
- Modify: `tests/e2e/settings.spec.ts`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `Settings.deletionLayout`
- Changes: `srow(label, sub, control, tip)` 的 `tip` 为必填字符串
- Changes: `ShortcutDef.descKey` 为必填 i18n key

- [ ] **Step 1: 写设置默认值持久化和悬浮解释的失败 E2E**

在 `tests/e2e/settings.spec.ts` 复用现有 `openSettings` helper：

```ts
async function storedDeletionLayout(): Promise<string> {
  const workers = context.serviceWorkers();
  if (workers.length === 0) return '';
  return workers[0].evaluate(async () => {
    const result = await chrome.storage.local.get('settings');
    const settings = result['settings'] as { deletionLayout?: string } | undefined;
    return settings?.deletionLayout ?? '';
  });
}

test('删除布局默认保留位置，可切换并持久化', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-delete-preserve"]');
  expect(await shadowSwitchOn(page, 'pd-set-delete-preserve')).toBe(true);
  await clickShadowEl(page, 'pd-set-delete-reflow');
  await expect.poll(() => storedDeletionLayout()).toBe('reflow');
  await page.close();
});

test('每个设置行都有悬浮解释', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  for (const section of ['general', 'interaction', 'shortcuts', 'output', 'help']) {
    await clickShadowEl(page, `pd-set-nav-${section}`);
    const missing = await page.evaluate(() => {
      const root = document.querySelector('#pd-host')?.shadowRoot;
      return [...(root?.querySelectorAll('.pd-srow') ?? [])].filter((row) => !row.getAttribute('title')?.trim()).length;
    });
    expect(missing).toBe(0);
  }
  await page.close();
});
```

- [ ] **Step 2: 运行目标 E2E 并确认控件和 title 缺失**

Run: `npx playwright test tests/e2e/settings.spec.ts --grep "删除布局|每个设置行"`

Expected: FAIL；找不到 `pd-set-delete-preserve`，现有 `.pd-srow` 没有 `title`。

- [ ] **Step 3: 新增删除布局分段控件**

在 `renderInteraction()` 添加：

```ts
root.appendChild(this.srow(
  t('set_deletion_layout'),
  null,
  this.segText([
    { value: 'preserve-space', label: t('set_delete_preserve'), title: t('set_delete_preserve_tip'), testid: 'pd-set-delete-preserve' },
    { value: 'reflow', label: t('set_delete_reflow'), title: t('set_delete_reflow_tip'), testid: 'pd-set-delete-reflow' },
  ], this.settings.deletionLayout, (value) => {
    this.settings.deletionLayout = value as DeletionLayout;
    saveSettings({ deletionLayout: this.settings.deletionLayout });
  }),
  t('set_tip_deletion_layout')
));
```

扩展 `segText` 的 option 类型为可选 `title?: string`，并在按钮上设置。

- [ ] **Step 4: 强制全部设置行提供解释**

把工厂改为必填 tip：

```ts
private srow(label: string, sub: string | null, control: HTMLElement, tip: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'pd-srow';
  row.title = tip;
  const key = document.createElement('span');
  key.className = 'k';
  key.textContent = label;
  if (sub) {
    const small = document.createElement('small');
    small.textContent = sub;
    key.appendChild(small);
  }
  row.appendChild(key);
  row.appendChild(control);
  return row;
}
```

所有 `srow(...)` 调用补对应 `set_tip_*`。`shortcutRow` / `modifierRow` 接收 `tip`；`SHORTCUT_DEFS` 每项添加必填 `descKey`，例如：

```ts
{ id: 'delete', defaultCombo: 'Delete', category: 'selection', labelKey: 'set_sc_delete', descKey: 'set_tip_sc_delete', kind: 'combo' }
```

中英文 locale 为通用、交互、快捷键、输出和帮助分区的每个 `.pd-srow` 增加明确解释；重排提示必须写明删除框可能与重排内容重叠。

- [ ] **Step 5: 更新 CHANGELOG**

在 `CHANGELOG.md` 的 `[Unreleased]` 下记录：

```md
- 修复删除标注在图片导出和清空恢复中的缺失，并新增删除后保留布局/页面重排设置。
- 为设置面板全部设置项补充悬浮解释。
```

- [ ] **Step 6: 运行设置 E2E、i18n 和类型检查**

Run: `npx playwright test tests/e2e/settings.spec.ts --grep "删除布局|每个设置行"`

Expected: PASS。

Run: `npm run i18n:check`

Expected: PASS。

Run: `npm run typecheck`

Expected: PASS；必填 `srow` tip 和 `descKey` 保证没有遗漏设置行。

- [ ] **Step 7: 独立提交**

```powershell
git add -- src/content/settings-panel.ts src/state/shortcuts-def.ts public/_locales/en/messages.json public/_locales/zh_CN/messages.json tests/e2e/settings.spec.ts CHANGELOG.md
git commit -m "feat: 增加删除布局设置与悬浮说明"
```

---

### Task 6: 全量验证

**Files:**
- No production changes expected
- Modify only a directly failing affected test or implementation file when evidence identifies a regression

**Interfaces:**
- Verifies all preceding tasks together

- [ ] **Step 1: 运行受影响单测**

Run: `npx vitest run src/state/settings.test.ts src/content/deletion-runtime.test.ts src/content/selection-box.test.ts src/content/overlay.test.ts src/content/capture.test.ts src/content/clear.test.ts`

Expected: PASS。

- [ ] **Step 2: 运行仓库门禁**

Run: `npm run typecheck`

Expected: PASS。

Run: `npm test`

Expected: PASS，输出无失败测试。

Run: `npm run i18n:check`

Expected: PASS。

- [ ] **Step 3: 运行受影响 E2E**

Run: `npx playwright test tests/e2e/settings.spec.ts tests/e2e/full-flow.spec.ts`

Expected: PASS；设置持久化、删除、清空和完整主流程无回归。

- [ ] **Step 4: 检查工作区和提交范围**

Run: `git status --short`

Expected: 仅显示用户原有未提交改动和未跟踪素材；本功能文件均已在前述独立提交中提交，不包含构建产物。
