/**
 * Generate PWA icons from SVG
 *
 * This script converts icon.svg to PNG files at different sizes.
 *
 * Requirements:
 * - Node.js
 * - sharp package: npm install sharp
 *
 * Usage:
 * node scripts/generate-icons.js
 */

import sharp from 'sharp';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = join(__dirname, '..', 'public');

const svgBuffer = readFileSync(join(publicDir, 'icon.svg'));

const sizes = [
  { name: 'icon-192.png', size: 192 },
  { name: 'icon-512.png', size: 512 },
  { name: 'apple-touch-icon.png', size: 180 },
];

console.log('🎨 Generating PWA icons...\n');

Promise.all(
  sizes.map(async ({ name, size }) => {
    await sharp(svgBuffer)
      .resize(size, size)
      .png()
      .toFile(join(publicDir, name));

    console.log(`✅ Generated ${name} (${size}x${size})`);
  })
)
  .then(() => {
    console.log('\n✨ All icons generated successfully!');
    console.log('\nGenerated files:');
    console.log('  - /public/icon-192.png');
    console.log('  - /public/icon-512.png');
    console.log('  - /public/apple-touch-icon.png');
  })
  .catch((error) => {
    console.error('❌ Error generating icons:', error);
    process.exit(1);
  });
