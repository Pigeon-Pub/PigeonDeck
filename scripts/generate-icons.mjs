#!/usr/bin/env node
/**
 * Generate extension PNG icons from public/brand/icon-app.svg using sharp.
 * Usage: node scripts/generate-icons.mjs
 */
import sharp from 'sharp';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const svgBuffer = readFileSync(join(root, 'public/brand/icon-app.svg'));
const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const dest = join(root, `public/icons/icon${size}.png`);
  await sharp(svgBuffer).resize(size, size).png().toFile(dest);
  console.log(`  icon${size}.png`);
}

console.log('Done.');
