/**
 * move.spec.ts — 阶段 6a 移动模式 E2E（4 用例）
 *
 * ① 切换移动模式，单击组件 → [data-testid="pd-selbox"] + 8 个句柄出现
 * ② 拖 br（右下角）句柄 → 目标元素 width/height 变大
 * ③ 缩放后目标元素出现位号（尺寸修改进了 store），位号可见
 * ④ 切回批注 / 收起 → selbox 消失
 *
 * 拖拽用 mouse.move/down/move/up，时序断言全轮询（waitForFunction / expect.poll）。
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

/** 切换到移动模式（点移动按钮） */
async function enterMoveMode(page: Page): Promise<void> {
  await clickShadowEl(page, 'pd-btn-move');
}

/** 等待 Shadow DOM 内 testid 元素出现 */
async function waitShadowTestId(page: Page, testId: string, timeout = 8000): Promise<void> {
  await page.waitForFunction(
    (id: string) => !!document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${id}"]`),
    testId,
    { timeout }
  );
}

/** 检查 Shadow DOM 内 testid 是否存在 */
async function shadowTestIdExists(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    return !!document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${id}"]`);
  }, testId);
}

/** 获取 selbox 在 viewport 中的位置 */
async function getSelboxRect(page: Page): Promise<{ left: number; top: number; width: number; height: number } | null> {
  return page.evaluate(() => {
    const host = document.getElementById('pd-host');
    const selbox = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-selbox"]');
    if (!selbox) return null;
    return {
      left: parseFloat(selbox.style.left),
      top: parseFloat(selbox.style.top),
      width: parseFloat(selbox.style.width),
      height: parseFloat(selbox.style.height),
    };
  });
}

/**
 * 读取句柄中心坐标，并等待其稳定（连续两次读数一致）。
 * selbox 渲染/定位后句柄位置在负载下可能有一帧延迟；稳定后再拖拽，
 * 避免 mousedown 落在 8px 句柄外导致缩放不触发（负载下的偶发失败根因）。
 */
async function stableHandleCenter(page: Page, dir: string): Promise<{ x: number; y: number }> {
  const read = (): Promise<{ x: number; y: number } | null> =>
    page.evaluate((d: string) => {
      const host = document.getElementById('pd-host');
      const h = host?.shadowRoot?.querySelector<HTMLElement>(`[data-testid="pd-handle-${d}"]`);
      if (!h) return null;
      const r = h.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, dir);

  let prev = await read();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(50);
    const cur = await read();
    if (cur && prev && Math.abs(cur.x - prev.x) < 0.5 && Math.abs(cur.y - prev.y) < 0.5) {
      return cur;
    }
    prev = cur;
  }
  if (!prev) throw new Error(`handle ${dir} not found`);
  return prev;
}

/** 从句柄中心拖拽 (ddx,ddy)：hover→down→分段 move→up，负载下更可靠触发缩放 */
async function dragHandle(page: Page, dir: string, ddx: number, ddy: number): Promise<void> {
  const c = await stableHandleCenter(page, dir);
  await page.mouse.move(c.x, c.y);
  await page.mouse.down();
  await page.mouse.move(c.x + ddx / 2, c.y + ddy / 2, { steps: 8 });
  await page.mouse.move(c.x + ddx, c.y + ddy, { steps: 8 });
  await page.mouse.up();
}

