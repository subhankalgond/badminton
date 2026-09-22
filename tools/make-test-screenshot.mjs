/**
 * Writes a sample payment screenshot image used by the smoke test and by
 * manual browser testing of the upload field.
 * Run with: node tools/make-test-screenshot.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, drawRectOutline, encodePng, fillRect } from './png.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const outputDir = path.join(path.resolve(here, '..'), 'tmp');
fs.mkdirSync(outputDir, { recursive: true });

const width = 320;
const height = 420;
const canvas = createCanvas(width, height);

fillRect(canvas, 0, 0, width, height, [245, 247, 245]);
drawRectOutline(canvas, 8, 8, width - 16, height - 16, 3, [15, 107, 63]);
fillRect(canvas, 32, 40, width - 64, 34, [15, 107, 63]);
fillRect(canvas, 32, 96, 150, 14, [82, 96, 90]);
fillRect(canvas, 32, 124, 220, 14, [82, 96, 90]);
fillRect(canvas, 32, 168, 120, 14, [82, 96, 90]);
fillRect(canvas, 32, 196, 90, 26, [15, 107, 63]);
fillRect(canvas, 32, 250, width - 64, 1, [220, 227, 223]);
fillRect(canvas, 32, 274, 180, 14, [82, 96, 90]);
fillRect(canvas, 32, 302, 240, 14, [82, 96, 90]);
fillRect(canvas, 32, 352, 140, 14, [82, 96, 90]);

const file = path.join(outputDir, 'test-payment.png');
fs.writeFileSync(file, encodePng(canvas.width, canvas.height, canvas.data));
console.log('wrote ' + file);
