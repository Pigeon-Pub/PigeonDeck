/**
 * style-edit.spec.ts - 阶段 3b 修改栏 + 高级样式 E2E（6 用例）
 *
 * ① 文本元素面板出现排版修改栏，改字号即时生效
 * ② 改背景色（调色盘展开选推荐色）→ 保存 → 卡片出现调整项行
 * ③ 高级样式 4 分类切换、字体下拉智能识别栏出现采样项
 * ④ 未保存关面板 → 页面样式回滚
 * ⑤ 陌生元素面板出「自动」角标控件
 * ⑥ 调试分类默认英文、点翻译图标变中文
 *
 * 时序断言全部用轮询（waitForFunction / expect.poll），不用固定 sleep。
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

/** 在页面元素中心执行鼠标点击（capture 拦截由扩展处理） */
async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

/** 读取页面元素 computed style 属性 */
function pageComputed(page: Page, cssSelector: string, prop: string): Promise<string> {
  return page.evaluate(
    ([sel, p]) => getComputedStyle(document.querySelector(sel)!).getPropertyValue(p),
    [cssSelector, prop] as [string, string]
  );
}

// ============================================================
// 用例
// ============================================================

test('① 文本元素面板出现排版修改栏，改字号即时生效', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await clickPageEl(page, '#card-text p');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  // 排版修改栏：文字内容 + 字号/字重 + 颜色 + 对齐
  await waitShadowVisible(page, '[data-testid="pd-modbox"]');
  await waitShadowVisible(page, '[data-field="text"]');
  await waitShadowVisible(page, '[data-field="fontSize"]');
  await waitShadowVisible(page, '[data-field="color"]');
  await waitShadowVisible(page, '[data-field="align"]');

  // 点字号 + 一次 → 14px 立即变 15px（即时预览）
  const before = await pageComputed(page, '#card-text p', 'font-size');
  expect(before).toBe('14px');
  await clickShadowSel(page, '[data-field="fontSize"] .step button[data-dir="1"]');
  await expect
    .poll(() => pageComputed(page, '#card-text p', 'font-size'))
    .toBe('15px');

  await page.close();
});

test('② 调色盘选推荐色改背景 → 保存 → 卡片出现调整项行', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await clickPageEl(page, '#btn-primary');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');
  await page.keyboard.type('主按钮换个底色');

  // 展开调色盘（点背景色控件的色块）
  await clickShadowSel(page, '[data-field="bgColor"] .sw');
  await waitShadowVisible(page, '[data-testid="pd-palette"]');
  await waitShadowVisible(page, '[data-testid="pd-palette-sug"] .s');

  // 点一个与当前背景不同的推荐色 → 即时生效
  const bgBefore = await pageComputed(page, '#btn-primary', 'background-color');
  const picked = await page.evaluate((current: string) => {
    const host = document.getElementById('pd-host');
    const swatches = [
      ...host!.shadowRoot!.querySelectorAll<HTMLElement>('[data-testid="pd-palette-sug"] .s'),
    ];
    const target = swatches.find(
      (s) => getComputedStyle(s).backgroundColor !== current
    );
    if (!target) return null;
    const value = target.getAttribute('data-color');
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true }));
    return value;
  }, bgBefore);
  expect(picked).toBeTruthy();
  await expect
    .poll(() => pageComputed(page, '#btn-primary', 'background-color'))
    .not.toBe(bgBefore);

  // 保存 → 位号出现 → 点位号出卡片 → 卡片含调整项行（原值 → 新值）
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowVisible(page, '[data-testid="pd-pin"][data-number="1"]');
  await clickShadowEl(page, 'pd-pin');
  await waitShadowVisible(page, '[data-testid="pd-card"]');
  await waitShadowVisible(page, '[data-testid="pd-card-mods"] .mod');
  const diffText = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    return host?.shadowRoot?.querySelector('[data-testid="pd-card-mods"] .mod .pd-diff')
      ?.textContent;
  });
  expect(diffText).toContain('→');

  await page.close();
});

