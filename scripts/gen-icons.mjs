#!/usr/bin/env node
/** Veyvox icon generator. Supplied raster masters are never modified.
 * Regenerate with pnpm gen-icons; see gen-icons.README.md for the output matrix.
 * Encoders, platform framing and tray centering remain owned by this pipeline.
 */
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import png2icons from 'png2icons';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PNG = { compressionLevel: 9, palette: false };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };
const TRAY_ICO_SIZES = [16, 20, 24, 32, 40, 48];

/** Approved minimal cleanup: remove only distant near-transparent noise.
 * Every alpha >=16 RGBA pixel (both Vs) and one pixel of edge support survives.
 * No connected-component discard, chroma filtering, erosion or redrawing.
 */
export async function cleanSymbol(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const support = new Uint8Array(width * height);
  let foreground = 0;
  for (let p = 0; p < support.length; p++) {
    if (data[p * 4 + 3] < 16) continue;
    foreground++;
    const x = p % width, y = Math.floor(p / width);
    for (let yy = Math.max(0, y - 1); yy <= Math.min(height - 1, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(width - 1, x + 1); xx++) support[yy * width + xx] = 1;
    }
  }
  if (!foreground) throw new Error('Symbol has no visible foreground');
  for (let p = 0; p < support.length; p++) if (!support[p]) data[p * 4 + 3] = 0;
  return sharp(data, { raw: info }).png(PNG).toBuffer();
}

/** Remove the opaque black matte outside the supplied rounded app tile.
 * Only near-black pixels connected to the canvas edge lose alpha. The purple
 * outline, enclosed dark interior, both Vs and every source RGB stay intact.
 */
export async function cleanAppIcon(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const visited = new Uint8Array(width * height);
  const pending = new Uint32Array(visited.length);
  let head = 0, tail = 0;
  const add = pixel => {
    if (pixel < 0 || pixel >= visited.length || visited[pixel]) return;
    const offset = pixel * 4;
    if (Math.max(data[offset], data[offset + 1], data[offset + 2]) > 16) return;
    visited[pixel] = 1;
    pending[tail++] = pixel;
  };
  for (let x = 0; x < width; x++) { add(x); add((height - 1) * width + x); }
  for (let y = 0; y < height; y++) { add(y * width); add(y * width + width - 1); }
  while (head < tail) {
    const pixel = pending[head++], x = pixel % width;
    data[pixel * 4 + 3] = 0;
    if (x > 0) add(pixel - 1);
    if (x < width - 1) add(pixel + 1);
    add(pixel - width); add(pixel + width);
  }
  return sharp(data, { raw: info }).png(PNG).toBuffer();
}

async function cropSymbol(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = info.width, top = info.height, right = -1, bottom = -1;
  for (let p = 0; p < info.width * info.height; p++) {
    if (!data[p * 4 + 3]) continue;
    const x = p % info.width, y = Math.floor(p / info.width);
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right < left) throw new Error('Symbol has no alpha bounds');
  return sharp(input).extract({ left, top, width: right - left + 1, height: bottom - top + 1 }).png(PNG).toBuffer();
}

async function monochrome(input, color) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0]; data[i + 1] = color[1]; data[i + 2] = color[2];
  }
  return sharp(data, { raw: info }).png(PNG).toBuffer();
}

async function renderPng(input, size) {
  return sharp(input).resize(size, size, { fit: 'contain', background: TRANSPARENT }).png(PNG).toBuffer();
}

async function alphaCentroidX(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let weighted = 0, alpha = 0;
  for (let p = 0; p < info.width * info.height; p++) {
    weighted += data[p * 4 + 3] * ((p % info.width) + 0.5); alpha += data[p * 4 + 3];
  }
  return alpha ? weighted / alpha : info.width / 2;
}

async function renderTrayGlyphPng(input, canvas, glyphSize) {
  const glyph = await sharp(input).resize(glyphSize, glyphSize, { fit: 'inside' }).png(PNG).toBuffer();
  const meta = await sharp(glyph).metadata();
  // Preserve the measured centering rule, bounded so no pixels can be clipped.
  const left = Math.max(0, Math.min(canvas - meta.width, Math.round(canvas / 2 - await alphaCentroidX(glyph))));
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: TRANSPARENT } })
    .composite([{ input: glyph, left, top: Math.round((canvas - meta.height) / 2) }]).png(PNG).toBuffer();
}

