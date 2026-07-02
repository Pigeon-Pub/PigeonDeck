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

/** 在页面元素中心执行鼠标双击（先滚入视口，取滚后坐标） */
async function dblClickPageEl(page: Page, cssSelector: string): Promise<void> {
  await page.locator(cssSelector).first().scrollIntoViewIfNeeded();
  const box = await page.locator(cssSelector).first().boundingBox();
  if (!box) throw new Error(`Page element not found: ${cssSelector}`);
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
}

/** 在页面元素中心执行鼠标单击（先滚入视口，取滚后坐标） */
async function clickPageEl(page: Page, cssSelector: string): Promise<void> {
  await page.locator(cssSelector).first().scrollIntoViewIfNeeded();
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

test('③b 字号下拉作用于选区（弹层命令保选区）→ span 只包住选区文本', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await dblClickPageEl(page, '#card-text p');

  // 等待编辑态
  await page.waitForFunction(() => {
    const el = document.querySelector('#card-text p');
    return el instanceof HTMLElement && el.contentEditable === 'true';
  });

  // 选中头 8 个字符，记录选区文本
  const selectedText = await page.evaluate(() => {
    const el = document.querySelector('#card-text p');
    if (!el?.firstChild) return '';
    const len = Math.min(8, el.firstChild.textContent?.length ?? 0);
    const range = document.createRange();
    range.setStart(el.firstChild, 0);
    range.setEnd(el.firstChild, len);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return el.firstChild.textContent?.slice(0, len) ?? '';
  });
  expect(selectedText.length).toBeGreaterThan(0);

  // 等待浮条出现
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      const bar = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-rtbar"]');
      return bar && getComputedStyle(bar).display !== 'none';
    });
  }, { timeout: 3000 }).toBeTruthy();

  // 打开字号下拉
  await clickShadowSel(page, '[data-testid="pd-rt-size"] .pd-select');
  await waitShadowVisible(page, '[data-testid="pd-dropdown"]');

  // 点 32px 项
  await clickShadowSel(page, '[data-testid="pd-dropdown"] [data-value="32"]');

  // 断言：编辑元素 innerHTML 内出现 font-size:32px 的 span，
  // 且该 span 文本恰等于选区文本（只包住选区，非整段）
  await expect.poll(async () => {
    return page.evaluate((selText: string) => {
      const el = document.querySelector('#card-text p') as HTMLElement;
      // 找到含 32px 字号的元素
      const spans = [...el.querySelectorAll<HTMLElement>('*')].filter((n) => {
        const fs = n.style.fontSize || '';
        return fs.replace(/\s/g, '') === '32px';
      });
      if (spans.length === 0) return { ok: false, reason: 'no-32px-span' };
      // 该 span 文本应等于选区文本（只包住选区）
      const spanText = spans[0].textContent ?? '';
      // 整段文本应比选区文本长（证明没包整段）
      const fullText = el.textContent ?? '';
      return {
        ok: spanText === selText && fullText.length > selText.length,
        spanText,
        selText,
        fullLen: fullText.length,
      };
    }, selectedText);
  }, { timeout: 3000 }).toMatchObject({ ok: true });

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

  // 点位号 → 卡片出现（点击后轮询等待卡片，规避 rAF 定位/渲染时序抖动）
  const cardOpen = (): Promise<boolean> =>
    page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-card"]');
    });
  if (!(await cardOpen())) {
    await clickShadowEl(page, 'pd-pin');
  }
  await expect.poll(cardOpen, { timeout: 3000 }).toBe(true);

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

test('⑥ 双击 #pic → 替换弹层出现（含 drop 区 + URL 行）', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await dblClickPageEl(page, '#pic');

  // 替换弹层出现
  await waitShadowVisible(page, '[data-testid="pd-replace"]');
  // 含本地文件 drop 区 + URL 行 + 确认钮
  await waitShadowVisible(page, '[data-testid="pd-replace-drop"]');
  await waitShadowVisible(page, '[data-testid="pd-replace-url"]');
  await waitShadowVisible(page, '[data-testid="pd-replace-confirm"]');

  await page.close();
});

test('⑦ URL 行填新 dataURL → 替换 → #pic src 变新值、位号出现', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  const oldSrc = await page.evaluate(() =>
    document.querySelector<HTMLImageElement>('#pic')!.getAttribute('src')
  );

  await dblClickPageEl(page, '#pic');
  await waitShadowVisible(page, '[data-testid="pd-replace"]');

  // 一个不同的小 dataURL（红色矩形）
  const newSrc =
    "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='120'%20height='80'%3E%3Crect%20width='120'%20height='80'%20fill='%23ff0000'/%3E%3C/svg%3E";

  // 填 URL 输入框
  await page.evaluate((src: string) => {
    const host = document.getElementById('pd-host');
    const input = host!.shadowRoot!.querySelector<HTMLInputElement>('[data-testid="pd-replace-url"]')!;
    input.value = src;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, newSrc);

  // 点替换钮
  await clickShadowSel(page, '[data-testid="pd-replace-confirm"]');

  // #pic src 变为新值（即时预览）
  await expect.poll(async () => {
    return page.evaluate(() =>
      document.querySelector<HTMLImageElement>('#pic')!.getAttribute('src')
    );
  }, { timeout: 3000 }).toBe(newSrc);

  // 确认确实变了
  expect(newSrc).not.toBe(oldSrc);

  // 位号出现（替换即记录标注、无需额外保存）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-pin"]');
    });
  }, { timeout: 3000 }).toBe(true);

  await page.close();
});

test('⑧ 本地文件（setInputFiles 小 PNG buffer）→ #pic src 变 data: 开头', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);

  await dblClickPageEl(page, '#pic');
  await waitShadowVisible(page, '[data-testid="pd-replace"]');

  // 用 setInputFiles 塞一个 1x1 PNG 小 buffer 到隐藏 file input（shadow DOM 内）
  const pngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const fileHandle = await page.evaluateHandle(() => {
    const host = document.getElementById('pd-host');
    return host!.shadowRoot!.querySelector('[data-testid="pd-replace-file"]') as HTMLInputElement;
  });
  const fileInput = fileHandle.asElement()!;
  await fileInput.setInputFiles({
    name: 'tiny.png',
    mimeType: 'image/png',
    buffer: Buffer.from(pngBase64, 'base64'),
  });

  // #pic src 变为 data: 开头（FileReader 产出 dataURL）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const src = document.querySelector<HTMLImageElement>('#pic')!.getAttribute('src') ?? '';
      return src.startsWith('data:image/png');
    });
  }, { timeout: 3000 }).toBe(true);

  await page.close();
});