test('③ 高级样式 4 分类切换，字体下拉智能识别栏出现采样项', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await clickPageEl(page, '#card-text p');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  // 展开高级样式（默认排版分类）
  await clickShadowSel(page, '[data-testid="pd-adv-toggle"]');
  await waitShadowVisible(page, '[data-testid="pd-advbox"]');
  await waitShadowVisible(page, '[data-testid="pd-advbox"] [data-field="font"]');

  // 尺寸 → 宽度控件
  await clickShadowSel(page, '[data-testid="pd-adv-nav-size"]');
  await waitShadowVisible(page, '[data-testid="pd-advbox"] [data-field="width"]');

  // 外观 → 背景色控件
  await clickShadowSel(page, '[data-testid="pd-adv-nav-appearance"]');
  await waitShadowVisible(page, '[data-testid="pd-advbox"] [data-field="bgColor"]');

  // 调试 → 只读 readout
  await clickShadowSel(page, '[data-testid="pd-adv-nav-debug"]');
  await waitShadowVisible(page, '[data-testid="pd-adv-debug"]');

  // 回排版 → 打开字体下拉 → 智能识别栏有采样项（页面字体栈可采）
  await clickShadowSel(page, '[data-testid="pd-adv-nav-typography"]');
  await waitShadowVisible(page, '[data-testid="pd-advbox"] [data-field="font"]');
  await clickShadowSel(page, '[data-testid="pd-advbox"] [data-field="font"] .pd-select');
  await waitShadowVisible(page, '[data-testid="pd-dropdown"]');
  await waitShadowVisible(page, '[data-testid="pd-dd-smart"] [data-testid="pd-dd-item"]');
  const smartBadge = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    return host?.shadowRoot?.querySelector('[data-testid="pd-dd-smart"] .smart')?.textContent;
  });
  expect(smartBadge).toBeTruthy();

  await page.close();
});

test('④ 未保存关面板 → 页面样式回滚', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await clickPageEl(page, '#card-text p');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  // 改字号（即时预览生效）
  await clickShadowSel(page, '[data-field="fontSize"] .step button[data-dir="1"]');
  await expect
    .poll(() => pageComputed(page, '#card-text p', 'font-size'))
    .toBe('15px');

  // 点面板外部（body 空白区）关面板 → 预览回滚
  await page.mouse.click(5, 5);
  await page.waitForFunction(() => {
    const host = document.getElementById('pd-host');
    return !host?.shadowRoot?.querySelector('[data-testid="pd-panel"]');
  });
  await expect
    .poll(() => pageComputed(page, '#card-text p', 'font-size'))
    .toBe('14px');
  // inline style 也被清掉（原本没有内联字号）
  const inline = await page.evaluate(
    () => document.querySelector<HTMLElement>('#card-text p')!.style.fontSize
  );
  expect(inline).toBe('');

  await page.close();
});

test('⑤ 陌生元素面板出「自动」角标控件', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await clickPageEl(page, '#deco-strip');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  // 自动适配说明条 + 至少一个带「自动」角标的控件
  await waitShadowVisible(page, '[data-testid="pd-autonote"]');
  await waitShadowVisible(page, '[data-testid="pd-modbox"] .prop .auto');
  // 有背景色的元素 → 背景色控件被自动列出
  await waitShadowVisible(page, '[data-testid="pd-modbox"] [data-field="bgColor"]');

  await page.close();
});

test('⑥ 调试分类默认英文，点翻译图标变中文', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await clickPageEl(page, '#card-text p');
  await waitShadowVisible(page, '[data-testid="pd-panel"]');

  await clickShadowSel(page, '[data-testid="pd-adv-toggle"]');
  await waitShadowVisible(page, '[data-testid="pd-advbox"]');
  await clickShadowSel(page, '[data-testid="pd-adv-nav-debug"]');
  await waitShadowVisible(page, '[data-testid="pd-adv-debug"]');

  const readLabels = (): Promise<{ heading?: string; firstKey?: string }> =>
    page.evaluate(() => {
      const host = document.getElementById('pd-host');
      const debug = host?.shadowRoot?.querySelector('[data-testid="pd-adv-debug"]');
      return {
        heading: debug?.querySelector('.dom-h')?.textContent ?? undefined,
        firstKey: debug?.querySelector('.kv .k')?.textContent ?? undefined,
      };
    });

  // 默认全英文
  await expect.poll(async () => (await readLabels()).heading).toBe('DOM INFO');
  expect((await readLabels()).firstKey).toBe('tagName');

  // 点翻译图标 → 标签译中文（值保持原样）
  await clickShadowSel(page, '[data-testid="pd-adv-translate"]');
  await expect.poll(async () => (await readLabels()).heading).toBe('DOM 信息');
  expect((await readLabels()).firstKey).toBe('标签名');

  await page.close();
});
