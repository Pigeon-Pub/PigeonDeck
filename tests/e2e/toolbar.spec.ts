/**
 * toolbar.spec.ts - Toolbar E2E tests (6 cases)
 *
 * 1. Floating ball appears with correct size/position
 * 2. Click to expand showing 7 items, click Logo to collapse
 * 3. Hover shows tooltip
 * 4. Click Move button shows active highlight, click again cancels
 * 5. Long-press drag moves position, persists after refresh
 * 6. Drag ball near viewport bottom, expand toolbar stays in bounds
 */

import { test, expect, BrowserContext, Page } from '@playwright/test';
import {
  launchExtensionBrowser,
  startFixtureServer,
  waitForExtensionInjected,
  getShadowElementRect,
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

async function openFixturePage() {
  const page = await context.newPage();
  await page.goto(`${server.baseUrl}/basic.html`);
  await waitForExtensionInjected(page);
  // Clear any persisted position for clean test state
  await page.evaluate(() => localStorage.removeItem('pigeondeck.pos'));
  await page.reload();
  await waitForExtensionInjected(page);
  return page;
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

function shadowExists(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel: string) => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector(sel);
  }, selector);
}

async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function dragShadowEl(page: Page, testId: string, dx: number, dy: number): Promise<void> {
  const rect = await getShadowElementRect(page, testId);
  if (!rect) throw new Error(`Shadow element not found: ${testId}`);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 12 });
  await page.mouse.up();
}

// ============================================================
// Test cases
// ============================================================

test('① floating ball appears with correct size and position', async () => {
  const page = await openFixturePage();

  const rect = await getShadowElementRect(page, 'pd-ball');
  expect(rect).not.toBeNull();

  // Size: 42×42
  expect(rect!.width).toBeCloseTo(42, 0);
  expect(rect!.height).toBeCloseTo(42, 0);

  // Default bottom-right 16px offset (tolerance ~20px to account for subpixel/scrollbar)
  const vw = page.viewportSize()!.width;
  const vh = page.viewportSize()!.height;
  const rightOffset = vw - rect!.right;
  const bottomOffset = vh - rect!.bottom;
  expect(rightOffset).toBeGreaterThanOrEqual(10);
  expect(rightOffset).toBeLessThanOrEqual(35);
  expect(bottomOffset).toBeGreaterThanOrEqual(10);
  expect(bottomOffset).toBeLessThanOrEqual(35);

  // Toolbar should be hidden
  const tbVisible = await isShadowElVisible(page, 'pd-toolbar');
  expect(tbVisible).toBe(false);

  await page.close();
});

test('② click to expand shows 7 items, click Logo to collapse', async () => {
  const page = await openFixturePage();

  // Click ball to expand
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(200);

  // Toolbar should be visible
  const tbVisible = await isShadowElVisible(page, 'pd-toolbar');
  expect(tbVisible).toBe(true);

  // Ball should be hidden
  const ballVisible = await isShadowElVisible(page, 'pd-ball');
  expect(ballVisible).toBe(false);

  // Toolbar has 7 items: Logo + UndoRedo(container) + Move + CopyText + CopyImage + Clear + Settings
  // Count direct children of toolbar (not including inner undo/redo buttons)
  const itemCount = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return 0;
    const tb = host.shadowRoot.querySelector('[data-testid="pd-toolbar"]');
    if (!tb) return 0;
    // Direct children only: each top-level item is either a button or the undoredo container
    return tb.children.length;
  });
  expect(itemCount).toBe(7);

  // Click Logo button to collapse
  await clickShadowEl(page, 'pd-btn-logo');
  await page.waitForTimeout(200);

  // Ball visible again
  const ballVisibleAgain = await isShadowElVisible(page, 'pd-ball');
  expect(ballVisibleAgain).toBe(true);

  // Toolbar hidden
  const tbHidden = await isShadowElVisible(page, 'pd-toolbar');
  expect(tbHidden).toBe(false);

  await page.close();
});

