import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
test('presents Juno only as a minigame example', () => {
  for (const [file, category, label] of [
    ['README.md', 'minigames', 'Minigames and soundboard'],
    ['README.pt-BR.md', 'minijogos', 'Minijogos e soundboard'],
  ]) {
    const text = read(file);
    const hero = text.slice(0, text.indexOf('</div>'));
    assert.match(hero, new RegExp(` · ${category}\\r?$`, 'm'));
    assert.doesNotMatch(hero, /\bJuno\b/);
    assert.match(text, new RegExp(`^- \\*\\*${label}:\\*\\*[^\\n]*\\bJuno\\b`, 'm'));
    assert.doesNotMatch(text, /^#{1,6}[^\n]*\bJuno\b|^- \*\*[^*\n]*\bJuno\b/im);
  }
});

function anchors(text) {
  const result = new Set([...text.matchAll(/(?:id|name)=["']([^"']+)["']/g)].map(m => m[1]));
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) result.add(match[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s/g, '-'));
  return result;
}
test('documents equivalent installer placeholders and a discoverable source version', () => {
  for (const file of ['README.md', 'README.pt-BR.md']) {
    const text = read(file);
    assert.match(text, /\[package\.json\]\(package\.json\)/, file);
    for (const suffix of ['win-x64.exe', 'linux-x86_64.AppImage', 'mac-arm64.dmg']) assert.ok(text.includes(`Veyvox-<version>-${suffix}`), `${file}: ${suffix}`);
    assert.doesNotMatch(text, /Veyvox-x\.x{1,2}\.x|source tree targets;|prepara a versão;/, file);
    assert.doesNotMatch(text, /releases\/download\/v\d/);
  }
});
test('ships equivalent bilingual onboarding and original attribution with real local links', () => {
  for (const file of ['README.md', 'README.pt-BR.md']) {
    const text = read(file);
    for (const required of ['Veyvox', 'Jannis Braun', 'TheZwiss', 'https://github.com/TheZwiss/backspace', 'AGPL-3.0-only', 'LiveKit', 'Juno', 'soundboard', 'PWA', '25', 'pnpm install --frozen-lockfile', '@veyvox/desktop', '3005', '5173', '3000', 'JWT_SECRET', '32', 'ghcr.io/bernardokcosta/backspace']) assert.ok(text.includes(required), `${file}: ${required}`);
    assert.match(text, /docker compose pull backspace/);
    assert.doesNotMatch(text, /docker compose (?:pull|up[^\n]*) veyvox/);
    assert.ok(text.slice(0, 250).includes(file === 'README.md' ? 'README.pt-BR.md' : 'README.md'));
    assert.doesNotMatch(text, /https:\/\/github\.com\/bernardokcosta\/veyvox\/releases\/download\/v1\.17\.0\//);
    const targets = [...text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(m => m[1]);
    targets.push(...[...text.matchAll(/<img[^>]+src=["']([^"']+)["']/g)].map(m => m[1]));
    for (const target of targets) {
      if (/^[a-z]+:/i.test(target)) continue;
      const [relative, fragment] = target.split('#');
      const resolved = path.resolve(path.dirname(path.join(ROOT, file)), relative || file);
      assert.ok(resolved === ROOT || resolved.startsWith(ROOT + path.sep), `${file}: external local path ${target}`);
      assert.ok(fs.existsSync(resolved), `${file}: missing ${target}`);
      if (fragment) assert.ok(anchors(fs.readFileSync(resolved, 'utf8')).has(decodeURIComponent(fragment)), `${file}: missing heading ${target}`);
    }
  }
  const notice = read('NOTICE');
  for (const required of ['Copyright (c) 2026 Jannis Braun', 'veyvox-app-icon.png', 'veyvox-symbol.png', 'SIL Open Font License', 'MPL-2.0']) assert.ok(notice.includes(required));
});

test('both READMEs display the transparent app derivative, not the opaque master', async () => {
  for (const file of ['README.md', 'README.pt-BR.md']) {
    const source = /<img[^>]+src=["']([^"']+)["']/.exec(read(file))?.[1];
    assert.equal(source, 'assets/brand/app-icon-1024.png', `${file}: use the generated transparent tile`);
    const { data, info } = await sharp(path.join(ROOT, source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (const [x, y] of [[0, 0], [info.width - 1, 0], [0, info.height - 1], [info.width - 1, info.height - 1]]) {
      assert.equal(data[(y * info.width + x) * 4 + 3], 0, `${file}: visible image corner is not transparent`);
    }
  }
});
