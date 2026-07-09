// Render the built onboarding page (as a real extension page) to a full-page PNG.
// Usage: node scripts/shot-onboarding.mjs <lang> <out.png>   e.g. en-US assets/tmp/onboarding-en.png
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const DIST = path.resolve('dist');
const PROFILE = path.resolve('.playwright-profile');
const LANG = process.argv[2] || 'en-US';
const OUT = path.resolve(process.argv[3] || 'assets/tmp/onboarding.png');
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.rmSync(PROFILE, { recursive: true, force: true });

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox', '--disable-dev-shm-usage', `--lang=${LANG}`],
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 2,
  locale: LANG,
});

let id = '';
const t0 = Date.now();
while (!id && Date.now() - t0 < 10000) {
  for (const w of ctx.serviceWorkers()) { const m = w.url().match(/chrome-extension:\/\/([^/]+)/); if (m) { id = m[1]; break; } }
  if (!id) await new Promise((r) => setTimeout(r, 200));
}

const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/onboarding.html`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1200); // let entrance animations settle + webp decode
await page.screenshot({ path: OUT, fullPage: true });
console.log('wrote', OUT);
await ctx.close();