test('③ toolbar buttons expose native title tooltip', async () => {
  const page = await openFixturePage();

  // Expand
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(200);

  // F3：改用原生系统 tooltip（title 属性），断言其存在且非空
  const title = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return null;
    const btn = host.shadowRoot.querySelector('[data-testid="pd-btn-move"]');
    return btn?.getAttribute('title') ?? null;
  });
  expect(title).toBeTruthy();

  await page.close();
});

test('④ click Move shows active highlight, click again cancels', async () => {
  const page = await openFixturePage();

  // Expand
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(200);

  // Click Move button
  await clickShadowEl(page, 'pd-btn-move');
  await page.waitForTimeout(100);

  // pd-btn-move should have 'active' class
  const hasActive = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const btn = host.shadowRoot.querySelector('[data-testid="pd-btn-move"]');
    return btn?.classList.contains('active') ?? false;
  });
  expect(hasActive).toBe(true);

  // Toolbar should have 'is-active' class (outline)
  const tbHasActive = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const tb = host.shadowRoot.querySelector('[data-testid="pd-toolbar"]');
    return tb?.classList.contains('is-active') ?? false;
  });
  expect(tbHasActive).toBe(true);

  // Click Move again to cancel
  await clickShadowEl(page, 'pd-btn-move');
  await page.waitForTimeout(100);

  const noActive = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const btn = host.shadowRoot.querySelector('[data-testid="pd-btn-move"]');
    return btn?.classList.contains('active') ?? false;
  });
  expect(noActive).toBe(false);

  await page.close();
});

