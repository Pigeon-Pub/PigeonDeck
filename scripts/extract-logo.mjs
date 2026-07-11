/**
 * Extract logo assets using Playwright.
 * Outputs:
 *   public/brand/logo-full.png  — mark + wordmark lockup, transparent bg, 3x
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const lockupUrl = 'file:///' + join(root, 'scripts/logo-lockup.html').replace(/\\/g, '/');

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 3 });

await page.goto(lockupUrl);
await page.waitForLoadState('networkidle');
await page.waitForTimeout(600);

const el = page.locator('.lockup');
await el.screenshot({
  path: join(root, 'public/brand/logo-full.png'),
  omitBackground: true,
});

await browser.close();
console.log('Done → public/brand/logo-full.png');
