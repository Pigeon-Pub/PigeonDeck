// Capture a REAL move shot: drag the hero image downward on PigeonLib, screenshot mid-drag.
// Outputs WebP directly to assets/screenshots/live/<lang>/06-move-selbox.webp (overwrites the static selbox shot).
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
const VW = 1440, VH = 900;

const MIME = { '.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.woff2':'font/woff2','.pigeon':'application/zip','.md':'text/plain' };
function startServer(dir) {
  const s = http.createServer((req, res) => {
    let p = decodeURIComponent((req.url||'/').split('?')[0]); if (p==='/') p='/index.html';
    let fp = path.join(dir, p);
    if (fs.existsSync(fp)&&fs.statSync(fp).isDirectory()) fp=path.join(fp,'index.html');
    fs.readFile(fp,(e,d)=>{if(e){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':MIME[path.extname(fp).toLowerCase()]||'application/octet-stream'});res.end(d);});
  });
  return new Promise(r=>s.listen(0,'127.0.0.1',()=>r({port:s.address().port,close:()=>new Promise(x=>s.close(x))})));
}

const rect=(p,id)=>p.evaluate(t=>{const e=document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${t}"]`);if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height};},id);
async function clickShadow(p,id){const r=await rect(p,id);if(!r)throw new Error('no '+id);await p.mouse.click(r.x+r.w/2,r.y+r.h/2);}
const waitShadow=(p,t,tm=8000)=>p.waitForFunction(x=>{const e=document.getElementById('pd-host')?.shadowRoot?.querySelector(`[data-testid="${x}"]`);if(!e)return false;const s=getComputedStyle(e);return s.display!=='none'&&s.visibility!=='hidden'&&s.opacity!=='0';},t,{timeout:tm});

const site = await startServer(SITE);
const HOME = `http://127.0.0.1:${site.port}/index.html`;
fs.rmSync(PROFILE, { recursive: true, force: true });
const args = [`--disable-extensions-except=${DIST}`,`--load-extension=${DIST}`,'--no-sandbox','--disable-dev-shm-usage',`--lang=${UI_LANG}`];
const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, args, viewport:{width:VW,height:VH}, deviceScaleFactor:2, locale:UI_LANG });

// set extension UI locale
const loc = UI_LANG.toLowerCase().startsWith('zh') ? 'zh_CN' : 'en';
let sw = ctx.serviceWorkers()[0]; const t0=Date.now();
while(!sw&&Date.now()-t0<10000){await new Promise(r=>setTimeout(r,200));sw=ctx.serviceWorkers()[0];}
if(sw) await sw.evaluate(l=>chrome.storage.local.set({uiLocale:l}),loc);

const page = await ctx.newPage();
await page.goto(HOME, { waitUntil:'load' });
await page.waitForFunction(()=>!!document.getElementById('pd-host'),null,{timeout:15000});
await page.waitForSelector('.hero h1',{timeout:15000});
await page.evaluate(()=>document.fonts.ready);
await page.evaluate(()=>localStorage.removeItem('pigeondeck.pos'));
await page.waitForTimeout(600);

// expand toolbar
await clickShadow(page, 'pd-ball');
await waitShadow(page, 'pd-toolbar');
await page.waitForTimeout(300);

// enter move mode
await clickShadow(page, 'pd-btn-move');
await page.waitForTimeout(200);

// Force elementFromPoint to hit exactly .hero-media (not a larger ancestor).
// Suppress pointer-events on the hero section & img, keep only .hero-media responsive.
await page.evaluate(() => {
  const hero = document.querySelector('.hero');
  if (hero) hero.style.pointerEvents = 'none';
  const media = document.querySelector('.hero-media');
  if (media) media.style.pointerEvents = 'auto';
  const img = document.querySelector('.hero-photo');
  if (img) img.style.pointerEvents = 'none';
  // also ensure the moved element won't be clipped
  for (let el = media; el; el = el.parentElement) el.style.overflow = 'visible';
});
const mediaBox = await page.locator('.hero-media').first().boundingBox();
if (!mediaBox) throw new Error('hero-media not found');
await page.mouse.click(mediaBox.x + mediaBox.width/2, mediaBox.y + mediaBox.height/2);
await waitShadow(page, 'pd-selbox');
await page.waitForTimeout(400);

// verify selbox wraps the media container (not the whole hero section)
const selboxRect = await rect(page, 'pd-selbox');
console.log('selbox w×h:', Math.round(selboxRect?.w), '×', Math.round(selboxRect?.h),
  '(media:', Math.round(mediaBox.width), '×', Math.round(mediaBox.height), ')');

// drag LEFT 350px so image clearly overlaps the text area (unmistakable displacement)
const cx = mediaBox.x + mediaBox.width/2;
const cy = mediaBox.y + mediaBox.height/2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx - 350, cy + 80, { steps: 20 });
await page.mouse.up();
await page.waitForTimeout(600);

const hasMoved = await page.evaluate(() => {
  const el = document.querySelector('.hero-media');
  return el ? el.style.transform : 'NO TRANSFORM';
});
console.log('transform:', hasMoved);

// screenshot mid-drag (element displaced + possible guide)
const buf = await page.screenshot();
await page.mouse.up();

// save as webp
const out = path.resolve('assets/screenshots/live', SUB, '06-move-selbox.webp');
await sharp(buf).resize({width:1600,withoutEnlargement:true}).webp({quality:82}).toFile(out);
console.log('OK', SUB, '06-move-selbox.webp', Math.round(fs.statSync(out).size/1024)+'KB');

await ctx.close();
await site.close();