test('⑤ long-press drag moves position, persists after refresh', async () => {
  const page = await openFixturePage();

  const initialRect = await getShadowElementRect(page, 'pd-ball');
  expect(initialRect).not.toBeNull();

  const cx = initialRect!.x + initialRect!.width / 2;
  const cy = initialRect!.y + initialRect!.height / 2;

  // Long-press (hold > 300ms threshold)
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(400); // > LONG_PRESS_MS=300

  // Drag 100px left, 50px up
  await page.mouse.move(cx - 100, cy - 50, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // Position should have changed
  const newRect = await getShadowElementRect(page, 'pd-ball');
  expect(newRect).not.toBeNull();

  const movedX = Math.abs((newRect!.x + newRect!.width / 2) - cx) > 50;
  const movedY = Math.abs((newRect!.y + newRect!.height / 2) - cy) > 20;
  expect(movedX || movedY).toBe(true);

  // Reload — position should be restored from localStorage
  await page.reload();
  await waitForExtensionInjected(page);
  await page.waitForTimeout(300);

  const restoredRect = await getShadowElementRect(page, 'pd-ball');
  expect(restoredRect).not.toBeNull();

  // Restored position should match new position (within 10px)
  const diffX = Math.abs(
    (restoredRect!.x + restoredRect!.width / 2) - (newRect!.x + newRect!.width / 2)
  );
  const diffY = Math.abs(
    (restoredRect!.y + restoredRect!.height / 2) - (newRect!.y + newRect!.height / 2)
  );
  expect(diffX).toBeLessThan(10);
  expect(diffY).toBeLessThan(10);

  await page.close();
});

test('⑥ drag ball near viewport bottom, expanded toolbar stays in bounds', async () => {
  const page = await openFixturePage();

  const vh = page.viewportSize()!.height;

  const ballRect = await getShadowElementRect(page, 'pd-ball');
  const cx = ballRect!.x + ballRect!.width / 2;
  const cy = ballRect!.y + ballRect!.height / 2;

  // Long-press drag ball to near viewport bottom (30px from bottom)
  const targetY = vh - 30;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.move(cx, targetY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // Click ball to expand toolbar
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(300);

  // Toolbar should be within viewport bounds
  const tbRect = await getShadowElementRect(page, 'pd-toolbar');
  expect(tbRect).not.toBeNull();

  // Toolbar bottom <= viewport height (2px tolerance)
  expect(tbRect!.bottom).toBeLessThanOrEqual(vh + 2);

  // Toolbar top >= 0
  expect(tbRect!.top).toBeGreaterThanOrEqual(-2);

  await page.close();
});

test('⑦ drag direction is not inverted (drag down-left → ball moves down-left)', async () => {
  const page = await openFixturePage();

  // 先把球拖到屏幕中部，四周留出空间（点住即拖，无需长按）
  const start = await getShadowElementRect(page, 'pd-ball');
  const sx = start!.x + start!.width / 2;
  const sy = start!.y + start!.height / 2;
  const vw = page.viewportSize()!.width;
  const vh = page.viewportSize()!.height;
  const midX = Math.round(vw / 2);
  const midY = Math.round(vh / 2);

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(midX, midY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const mid = await getShadowElementRect(page, 'pd-ball');
  const mx = mid!.x + mid!.width / 2;
  const my = mid!.y + mid!.height / 2;

  // 从中部向「下 + 左」拖：down = 屏幕 y 增大，left = 屏幕 x 减小
  await page.mouse.move(mx, my);
  await page.mouse.down();
  await page.mouse.move(mx - 120, my + 120, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  const end = await getShadowElementRect(page, 'pd-ball');
  const ex = end!.x + end!.width / 2;
  const ey = end!.y + end!.height / 2;

  // 关键：拖「下」→ 球向下（ey 变大），而非旧 bug 的向上
  expect(ey).toBeGreaterThan(my + 40);
  // 拖「左」→ 球向左（ex 变小）
  expect(ex).toBeLessThan(mx - 40);

  await page.close();
});

test('⑧ click-to-drag needs no long-press; a real drag does not toggle expand', async () => {
  const page = await openFixturePage();

  const before = await getShadowElementRect(page, 'pd-ball');
  const cx = before!.x + before!.width / 2;
  const cy = before!.y + before!.height / 2;

  // 立即拖拽（不做任何 hold / 长按）：down → 直接分段 move → up
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 90, cy - 60, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(150);

  // 位置已改变（无需 300ms 长按即可拖动）
  const after = await getShadowElementRect(page, 'pd-ball');
  const moved =
    Math.abs((after!.x + after!.width / 2) - cx) > 40 ||
    Math.abs((after!.y + after!.height / 2) - cy) > 40;
  expect(moved).toBe(true);

  // 真实拖拽不应触发展开：工具盘仍隐藏、球仍可见
  expect(await isShadowElVisible(page, 'pd-toolbar')).toBe(false);
  expect(await isShadowElVisible(page, 'pd-ball')).toBe(true);

  // 反证：一次普通点击（无位移）仍能展开
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(250);
  expect(await isShadowElVisible(page, 'pd-toolbar')).toBe(true);

  await page.close();
});

test('⑨ dragging the expanded toolbar closes the settings-derived panel', async () => {
  const page = await openFixturePage();

  await clickShadowEl(page, 'pd-ball');
  await waitShadowVisible(page, '[data-testid="pd-toolbar"]');
  await clickShadowEl(page, 'pd-btn-settings');
  await waitShadowVisible(page, '[data-testid="pd-settings"]');

  await dragShadowEl(page, 'pd-btn-logo', -90, -50);

  await expect
    .poll(() => shadowExists(page, '[data-testid="pd-settings"]'), { timeout: 5000 })
    .toBe(false);
  expect(await isShadowElVisible(page, 'pd-toolbar')).toBe(true);

  await page.close();
});

test('⑩ dragging the expanded toolbar does not close an annotation panel', async () => {
  const page = await openFixturePage();

  await clickShadowEl(page, 'pd-ball');
  await waitShadowVisible(page, '[data-testid="pd-toolbar"]');
  await clickPageEl(page, '#btn-primary');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  await dragShadowEl(page, 'pd-btn-logo', -90, -50);

  await expect
    .poll(() => shadowExists(page, '[data-testid="pd-panel"]'), { timeout: 5000 })
    .toBe(true);
  expect(await isShadowElVisible(page, 'pd-toolbar')).toBe(true);

  await page.close();
});
