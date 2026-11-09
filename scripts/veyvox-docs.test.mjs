import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8');
function anchors(text) {
  const result = new Set([...text.matchAll(/(?:id|name)=["']([^"']+)["']/g)].map(m => m[1]));
  for (const match of text.matchAll(/^#{1,6}\s+(.+)$/gm)) result.add(match[1].toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').trim().replace(/\s/g, '-'));
  return result;
}
test('ships equivalent bilingual onboarding and original attribution with real local links', () => {
  for (const file of ['README.md', 'README.pt-BR.md']) {
    const text = read(file);
    for (const required of ['Veyvox', '1.17.0', 'Jannis Braun', 'TheZwiss', 'https://github.com/TheZwiss/backspace', 'AGPL-3.0-only', 'LiveKit', 'Juno', 'soundboard', 'PWA', '25', 'pnpm install --frozen-lockfile', '@veyvox/desktop', '3005', '5173', '3000', 'JWT_SECRET', '32', 'ghcr.io/bernardokcosta/backspace']) assert.ok(text.includes(required), `${file}: ${required}`);
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
