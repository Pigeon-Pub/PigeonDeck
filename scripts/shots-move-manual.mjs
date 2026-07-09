// Open browser with extension on PigeonLib, enter move mode, wait for user to move manually, then screenshot.
import { chromium } from '@playwright/test';
import sharp from 'sharp';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve('dist');
const PROFILE = path.resolve('.playwright-profile');
const SITE = 'C:/Users/HELUOO/Desktop/CODE/Claude/Pigeon_Library/app/dist';
const VW = 1440, VH = 900;
const WAIT_SEC = 30; // seconds to wait for manual move

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
const args = [`--disable-extensions-except=${DIST}`,`--load-extension=${DIST}`,'--no-sandbox','--disable-dev-shm-usage'];
const ctx = await chromium.launchPersistentContext(PROFILE, { headless:false, args, viewport:{width:VW,height:VH}, deviceScaleFactor:2 });

const page = await ctx.newPage();
await page.goto(HOME, { waitUntil:'load' });
await page.waitForFunction(()=>!!document.getElementById('pd-host'),null,{timeout:15000});
await page.waitForSelector('.hero h1',{timeout:15000});
await page.evaluate(()=>document.fonts.ready);
await page.evaluate(()=>localStorage.removeItem('pigeondeck.pos'));
await page.waitForTimeout(600);

// expand toolbar + enter move mode
await clickShadow(page, 'pd-ball');
await waitShadow(page, 'pd-toolbar');
await page.waitForTimeout(300);
await clickShadow(page, 'pd-btn-move');
await page.waitForTimeout(200);

console.log(`\n=== 已进入移动模式 ===`);
console.log(`请在浏览器窗口里手动拖动 hero 图片到你满意的位置`);
console.log(`${WAIT_SEC} 秒后自动截图...\n`);

for (let i = WAIT_SEC; i > 0; i--) {
  process.stdout.write(`\r  倒计时 ${i}s `);
  await page.waitForTimeout(1000);
}
console.log('\n截图中...');

const buf = await page.screenshot();
// save as both en and zh (same image)
for (const lang of ['en', 'zh']) {
  const out = path.resolve('assets/screenshots/live', lang, '06-move-selbox.webp');
  await sharp(buf).resize({width:1600,withoutEnlargement:true}).webp({quality:82}).toFile(out);
  console.log('OK', lang, Math.round(fs.statSync(out).size/1024)+'KB');
}

await ctx.close();
await site.close();
console.log('done');
