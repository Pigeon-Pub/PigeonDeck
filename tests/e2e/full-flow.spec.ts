/**
 * full-flow.spec.ts — 阶段 15 全链路集成 E2E（1 个大场景）
 *
 * 串起 V1 主流程，验证各阶段集成不脱节（构想蓝图2 §10.3）：
 *   1. 展开工具盘 → 单击元素 → 批注 → 保存 → 位号 #1
 *   2. 批注模式改样式（背景色）→ 保存 → 位号 #2 + store 有 changes
 *   3. 移动模式选中另一元素 → 拖本体 → 松手 → 出位号（move 记录）
 *   4. 切回批注 → 长按拖区域 → 填说明 → 保存 → 区域框 + 位号
 *   5. 复制文本 → 授剪贴板权限 → 读剪贴板断言 [Page Context]/[Operations]/#/note
 *   6. 撤销一次 → 最近一步回退（store 数量减少）
 *   7. 清空 → 确认 → 位号全消失；Ctrl+Z → 恢复（清空可撤销）
 *   8. 刷新 → 之前保存的标注位号恢复（sessionStorage 恢复）
 *   9. 设置 → 面板出现 → 关闭
 *
 * 复制图片（captureVisibleTab）在 Playwright persistent-context 下会挂起
 * （见 copy-image.spec DEVIATION），全链路里跳过截图步骤，改由手动冒烟验证。
 *
 * 时序断言全部轮询（waitForFunction / expect.poll），无固定 sleep 后断言。
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

/** 位号圆数量（overlay 渲染的 store 标注计数的可视代理） */
function pinCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const host = document.getElementById('pd-host');
    return host?.shadowRoot?.querySelectorAll('[data-testid="pd-pin"]').length ?? 0;
  });
}

/** 用 CSS 选择器点击 Shadow DOM 内元素（先滚入可视区） */
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

function readClipboard(page: Page): Promise<string> {
  return page.evaluate(() => navigator.clipboard.readText());
}

function readOutputBody(page: Page): Promise<string> {
  return page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const body = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-output-body"]');
    return body?.textContent ?? '';
  });
}

// ============================================================
// 全链路场景
// ============================================================

