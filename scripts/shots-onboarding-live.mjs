// Capture TIGHT-CROPPED PigeonDeck shots for the onboarding page.
// Same real driving as shots-live, but screenshots are clipped to the actual
// PigeonDeck UI bounds (panel / selbox / pins / output) and written straight to
// public/onboarding/<lang>/<shot>.webp. Usage: node scripts/shots-onboarding-live.mjs <lang> <sub>
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const PROFILE = path.resolve('.playwright-profile');
const SITE = 'C:/Users/HELUOO/Desktop/CODE/Claude/Pigeon_Library/app/dist';
const UI_LANG = process.argv[2] || 'en-US';
const SUB = process.argv[3] || 'en';
const OUT = path.resolve('public/onboarding', SUB);
fs.mkdirSync(OUT, { recursive: true });
const VW = 1440, VH = 900;

const MIME = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.pigeon':'application/zip','.md':'text/plain','.ico':'image/x-icon' };
function startServer(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    let fp = path.join(dir, p);
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('nf'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, close: () => new Promise((x) => server.close(x)) })));
}

const rect = (page, id) => page.evaluate((tid) => {
  const el = document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${tid}"]`);
  if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height };
}, id);
async function clickShadow(page, id) { const r = await rect(page, id); if (!r) throw new Error('no ' + id); await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2); }
const waitShadow = (page, tid, t = 8000) => page.waitForFunction((x) => { const e = document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${x}"]`); if (!e) return false; const s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'; }, tid, { timeout: t });
async function clickPage(page, sel) { const b = await page.locator(sel).first().boundingBox(); if (!b) throw new Error('no ' + sel); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); }
async function expand(page) { await clickShadow(page, 'pd-ball'); await waitShadow(page, 'pd-toolbar'); await page.waitForTimeout(300); }
async function annotate(page, sel, note) {
  await clickPage(page, sel); await waitShadow(page, 'pd-panel'); await page.waitForTimeout(250);
  await clickShadow(page, 'pd-panel-note').catch(() => {}); await page.keyboard.type(note, { delay: 6 });
  await clickShadow(page, 'pd-panel-save'); await waitShadow(page, 'pd-pin'); await page.waitForTimeout(180);
}

// union bounding rect of all elements matching the given testids, in viewport px
const unionRect = (page, tids) => page.evaluate((ids) => {
  const root = document.getElementById('pd-host')?.shadowRoot; if (!root) return null;
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0;
  for (const id of ids) for (const el of root.querySelectorAll(`[data-testid="${id}"]`)) {
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); n++;
  }
  return n ? { x0, y0, x1, y1 } : null;
}, tids);

function clampClip(u, padL, padT, padR, padB) {
  const x = Math.max(0, Math.floor(u.x0 - padL));
  const y = Math.max(0, Math.floor(u.y0 - padT));
  const x1 = Math.min(VW, Math.ceil(u.x1 + padR));
  const y1 = Math.min(VH, Math.ceil(u.y1 + padB));
  return { x, y, width: x1 - x, height: y1 - y };
}

