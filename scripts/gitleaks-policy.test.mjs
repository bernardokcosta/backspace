import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
test('historical exceptions use unique commit-specific fingerprints with rationale', () => {
  const text = fs.readFileSync(new URL('.gitleaksignore', root), 'utf8');
  const entries = text.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  assert.equal(entries.length, 16);
  assert.equal(new Set(entries).size, 16);
  let rationale = false;
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    if (line.startsWith('#')) { rationale = true; continue; }
    assert.ok(rationale, 'every fingerprint needs a preceding safe rationale');
    assert.match(line, /^[0-9a-f]{40}:[^:*]+:generic-api-key:[1-9]\d*$/);
    const [commit, file] = line.split(':');
    assert.ok(!file.startsWith('/') && !file.split('/').includes('..'));
    execFileSync('git', ['cat-file', '-e', `${commit}:${file}`], { cwd: root, stdio: 'pipe' });
    rationale = false;
  }
  assert.equal(fs.existsSync(new URL('.gitleaks.toml', root)), false, 'do not replace exact fingerprints with broad exclusions');
});
