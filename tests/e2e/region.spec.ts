/**
 * region.spec.ts - 阶段 5 区域框选 E2E（3 用例）
 *
 * ① 长按拖拽出区域金框，松手后弹区域批注面板
 * ② 填写说明保存后持久区域框 + 位号出现
 * ③ 编号连续：先建元素标注（#1），再建区域标注（#2）
 *
 * 时序断言全轮询（waitForFunction），不写固定 sleep 断言。
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

/** Shadow DOM 内元素是否存在且可见 */
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

/**
 * 长按后拖拽框选。
 * 用 waitForFunction 轮询等待实时金框出现（≥300ms 后出现），不写固定 sleep。
 */
async function longPressAndDrag(
  page: Page,
  startX: number,
  startY: number,
  endX: number,
  endY: number
): Promise<void> {
  await page.mouse.move(startX, startY);
  await page.mouse.down();

  // 等待长按触发（实时金框出现）——轮询，不写固定 sleep
  await page.waitForFunction(() => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector('[data-testid="pd-region-live"]');
  }, { timeout: 2000 });

  // 拖到终点
  await page.mouse.move(endX, endY);
  await page.mouse.up();
}

/** 创建元素批注（用于编号连续测试） */
async function createElementAnnotation(page: Page, cssSelector: string, note: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type(note);
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowVisible(page, '[data-testid="pd-pin"]');
}

// ============================================================
// 用例
// ============================================================

test('① 长按拖拽出区域金框，松手弹区域批注面板', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 从页面中部拖拽一个较大区域
  await longPressAndDrag(page, 100, 80, 400, 300);

  // 松手后区域批注面板出现
  await waitShadowVisible(page, '[data-testid="pd-region-panel"]');

  // 面板中有 textarea
  const hasTextarea = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector('[data-testid="pd-region-note"]');
  });
  expect(hasTextarea).toBe(true);

  // 实时金框在松手后被移除
  await waitShadowGone(page, '[data-testid="pd-region-live"]');

  await page.close();
});

test('② 填写说明保存后持久区域框 + 位号出现', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await longPressAndDrag(page, 100, 80, 400, 300);
  await waitShadowVisible(page, '[data-testid="pd-region-panel"]');

  // 输入说明
  await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const ta = host?.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-testid="pd-region-note"]');
    if (ta) {
      ta.focus();
      ta.value = '这块区域整体留白偏紧';
    }
  });

  // 点保存
  await clickShadowEl(page, 'pd-region-save');

  // 面板关闭
  await waitShadowGone(page, '[data-testid="pd-region-panel"]');

  // 持久区域框出现
  await waitShadowVisible(page, '[data-testid="pd-region"]');

  // 位号圆出现（编号 1）
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  // 区域框有宽高（不是 0×0）
  const regionSize = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-region"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  });
  expect(regionSize).not.toBeNull();
  expect(regionSize!.w).toBeGreaterThan(10);
  expect(regionSize!.h).toBeGreaterThan(10);

  await page.close();
});

test('③ 编号连续：元素标注 #1，区域标注 #2', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 先建元素标注（#1）
  await createElementAnnotation(page, '#btn-primary', '第一条元素标注');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  // 再建区域标注（应为 #2）
  await longPressAndDrag(page, 100, 200, 450, 380);
  await waitShadowVisible(page, '[data-testid="pd-region-panel"]');

  await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const ta = host?.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-testid="pd-region-note"]');
    if (ta) {
      ta.focus();
      ta.value = '区域修改说明';
    }
  });

  await clickShadowEl(page, 'pd-region-save');
  await waitShadowGone(page, '[data-testid="pd-region-panel"]');

  // 区域位号应为 #2
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="2"]');

  // 确认 #1 仍存在（元素标注），#2 是区域标注
  const pinNumbers = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const pins = host?.shadowRoot?.querySelectorAll('[data-testid="pd-pin"]');
    return Array.from(pins ?? []).map((p) => Number(p.getAttribute('data-number')));
  });
  expect(pinNumbers).toContain(1);
  expect(pinNumbers).toContain(2);

  await page.close();
});

test('④ 清空在存在区域标注时正常完成（交互11 回归）', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  // 造一条区域标注（selector 为空串）
  await longPressAndDrag(page, 100, 120, 420, 340);
  await waitShadowVisible(page, '[data-testid="pd-region-panel"]');
  await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const ta = host?.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-testid="pd-region-note"]');
    if (ta) {
      ta.focus();
      ta.value = '区域待清空';
    }
  });
  await clickShadowEl(page, 'pd-region-save');
  await waitShadowVisible(page, '[data-testid="pd-region"]');
  await waitShadowVisible(page, '[data-testid="pd-pin"]');

  // 点清空 → 确认 → 区域框 + 位号全消失（若 querySelector('') 抛错则不会清掉）
  await clickShadowEl(page, 'pd-btn-clear');
  await waitShadowVisible(page, '[data-testid="pd-clear-confirm"]');
  await clickShadowEl(page, 'pd-clear-ok');
  await waitShadowGone(page, '[data-testid="pd-pin"]');
  await waitShadowGone(page, '[data-testid="pd-region"]');

  await page.close();
});
