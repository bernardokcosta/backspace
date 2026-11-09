import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { cleanSymbol, generateIcons } from './gen-icons.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {
  'veyvox-app-icon.png': 'ebe84fc5136272548231f61b9eaa404922d064a8f013a556afcf1b802af5374e',
  'veyvox-symbol.png': '3db91352925569d1c193b5c96cedc8029cafa06004f39b8a6223de63dfd3fb77',
};
async function fixture(t) {
  const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  const root = await fs.mkdtemp(path.join(temp, 'veyvox-icons-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function png(file, width, height = width) {
  const image = sharp(file);
  const meta = await image.metadata();
  assert.equal(meta.width, width); assert.equal(meta.height, height);
  return image.ensureAlpha().raw().toBuffer();
}

test('preserves the exact supplied masters and both intentional V components', async () => {
  for (const [name, digest] of Object.entries(sources)) assert.equal(hash(await fs.readFile(path.join(ROOT, 'assets/brand', name))), digest);
  const input = await fs.readFile(path.join(ROOT, 'assets/brand/veyvox-symbol.png'));
  const original = await sharp(input).ensureAlpha().raw().toBuffer();
  const cleaned = await sharp(await cleanSymbol(input)).ensureAlpha().raw().toBuffer();
  assert.equal(cleaned.length, original.length);
  let preserved = 0, removed = 0;
  for (let i = 0; i < original.length; i += 4) {
    if (original[i + 3] >= 16) {
      assert.ok(original.subarray(i, i + 4).equals(cleaned.subarray(i, i + 4)));
      preserved++;
    } else if (cleaned[i + 3] < original[i + 3]) removed++;
  }
  assert.equal(preserved, 245_730 + 66_918); // Outer AND inner V, not only the largest.
  assert.equal(removed, 27_321); // Approved near-transparent noise, not colored geometry.
});

test('refuses missing masters before creating any output', async t => {
  const root = await fixture(t);
  await assert.rejects(generateIcons(root), /Missing source/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('generates every raster, ICO and ICNS output deterministically', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'assets/brand'), { recursive: true });
  for (const name of Object.keys(sources)) await fs.copyFile(path.join(ROOT, 'assets/brand', name), path.join(root, 'assets/brand', name));
  await generateIcons(root);
  for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) await png(path.join(root, `packages/desktop/build/icons/${size}x${size}.png`), size);
  const web = name => path.join(root, 'packages/web/public/icons', name);
  for (const [name, size] of Object.entries({ 'favicon-16.png': 16, 'favicon-32.png': 32, 'logo.png': 256, 'logo-mark.png': 256, 'symbol.png': 512, 'apple-touch-icon.png': 180, 'icon-192.png': 192, 'icon-512.png': 512, 'icon-maskable-512.png': 512 })) {
    const raw = await png(web(name), size);
    if (name === 'apple-touch-icon.png' || name === 'icon-maskable-512.png') for (let i = 3; i < raw.length; i += 4) assert.equal(raw[i], 255);
  }
  const dock = await png(path.join(root, 'packages/desktop/build/icon.png'), 512);
  for (let y = 0; y < 50; y++) for (let x = 0; x < 512; x++) assert.equal(dock[(y * 512 + x) * 4 + 3], 0);
  for (const [name, w, h] of [['tray-iconTemplate.png', 22, 22], ['tray-iconTemplate@2x.png', 44, 44]]) {
    const raw = await png(path.join(root, 'packages/desktop/resources', name), w, h);
    let alpha = 0;
    for (let i = 0; i < raw.length; i += 4) { assert.equal(raw[i] + raw[i + 1] + raw[i + 2], 0); alpha += raw[i + 3]; }
    assert.ok(alpha > 0);
  }
  for (const [name, expected] of [['build/icon.ico', [16, 24, 32, 48, 64, 128, 256]], ['resources/tray-icon.ico', [16, 20, 24, 32, 40, 48]]]) {
    const bytes = await fs.readFile(path.join(root, 'packages/desktop', name));
    assert.equal(bytes.readUInt16LE(2), 1); assert.equal(bytes.readUInt16LE(4), expected.length);
    for (const [i, size] of expected.entries()) {
      const entry = 6 + i * 16, length = bytes.readUInt32LE(entry + 8), start = bytes.readUInt32LE(entry + 12);
      assert.equal(bytes[entry] || 256, size); assert.equal(bytes[entry + 1] || 256, size);
      assert.ok(length > 0 && start + length <= bytes.length);
      const frame = bytes.subarray(start, start + length);
      if (frame.readUInt32LE(0) === 40) { assert.equal(frame.readInt32LE(4), size); assert.equal(frame.readInt32LE(8), size * 2); }
      else { const meta = await sharp(frame).metadata(); assert.equal(meta.width, size); assert.equal(meta.height, size); }
    }
  }
  const icns = await fs.readFile(path.join(root, 'packages/desktop/build/icon.icns'));
  assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  const chunks = [];
  for (let offset = 8; offset < icns.length;) {
    const type = icns.toString('ascii', offset, offset + 4), length = icns.readUInt32BE(offset + 4);
    assert.ok(length > 8 && offset + length <= icns.length);
    if (type.startsWith('ic')) { const meta = await sharp(icns.subarray(offset + 8, offset + length)).metadata(); assert.ok([32, 64, 128, 256, 512, 1024].includes(meta.width)); }
    chunks.push(type); offset += length;
  }
  assert.deepEqual(chunks, ['ic12', 'ic07', 'ic13', 'ic08', 'ic14', 'ic09', 'ic10', 'ic11', 'il32', 'l8mk', 'is32', 's8mk']);
  const files = (await fs.readdir(root, { recursive: true })).filter(name => /\.(png|ico|icns)$/.test(name));
  const before = await Promise.all(files.map(async name => hash(await fs.readFile(path.join(root, name)))));
  await generateIcons(root);
  assert.deepEqual(await Promise.all(files.map(async name => hash(await fs.readFile(path.join(root, name))))), before);
});
