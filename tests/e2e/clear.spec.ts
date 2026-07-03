/**
 * clear.spec.ts — 阶段 10 清空确认 E2E（4 用例）
 *
 * ① 造 2 条标注 → 点清空 → 确认弹层出现 → 点确认清空 → 位号全消失
 * ② 造标注 → 清空 → Ctrl+Z（撤销）→ 位号回来
 * ③ 造标注 → 点清空开弹层 → 点页面外部 → 弹层消失、位号仍在
 * ④ 清空后新造标注 → 编号重置为 #1
 *
 * 时序断言全部轮询（waitForFunction / expect.poll），不用固定 sleep 断言。
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
  // 把工具盘挪离右下角：确认弹层（212px）锚在清空按钮，向右展开时不被视口右缘
  // 夹回、其右侧「确认」按钮不会压到更高 z 层的工具盘列（否则点击会落到工具盘）。
  await page.evaluate(() =>
    localStorage.setItem('pigeondeck.pos', JSON.stringify({ right: 500, bottom: 260 }))
  );
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

async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
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

/** 造一条标注：单击元素 → 填写 → 保存，返回后位号已出现 */
async function createAnnotation(page: Page, cssSelector: string, note: string): Promise<void> {
  await clickPageEl(page, cssSelector);
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type(note);
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowVisible(page, '[data-testid="pd-pin"]');
}

// ============================================================
// 用例
// ============================================================

test('① 确认清空 → 位号全消失', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', '标注一');
  await createAnnotation(page, '#btn-secondary', '标注二');

  // 点清空 → 确认弹层出现
  await clickShadowEl(page, 'pd-btn-clear');
  await waitShadowVisible(page, '[data-testid="pd-clear-confirm"]');

  // 点确认清空 → 位号全消失
  await clickShadowEl(page, 'pd-clear-ok');
  await waitShadowGone(page, '[data-testid="pd-pin"]');

  await page.close();
});

test('② 清空后 Ctrl+Z → 位号回来', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', '待恢复');

  await clickShadowEl(page, 'pd-btn-clear');
  await waitShadowVisible(page, '[data-testid="pd-clear-confirm"]');
  await clickShadowEl(page, 'pd-clear-ok');
  await waitShadowGone(page, '[data-testid="pd-pin"]');

  // Ctrl+Z 撤销清空 → 位号回来
  await page.keyboard.press('Control+z');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  await page.close();
});

test('③ 点外部取消 → 弹层消失、位号仍在', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', '保留标注');

  await clickShadowEl(page, 'pd-btn-clear');
  await waitShadowVisible(page, '[data-testid="pd-clear-confirm"]');

  // 点页面左上角外部 → 弹层关闭，不清空
  await page.mouse.click(10, 10);
  await expect
    .poll(() => shadowExists(page, '[data-testid="pd-clear-confirm"]'), {
      timeout: 5000,
      message: 'confirm popover should close on outside click',
    })
    .toBe(false);

  // 位号仍在
  expect(await shadowExists(page, '[data-testid="pd-pin"]')).toBe(true);

  await page.close();
});

test('④ 清空后新造标注 → 编号重置为 #1', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', '第一批一');
  await createAnnotation(page, '#btn-secondary', '第一批二');

  // 清空
  await clickShadowEl(page, 'pd-btn-clear');
  await waitShadowVisible(page, '[data-testid="pd-clear-confirm"]');
  await clickShadowEl(page, 'pd-clear-ok');
  await waitShadowGone(page, '[data-testid="pd-pin"]');

  // 新造标注 → 编号从 1 重置
  await createAnnotation(page, '#btn-ghost', '清空后新标注');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  const pinText = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const pin = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-pin"][data-number="1"]');
    return pin?.textContent ?? '';
  });
  expect(pinText.trim()).toBe('1');

  await page.close();
});
