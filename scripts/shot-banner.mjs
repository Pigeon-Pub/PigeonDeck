// Render an HTML banner to a crisp 2x PNG. Usage: node scripts/shot-banner.mjs [in.html] [out.png] [w] [h]
import { chromium } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const inHtml = path.resolve(process.argv[2] ?? 'assets/banner.html');
const outPng = path.resolve(process.argv[3] ?? 'assets/banner.png');
const width = Number(process.argv[4] ?? 1280);
const height = Number(process.argv[5] ?? 400);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(inHtml).href, { waitUntil: 'networkidle' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.screenshot({ path: outPng, clip: { x: 0, y: 0, width, height } });
await browser.close();
console.log('wrote', outPng);
