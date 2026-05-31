/**
 * Honoka icon generator
 * Produces 16/48/128 PNG icons matching the overlay UI theme.
 *
 * Usage: node scripts/generate-icons.mjs
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ICONS_DIR = path.resolve(__dirname, "..", "icons");

const SIZES = [16, 48, 128];

function buildSvg(size) {
  const strokeWidth = Math.max(2, Math.round(size * 0.04));
  const ringGap = Math.round(size * 0.07);

  const dotR = Math.max(1, Math.round(size * 0.02));

  // Ring: not full (75% arc) to suggest "budget remaining"
  const ringR = Math.round(size * 0.34);
  const cx = size / 2;
  const cy = size / 2;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="ring" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#4db8ff"/>
      <stop offset="100%" stop-color="#0f3460"/>
    </linearGradient>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2d2a24"/>
      <stop offset="100%" stop-color="#1a1a18"/>
    </linearGradient>
  </defs>

  <!-- Background circle -->
  <circle cx="${cx}" cy="${cy}" r="${ringR + strokeWidth}" fill="url(#bg)"/>

  <!-- Ring track (dark) -->
  <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none"
    stroke="#555" stroke-width="${strokeWidth}"
    stroke-dasharray="${Math.PI * ringR * 1.5} ${Math.PI * ringR * 2}"
    stroke-linecap="round"
    transform="rotate(-90 ${cx} ${cy})"/>

  <!-- Ring progress (glowing) -->
  <circle cx="${cx}" cy="${cy}" r="${ringR}" fill="none"
    stroke="url(#ring)" stroke-width="${strokeWidth}"
    stroke-dasharray="${Math.PI * ringR * 1.2} ${Math.PI * ringR * 2}"
    stroke-linecap="round"
    transform="rotate(-90 ${cx} ${cy})"/>

  <!-- H letter (simplified) -->
  <text x="${cx}" y="${cy + Math.round(size * 0.08)}"
    font-family="system-ui, -apple-system, sans-serif"
    font-size="${Math.round(size * 0.38)}" font-weight="700"
    fill="white" text-anchor="middle" dominant-baseline="middle">H</text>
</svg>`;
}

async function generate() {
  if (!fs.existsSync(ICONS_DIR)) {
    fs.mkdirSync(ICONS_DIR, { recursive: true });
  }

  for (const size of SIZES) {
    const svg = buildSvg(size);
    const pngPath = path.join(ICONS_DIR, `icon${size}.png`);

    await sharp(Buffer.from(svg))
      .resize(size, size)
      .png()
      .toFile(pngPath);

    const stat = fs.statSync(pngPath);
    console.log(`✅ icon${size}.png  (${(stat.size / 1024).toFixed(1)} KB)`);
  }

  console.log("\nDone — 3 icons generated.");
}

generate().catch(console.error);
