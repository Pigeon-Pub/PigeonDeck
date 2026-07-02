/**
 * extension.ts — E2E 测试帮助函数
 * 加载 dist/ 目录下的 Chrome 扩展，提供 Shadow DOM 穿透工具。
 */

import { chromium, BrowserContext, Page } from '@playwright/test';
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.resolve(__dirname, '..', '..', '..', 'dist');
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures');

/** 启动带扩展的 Chromium（持久化上下文） */
export async function launchExtensionBrowser(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const userDataDir = path.join(DIST_DIR, '..', '.playwright-profile');
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // Chrome 扩展要求非 headless（或使用新 headless 模式）
    args: [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    viewport: { width: 1280, height: 720 },
  });

  // 获取扩展 ID（等待 service worker 启动）
  let extensionId = '';
  const timeout = Date.now() + 10000;
  while (!extensionId && Date.now() < timeout) {
    const workers = context.serviceWorkers();
    for (const worker of workers) {
      const match = worker.url().match(/chrome-extension:\/\/([^/]+)/);
      if (match) {
        extensionId = match[1];
        break;
      }
    }
    if (!extensionId) {
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  if (!extensionId) {
    // 尝试从打开的背景页获取
    for (const page of context.pages()) {
      const match = page.url().match(/chrome-extension:\/\/([^/]+)/);
      if (match) {
        extensionId = match[1];
        break;
      }
    }
  }

  return { context, extensionId };
}

/** 静态文件 HTTP 服务器（随机端口） */
export interface TestServer {
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export async function startFixtureServer(): Promise<TestServer> {
  const server = http.createServer((req, res) => {
    const urlPath = req.url === '/' ? '/basic.html' : (req.url ?? '/basic.html');
    const filePath = path.join(FIXTURES_DIR, urlPath);

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const ext = path.extname(filePath);
      const contentType =
        ext === '.html' ? 'text/html' :
        ext === '.js' ? 'application/javascript' :
        ext === '.css' ? 'text/css' :
        'application/octet-stream';

      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve(addr.port);
      } else {
        reject(new Error('Failed to get server port'));
      }
    });
  });

  return {
    port,
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    }),
  };
}

/**
 * 获取 Shadow DOM 内的元素（Playwright 原生支持穿透 open shadow DOM）。
 * 直接使用 page.locator() 即可穿透 open shadow，无需特殊工具。
 *
 * Shadow DOM 宿主选择器示例：'#pd-host'
 * Shadow root 内部：page.locator('#pd-host >> css=.pd-ball')
 */
export function getShadowLocator(page: Page, selector: string) {
  // Playwright 自动穿透 open shadow DOM
  return page.locator(selector);
}

/** 等待 Shadow DOM 宿主注入完成 */
export async function waitForExtensionInjected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => !!document.getElementById('pd-host'),
    { timeout: 10000 }
  );
}

/** 在 shadow root 内查询元素（返回 page.locator） */
export function shadowLocator(page: Page, cssSelector: string) {
  // Playwright 穿透 open shadow DOM：使用 >> 语法
  return page.locator(`#pd-host >> css=${cssSelector}`);
}
