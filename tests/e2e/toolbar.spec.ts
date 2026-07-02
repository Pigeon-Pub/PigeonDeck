/**
 * toolbar.spec.ts — 工具盘 E2E 测试（6 用例）
 *
 * 用例：
 * 1. 悬浮球出现且尺寸/位置正确
 * 2. 点击展开出 7 按钮、再点 Logo 收起
 * 3. hover 出 tooltip
 * 4. 点移动按钮出现激活高亮、再点取消
 * 5. 长按拖拽移动位置、刷新后恢复
 * 6. 把球拖到视口底部附近展开→工具盘不越界
 */

import { test, expect, BrowserContext } from '@playwright/test';
import {
  launchExtensionBrowser,
  startFixtureServer,
  TestServer,
  waitForExtensionInjected,
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
  return page;
}

/**
 * Shadow DOM 内的元素选择器。
 * Playwright 1.x 穿透 open shadow DOM：page.locator(':host') 不行，
 * 需用 page.locator('pierce/...') 或 page.locator('#pd-host >> [data-testid=...]')。
 * 最可靠的方式是通过 page.evaluate() 直接查询 shadow root。
 */
function shadowQuery(page: ReturnType<BrowserContext['newPage'] extends (...args: unknown[]) => infer R ? () => R : never>, selector: string) {
  return page.locator(`[data-testid="${selector}"]`);
}

/** 通过 evaluate 获取 shadow root 内元素的 bounding rect */
async function getShadowElementRect(page: Parameters<typeof waitForExtensionInjected>[0], testId: string) {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return null;
    const el = host.shadowRoot.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, right: r.right, bottom: r.bottom, left: r.left };
  }, testId);
}

/** 在 shadow root 内点击元素 */
async function clickShadowEl(page: Parameters<typeof waitForExtensionInjected>[0], testId: string) {
  const rect = await getShadowElementRect(page, testId);
  if (!rect) throw new Error(`Shadow element not found: ${testId}`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/** 检查 shadow root 内元素是否可见 */
async function isShadowElVisible(page: Parameters<typeof waitForExtensionInjected>[0], testId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const el = host.shadowRoot.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }, testId);
}

/** 获取 shadow root 内元素的 computed style 属性 */
async function getShadowElStyle(page: Parameters<typeof waitForExtensionInjected>[0], testId: string, prop: string): Promise<string> {
  return page.evaluate(({ id, property }: { id: string; property: string }) => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return '';
    const el = host.shadowRoot.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) return '';
    return getComputedStyle(el).getPropertyValue(property);
  }, { id: testId, property: prop });
}

// ---- 用例 ----

test('①悬浮球出现且尺寸/位置正确', async () => {
  const page = await openFixturePage();

  // 悬浮球应存在于 shadow root 内
  const rect = await getShadowElementRect(page, 'pd-ball');
  expect(rect).not.toBeNull();

  // 尺寸：42×42
  expect(rect!.width).toBeCloseTo(42, 0);
  expect(rect!.height).toBeCloseTo(42, 0);

  // 默认右下角 16px 偏移
  const vw = page.viewportSize()!.width;
  const vh = page.viewportSize()!.height;
  // right ≈ vw - rect.right ≈ 16
  const rightOffset = vw - rect!.right;
  const bottomOffset = vh - rect!.bottom;
  expect(rightOffset).toBeGreaterThanOrEqual(12);
  expect(rightOffset).toBeLessThanOrEqual(24);
  expect(bottomOffset).toBeGreaterThanOrEqual(12);
  expect(bottomOffset).toBeLessThanOrEqual(24);

  // 工具盘应隐藏
  const tbVisible = await isShadowElVisible(page, 'pd-toolbar');
  expect(tbVisible).toBe(false);

  await page.close();
});

test('②点击展开出 7 按钮、再点 Logo 收起', async () => {
  const page = await openFixturePage();

  // 点击悬浮球展开
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(200);

  // 工具盘应可见
  const tbVisible = await isShadowElVisible(page, 'pd-toolbar');
  expect(tbVisible).toBe(true);

  // 悬浮球应隐藏
  const ballVisible = await isShadowElVisible(page, 'pd-ball');
  expect(ballVisible).toBe(false);

  // 工具盘内有 7 个预期按钮/元素
  const buttonCount = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return 0;
    const tb = host.shadowRoot.querySelector('[data-testid="pd-toolbar"]');
    if (!tb) return 0;
    // Logo + move + copy-text + copy-image + undoredo(container) + clear + settings = 7 items
    return tb.querySelectorAll('[data-testid^="pd-btn"], [data-testid="pd-undoredo"]').length;
  });
  expect(buttonCount).toBe(7);

  // 点击 Logo 按钮收起
  await clickShadowEl(page, 'pd-btn-logo');
  await page.waitForTimeout(200);

  // 悬浮球应再次可见
  const ballVisibleAgain = await isShadowElVisible(page, 'pd-ball');
  expect(ballVisibleAgain).toBe(true);

  // 工具盘应隐藏
  const tbHidden = await isShadowElVisible(page, 'pd-toolbar');
  expect(tbHidden).toBe(false);

  await page.close();
});