async function macIconPng(input, size) {
  const innerSize = Math.round(size * 824 / 1024);
  const inner = await renderPng(input, innerSize);
  const offset = Math.round((size - innerSize) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: TRANSPARENT } })
    .composite([{ input: inner, left: offset, top: offset }]).png(PNG).toBuffer();
}

function plumGradientSvg(size) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#2a2740"/><stop offset="1" stop-color="#12101d"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
}

/** root is both input and output owner; tests use disposable repository roots. */
export async function generateIcons(root = ROOT) {
  const brand = join(root, 'assets/brand');
  const paths = { app: join(brand, 'veyvox-app-icon.png'), symbol: join(brand, 'veyvox-symbol.png') };
  for (const file of Object.values(paths)) if (!existsSync(file)) throw new Error(`Missing source PNG: ${file}`);
  // Validate/read both masters before creating any output.
  const originalApp = readFileSync(paths.app), originalSymbol = readFileSync(paths.symbol);
  for (const input of [originalApp, originalSymbol]) {
    const meta = await sharp(input).metadata();
    if (meta.format !== 'png' || !meta.width || meta.width !== meta.height) throw new Error('Brand master must be a square PNG');
  }
  const app = await cleanAppIcon(originalApp);
  const symbol = await cropSymbol(await cleanSymbol(originalSymbol));
  const lavender = await monochrome(symbol, [124, 108, 246]);
  const white = await monochrome(symbol, [255, 255, 255]);
  const black = await monochrome(symbol, [0, 0, 0]);
  const build = join(root, 'packages/desktop/build');
  const resources = join(root, 'packages/desktop/resources');
  const web = join(root, 'packages/web/public/icons');
  const write = (file, bytes) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); };
  write(join(brand, 'app-icon-1024.png'), await renderPng(app, 1024));
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) write(join(build, `icons/${size}x${size}.png`), await renderPng(app, size));
  write(join(build, 'icon.png'), await macIconPng(app, 512));
  const icns = png2icons.createICNS(await macIconPng(app, 1024), png2icons.BICUBIC, 0);
  if (!icns) throw new Error('png2icons.createICNS returned null');
  write(join(build, 'icon.icns'), icns);
  write(join(build, 'icon.ico'), await pngToIco(await Promise.all([16, 24, 32, 48, 64, 128, 256].map(size => renderPng(app, size)))));
  write(join(resources, 'tray-iconTemplate.png'), await renderTrayGlyphPng(black, 22, 18));
  write(join(resources, 'tray-iconTemplate@2x.png'), await renderTrayGlyphPng(black, 44, 36));
  write(join(resources, 'tray-icon.png'), await renderTrayGlyphPng(lavender, 22, 18));
  write(join(resources, 'tray-icon.ico'), await pngToIco(await Promise.all(TRAY_ICO_SIZES.map(size => renderTrayGlyphPng(lavender, size, size - Math.floor(size / 8))))));
  for (const size of [16, 32]) write(join(web, `favicon-${size}.png`), await renderPng(lavender, size));
  for (const size of [192, 512]) write(join(web, `icon-${size}.png`), await renderPng(app, size));
  write(join(web, 'apple-touch-icon.png'), await sharp(await renderPng(app, 180)).flatten({ background: '#12101d' }).png(PNG).toBuffer());
  // Fit the entire mark in a 60%-of-canvas square, inside the maskable safe circle.
  const maskable = await sharp(plumGradientSvg(512)).composite([{ input: await renderPng(symbol, Math.round(512 * 0.6)), gravity: 'center' }]).png(PNG).toBuffer();
  write(join(web, 'icon-maskable-512.png'), maskable);
  write(join(web, 'logo.png'), await renderPng(app, 256));
  write(join(web, 'logo-mark.png'), await renderPng(white, 256));
  write(join(web, 'symbol.png'), await renderPng(symbol, 512));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  generateIcons().then(() => console.log('Generated Veyvox web/PWA, desktop and tray icons from the supplied PNG masters.')).catch(error => {
    console.error(error); process.exitCode = 1;
  });
}
