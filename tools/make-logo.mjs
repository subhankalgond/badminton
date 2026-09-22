/**
 * Prepares the institute crest for the site.
 *
 * The supplied crest is a JPEG, which cannot carry transparency, so it has a
 * solid black background. This tool floods that background from the edges,
 * makes it transparent, trims the empty border and writes a PNG.
 *
 * The flood fill starts at the image edges, so black details inside the crest
 * (outlines, lettering) are kept. The background inside the crest is connected
 * to the outside edge, so it is cleared too.
 *
 * Usage:
 *   node tools/make-logo.mjs <source image> [output png] [max size in pixels]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { encodePng } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const [sourceArg, outputArg, maxSizeArg] = process.argv.slice(2);
const maxSize = Number(maxSizeArg) > 0 ? Number(maxSizeArg) : 320;

if (!sourceArg) {
  console.error('Usage: node tools/make-logo.mjs <source image> [output png] [max size in pixels]');
  process.exit(1);
}

const source = path.resolve(sourceArg);
const output = outputArg
  ? path.resolve(outputArg)
  : path.resolve(here, '..', 'public', 'img', 'aitm-logo.png');

const decoded = jpeg.decode(fs.readFileSync(source), { useTArray: true });
const { width, height } = decoded;
const data = Buffer.from(decoded.data);

console.log('source ' + width + ' x ' + height);

const luminance = new Uint8Array(width * height);
for (let index = 0, pixel = 0; index < data.length; index += 4, pixel += 1) {
  luminance[pixel] = Math.round(
    0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]
  );
}

// Anything at least this dark, reachable from the edge, counts as background.
const BACKGROUND_MAX = 36;

/**
 * The outside border of the scan is always empty space, so a second, more
 * forgiving pass runs inside this margin to catch the faint grey compression
 * speck that some exports leave in a corner. The crest never reaches this
 * close to the edge, so the pass can never eat into the artwork.
 */
const EDGE_MARGIN = 60;
const SMUDGE_MAX = 210;

const isBackground = new Uint8Array(width * height);
const stack = [];

function visit(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const pixel = y * width + x;
  if (isBackground[pixel] === 1) return;
  if (luminance[pixel] > BACKGROUND_MAX) return;
  isBackground[pixel] = 1;
  stack.push(pixel);
}

for (let x = 0; x < width; x += 1) {
  visit(x, 0);
  visit(x, height - 1);
}
for (let y = 0; y < height; y += 1) {
  visit(0, y);
  visit(width - 1, y);
}

while (stack.length > 0) {
  const pixel = stack.pop();
  const x = pixel % width;
  const y = (pixel - x) / width;
  visit(x + 1, y);
  visit(x - 1, y);
  visit(x, y + 1);
  visit(x, y - 1);
}

const smudge = new Uint8Array(width * height);
const smudgeStack = [];

const nearEdge = (x, y) =>
  x < EDGE_MARGIN || y < EDGE_MARGIN || x >= width - EDGE_MARGIN || y >= height - EDGE_MARGIN;

function visitSmudge(x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  if (!nearEdge(x, y)) return;
  const pixel = y * width + x;
  if (smudge[pixel] === 1 || isBackground[pixel] === 1) return;
  const index = pixel * 4;
  const spread =
    Math.max(data[index], data[index + 1], data[index + 2]) -
    Math.min(data[index], data[index + 1], data[index + 2]);
  if (luminance[pixel] < 60 || luminance[pixel] > SMUDGE_MAX || spread > 30) return;
  smudge[pixel] = 1;
  smudgeStack.push(pixel);
}

for (let x = 0; x < width; x += 1) {
  visitSmudge(x, 0);
  visitSmudge(x, height - 1);
}
for (let y = 0; y < height; y += 1) {
  visitSmudge(0, y);
  visitSmudge(width - 1, y);
}

while (smudgeStack.length > 0) {
  const pixel = smudgeStack.pop();
  const x = pixel % width;
  const y = (pixel - x) / width;
  visitSmudge(x + 1, y);
  visitSmudge(x - 1, y);
  visitSmudge(x, y + 1);
  visitSmudge(x, y - 1);
}

let cleared = 0;
let minX = width;
let minY = height;
let maxX = -1;
let maxY = -1;

for (let y = 0; y < height; y += 1) {
  for (let x = 0; x < width; x += 1) {
    const pixel = y * width + x;
    if (isBackground[pixel] === 1 || smudge[pixel] === 1) {
      data[pixel * 4 + 3] = 0;
      cleared += 1;
      continue;
    }
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
}

if (maxX < minX || maxY < minY) {
  console.error('Every pixel was treated as background. Check the source image.');
  process.exit(1);
}

const cropWidth = maxX - minX + 1;
const cropHeight = maxY - minY + 1;
const cropped = Buffer.alloc(cropWidth * cropHeight * 4);

for (let y = 0; y < cropHeight; y += 1) {
  const from = ((y + minY) * width + minX) * 4;
  data.copy(cropped, y * cropWidth * 4, from, from + cropWidth * 4);
}

/**
 * Box filter downscale. Alpha is averaged in premultiplied space so the
 * transparent edges do not pull dark pixels into the crest outlines.
 */
function downscale(source, sourceWidth, sourceHeight, limit) {
  const scale = Math.min(1, limit / Math.max(sourceWidth, sourceHeight));
  if (scale >= 1) return { data: source, width: sourceWidth, height: sourceHeight };

  const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
  const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
  const target = Buffer.alloc(targetWidth * targetHeight * 4);

  for (let y = 0; y < targetHeight; y += 1) {
    const fromY = Math.floor((y * sourceHeight) / targetHeight);
    const toY = Math.max(fromY + 1, Math.ceil(((y + 1) * sourceHeight) / targetHeight));

    for (let x = 0; x < targetWidth; x += 1) {
      const fromX = Math.floor((x * sourceWidth) / targetWidth);
      const toX = Math.max(fromX + 1, Math.ceil(((x + 1) * sourceWidth) / targetWidth));

      let red = 0;
      let green = 0;
      let blue = 0;
      let alphaSum = 0;
      let count = 0;

      for (let sy = fromY; sy < toY; sy += 1) {
        for (let sx = fromX; sx < toX; sx += 1) {
          const index = (sy * sourceWidth + sx) * 4;
          const alpha = source[index + 3] / 255;
          red += source[index] * alpha;
          green += source[index + 1] * alpha;
          blue += source[index + 2] * alpha;
          alphaSum += alpha;
          count += 1;
        }
      }

      const out = (y * targetWidth + x) * 4;
      target[out] = alphaSum > 0 ? Math.round(red / alphaSum) : 0;
      target[out + 1] = alphaSum > 0 ? Math.round(green / alphaSum) : 0;
      target[out + 2] = alphaSum > 0 ? Math.round(blue / alphaSum) : 0;
      target[out + 3] = Math.round((255 * alphaSum) / count);
    }
  }

  return { data: target, width: targetWidth, height: targetHeight };
}

const finalImage = downscale(cropped, cropWidth, cropHeight, maxSize);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  encodePng(finalImage.width, finalImage.height, finalImage.data)
);

const percent = ((cleared / (width * height)) * 100).toFixed(1);
console.log('cleared ' + percent + '% of the image (the black background)');
console.log(
  'wrote ' +
    path.relative(process.cwd(), output) +
    ' at ' +
    finalImage.width +
    ' x ' +
    finalImage.height +
    ' (' +
    (fs.statSync(output).size / 1024).toFixed(0) +
    ' KB)'
);
