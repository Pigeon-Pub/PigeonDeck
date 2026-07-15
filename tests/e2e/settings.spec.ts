/**
 * settings.spec.ts — 阶段 11a 设置面板 E2E（6 用例）
 *
 * ① 点设置按钮 → pd-settings 面板出现
 * ② 切 4 个导航分区 → 各分区内容切换
 * ③ 切主题暗色 → host data-theme='dark'
 * ④ 关 hover 标签开关 → 关闭并重开面板仍为关（共享 settings 引用持久）
 * ⑤ 历史上限 +步进 → 数值更新且重开面板仍保留
 * ⑥ 关闭按钮 / Esc / 点外部 → 面板消失
 *
 * 时序断言全部轮询，不用固定 sleep 断言。
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import {
  launchExtensionBrowser,
  startFixtureServer,
  waitForExtensionInjected,
  clickShadowEl,
  TestServer,
} from './helpers/extension';

let context: BrowserContext;
let server: TestServer;

test.beforeAll(async () => {
  server = await startFixtureServer();
  const result = await launchExtensionBrowser();
  context = result.context;
});

test.afterAll(async () => {
  await resetStorage();
  await context.close();
  await server.close();
});

/** 通过后台 service worker 清空 chrome.storage.local，避免设置持久化泄漏到其它测试 */
async function resetStorage(): Promise<void> {
  const workers = context.serviceWorkers();
  if (workers.length > 0) {
    await workers[0].evaluate(() => chrome.storage.local.clear());
  }
}

// 每个用例前重置存储，从默认设置起步（设置写入 chrome.storage.local 会持久化到共享 profile）
test.beforeEach(async () => {
  await resetStorage();
});