test('①  移动模式单击组件 → selbox + 8 句柄出现', async () => {
  const page = await openFixturePage();

  await expandToolbar(page);
  await enterMoveMode(page);

  // 获取 card-buttons 的位置，单击进入
  const cardRect = await page.evaluate(() => {
    const el = document.getElementById('card-buttons')!;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  await page.mouse.click(cardRect.cx, cardRect.cy);

  // 等 selbox 出现
  await waitShadowTestId(page, 'pd-selbox');

  // 验证 8 个句柄都在
  for (const dir of ['tl', 'tr', 'bl', 'br', 'tm', 'bm', 'ml', 'mr']) {
    const exists = await shadowTestIdExists(page, `pd-handle-${dir}`);
    expect(exists, `handle ${dir} should exist`).toBe(true);
  }

  await page.close();
});

test('②  拖 br 句柄 → 目标元素 width + height 变大', async () => {
  const page = await openFixturePage();

  await expandToolbar(page);
  await enterMoveMode(page);

  // 单击 card-buttons 选中
  const cardInfo = await page.evaluate(() => {
    const el = document.getElementById('card-buttons')!;
    const r = el.getBoundingClientRect();
    const cs = window.getComputedStyle(el);
    return {
      cx: r.left + r.width / 2,
      cy: r.top + r.height / 2,
      w: parseFloat(cs.width),
      h: parseFloat(cs.height),
    };
  });

  await page.mouse.click(cardInfo.cx, cardInfo.cy);
  await waitShadowTestId(page, 'pd-selbox');

  // 拖 br 句柄放大（稳定读句柄坐标 + 分段拖拽，负载下可靠触发缩放）
  await dragHandle(page, 'br', 80, 80);

  // 等待目标元素 computed width/height 变大（通过 computed style 验证）
  await expect.poll(async () => {
    const newW = await page.evaluate(() => {
      const el = document.getElementById('card-buttons');
      if (!el) return 0;
      return parseFloat(window.getComputedStyle(el).width);
    });
    return newW > cardInfo.w + 20;
  }, { timeout: 6000, message: `card-buttons width should grow beyond ${cardInfo.w + 20}` }).toBe(true);

  await page.close();
});

test('③  缩放后目标元素出现位号（尺寸修改进了 store）', async () => {
  const page = await openFixturePage();

  await expandToolbar(page);
  await enterMoveMode(page);

  const cardRect = await page.evaluate(() => {
    const el = document.getElementById('card-buttons')!;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  await page.mouse.click(cardRect.cx, cardRect.cy);
  await waitShadowTestId(page, 'pd-selbox');

  await dragHandle(page, 'br', 80, 80);

  // 等待位号出现（标注进了 store → overlay 渲染位号圆）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-pin"]');
    });
  }, { timeout: 8000, message: 'pin should appear after resize commit' }).toBe(true);

  await page.close();
});

test('④  切回批注 / 收起 → selbox 消失', async () => {
  const page = await openFixturePage();

  await expandToolbar(page);
  await enterMoveMode(page);

  const cardRect = await page.evaluate(() => {
    const el = document.getElementById('card-buttons')!;
    const r = el.getBoundingClientRect();
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  });

  await page.mouse.click(cardRect.cx, cardRect.cy);
  await waitShadowTestId(page, 'pd-selbox');

  // 切回批注模式（再次点移动按钮 = toggle）
  await clickShadowEl(page, 'pd-btn-move');

  // 等 selbox 消失（轮询）
  await expect.poll(async () => {
    return shadowTestIdExists(page, 'pd-selbox');
  }, { timeout: 5000, message: 'selbox should disappear after leaving move mode' }).toBe(false);

  await page.close();
});

