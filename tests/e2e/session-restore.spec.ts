/**
 * session-restore.spec.ts — Cluster W5b 刷新恢复 + hover 清除 E2E
 *
 * ① 造标注（普通说明）+ 移动一个元素 → reload → 位号恢复、被移动元素停在移动位置
 *    （不回弹）、撤销按钮可用、Ctrl+Z 撤最新（移动那条）→ 该位号消失且元素归位、
 *    首条位号仍在
 * ② Bug3 显示17：批注模式 hover 出金框 → 派发 document mouseleave → 金框清除
 *
 * 时序断言全部用轮询（waitForFunction / expect.poll）。
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import {
  launchExtensionBrowser,
  startFixtureServer,
  waitForExtensionInjected,
  clickShadowEl,
  isShadowElVisible,
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

async function shadowExists(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector(sel);
  }, selector);
}

function isShadowBtnDisabled(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    const btn = host?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${id}"]`);
    return btn?.disabled ?? true;
  }, testId);
}

async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function createAnnotation(page: Page, cssSelector: string, note: string): Promise<void> {
  await clickPageEl(page, cssSelector);
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type(note);
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowVisible(page, '[data-testid="pd-pin"]');
}

/** 选中 #snap-b（滚入视口，返回视口中心坐标） */
async function selectSnapB(page: Page): Promise<{ cx: number; cy: number }> {
  await page.evaluate(() => {
    const el = document.getElementById('snap-b')!;
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - 160);
  });
  const c = await page.evaluate(() => {
    const el = document.getElementById('snap-b')!;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await page.mouse.click(c.cx, c.cy);
  await page.waitForFunction(
    () => !!document.getElementById('pd-host')?.shadowRoot?.querySelector('[data-testid="pd-selbox"]')
  );
  return c;
}

test('① 刷新恢复：位号+移动 DOM 回放 + 撤销可用 + Ctrl+Z 撤最新', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 第 1 条：普通说明标注（#btn-primary）
  await createAnnotation(page, '#btn-primary', '刷新后要还在');

  // 第 2 条：切到移动模式，向下拖 #snap-b（祖先被排除、下方无容器 → transform 位移）
  await clickShadowEl(page, 'pd-btn-move');
  const c = await selectSnapB(page);
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  await page.mouse.move(c.cx, c.cy + 40, { steps: 12 });
  await page.mouse.up();
  // 移动记入 store → 出现第 2 个位号
  await page.waitForFunction(
    () => !!document.getElementById('pd-host')?.shadowRoot?.querySelector('[data-testid="pd-pin"][data-number="2"]')
  );

  // 等两条标注（含 move）持久化到 sessionStorage
  await page.waitForFunction(() => {
    const raw = sessionStorage.getItem('pigeondeck:' + location.href);
    if (!raw) return false;
    try {
      const payload = JSON.parse(raw) as { pages: Record<string, { annotations: Array<{ move?: unknown }> }> };
      const st = payload.pages[location.href];
      return !!st && st.annotations.length >= 2 && st.annotations.some((a) => a.move);
    } catch {
      return false;
    }
  });

  await page.reload();
  await waitForExtensionInjected(page);

  // 两个位号都恢复
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="2"]');

  // 被移动元素停在移动位置（transform 含 translate，未回弹）
  await expect
    .poll(() => page.evaluate(() => document.getElementById('snap-b')?.style.transform ?? ''))
    .toContain('translate');

  // 恢复后撤销按钮可用（历史已重建）
  await expandToolbar(page);
  await expect.poll(() => isShadowBtnDisabled(page, 'pd-btn-undo')).toBe(false);

  // Ctrl+Z 撤最新（移动那条 #2）→ 位号 #2 消失、元素 transform 归空、位号 #1 仍在
  await page.keyboard.press('Control+z');
  await waitShadowGone(page, '[data-testid="pd-pin"][data-number="2"]');
  await expect
    .poll(() => page.evaluate(() => document.getElementById('snap-b')?.style.transform ?? ''))
    .toBe('');
  expect(await shadowExists(page, '[data-testid="pd-pin"][data-number="1"]')).toBe(true);

  await page.close();
});

test('② Bug3 显示17：指针离开文档 → hover 金框清除', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  const box = (await page.locator('#btn-primary').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await waitShadowVisible(page, '[data-testid="pd-hover"]');

  // 派发 document mouseleave（指针离开视口）→ hover 清除
  await page.evaluate(() => document.dispatchEvent(new MouseEvent('mouseleave')));
  await expect.poll(() => isShadowElVisible(page, 'pd-hover')).toBe(false);

  await page.close();
});
