/**
 * generate_icons.js  (Node.js one-shot helper)
 *
 * Run this ONCE with:   node generate_icons.js
 *
 * It reads icon_source.png and writes:
 *   ../icons/icon16.png
 *   ../icons/icon48.png
 *   ../icons/icon128.png
 *
 * Requires the `sharp` package:
 *   npm install sharp --save-dev
 *
 * If you don't want to run Node, you can manually resize
 * any square PNG to 16×16, 48×48, and 128×128 and place
 * the results in the icons/ folder.
 */

const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const SRC  = path.join(__dirname, 'icon_source.png');
const DEST = path.join(__dirname, '..', 'icons');

if (!fs.existsSync(DEST)) fs.mkdirSync(DEST, { recursive: true });

const sizes = [16, 48, 128];

(async () => {
  for (const size of sizes) {
    const out = path.join(DEST, `icon${size}.png`);
    await sharp(SRC).resize(size, size).png().toFile(out);
    console.log(`✓ icons/icon${size}.png`);
  }
  console.log('Icons generated successfully.');
})();
