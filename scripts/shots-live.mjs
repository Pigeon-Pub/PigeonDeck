// Capture PigeonDeck *in use* on the real PigeonLib site (app/dist), at 2x.
// Serves the built PigeonLib statically, loads the built PigeonDeck extension,
// drives real interactions, screenshots each state. Each shot uses a fresh page.
import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist'); // PigeonDeck built extension
const PROFILE = path.resolve('.playwright-profile');
const SITE = 'C:/Users/HELUOO/Desktop/CODE/Claude/Pigeon_Library/app/dist';
const UI_LANG = process.argv[2] || '';      // e.g. en-US / zh-CN — sets chrome.i18n UI locale
const SUB = process.argv[3] || '';          // output subdir under live/
const OUT = path.resolve('assets/screenshots/live' + (SUB ? '/' + SUB : ''));
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.woff2': 'font/woff2',
  '.woff': 'font/woff', '.ttf': 'font/ttf', '.pigeon': 'application/zip',
  '.md': 'text/plain', '.ico': 'image/x-icon',
};

function startServer(dir) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url || '/').split('?')[0]);
    if (p === '/') p = '/index.html';
    let fp = path.join(dir, p);
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) fp = path.join(fp, 'index.html');
    fs.readFile(fp, (err, data) => {
      if (err) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(fp).toLowerCase()] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

// ---- shadow helpers (run in page context) ----
const rectByTestId = (page, id) => page.evaluate((tid) => {
  const el = document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${tid}"]`);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height };
}, id);

async function clickShadow(page, id) {
  const r = await rectByTestId(page, id);
  if (!r) throw new Error(`shadow el not found: ${id}`);
  await page.mouse.click(r.x + r.w / 2, r.y + r.h / 2);
}

const waitShadow = (page, tid, timeout = 8000) => page.waitForFunction((t) => {
  const el = document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${t}"]`);
  if (!el) return false;
  const s = getComputedStyle(el);
  return s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0';
}, tid, { timeout });

async function clickPage(page, sel) {
  const box = await page.locator(sel).first().boundingBox();
  if (!box) throw new Error(`page el not found: ${sel}`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

async function annotate(page, sel, note) {
  await clickPage(page, sel);
  await waitShadow(page, 'pd-panel');
  await page.waitForTimeout(250);
  await clickShadow(page, 'pd-panel-note').catch(() => {});
  await page.keyboard.type(note, { delay: 8 });
  await clickShadow(page, 'pd-panel-save');
  await waitShadow(page, 'pd-pin');
  await page.waitForTimeout(200);
}

async function expand(page) {
  await clickShadow(page, 'pd-ball');
  await waitShadow(page, 'pd-toolbar');
  await page.waitForTimeout(300);
}

// ---- main ----
const site = await startServer(SITE);
const HOME = `http://127.0.0.1:${site.port}/index.html`;
fs.rmSync(PROFILE, { recursive: true, force: true });

const args = [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, '--no-sandbox', '--disable-dev-shm-usage'];
if (UI_LANG) args.push(`--lang=${UI_LANG}`);

const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: false,
  args,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  locale: UI_LANG || undefined,
});

// The extension's own i18n runtime reads chrome.storage.local 'uiLocale' (default zh_CN).
// Set it via the extension service worker before opening pages so the UI renders in the right language.
{
  const uiLocale = UI_LANG.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
  let sw = ctx.serviceWorkers()[0];
  const t0 = Date.now();
  while (!sw && Date.now() - t0 < 10000) { await new Promise((r) => setTimeout(r, 200)); sw = ctx.serviceWorkers()[0]; }
  if (sw) { await sw.evaluate((loc) => chrome.storage.local.set({ uiLocale: loc }), uiLocale); }
  console.log('uiLocale set to', uiLocale, sw ? '(via SW)' : '(no SW found)');
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

const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) }).then(() => console.log('OK', name));

async function run(name, fn) {
  const page = await newHome();
  try { await fn(page); console.log('done', name); }
  catch (e) { console.log('FAIL', name, String(e).split('\n')[0]); }
  finally { await page.close().catch(() => {}); }
}

// 1) toolbar expanded on the real page
await run('01-toolbar-expanded.png', async (p) => { await expand(p); await shot(p, '01-toolbar-expanded.png'); });

// 2) annotating the hero headline — panel open with a typed instruction (signature shot)
await run('02-annotate.png', async (p) => {
  await expand(p);
  await clickPage(p, '#heroTitle');
  await waitShadow(p, 'pd-panel');
  await p.waitForTimeout(300);
  await clickShadow(p, 'pd-panel-note').catch(() => {});
  await p.keyboard.type('Make this headline larger and center it.', { delay: 12 });
  await p.waitForTimeout(200);
  await shot(p, '02-annotate.png');
});

// 3) two saved pins + an open card (the result on a real page)
await run('03-pins-card.png', async (p) => {
  await expand(p);
  await annotate(p, '#heroTitle', 'Make this headline larger and center it.');
  await annotate(p, '.hero-actions .btn-primary', 'Rebrand this button gold with a softer radius.');
  await clickShadow(p, 'pd-pin'); // open first card
  await waitShadow(p, 'pd-card');
  await p.waitForTimeout(250);
  await shot(p, '03-pins-card.png');
});

// 4) editing styles — advanced style panel over the real page
await run('05-advanced-styles.png', async (p) => {
  await expand(p);
  await clickPage(p, '.hero-actions .btn-primary');
  await waitShadow(p, 'pd-panel');
  await p.waitForTimeout(250);
  await clickShadow(p, 'pd-adv-toggle');
  await waitShadow(p, 'pd-advbox');
  await clickShadow(p, 'pd-adv-nav-appearance').catch(() => {});
  await p.waitForTimeout(400);
  await shot(p, '05-advanced-styles.png');
});

// 5) move mode — selection box with 8 handles on a component
await run('06-move-selbox.png', async (p) => {
  await expand(p);
  await clickShadow(p, 'pd-btn-move');
  await p.waitForTimeout(200);
  await clickPage(p, '.hero-actions .btn-primary');
  await waitShadow(p, 'pd-selbox');
  await p.waitForTimeout(250);
  await shot(p, '06-move-selbox.png');
});

// 6) copy text — the AI task-list output panel over the page
await run('08-copy-text.png', async (p) => {
  await expand(p);
  await annotate(p, '#heroTitle', 'Make this headline larger and center it.');
  await annotate(p, '.hero-actions .btn-primary', 'Rebrand this button gold; move it below the sidebar.');
  await clickShadow(p, 'pd-btn-copy-text');
  await waitShadow(p, 'pd-output');
  await p.waitForTimeout(400);
  await shot(p, '08-copy-text.png');
});

await ctx.close();
await site.close();
console.log('all done');