test('全链路：标注 → 样式 → 移动 → 区域 → 复制文本 → 撤销 → 清空/恢复 → 刷新恢复 → 设置', async () => {
  test.setTimeout(120000);
  const page = await openFixturePage();

  // ---- 1. 展开 + 批注 #btn-primary ----
  await expandToolbar(page);
  await clickPageEl(page, '#btn-primary');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type('全链路批注一');
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  // ---- 2. 批注模式改样式（背景色）→ #btn-secondary ----
  await clickPageEl(page, '#btn-secondary');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type('顺带改个背景');
  await clickShadowSel(page, '[data-field="bgColor"] .sw');
  await waitShadowVisible(page, '[data-testid="pd-palette"]');
  await waitShadowVisible(page, '[data-testid="pd-palette-sug"] .s');

  const bgBefore = await pageComputed(page, '#btn-secondary', 'background-color');
  const picked = await page.evaluate((current: string) => {
    const host = document.getElementById('pd-host');
    const swatches = [
      ...host!.shadowRoot!.querySelectorAll<HTMLElement>('[data-testid="pd-palette-sug"] .s'),
    ];
    const target = swatches.find((s) => getComputedStyle(s).backgroundColor !== current);
    if (!target) return false;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    return true;
  }, bgBefore);
  expect(picked, 'a recommended swatch differing from current bg should exist').toBe(true);
  await expect.poll(() => pageComputed(page, '#btn-secondary', 'background-color')).not.toBe(bgBefore);

  await clickShadowSel(page, '[data-testid="pd-panel-save"]');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="2"]');
  await expect.poll(() => pinCount(page)).toBe(2);

  // ---- 3. 移动模式：选中绝对定位 #snap-b 拖本体 → 出位号 ----
  await clickShadowEl(page, 'pd-btn-move');
  // 滚到 snap-b 附近再选中
  await page.evaluate(() => {
    const el = document.getElementById('snap-b')!;
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - 160);
  });
  const snapC = await page.evaluate(() => {
    const el = document.getElementById('snap-b')!;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });
  await page.mouse.click(snapC.cx, snapC.cy);
  await waitShadowVisible(page, '[data-testid="pd-selbox"]');

  // 拖本体一段明显位移
  await page.mouse.move(snapC.cx, snapC.cy);
  await page.mouse.down();
  await page.mouse.move(snapC.cx + 45, snapC.cy + 35, { steps: 12 });
  await page.mouse.up();

  // move 记入 store → 第 3 个位号出现
  await expect.poll(() => pinCount(page), {
    timeout: 8000,
    message: 'move commit should add a 3rd pin',
  }).toBe(3);

  // ---- 4. 切回批注 → 长按拖区域 → 填说明 → 保存 ----
  await clickShadowEl(page, 'pd-btn-move'); // toggle 回批注
  await page.evaluate(() => window.scrollTo(0, 0));

  // 从 card-text 区域内长按（避开 body 空隙，与 region.spec 一致的落点区），
  // 满 300ms 出实时金框后拖拽成区域。
  await page.mouse.move(100, 90);
  await page.mouse.down();
  await page.waitForFunction(
    () => !!document.getElementById('pd-host')?.shadowRoot?.querySelector('[data-testid="pd-region-live"]'),
    undefined,
    { timeout: 4000 }
  );
  await page.mouse.move(400, 300, { steps: 8 });
  await page.mouse.up();

  await waitShadowVisible(page, '[data-testid="pd-region-panel"]');
  await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const ta = host?.shadowRoot?.querySelector<HTMLTextAreaElement>('[data-testid="pd-region-note"]');
    if (ta) {
      ta.focus();
      ta.value = '这块区域整体重排';
    }
  });
  await clickShadowEl(page, 'pd-region-save');
  await waitShadowGone(page, '[data-testid="pd-region-panel"]');
  await waitShadowVisible(page, '[data-testid="pd-region"]');
  await expect.poll(() => pinCount(page), {
    timeout: 8000,
    message: 'region save should add a 4th pin',
  }).toBe(4);

  // ---- 5. 复制文本 → 剪贴板断言（核心，真断言）----
  await clickShadowEl(page, 'pd-btn-copy-text');
  await waitShadowVisible(page, '[data-testid="pd-output"]');

  if (clipboardGranted) {
    await expect.poll(() => readClipboard(page)).toContain('[Page Context]');
    await expect.poll(() => readClipboard(page)).toContain('[Operations]');
    await expect.poll(() => readClipboard(page)).toContain('#1');
    await expect.poll(() => readClipboard(page)).toContain('全链路批注一');
  } else {
    // 剪贴板未授权：退化断言弹窗正文含同样结构
    await expect.poll(() => readOutputBody(page)).toContain('[Page Context]');
    await expect.poll(() => readOutputBody(page)).toContain('[Operations]');
    await expect.poll(() => readOutputBody(page)).toContain('全链路批注一');
  }

  // 关弹窗（点外部），回到主界面
  await page.mouse.click(10, 10);
  await waitShadowGone(page, '[data-testid="pd-output"]');

  // 复制图片：captureVisibleTab 在本环境挂起，全链路跳过（见文件头 + 手动冒烟清单）。

  // ---- 6. 撤销一次 → 最近一步（区域）回退，位号数减少 ----
  await clickShadowEl(page, 'pd-btn-undo');
  await expect.poll(() => pinCount(page), {
    timeout: 6000,
    message: 'undo should remove the most recent (region) pin',
  }).toBe(3);

  // ---- 7. 清空 → 确认 → 位号全消失；Ctrl+Z → 恢复 ----
  await clickShadowEl(page, 'pd-btn-clear');
  await waitShadowVisible(page, '[data-testid="pd-clear-confirm"]');
  await clickShadowEl(page, 'pd-clear-ok');
  await waitShadowGone(page, '[data-testid="pd-pin"]');

  await page.keyboard.press('Control+z');
  // 清空可撤销：位号恢复（撤销清空前的 3 条）
  await expect.poll(() => pinCount(page), {
    timeout: 6000,
    message: 'undo-clear should restore the pins',
  }).toBe(3);
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  // ---- 8. 刷新 → 标注恢复（sessionStorage）----
  // 等防抖写入 sessionStorage（内容含批注文本）后再刷新
  await page.waitForFunction(() => {
    const raw = sessionStorage.getItem('pigeondeck:' + location.href);
    return !!raw && raw.includes('全链路批注一');
  }, { timeout: 6000 });

  await page.reload();
  await waitForExtensionInjected(page);
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');

  // ---- 9. 设置面板出现 → 关闭 ----
  await expandToolbar(page);
  await clickShadowEl(page, 'pd-btn-settings');
  await waitShadowVisible(page, '[data-testid="pd-settings"]');
  await clickShadowEl(page, 'pd-settings-close');
  await waitShadowGone(page, '[data-testid="pd-settings"]');

  await page.close();
});