const site = await startServer(SITE);
const HOME = `http://127.0.0.1:${site.port}/index.html`;
fs.rmSync(PROFILE, { recursive: true, force: true });
const args = [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox', '--disable-dev-shm-usage', `--lang=${UI_LANG}`];
const ctx = await chromium.launchPersistentContext(PROFILE, { headless: false, args, viewport: { width: VW, height: VH }, deviceScaleFactor: 2, locale: UI_LANG });
{
  const loc = UI_LANG.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
  let sw = ctx.serviceWorkers()[0]; const t0 = Date.now();
  while (!sw && Date.now() - t0 < 10000) { await new Promise((r) => setTimeout(r, 200)); sw = ctx.serviceWorkers()[0]; }
  if (sw) await sw.evaluate((l) => chrome.storage.local.set({ uiLocale: l }), loc);
}

async function newHome() {
  const page = await ctx.newPage();
  await page.goto(HOME, { waitUntil: 'load' });
  await page.waitForFunction(() => !!document.getElementById('pd-host'), null, { timeout: 15000 });
  await page.waitForSelector('.hero h1', { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => localStorage.removeItem('pigeondeck.pos'));
  await page.waitForTimeout(500);
  return page;
}
async function save(page, clip, name) {
  const buf = await page.screenshot({ clip });
  await sharp(buf).resize({ width: 1200, withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(OUT, name + '.webp'));
  console.log('OK', SUB, name, `${Math.round(clip.width)}x${Math.round(clip.height)}`);
}
async function run(name, fn) { const p = await newHome(); try { await fn(p); } catch (e) { console.log('FAIL', name, String(e).split('\n')[0]); } finally { await p.close().catch(() => {}); } }

// 01 toolbar: rail + adjacent page context
await run('01-toolbar-expanded', async (p) => {
  await expand(p);
  const tb = await rect(p, 'pd-toolbar');
  const clip = { x: Math.max(0, Math.floor(tb.x - 560)), y: Math.max(0, Math.floor(tb.y - 40)), width: 0, height: 0 };
  clip.width = Math.min(VW, Math.ceil(tb.x + tb.w + 34)) - clip.x;
  clip.height = Math.min(VH, Math.ceil(tb.y + tb.h + 40)) - clip.y;
  await save(p, clip, '01-toolbar-expanded');
});
// 02 annotate: panel + selected element box
await run('02-annotate', async (p) => {
  await expand(p);
  await clickPage(p, '#heroTitle'); await waitShadow(p, 'pd-panel'); await p.waitForTimeout(300);
  await clickShadow(p, 'pd-panel-note').catch(() => {});
  await p.keyboard.type('Make this headline larger and center it.', { delay: 10 });
  await p.waitForTimeout(200);
  const u = await unionRect(p, ['pd-panel', 'pd-selbox']);
  await save(p, clampClip(u, 40, 40, 40, 40), '02-annotate');
});
// 03 pins + card
await run('03-pins-card', async (p) => {
  await expand(p);
  await annotate(p, '#heroTitle', 'Make this headline larger and center it.');
  await annotate(p, '.hero-actions .btn-primary', 'Rebrand this button gold with a softer radius.');
  await clickShadow(p, 'pd-pin'); await waitShadow(p, 'pd-card'); await p.waitForTimeout(250);
  const u = await unionRect(p, ['pd-pin', 'pd-card', 'pd-markbox']);
  await save(p, clampClip(u, 48, 40, 48, 40), '03-pins-card');
});
// 05 advanced styles
await run('05-advanced-styles', async (p) => {
  await expand(p);
  await clickPage(p, '.hero-actions .btn-primary'); await waitShadow(p, 'pd-panel'); await p.waitForTimeout(250);
  await clickShadow(p, 'pd-adv-toggle'); await waitShadow(p, 'pd-advbox');
  await clickShadow(p, 'pd-adv-nav-appearance').catch(() => {}); await p.waitForTimeout(400);
  const u = await unionRect(p, ['pd-panel', 'pd-advbox']);
  await save(p, clampClip(u, 40, 40, 40, 40), '05-advanced-styles');
});
// 08 copy text output
await run('08-copy-text', async (p) => {
  await expand(p);
  await annotate(p, '#heroTitle', 'Make this headline larger and center it.');
  await annotate(p, '.hero-actions .btn-primary', 'Rebrand this button gold; move it below the sidebar.');
  await clickShadow(p, 'pd-btn-copy-text'); await waitShadow(p, 'pd-output'); await p.waitForTimeout(400);
  const u = await unionRect(p, ['pd-output']);
  await save(p, clampClip(u, 34, 34, 34, 34), '08-copy-text');
});

await ctx.close();
await site.close();
console.log('onboarding crops done:', SUB);
