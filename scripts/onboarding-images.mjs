// Optimize real screenshots into small WebP for the onboarding page (bundled in the extension).
// Reads assets/screenshots/live/{en,zh}/*.png → public/onboarding/{en,zh}/*.webp
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = ['01-toolbar-expanded', '02-annotate', '03-pins-card', '05-advanced-styles', '08-copy-text'];
const WIDTH = 1200;
const QUALITY = 82;

for (const lang of ['en', 'zh']) {
  const inDir = path.resolve('assets/screenshots/live', lang);
  const outDir = path.resolve('public/onboarding', lang);
  fs.mkdirSync(outDir, { recursive: true });
  for (const name of SHOTS) {
    const src = path.join(inDir, name + '.png');
    const out = path.join(outDir, name + '.webp');
    const buf = await sharp(src).resize({ width: WIDTH }).webp({ quality: QUALITY }).toBuffer();
    fs.writeFileSync(out, buf);
    console.log(lang, name, Math.round(buf.length / 1024) + 'KB');
  }
}
console.log('onboarding images done');
