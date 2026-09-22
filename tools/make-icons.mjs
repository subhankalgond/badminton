/**
 * Renders the site favicon as a shuttlecock mark and writes favicon.ico plus
 * the apple touch icon. Run with: npm run icons
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, encodeIco, encodePng } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(here, '..', 'public');

const GREEN = [15, 107, 63];
const WHITE = [255, 255, 255];

const SKIRT = [
  [0.34, 0.60],
  [0.66, 0.60],
  [0.78, 0.13],
  [0.22, 0.13],
];

function insideRoundedSquare(x, y, radius) {
  const r = radius;
  const cx = Math.min(Math.max(x, r), 1 - r);
  const cy = Math.min(Math.max(y, r), 1 - r);
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insidePolygon(x, y, points) {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i, i += 1) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function insideDisc(x, y, cx, cy, r) {
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function insideBar(x, y, x0, y0, x1, y1, halfWidth) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lengthSquared = dx * dx + dy * dy;
  let t = ((x - x0) * dx + (y - y0) * dy) / lengthSquared;
  t = Math.max(0, Math.min(1, t));
  const px = x0 + t * dx;
  const py = y0 + t * dy;
  const ddx = x - px;
  const ddy = y - py;
  return ddx * ddx + ddy * ddy <= halfWidth * halfWidth;
}

function colourAt(x, y) {
  if (!insideRoundedSquare(x, y, 0.22)) return [0, 0, 0, 0];
  let colour = GREEN;
  if (insidePolygon(x, y, SKIRT)) colour = WHITE;
  if (insideBar(x, y, 0.5, 0.60, 0.5, 0.13, 0.022)) colour = GREEN;
  if (insideBar(x, y, 0.42, 0.60, 0.35, 0.13, 0.017)) colour = GREEN;
  if (insideBar(x, y, 0.58, 0.60, 0.65, 0.13, 0.017)) colour = GREEN;
  if (insideDisc(x, y, 0.5, 0.705, 0.135)) colour = WHITE;
  return [colour[0], colour[1], colour[2], 255];
}

function render(size) {
  const canvas = createCanvas(size, size);
  const samples = 4;
  const step = 1 / (size * samples);

  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;

      for (let sy = 0; sy < samples; sy += 1) {
        for (let sx = 0; sx < samples; sx += 1) {
          const x = px / size + (sx + 0.5) * step;
          const y = py / size + (sy + 0.5) * step;
          const [cr, cg, cb, ca] = colourAt(x, y);
          const alpha = ca / 255;
          r += cr * alpha;
          g += cg * alpha;
          b += cb * alpha;
          a += ca;
        }
      }

      const total = samples * samples;
      const alphaAverage = a / total;
      const weight = alphaAverage > 0 ? 255 / a : 0;
      const offset = (py * size + px) * 4;
      canvas.data[offset] = Math.round(r * weight);
      canvas.data[offset + 1] = Math.round(g * weight);
      canvas.data[offset + 2] = Math.round(b * weight);
      canvas.data[offset + 3] = Math.round(alphaAverage);
    }
  }

  return canvas;
}

const targets = [
  { size: 16, file: null },
  { size: 32, file: null },
  { size: 48, file: null },
  { size: 180, file: 'favicon-180.png' },
];

const icoImages = [];

for (const target of targets) {
  const canvas = render(target.size);
  const png = encodePng(canvas.width, canvas.height, canvas.data);
  if (target.file) {
    fs.writeFileSync(path.join(publicDir, target.file), png);
    console.log('wrote public/' + target.file);
  } else {
    icoImages.push({ size: target.size, png });
  }
}

fs.writeFileSync(path.join(publicDir, 'favicon.ico'), encodeIco(icoImages));
console.log('wrote public/favicon.ico');
