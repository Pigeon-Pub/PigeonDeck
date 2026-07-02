/**
 * gen-icons.mjs — 用 sharp 把鸽子 logo 渲染在邮政金圆底上，生成扩展 icon PNG。
 * 运行：node scripts/gen-icons.mjs
 */

import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, '..', 'public', 'icons');

const SIZES = [16, 32, 48, 128];
const BRASS = '#b8842c'; // 邮政金

// 鸽子 SVG path（来自 preview/parts/02-toolbar-default.html）
const PIGEON_PATH = 'M4.6 15.2Q10 9.2 17 10.1Q12.8 14.2 7.4 16.1Q5.7 16.6 4.6 15.2ZM9 12.6Q12 5.9 18.8 5Q16.4 9.8 12.4 11.7Q10.5 12.7 9 12.6ZM16.7 10L20.4 8.9 17.2 11.4Z';

let sharp;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.warn('sharp not available, skipping icon PNG generation.');
  console.warn('Run: npm install sharp');
  process.exit(0);
}

async function generateIcon(size) {
  const padding = Math.round(size * 0.18);
  const innerSize = size - padding * 2;
  const scale = innerSize / 24; // 鸽子 viewBox 是 24x24

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${size / 2}" fill="${BRASS}"/>
  <g transform="translate(${padding},${padding}) scale(${scale})">
    <path d="${PIGEON_PATH}" fill="#fdf6e6"/>
  </g>
</svg>`;

  const pngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  const outPath = path.join(outDir, `icon${size}.png`);
  await fs.writeFile(outPath, pngBuffer);
  console.log(`Generated ${outPath}`);
}

await fs.mkdir(outDir, { recursive: true });
for (const size of SIZES) {
  await generateIcon(size);
}
console.log('Icons generated.');
