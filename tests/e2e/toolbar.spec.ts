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

import { test, expect, BrowserContext } from '@playwright/test';
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

test('③ hover shows tooltip', async () => {
  const page = await openFixturePage();

  // Expand
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(200);

  // Hover Move button
  const rect = await getShadowElementRect(page, 'pd-btn-move');
  expect(rect).not.toBeNull();
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  // 抖动 1px 确保 hover 事件在动画后仍然触发
  await page.mouse.move(rect!.x + rect!.width / 2 + 1, rect!.y + rect!.height / 2);

  // Tooltip visible (opacity > 0.5) — 轮询等待，避免对过渡时长的固定假设
  await page.waitForFunction(
    () => {
      const host = document.getElementById('pd-host');
      if (!host?.shadowRoot) return false;
      const btn = host.shadowRoot.querySelector('[data-testid="pd-btn-move"]');
      if (!btn) return false;
      const tip = btn.querySelector('.pd-tip') as HTMLElement | null;
      if (!tip) return false;
      return parseFloat(getComputedStyle(tip).opacity) > 0.5;
    },
    undefined,
    { timeout: 3000 }
  );

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
