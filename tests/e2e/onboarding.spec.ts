/**
 * onboarding.spec.ts — 阶段 12 安装说明页 E2E
 *
 * ① 直接访问 chrome-extension://<id>/onboarding.html
 *    → 断言标题、功能总览网格渲染出非空文本（chrome.i18n 生效）
 * ② logo img src 指向扩展内 brand/logo.svg
 *
 * 注：onInstalled 首次安装自动打开无法在 Playwright persistent-context 下
 * 可靠断言，列为手动冒烟（见最终报告）。
 */

import { test, expect, BrowserContext } from '@playwright/test';
import { launchExtensionBrowser } from './helpers/extension';

let context: BrowserContext;
let extensionId: string;

test.beforeAll(async () => {
  const result = await launchExtensionBrowser();
  context = result.context;
  extensionId = result.extensionId;
});

test.afterAll(async () => {
  await context.close();
});

test('安装说明页渲染 chrome.i18n 文案', async () => {
  expect(extensionId, 'extensionId should be resolved').toBeTruthy();

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);

  // 标题（chrome.i18n 设置 document.title）
  await expect(page).toHaveTitle(/PigeonDeck/);

  // 快速上手分区标题非空
  const quickstart = page.locator('[data-i18n="onboarding_quickstart_title"]');
  await expect(quickstart).not.toBeEmpty();

  // 功能总览网格：8 个功能项，每项名称非空
  const featNames = page.locator('.feat .name');
  await expect(featNames).toHaveCount(8);
  for (let i = 0; i < 8; i++) {
    await expect(featNames.nth(i)).not.toBeEmpty();
  }

  // 场景段落非空
  await expect(page.locator('.scenario')).not.toBeEmpty();

  await page.close();
});

test('logo 指向扩展内 brand/logo.svg', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/onboarding.html`);

  const src = await page.locator('#brand-logo').getAttribute('src');
  expect(src).toContain('brand/logo.svg');
  expect(src).toContain(`chrome-extension://${extensionId}`);

  await page.close();
});
