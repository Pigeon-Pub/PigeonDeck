/**
 * copy-text.spec.ts — 阶段 8b 复制文本 UI E2E
 *
 * ① 造标注 → 点 pd-btn-copy-text → 结果弹窗 pd-output 出现，正文含
 *    [Page Context] + [Operations] + note
 * ② 剪贴板断言（授权时）：navigator.clipboard.readText() 含
 *    [Page Context]/[Global Editing Rules]/[Operations]/note；
 *    授权失败则退化断言弹窗正文文本（见报告说明）
 * ③ 语言快切：点 pd-output-lang → 选 zh_CN → Global Rules 变中文
 *    （「不要硬编码」）；en 含 Do NOT hardcode
 * ④ 造标注 + 样式修改 → 输出含 Changes: 表
 *
 * 时序断言全部用轮询（waitForFunction / expect.poll）。
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
/** 剪贴板权限是否授予成功（否则用弹窗正文退化断言） */
let clipboardGranted = false;

test.beforeAll(async () => {
  server = await startFixtureServer();
  const result = await launchExtensionBrowser();
  context = result.context;
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    clipboardGranted = true;
  } catch {
    clipboardGranted = false;
  }
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

/** 用任意 CSS 选择器点击 Shadow DOM 内元素（先滚入可视区） */
async function clickShadowSel(page: Page, selector: string): Promise<void> {
  const rect = await page.evaluate((sel: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(sel);
    if (!el) return null;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  }, selector);
  if (!rect) throw new Error(`Shadow element not found: ${selector}`);
  await page.mouse.click(rect.x, rect.y);
}

function pageComputed(page: Page, cssSelector: string, prop: string): Promise<string> {
  return page.evaluate(
    ([sel, p]) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(p),
    [cssSelector, prop] as [string, string]
  );
}

/** 创建一条纯批注 */
async function createAnnotation(page: Page, cssSelector: string, note: string): Promise<void> {
  await clickPageEl(page, cssSelector);
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type(note);
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowVisible(page, '[data-testid="pd-pin"]');
}

/** 读弹窗正文文本 */
function readOutputBody(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const body = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-output-body"]');
    return body?.textContent ?? '';
  });
}

/** 读剪贴板文本 */
function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

// ============================================================
// 用例
// ============================================================

test('① 复制文本 → 结果弹窗出现，正文含 Page Context / Operations / note', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', 'make it gold');

  await clickShadowEl(page, 'pd-btn-copy-text');
  await waitShadowVisible(page, '[data-testid="pd-output"]');

  await expect.poll(() => readOutputBody(page)).toContain('[Page Context]');
  await expect.poll(() => readOutputBody(page)).toContain('[Operations]');
  await expect.poll(() => readOutputBody(page)).toContain('make it gold');

  await page.close();
});

test('② 剪贴板含任务清单（授权时），否则退化断言弹窗正文', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', 'clipboard note');

  await clickShadowEl(page, 'pd-btn-copy-text');
  await waitShadowVisible(page, '[data-testid="pd-output"]');

  if (clipboardGranted) {
    await expect.poll(() => readClipboard(page)).toContain('[Page Context]');
    await expect.poll(() => readClipboard(page)).toContain('[Global Editing Rules]');
    await expect.poll(() => readClipboard(page)).toContain('[Operations]');
    await expect.poll(() => readClipboard(page)).toContain('clipboard note');
  } else {
    // 剪贴板未授权：退化断言弹窗正文含同样内容
    await expect.poll(() => readOutputBody(page)).toContain('[Global Editing Rules]');
    await expect.poll(() => readOutputBody(page)).toContain('clipboard note');
  }

  await page.close();
});

test('③ 语言快切：en 含 Do NOT hardcode → 切 zh_CN 含「不要硬编码」', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', 'lang switch note');

  await clickShadowEl(page, 'pd-btn-copy-text');
  await waitShadowVisible(page, '[data-testid="pd-output"]');

  // 默认 en
  await expect.poll(() => readOutputBody(page)).toContain('Do NOT hardcode');

  // 打开语言浮层 → 选简体中文
  await clickShadowEl(page, 'pd-output-lang');
  await waitShadowVisible(page, '[data-testid="pd-output-langdd"]');
  await clickShadowEl(page, 'pd-output-lang-zh_CN');

  await expect.poll(() => readOutputBody(page)).toContain('不要硬编码');
  // note 原文不翻译
  await expect.poll(() => readOutputBody(page)).toContain('lang switch note');

  await page.close();
});

test('④ 样式修改 → 输出含 Changes: 表', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 打开面板 → 调色盘选推荐色改背景 → 保存（产生一条 background-color StyleChange）
  await clickPageEl(page, '#btn-primary');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type('style change note');

  await clickShadowSel(page, '[data-field="bgColor"] .sw');
  await waitShadowVisible(page, '[data-testid="pd-palette"]');
  await waitShadowVisible(page, '[data-testid="pd-palette-sug"] .s');

  const bgBefore = await pageComputed(page, '#btn-primary', 'background-color');
  const picked = await page.evaluate((current: string) => {
    const host = document.getElementById('pd-host');
    const swatches = [
      ...host!.shadowRoot!.querySelectorAll<HTMLElement>('[data-testid="pd-palette-sug"] .s'),
    ];
    const target = swatches.find((s) => getComputedStyle(s).backgroundColor !== current);
    if (!target) return null;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    return true;
  }, bgBefore);
  expect(picked).toBeTruthy();
  await expect.poll(() => pageComputed(page, '#btn-primary', 'background-color')).not.toBe(bgBefore);

  await clickShadowSel(page, '[data-testid="pd-panel-save"]');
  await waitShadowVisible(page, '[data-testid="pd-pin"]');

  // 复制 → 输出含 Changes: 表 + background-color 行
  await clickShadowEl(page, 'pd-btn-copy-text');
  await waitShadowVisible(page, '[data-testid="pd-output"]');
  await expect.poll(() => readOutputBody(page)).toContain('Changes:');
  await expect.poll(() => readOutputBody(page)).toContain('background-color');

  await page.close();
});
