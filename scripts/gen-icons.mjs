/* ============================================================
   gen-icons.mjs — 生成扩展图标（浏览器工具栏 / 扩展管理页）
   品牌标记：邮政金圆角方形徽章 + 居中白色品牌鸽。
   金色取自 src/content/design-tokens.css 的 --c1（悬浮球背景 var(--c1)）。
   鸽子矢量取自 src/content/logo.ts / public/brand/logo.svg（同一路径）。

   做法：先把白鸽高分辨率栅格化并 trim 到真实内容包围盒（自动处理
   旋转 transform 与描边溢出），再按目标尺寸缩放并带留白居中合成到
   金色圆角方形背景上，输出到 public/icons/。
   运行：node scripts/gen-icons.mjs
   ============================================================ */
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = resolve(__dirname, '../public/icons');

// 悬浮球背景色 var(--c1)（亮色主题 · 邮政金）
const GOLD = '#b8842c';
// 鸽子描边色（任务要求：图标内用纯白）
const PIGEON = '#ffffff';

const SIZES = [16, 32, 48, 128];
const CORNER_FRAC = 0.22; // 圆角方形圆角 = 22% 边长（squircle 观感）
const INNER_FRAC = 0.76; // 鸽子内容框 = 76% 画布（约 12% 四周留白）

// 与 src/content/logo.ts 的 LOGO_SVG 同一矢量，仅把 stroke 设为白色。
const PIGEON_PATH =
  'M78 387.5C152.631 368.891 76.4167 392.232 49.7159 390.136C29.1717 388.523 9.13425 371.072 2.55369 390.136C-12.5464 433.88 43.4887 557.5 61.4994 557.5C97.5603 557.5 95.1332 499.399 184.592 475.119C256.159 455.694 409.626 508.071 456.782 345.043C503.939 182.015 572.94 180.281 582.476 175.078C592.011 169.875 556.99 105.184 472.386 130.853C450.907 137.369 435.465 148.71 424.171 156.868C399.875 174.416 397.5 180 389 185.5C380.5 191 368.5 203 313.753 182.016C259.005 161.031 242.331 146.042 189.5 107C156.829 82.8558 176 96.4999 75.369 10.3161C-25.262 -75.8676 145.757 407.479 184.592 365.855C197.353 352.189 196.253 346.982 199.328 332.903C205.612 304.136 206.358 271.572 217.532 286.943C224.842 296.998 237.881 316.154 248.739 335.504C262.601 360.21 276.478 376.261 284.28 374.527C292.081 372.793 325.888 347.298 325.888 335.504C325.888 331.568 324.906 329.488 317.921 320.623C315.251 317.234 311.705 312.855 307 307C287.143 282.288 243.751 226.465 280 273';
const PIGEON_TRANSFORM =
  'matrix(0.996195,-0.0871557,0.0871557,0.996195,0,50.899)';

// 高分辨率白鸽 SVG（原始 viewBox，保真 in-app 渲染的裁切范围）
const RENDER_W = 2000;
const RENDER_H = Math.round((2000 * 618.433) / 630.367);
const pigeonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER_W}" height="${RENDER_H}" viewBox="0 0 630.367 618.433" fill="none" stroke="${PIGEON}" stroke-width="35" stroke-linecap="round" stroke-linejoin="round"><path d="${PIGEON_PATH}" transform="${PIGEON_TRANSFORM}"/></svg>`;

function goldBadgeSvg(size) {
  const r = Math.round(size * CORNER_FRAC);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${GOLD}"/></svg>`;
}

async function main() {
  // 1) 白鸽高分辨率栅格 → trim 到真实内容包围盒
  const trimmed = await sharp(Buffer.from(pigeonSvg)).trim().png().toBuffer();
  const tm = await sharp(trimmed).metadata();
  console.log(
    `trimmed pigeon content box: ${tm.width}x${tm.height} (aspect ${(tm.width / tm.height).toFixed(3)})`,
  );

  // 2) 每个尺寸：金色圆角方形背景 + 缩放并居中合成白鸽
  for (const size of SIZES) {
    const inner = Math.round(size * INNER_FRAC);
    const pigeon = await sharp(trimmed)
      .resize(inner, inner, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const out = resolve(ICONS_DIR, `icon${size}.png`);
    await sharp(Buffer.from(goldBadgeSvg(size)))
      .composite([{ input: pigeon, gravity: 'center' }])
      .png()
      .toFile(out);
    console.log(`wrote ${out} (${size}x${size}, inner ${inner})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