async function openFixturePage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${server.baseUrl}/basic.html`);
  await waitForExtensionInjected(page);
  // 默认右下角位置：设置面板贴设置按钮「侧边」弹出，完整可见
  await page.evaluate(() => localStorage.removeItem('pigeondeck.pos'));
  await page.reload();
  await waitForExtensionInjected(page);
  return page;
}

async function expandToolbar(page: Page): Promise<void> {
  await clickShadowEl(page, 'pd-ball');
  await page.waitForFunction(() => {
    const host = document.getElementById('pd-host');
    const tb = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-toolbar"]');
    return !!tb && getComputedStyle(tb).display !== 'none';
  });
}

async function waitShadowVisible(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(sel);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }, selector);
}

async function waitShadowGone(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel: string) => {
    const host = document.getElementById('pd-host');
    return !host?.shadowRoot?.querySelector(sel);
  }, selector);
}

function shadowExists(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector(sel);
  }, selector);
}

/** 点击 Shadow DOM 内嵌套元素（css selector 相对 shadowRoot） */
async function clickShadowSelector(page: Page, cssSelector: string): Promise<void> {
  const rect = await page.evaluate((sel: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, cssSelector);
  if (!rect) throw new Error(`Shadow selector not found: ${cssSelector}`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

function shadowSwitchOn(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return !!el && el.classList.contains('on');
  }, testId);
}

function shadowNumValue(page: Page, testId: string): Promise<string> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    const input = host?.shadowRoot?.querySelector<HTMLInputElement>(`[data-testid="${id}"] input`);
    return input?.value ?? '';
  }, testId);
}

function hostTheme(page: Page): Promise<string> {
  return page.evaluate(() => document.getElementById('pd-host')?.getAttribute('data-theme') ?? '');
}

/** 读取 Shadow DOM 内元素文本 */
function shadowText(page: Page, testId: string): Promise<string> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    return el?.textContent ?? '';
  }, testId);
}

/** 经后台 service worker 读取 chrome.storage.local 里持久化的快捷键绑定 */
async function storedShortcuts(): Promise<Record<string, string>> {
  const workers = context.serviceWorkers();
  if (workers.length === 0) return {};
  return workers[0].evaluate(async () => {
    const r = await chrome.storage.local.get('settings');
    const s = r['settings'] as { shortcuts?: Record<string, string> } | undefined;
    return s?.shortcuts ?? {};
  });
}

async function storedDeletionLayout(): Promise<string> {
  const workers = context.serviceWorkers();
  if (workers.length === 0) return '';
  return workers[0].evaluate(async () => {
    const result = await chrome.storage.local.get('settings');
    const settings = result['settings'] as { deletionLayout?: string } | undefined;
    return settings?.deletionLayout ?? '';
  });
}

/** 展开工具盘 + 打开设置面板 */
async function openSettings(page: Page): Promise<void> {
  await clickShadowEl(page, 'pd-btn-settings');
  await waitShadowVisible(page, '[data-testid="pd-settings"]');
}

// ============================================================
// 用例
// ============================================================

test('① 点设置按钮 → 面板出现', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  expect(await shadowExists(page, '[data-testid="pd-settings"]')).toBe(true);
  await page.close();
});

test('② 切 4 个导航分区 → 内容切换', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);

  // 默认通用分区
  await waitShadowVisible(page, '[data-testid="pd-set-ui-lang"]');

  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-longpress"]');

  await clickShadowEl(page, 'pd-set-nav-shortcuts');
  await waitShadowVisible(page, '[data-testid="pd-sc-record-undo"]');

  await clickShadowEl(page, 'pd-set-nav-output');
  await waitShadowVisible(page, '[data-testid="pd-set-imgmethod-clipboard"]');

  await clickShadowEl(page, 'pd-set-nav-help');
  await waitShadowVisible(page, '[data-testid="pd-set-onboarding"]');

  await clickShadowEl(page, 'pd-set-nav-general');
  await waitShadowVisible(page, '[data-testid="pd-set-theme-dark"]');

  await page.close();
});

test('③ 切主题暗色 → host data-theme=dark', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);

  expect(await hostTheme(page)).toBe('light');
  await clickShadowEl(page, 'pd-set-theme-dark');
  await expect.poll(() => hostTheme(page), { timeout: 5000 }).toBe('dark');

  // 切回亮色
  await clickShadowEl(page, 'pd-set-theme-light');
  await expect.poll(() => hostTheme(page), { timeout: 5000 }).toBe('light');

  await page.close();
});

test('④ 关 hover 标签 → 重开面板仍关', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-hover"]');

  // 默认开启
  expect(await shadowSwitchOn(page, 'pd-set-hover')).toBe(true);
  await clickShadowEl(page, 'pd-set-hover');
  await expect.poll(() => shadowSwitchOn(page, 'pd-set-hover'), { timeout: 5000 }).toBe(false);

  // 关闭面板再重开（共享 settings 对象引用 → 仍为关）
  await clickShadowEl(page, 'pd-settings-close');
  await waitShadowGone(page, '[data-testid="pd-settings"]');
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-hover"]');
  expect(await shadowSwitchOn(page, 'pd-set-hover')).toBe(false);

  await page.close();
});

test('⑤ 历史上限步进 → 数值更新且重开保留', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-history"]');

  expect(await shadowNumValue(page, 'pd-set-history')).toBe('50');
  // 点 + 步进（步长 10）
  await clickShadowSelector(page, '[data-testid="pd-set-history"] .step button:first-child');
  await expect.poll(() => shadowNumValue(page, 'pd-set-history'), { timeout: 5000 }).toBe('60');

  // 关闭再重开 → 仍为 60
  await clickShadowEl(page, 'pd-settings-close');
  await waitShadowGone(page, '[data-testid="pd-settings"]');
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-history"]');
  expect(await shadowNumValue(page, 'pd-set-history')).toBe('60');

  await page.close();
});

test('删除布局默认保留位置，可切换并持久化', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-delete-preserve"]');

  expect(await shadowSwitchOn(page, 'pd-set-delete-preserve')).toBe(true);
  await clickShadowEl(page, 'pd-set-delete-reflow');
  await expect.poll(() => storedDeletionLayout(), { timeout: 5000 }).toBe('reflow');

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
      return [...(root?.querySelectorAll('.pd-srow') ?? [])].filter(
        (row) => !row.getAttribute('title')?.trim()
      ).length;
    });
    expect(missing).toBe(0);
  }

  await page.close();
});

test('⑥ 关闭按钮 / Esc / 外部点击 → 面板消失', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 关闭按钮
  await openSettings(page);
  await clickShadowEl(page, 'pd-settings-close');
  await waitShadowGone(page, '[data-testid="pd-settings"]');

  // Esc
  await openSettings(page);
  await page.keyboard.press('Escape');
  await waitShadowGone(page, '[data-testid="pd-settings"]');

  // 点页面外部（左上角）
  await openSettings(page);
  await page.mouse.click(10, 10);
  await expect
    .poll(() => shadowExists(page, '[data-testid="pd-settings"]'), { timeout: 5000 })
    .toBe(false);

  await page.close();
});

// ============================================================
// 阶段 11b：搜索式语言选择器
// ============================================================

test('⑦ 点界面语言 → 语言选择器浮层出现', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await waitShadowVisible(page, '[data-testid="pd-set-ui-lang"]');

  await clickShadowEl(page, 'pd-set-ui-lang');
  await waitShadowVisible(page, '[data-testid="pd-lang-picker"]');
  expect(await shadowExists(page, '[data-testid="pd-lang-search"]')).toBe(true);

  await page.close();
});

test('⑧ 界面语言搜索「中」→ 筛出中文项、English 被过滤', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-ui-lang');
  await waitShadowVisible(page, '[data-testid="pd-lang-picker"]');

  await clickShadowEl(page, 'pd-lang-search');
  await page.keyboard.type('中');

  await waitShadowVisible(page, '[data-testid="pd-lang-opt-zh_CN"]');
  await expect
    .poll(() => shadowExists(page, '[data-testid="pd-lang-opt-en"]'), { timeout: 5000 })
    .toBe(false);

  await page.close();
});

test('⑨ 选 English → 面板标题变英文（默认中文起步）', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-ui-lang');
  await waitShadowVisible(page, '[data-testid="pd-lang-opt-en"]');

  await clickShadowEl(page, 'pd-lang-opt-en');

  // 面板重建后标题为英文 Settings（默认界面语言 zh_CN → 设置）
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const host = document.getElementById('pd-host');
          const el = host?.shadowRoot?.querySelector<HTMLElement>(
            '[data-testid="pd-settings"] .shead .t'
          );
          return el?.textContent ?? '';
        }),
      { timeout: 5000 }
    )
    .toBe('Settings');

  await page.close();
});

test('⑩ 点导出语言 → 紧凑 2 项下拉（英文 / 跟随界面），不含全量语言', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-output');
  await waitShadowVisible(page, '[data-testid="pd-set-export-lang"]');

  await clickShadowEl(page, 'pd-set-export-lang');
  await waitShadowVisible(page, '[data-testid="pd-dropdown"]');
  expect(await shadowExists(page, '[data-testid="pd-dd-item"][data-value="en"]')).toBe(true);
  expect(await shadowExists(page, '[data-testid="pd-dd-item"][data-value="auto"]')).toBe(true);
  // 紧凑 2 项菜单不含中文/全量语言项
  expect(await shadowExists(page, '[data-testid="pd-dd-item"][data-value="zh_CN"]')).toBe(false);

  await page.close();
});

// ============================================================
// W6a：默认粒度 element + 隐藏修改栏开关
// ============================================================

test('⑪ 默认选择粒度控件反映 element（逻辑12）', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);

  // 通用分区默认显示；element 为首选项且处选中态，smart 为次选未选中
  await waitShadowVisible(page, '[data-testid="pd-set-gran-element"]');
  expect(await shadowSwitchOn(page, 'pd-set-gran-element')).toBe(true);
  expect(await shadowSwitchOn(page, 'pd-set-gran-smart')).toBe(false);

  await page.close();
});

test('⑫ 关「显示修改栏」→ 批注面板无修改栏、仅留说明（建议7）', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-interaction');
  await waitShadowVisible(page, '[data-testid="pd-set-show-modbar"]');

  // 默认开启 → 关闭
  expect(await shadowSwitchOn(page, 'pd-set-show-modbar')).toBe(true);
  await clickShadowEl(page, 'pd-set-show-modbar');
  await expect.poll(() => shadowSwitchOn(page, 'pd-set-show-modbar'), { timeout: 5000 }).toBe(false);

  // 关设置回批注模式
  await clickShadowEl(page, 'pd-settings-close');
  await waitShadowGone(page, '[data-testid="pd-settings"]');

  // 单击页面按钮开批注面板（button 类型即时打开，不走延迟）
  const btnRect = await page.evaluate(() => {
    const el = document.getElementById('btn-primary')!;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(btnRect.x, btnRect.y);
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  // 修改栏卡片缺席，说明文本框仍在
  expect(await shadowExists(page, '[data-testid="pd-modbox"]')).toBe(false);
  expect(await shadowExists(page, '[data-testid="pd-panel-note"]')).toBe(true);

  await page.close();
});

// ============================================================
// W6b：快捷键全量重绑（录制 / 冲突 / 恢复默认）
// ============================================================

/** 打开设置 → 快捷键分区 → 等快捷键录制按钮就绪 */
async function openShortcuts(page: Page): Promise<void> {
  await openSettings(page);
  await clickShadowEl(page, 'pd-set-nav-shortcuts');
  await waitShadowVisible(page, '[data-testid="pd-sc-record-undo"]');
}

/** 快捷键分区可滚动（固定高度），底部行需先滚入视口再按坐标点击 */
async function clickShadowDeep(page: Page, testId: string): Promise<void> {
  await page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    el?.scrollIntoView({ block: 'center' });
  }, testId);
  await clickShadowEl(page, testId);
}

test('⑬ 录制新撤销绑定 → 持久化到 storage + 行内展示更新', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openShortcuts(page);

  // 默认展示含 Z
  expect(await shadowText(page, 'pd-sc-combo-undo')).toContain('Z');

  await clickShadowDeep(page, 'pd-sc-record-undo');
  await page.keyboard.press('Control+y'); // → Mod+Y

  await expect.poll(() => storedShortcuts(), { timeout: 5000 }).toMatchObject({ undo: 'Mod+Y' });
  // 行内组合展示随之更新
  await expect.poll(() => shadowText(page, 'pd-sc-combo-undo'), { timeout: 5000 }).toContain('Y');

  await page.close();
});

test('⑭ 冲突绑定被拒绝 → 不覆盖已有绑定 + 提示', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openShortcuts(page);

  // 先把撤销改成 Mod+Y（并落盘完整 settings，含默认 redo=Mod+Shift+Z）
  await clickShadowDeep(page, 'pd-sc-record-undo');
  await page.keyboard.press('Control+y');
  await expect.poll(() => storedShortcuts(), { timeout: 5000 }).toMatchObject({ undo: 'Mod+Y' });

  // 录制重做，按下 Mod+Y（= 撤销现有绑定）→ 冲突
  await clickShadowDeep(page, 'pd-sc-record-redo');
  await page.keyboard.press('Control+y');

  // 冲突提示出现
  await waitShadowVisible(page, '[data-testid="pd-toast"]');
  // 重做绑定未被改写（仍为默认 Mod+Shift+Z）
  await expect.poll(() => storedShortcuts(), { timeout: 5000 }).toMatchObject({ redo: 'Mod+Shift+Z' });
  expect(await shadowText(page, 'pd-sc-combo-redo')).toContain('Shift');

  await page.close();
});

test('⑮ 恢复默认 → 绑定回落 Mod+Z / Mod+Shift+Z / Escape', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openShortcuts(page);

  // 改一个绑定
  await clickShadowDeep(page, 'pd-sc-record-undo');
  await page.keyboard.press('Control+y');
  await expect.poll(() => storedShortcuts(), { timeout: 5000 }).toMatchObject({ undo: 'Mod+Y' });

  // 恢复默认
  await clickShadowDeep(page, 'pd-sc-reset');
  await expect
    .poll(() => storedShortcuts(), { timeout: 5000 })
    .toMatchObject({ undo: 'Mod+Z', redo: 'Mod+Shift+Z', exit: 'Escape' });
  await expect.poll(() => shadowText(page, 'pd-sc-combo-undo'), { timeout: 5000 }).toContain('Z');

  await page.close();
});

test('⑯ 录制删除元素绑定 → 持久化到 storage', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openShortcuts(page);

  await clickShadowDeep(page, 'pd-sc-record-delete');
  await page.keyboard.press('Backspace'); // → Backspace

  await expect.poll(() => storedShortcuts(), { timeout: 5000 }).toMatchObject({ delete: 'Backspace' });

  await page.close();
});

test('⑰ 保存绑定要求修饰键 → 裸 Enter 被拒、绑定不变', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openShortcuts(page);

  await clickShadowDeep(page, 'pd-sc-record-save');
  await page.keyboard.press('Enter'); // 无修饰键 → 护栏拒绝

  // 护栏提示出现
  await waitShadowVisible(page, '[data-testid="pd-toast"]');
  // save 绑定仍为默认 Mod+Enter（行内展示 = Ctrl/⌘ + Enter，未被裸 Enter 改写）
  const saveCombo = await shadowText(page, 'pd-sc-combo-save');
  expect(saveCombo).toContain('Enter');
  expect(saveCombo).toContain('Ctrl');

  await page.close();
});

test('⑱ 自由移动修饰键选择器 → 切换写入 storage', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await openShortcuts(page);

  await clickShadowDeep(page, 'pd-sc-mod-moveFree-Shift');
  await expect.poll(() => storedShortcuts(), { timeout: 5000 }).toMatchObject({ moveFree: 'Shift' });

  await page.close();
});
