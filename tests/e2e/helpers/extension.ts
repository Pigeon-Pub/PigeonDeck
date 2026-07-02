/**
 * extension.ts - E2E test helper functions
 * Loads the dist/ Chrome extension, provides Shadow DOM utilities.
 */

import { chromium, BrowserContext, Page } from '@playwright/test';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

const DIST_DIR = path.resolve(__dirname, '..', '..', '..', 'dist');
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures');

/** Launch Chromium with the extension loaded (persistent context) */
export async function launchExtensionBrowser(): Promise<{
  context: BrowserContext;
  extensionId: string;
}> {
  const userDataDir = path.join(DIST_DIR, '..', '.playwright-profile');
  fs.mkdirSync(userDataDir, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${DIST_DIR}`,
      `--load-extension=${DIST_DIR}`,
      '--no-sandbox',
      '--disable-dev-shm-usage',
    ],
    viewport: { width: 1280, height: 720 },
  });

  // Get extension ID from service worker URL
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

  // Fallback: try existing pages
  if (!extensionId) {
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

/** Local static file server for fixtures */
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
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

/** Wait for the extension's Shadow DOM host to be injected */
export async function waitForExtensionInjected(page: Page): Promise<void> {
  await page.waitForFunction(() => !!document.getElementById('pd-host'), {
    timeout: 10000,
  });
}

/** Get bounding rect of an element inside the Shadow DOM */
export async function getShadowElementRect(
  page: Page,
  testId: string
): Promise<{ x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number } | null> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return null;
    const el = host.shadowRoot.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      top: r.top,
      right: r.right,
      bottom: r.bottom,
      left: r.left,
    };
  }, testId);
}

/** Click an element inside the Shadow DOM by data-testid */
export async function clickShadowEl(page: Page, testId: string): Promise<void> {
  const rect = await getShadowElementRect(page, testId);
  if (!rect) throw new Error(`Shadow element not found: ${testId}`);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/** Check if an element inside Shadow DOM is visible */
export async function isShadowElVisible(page: Page, testId: string): Promise<boolean> {
  return page.evaluate((id: string) => {
    const host = document.getElementById('pd-host');
    if (!host?.shadowRoot) return false;
    const el = host.shadowRoot.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!el) return false;
    const style = getComputedStyle(el);
    return (
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      style.opacity !== '0'
    );
  }, testId);
}