test('⑤  多级 +/- 粒度不过冲：连点 + 两次落在正确的 2 级祖先', async () => {
  const page = await openFixturePage();

  await expandToolbar(page); // annotate 模式

  // 单击最内层 #deep-btn 开面板（button 有边框 → smart 基准=自身；offset=0 用原始命中）
  // 滚到视口上部，给面板（随粒度放大而增高/重定位）留出下方空间
  await page.evaluate(() => {
    const el = document.getElementById('deep-btn')!;
    const r = el.getBoundingClientRect();
    window.scrollBy(0, r.top - 120);
  });
  const btnCenter = await page.evaluate(() => {
    const el = document.getElementById('deep-btn')!;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(btnCenter.x, btnCenter.y);
  await waitShadowTestId(page, 'pd-panel');
  // 粒度胶囊应出现（smart 基准）
  await waitShadowTestId(page, 'pd-gran-capsule');

  // 连点 + 两次：offset 0 → +1（#deep-inner）→ +2（#deep-mid）
  // 关键：每次都从稳定的原始命中 #deep-btn + 累加 offset 解析，不从上次目标叠加
  await clickShadowEl(page, 'pd-gran-plus');
  await waitShadowTestId(page, 'pd-panel'); // 面板重开
  await waitShadowTestId(page, 'pd-gran-plus'); // 胶囊仍在
  await clickShadowEl(page, 'pd-gran-plus');
  await waitShadowTestId(page, 'pd-panel');

  // 保存
  await clickShadowEl(page, 'pd-panel-save');
  await waitShadowTestId(page, 'pd-pin');

  // 断言标注框覆盖 #deep-mid（正确的 2 级祖先），而非过冲到 #deep-outer
  const midRect = await page.evaluate(() => {
    const el = document.getElementById('deep-mid')!;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });
  const outerRect = await page.evaluate(() => {
    const el = document.getElementById('deep-outer')!;
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  });

  // markbox 相对目标外扩 3px（MARK_INSET），用宽度区分 mid vs outer。
  // 轮询等 markbox 定位稳定（负载下 overlay 定位可能有一帧延迟）。
  await expect.poll(async () => {
    const w = await page.evaluate(() => {
      const host = document.getElementById('pd-host');
      const el = host?.shadowRoot?.querySelector<HTMLElement>('[data-testid="pd-markbox"]');
      return el ? el.getBoundingClientRect().width : -1;
    });
    return w > 0 && Math.abs(w - midRect.width) < Math.abs(w - outerRect.width) && Math.abs(w - midRect.width) < 12;
  }, {
    timeout: 6000,
    message: `markbox width should match #deep-mid ${midRect.width}, not #deep-outer ${outerRect.width}`,
  }).toBe(true);

  await page.close();
});

/** 选中 #snap-b（滚入视口，返回其视口中心坐标） */
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
  await waitShadowTestId(page, 'pd-selbox');
  return c;
}

test('⑥  拖选中元素本体 → transform 出 translate、松手出位号', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await enterMoveMode(page);

  const c = await selectSnapB(page);

  // 拖本体：mousedown 在元素中心 → move 一段明显位移 → up
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  await page.mouse.move(c.cx + 40, c.cy + 30, { steps: 12 });

  // 拖拽中 transform 应含 translate
  await expect.poll(async () => {
    return page.evaluate(() => {
      const el = document.getElementById('snap-b');
      return el ? el.style.transform : '';
    });
  }, { timeout: 5000, message: 'snap-b transform should contain translate during drag' }).toContain('translate');

  await page.mouse.up();

  // 松手出位号（move 记入 store）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-pin"]');
    });
  }, { timeout: 8000, message: 'pin should appear after move commit' }).toBe(true);

  await page.close();
});

test('⑦  拖到与另一元素对齐处 → 参考线出现', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await enterMoveMode(page);

  const c = await selectSnapB(page);

  // #snap-b 左 130，#snap-a 左 120。拖 b 向左 10px → 左边缘对齐 a → 触发竖参考线
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  // 逐步移到左对齐附近（-10px），末步落在阈值内
  await page.mouse.move(c.cx - 10, c.cy - 118, { steps: 15 });

  // 参考线出现（吸附命中）
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-guide"]');
    });
  }, { timeout: 5000, message: 'guide should appear when edges align' }).toBe(true);

  await page.mouse.up();
  await page.close();
});

test('⑧  按 Alt 拖 → 无参考线 + 出 free hint', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await enterMoveMode(page);

  const c = await selectSnapB(page);

  // 按住 Alt 拖到本会触发对齐的位置：free move 应跳过吸附、无参考线、显 free hint
  await page.keyboard.down('Alt');
  await page.mouse.move(c.cx, c.cy);
  await page.mouse.down();
  await page.mouse.move(c.cx - 10, c.cy - 118, { steps: 15 });

  // free hint 出现
  await expect.poll(async () => {
    return page.evaluate(() => {
      const host = document.getElementById('pd-host');
      return !!host?.shadowRoot?.querySelector('[data-testid="pd-freehint"]');
    });
  }, { timeout: 5000, message: 'free hint should appear when dragging with Alt' }).toBe(true);

  // 无参考线
  const hasGuide = await page.evaluate(() => {
    const host = document.getElementById('pd-host');
    return !!host?.shadowRoot?.querySelector('[data-testid="pd-guide"]');
  });
  expect(hasGuide, 'no guide should appear in free move').toBe(false);

  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.close();
});

test('⑨  移动模式鼠标悬浮未选中元素 → 圆角高亮框出现', async () => {
  const page = await openFixturePage();
  await expandToolbar(page);
  await enterMoveMode(page);

  // 悬浮 card-buttons（未点击选中）→ 应出现 pd-move-hover 圆角框
  const c = await page.evaluate(() => {
    const el = document.getElementById('card-buttons')!;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(c.x, c.y);

  await expect.poll(async () => {
    return shadowTestIdExists(page, 'pd-move-hover');
  }, { timeout: 5000, message: 'move-mode hover box should appear on hover' }).toBe(true);

  // 未选中态：不应有 selbox
  const hasSelbox = await shadowTestIdExists(page, 'pd-selbox');
  expect(hasSelbox, 'no selbox before click').toBe(false);

  await page.close();
});
