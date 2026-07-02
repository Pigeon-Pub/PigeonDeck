/**
 * direct-edit.spec.ts - 阶段 4a 直接编辑 + 富文本浮条 E2E（5 用例）
 *
 * ① 双击 #card-text p → 元素进入可编辑态（data-pd-editing 出现），浮条初始不显
 * ② 编辑元素内选中字符 → [data-testid="pd-rtbar"] 出现在选区上方
 * ③ 点 pd-rt-bold → 仅选区字符加粗（选区外文字 font-weight 不变）
 * ④ 点编辑区外空白 → 编辑结束、内容变化被提交（位号出现 / 卡片出现内容调整项行）
 * ⑤ 单击（非双击）#btn-primary 仍正常弹面板（验证单击延迟没破坏既有单击开面板）
 *
 * 时序断言全部用轮询（waitForFunction / expect.poll），禁止固定 sleep 后断言。
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

/** 等待 Shadow DOM 内选择器出现且可见 */
async function waitShadowVisible(page: Page, selector: string): Promise<void> {
  await page.waitForFunction((sel: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(sel);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }, selector);
}

/** 用任意 CSS 选择器点击 Shadow DOM 内元素（先滚入面板可视区） */
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

/** 在页面元素中心执行鼠标双击 */
async function dblClickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

/** 在页面元素中心执行鼠标单击 */
async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// ============================================================
// 用例
// ============================================================

test('① 双击 #card-text p → 元素进入可编辑态，浮条初始不显', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await dblClickPageEl(page, '#card-text p');

  // 等待 data-pd-editing 属性出现（元素进入编辑态）
  await page.waitForFunction(() => {
    const el = document.querySelector('#card-text p');
    return el instanceof HTMLElement &&
      (el.contentEditable === 'true' || 'pdEditing' in el.dataset);
  });

  // 浮条初始不显（还没有选区）
  const rtbarVisible = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const bar = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-rtbar"]');
    if (!bar) return false;
    return getComputedStyle(bar).display !== 'none';
  });
  expect(rtbarVisible).toBe(false);

  await page.close();
});

test('② 编辑元素内选中字符 → pd-rtbar 出现', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await dblClickPageEl(page, '#card-text p');

  // 等待编辑态
  await page.waitForFunction(() => {
    const el = document.querySelector('#card-text p');
    return el instanceof HTMLElement && el.contentEditable === 'true';
  });

  // 选中段落内的一段文字（用 Range API 模拟选区）
  await page.evaluate(() => {
    const el = document.querySelector('#card-text p');
    if (!el || !el.firstChild) return;
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.setEnd(el.firstChild, Math.min(8, el.firstChild.textContent?.length ?? 0));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // 触发 selectionchange
    document.dispatchEvent(new Event('selectionchange'));
  });

  // 等待浮条出现
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      const bar = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-rtbar"]');
      if (!bar) return false;
      return getComputedStyle(bar).display !== 'none';
    });
  }, { timeout: 3000 }).toBe(true);

  await page.close();
});

test('③ 点 pd-rt-bold → 仅选区字符加粗', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 记录初始 font-weight
  const initWeight = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#card-text p')!).fontWeight
  );

  await dblClickPageEl(page, '#card-text p');

  // 等待编辑态
  await page.waitForFunction(() => {
    const el = document.querySelector('#card-text p');
    return el instanceof HTMLElement && el.contentEditable === 'true';
  });

  // 选中头 4 个字符
  await page.evaluate(() => {
    const el = document.querySelector('#card-text p');
    if (!el?.firstChild) return;
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.setEnd(el.firstChild, Math.min(4, el.firstChild.textContent?.length ?? 0));
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  // 等待浮条出现
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      const bar = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-rtbar"]');
      return bar && getComputedStyle(bar).display !== 'none';
    });
  }, { timeout: 3000 }).toBeTruthy();

  // 点加粗按钮
  await clickShadowSel(page, '[data-testid="pd-rt-bold"]');

  // 编辑元素 innerHTML 应包含加粗标记（<b> 或 <strong> 或 font-weight:bold）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const el = document.querySelector('#card-text p');
      const html = el?.innerHTML ?? '';
      return html.includes('<b') || html.includes('<strong') || html.includes('font-weight');
    });
  }, { timeout: 3000 }).toBe(true);

  // 元素整体 computed font-weight 不变（外部属性未被覆盖）
  const afterWeight = await page.evaluate(() =>
    getComputedStyle(document.querySelector('#card-text p')!).fontWeight
  );
  expect(afterWeight).toBe(initWeight);

  await page.close();
});

test('④ 点编辑区外空白 → 编辑结束、内容变化被提交（位号出现）', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await dblClickPageEl(page, '#card-text p');

  // 等待编辑态
  await page.waitForFunction(() => {
    const el = document.querySelector('#card-text p');
    return el instanceof HTMLElement && el.contentEditable === 'true';
  });

  // 修改文字内容
  await page.evaluate(() => {
    const el = document.querySelector('#card-text p') as HTMLElement;
    el.innerHTML = 'Modified text for testing submission';
  });

  // 点页面空白区（右上角，远离 card-text）
  await page.mouse.click(10, 10);

  // 等待编辑态退出（contentEditable 不再为 true）
  await page.waitForFunction(() => {
    const el = document.querySelector('#card-text p');
    return el instanceof HTMLElement && el.contentEditable !== 'true';
  });

  // 等待位号出现（表示标注被提交）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-pin"]');
    });
  }, { timeout: 3000 }).toBe(true);

  // 点位号 → 卡片出现，且包含调整项（richText 修改记录）
  await clickShadowEl(page, 'pd-pin');
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-card"]');
    });
  }, { timeout: 3000 }).toBe(true);

  // 卡片内应该有内容修改记录（调整项行或 mod 行包含 richText/html）
  const cardHasChange = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const mods = host?.shadowRoot?.querySelector('[data-testid="pd-card-mods"]');
    return !!mods && mods.querySelectorAll('.mod').length > 0;
  });
  expect(cardHasChange).toBe(true);

  await page.close();
});

test('⑤ 单击（非双击）#btn-primary 仍正常弹面板', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 单击按钮（非文本元素，无延迟）
  await clickPageEl(page, '#btn-primary');

  // 面板应该出现（可能有最多 250ms 延迟，但按钮是 button 类型，不走延迟）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-panel"]');
    });
  }, { timeout: 1500 }).toBe(true);

  await page.close();
});
