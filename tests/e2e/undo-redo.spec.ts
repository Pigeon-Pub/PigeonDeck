/**
 * undo-redo.spec.ts — 阶段 7 撤销/重做 E2E（4 用例）
 *
 * ① 初始 undo/redo 按钮均禁用
 * ② 造标注 → undo 按钮可用 → 点 undo → 位号消失 → redo 可用 → redo → 位号回来
 * ③ 快捷键 Ctrl+Z / Ctrl+Shift+Z 触发撤销/重做
 * ④ 收起态 Ctrl+Z 不生效（位号仍在）
 *
 * 时序断言全部用轮询（waitForFunction / expect.poll），不用固定 sleep 断言。
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
  await context.close();
  await server.close();
});

async function openFixturePage(): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`${server.baseUrl}/basic.html`);
  await waitForExtensionInjected(page);
  await page.evaluate(() => localStorage.removeItem('pigeondeck.pos'));
  await page.reload();
  await waitForExtensionInjected(page);
  return page;
}

/** 展开工具盘（自动进入批注模式） */
async function expandToolbar(page: Page): Promise<void> {
  await clickShadowEl(page, 'pd-ball');
  await page.waitForFunction(() => {
    const host = document.getElementById('pd-host');
    const tb = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-toolbar"]');
    return !!tb && getComputedStyle(tb).display !== 'none';
  });
}

/** 收起工具盘 */
async function collapseToolbar(page: Page): Promise<void> {
  await clickShadowEl(page, 'pd-btn-logo');
  await page.waitForFunction(() => {
    const host = document.getElementById('pd-host');
    const ball = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-ball"]');
    return !!ball && getComputedStyle(ball).display !== 'none';
  });
}

/** 在页面元素中心点击 */
async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** 等待 Shadow DOM 元素出现 */
async function waitShadowVisible(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(sel);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }, selector);
}

/** 等待 Shadow DOM 元素消失（从 DOM 中移除） */
async function waitShadowGone(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel: string) => {
      const host = document.getElementById('pd-host');
      return !host?.shadowRoot?.querySelector(sel);
    },
    selector
  );
}

/** 创建一条标注：单击元素 → 填写 → 保存，返回后位号已出现 */
async function createAnnotation(page: Page, cssSelector: string, note: string): Promise<void> {
  await clickPageEl(page, cssSelector);
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type(note);
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowVisible(page, '[data-testid="pd-pin"]');
}

/** 读取 Shadow DOM 按钮的 disabled 属性 */
function isShadowBtnDisabled(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    const btn = host?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    return btn?.disabled ?? true;
  }, testId);
}

// ============================================================
// 用例
// ============================================================

test('① 初始 undo/redo 按钮均禁用', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-undo')).toBe(true);
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-redo')).toBe(true);

  await page.close();
});

test('② 造标注 → undo → 位号消失 → redo → 位号回来', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', '测试撤销');

  // 造标注后 undo 可用，redo 不可用
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-undo')).toBe(false);
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-redo')).toBe(true);

  // 点 undo → 位号消失
  await clickShadowEl(page, 'pd-btn-undo');
  await waitShadowGone(page, '[data-testid="pd-pin"]');

  // undo 后 redo 可用，undo 不可用（只有一条命令）
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-undo')).toBe(true);
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-redo')).toBe(false);

  // 点 redo → 位号回来
  await clickShadowEl(page, 'pd-btn-redo');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  // redo 后状态恢复
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-undo')).toBe(false);
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-redo')).toBe(true);

  await page.close();
});

test('③ 快捷键 Ctrl+Z / Ctrl+Shift+Z', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-secondary', '快捷键测试');

  // Ctrl+Z → 位号消失
  await page.keyboard.press('Control+z');
  await waitShadowGone(page, '[data-testid="pd-pin"]');

  // Ctrl+Shift+Z → 位号回来
  await page.keyboard.press('Control+Shift+z');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  await page.close();
});

test('④ 收起态 Ctrl+Z 不生效（位号仍在）', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-ghost', '收起态测试');

  // 收起工具盘
  await collapseToolbar(page);

  // Ctrl+Z — 收起态不响应
  await page.keyboard.press('Control+z');

  // 给一点时间让潜在的撤销完成（如果有的话）
  await page.waitForTimeout(200);

  // 位号仍然存在
  const pinStillExists = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector('[data-testid="pd-pin"]');
  });
  expect(pinStillExists).toBe(true);

  await page.close();
});
