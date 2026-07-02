/**
 * annotation.spec.ts - 阶段 3a 批注核心链路 E2E（6 用例）
 *
 * ① 批注模式 hover 出高亮框 + 元素标签
 * ② 单击出面板，填写保存后出现位号 + 标注框
 * ③ 点位号展开卡片，再点收起
 * ④ 右键位号出菜单，删除后 UI 消失，再建标注编号不复用
 * ⑤ 刷新后标注恢复
 * ⑥ 点击带 href 的链接元素不发生导航（拦截验证）
 *
 * 时序断言全部用轮询（waitForFunction / expect.poll），不用固定 sleep 断言视觉状态。
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
  // 清持久化位置，保持测试初态一致（新 tab 的 sessionStorage 天然干净）
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

/** Shadow DOM 内元素当前是否可见（不存在或 display:none 均为 false） */
function shadowVisibleFn(): (selector: string) => boolean {
  // 该函数体在页面上下文执行
  return (selector: string) => {
    const host = document.getElementById('pd-host');
    const el = host?.shadowRoot?.querySelector<HTMLElement>(selector);
    if (!el) return false;
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
  };
}

async function waitShadowVisible(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(shadowVisibleFn(), selector);
}

async function waitShadowGone(page: Page, selector: string): Promise<void> {
  await page.waitForFunction(
    (sel: string) => {
      const host = document.getElementById('pd-host');
      return !host?.shadowRoot?.querySelector(sel);
    },
    selector
  );
}

/** 在页面元素中心执行鼠标点击（capture 拦截由扩展处理） */
async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** 创建一条标注：单击元素 → 填写 → 保存，返回后位号已出现 */
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

test('① 批注模式 hover 出高亮框 + 元素标签', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  const box = (await page.locator('#btn-primary').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

  await waitShadowVisible(page, '[data-testid="pd-hover"]');
  await waitShadowVisible(page, '[data-testid="pd-hlabel"]');

  // 标签显示 hover 元素的 tagName
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById('pd-host');
        return host?.shadowRoot?.querySelector('[data-testid="pd-hlabel"]')?.textContent;
      })
    )
    .toBe('button');

  // 高亮框大致覆盖目标元素
  const hoverRect = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const el = host!.shadowRoot!.querySelector('[data-testid="pd-hover"]')!;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(Math.abs(hoverRect.x - (box.x - 3))).toBeLessThan(3);
  expect(hoverRect.w).toBeGreaterThan(box.width - 2);

  await page.close();
});

test('② 单击出面板，填写保存后出现位号 + 标注框', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await clickPageEl(page, '#card-text p');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  // 面板 textarea 自动聚焦，直接键入
  await page.keyboard.type('把这段文字改得更简洁');
  await clickShadowEl(page, 'pd-panel-save');

  // 面板关闭，出现位号圆 #1 + 标注框
  await waitShadowGone(page, '[data-testid="pd-panel"]');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');
  await waitShadowVisible(page, '[data-testid="pd-markbox"][data-number="1"]');

  // 标注框大致覆盖目标元素
  const targetBox = (await page.locator('#card-text p').first().boundingBox())!;
  const markRect = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const el = host!.shadowRoot!.querySelector('[data-testid="pd-markbox"]')!;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(Math.abs(markRect.x - (targetBox.x - 3))).toBeLessThan(3);
  expect(markRect.w).toBeGreaterThan(targetBox.width - 2);

  await page.close();
});

test('③ 点位号展开卡片，再点收起', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-secondary', '按钮文案要更明确');

  // 点位号圆 → 卡片展开，含批注文本
  await clickShadowEl(page, 'pd-pin');
  await waitShadowVisible(page, '[data-testid="pd-card"]');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById('pd-host');
        return host?.shadowRoot?.querySelector('[data-testid="pd-card-note"]')?.textContent;
      })
    )
    .toBe('按钮文案要更明确');

  // 再点位号圆 → 卡片收起
  await clickShadowEl(page, 'pd-pin');
  await waitShadowGone(page, '[data-testid="pd-card"]');

  await page.close();
});

test('④ 右键位号出菜单，删除后 UI 消失，再建标注编号不复用', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', '第一条');

  // 右键位号圆 → 上下文菜单
  const pinRect = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const pin = host!.shadowRoot!.querySelector('[data-testid="pd-pin"]')!;
    const r = pin.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(pinRect.x, pinRect.y, { button: 'right' });
  await waitShadowVisible(page, '[data-testid="pd-menu"]');

  // 删除 → 位号/标注框消失
  await clickShadowEl(page, 'pd-menu-delete');
  await waitShadowGone(page, '[data-testid="pd-pin"]');
  await waitShadowGone(page, '[data-testid="pd-markbox"]');
  await waitShadowGone(page, '[data-testid="pd-menu"]');

  // 再建标注 → 编号继续用 2，不复用 1
  await createAnnotation(page, '#btn-ghost', '第二条');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="2"]');
  const hasNumber1 = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector('[data-testid="pd-pin"][data-number="1"]');
  });
  expect(hasNumber1).toBe(false);

  await page.close();
});

test('⑤ 刷新后标注恢复', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await createAnnotation(page, '#btn-primary', '刷新后要还在');

  // 等防抖写入 sessionStorage
  await page.waitForFunction(
    () => !!sessionStorage.getItem('pigeondeck:' + location.href)
  );

  await page.reload();
  await waitForExtensionInjected(page);

  // 位号圆 #1 自动恢复（无需展开工具盘）
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');
  await waitShadowVisible(page, '[data-testid="pd-markbox"][data-number="1"]');

  // 卡片内容也恢复：点位号验证批注文本
  await clickShadowEl(page, 'pd-pin');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const host = document.getElementById('pd-host');
        return host?.shadowRoot?.querySelector('[data-testid="pd-card-note"]')?.textContent;
      })
    )
    .toBe('刷新后要还在');

  await page.close();
});

test('⑥ 批注模式点击链接不导航', async () => {
  const page = await openFixturePage();
  const urlBefore = page.url();
  await expandToolbar(page);

  await clickPageEl(page, '#link-nav');

  // 面板出现（点击被扩展接管），URL 不变
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  expect(page.url()).toBe(urlBefore);

  // 再等一拍确认没有延迟导航
  await page.waitForFunction(
    (expected: string) => location.href === expected,
    urlBefore
  );

  await page.close();
});