test('③hover 出 tooltip', async () => {
  const page = await openFixturePage();

  // 展开
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(200);

  // hover 移动按钮，检查 tooltip 可见性
  const rect = await getShadowElementRect(page, 'pd-btn-move');
  expect(rect).not.toBeNull();

  // 移入
  await page.mouse.move(rect!.x + rect!.width / 2, rect!.y + rect!.height / 2);
  await page.waitForTimeout(200); // 等 tooltip 出现

  // tooltip 出现（通过 opacity）
  const tooltipVisible = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const btn = host.shadowRoot.querySelector('[data-testid="pd-btn-move"]');
    if (!btn) return false;
    const tip = btn.querySelector('.pd-tip') as HTMLElement | null;
    if (!tip) return false;
    // hover 时 opacity 变为 1
    const style = getComputedStyle(tip);
    return parseFloat(style.opacity) > 0.5;
  });
  expect(tooltipVisible).toBe(true);

  await page.close();
});

test('④点移动按钮出现激活高亮、再点取消', async () => {
  const page = await openFixturePage();

  // 展开
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(200);

  // 点移动按钮
  await clickShadowEl(page, 'pd-btn-move');
  await page.waitForTimeout(100);

  // pd-btn-move 应有 active 类
  const hasActive = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const btn = host.shadowRoot.querySelector('[data-testid="pd-btn-move"]');
    return btn?.classList.contains('active') ?? false;
  });
  expect(hasActive).toBe(true);

  // 工具盘应有 is-active 描边
  const tbHasActive = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const tb = host.shadowRoot.querySelector('[data-testid="pd-toolbar"]');
    return tb?.classList.contains('is-active') ?? false;
  });
  expect(tbHasActive).toBe(true);

  // 再点移动按钮取消
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

test('⑤长按拖拽移动位置、刷新后恢复', async () => {
  const page = await openFixturePage();

  // 获取初始球位置
  const initialRect = await getShadowElementRect(page, 'pd-ball');
  expect(initialRect).not.toBeNull();

  const cx = initialRect!.x + initialRect!.width / 2;
  const cy = initialRect!.y + initialRect!.height / 2;

  // 长按（按住 350ms，超过 300ms 阈值）
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(400); // 超过 LONG_PRESS_MS=300

  // 拖拽 100px 向左、50px 向上
  await page.mouse.move(cx - 100, cy - 50, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(200);

  // 新位置应不同于初始位置
  const newRect = await getShadowElementRect(page, 'pd-ball');
  expect(newRect).not.toBeNull();

  const movedX = Math.abs((newRect!.x + newRect!.width / 2) - cx) > 50;
  const movedY = Math.abs((newRect!.y + newRect!.height / 2) - cy) > 20;
  expect(movedX || movedY).toBe(true);

  // 保存位置后刷新
  await page.reload();
  await waitForExtensionInjected(page);
  await page.waitForTimeout(300);

  // 刷新后位置应恢复
  const restoredRect = await getShadowElementRect(page, 'pd-ball');
  expect(restoredRect).not.toBeNull();

  // 恢复的位置应接近拖拽后的位置
  const diffX = Math.abs((restoredRect!.x + restoredRect!.width / 2) - (newRect!.x + newRect!.width / 2));
  const diffY = Math.abs((restoredRect!.y + restoredRect!.height / 2) - (newRect!.y + newRect!.height / 2));
  expect(diffX).toBeLessThan(10);
  expect(diffY).toBeLessThan(10);

  await page.close();
});

test('⑥把球拖到视口底部附近展开→工具盘不越界', async () => {
  const page = await openFixturePage();

  const vh = page.viewportSize()!.height;
  const vw = page.viewportSize()!.width;

  // 清除已持久化的位置
  await page.evaluate(() => localStorage.removeItem('pigeondeck.pos'));
  await page.reload();
  await waitForExtensionInjected(page);

  const ballRect = await getShadowElementRect(page, 'pd-ball');
  const cx = ballRect!.x + ballRect!.width / 2;
  const cy = ballRect!.y + ballRect!.height / 2;

  // 长按拖拽到视口底部附近（距底 30px）
  const targetY = vh - 30;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.waitForTimeout(400);
  await page.mouse.move(cx, targetY, { steps: 20 });
  await page.mouse.up();
  await page.waitForTimeout(300);

  // 展开工具盘
  await clickShadowEl(page, 'pd-ball');
  await page.waitForTimeout(300);

  // 工具盘应在视口内（不超出底边）
  const tbRect = await getShadowElementRect(page, 'pd-toolbar');
  expect(tbRect).not.toBeNull();

  // 工具盘底部 ≤ 视口高度
  expect(tbRect!.bottom).toBeLessThanOrEqual(vh + 2); // 允许 2px 误差

  // 工具盘顶部 ≥ 0
  expect(tbRect!.top).toBeGreaterThanOrEqual(-2);

  await page.close();
});
