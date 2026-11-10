import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomInt } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';

// Run only with an installed, version-verified scanner. No provider credentials,
// source-repository commits, operator config or network calls are involved.
const { values } = parseArgs({ options: { binary: { type: 'string', default: 'gitleaks' } }, strict: true, allowPositionals: false });
const base = process.env.RUNNER_TEMP ?? (process.platform === 'win32' ? path.join(tmpdir(), 'opencode') : tmpdir());
fs.mkdirSync(base, { recursive: true });
const repo = fs.mkdtempSync(path.join(base, 'gitleaks-policy-'));
const isolatedConfig = path.join(repo, 'isolated.gitconfig');
fs.writeFileSync(isolatedConfig, '');
const env = { ...process.env, GIT_CONFIG_GLOBAL: isolatedConfig, GIT_CONFIG_SYSTEM: isolatedConfig };
const git = (...args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false', ...args], { cwd: repo, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
// A random base64 string can accidentally match the scanner's English stopwords
// or all-letter exemption. Balance this alphabet for entropy and omit d/e so
// pinned 8.24.3's hex-like stopwords cannot make the positive control flaky.
const characters = [...'0123456789abcf'.repeat(4)];
for (let i = characters.length - 1; i > 0; i--) {
  const j = randomInt(i + 1);
  [characters[i], characters[j]] = [characters[j], characters[i]];
}
const fixture = `api_key = "synthetic_${characters.join('')}"\n`;
function scan(expected, name) {
  const report = path.join(repo, `${name}.json`);
  const result = spawnSync(values.binary, ['detect', '--source', repo, '--gitleaks-ignore-path', path.join(repo, '.gitleaksignore'), '--redact', '--no-banner', '--exit-code=2', '--report-format=json', '--report-path', report], { cwd: repo, env, encoding: 'utf8', timeout: 60_000 });
  assert.ok(!result.error, 'scanner must execute successfully');
  assert.equal(result.status, expected, `${name}: expected scanner exit ${expected}, got ${result.status}; scanner output withheld`);
  return JSON.parse(fs.readFileSync(report, 'utf8'));
}
function commit(message) {
  git('add', 'fixture.env');
  git('-c', 'user.name=Scanner policy test', '-c', 'user.email=scanner@example.invalid', 'commit', '--quiet', '-m', message);
  return git('rev-parse', 'HEAD');
}
try {
  git('-c', 'init.defaultBranch=main', 'init', '--quiet');
  fs.writeFileSync(path.join(repo, '.gitleaksignore'), '');
  fs.writeFileSync(path.join(repo, 'fixture.env'), fixture);
  const first = commit('synthetic historical fixture');
  const initial = scan(2, 'initial');
  assert.equal(initial.length, 1, 'the canary must produce exactly one finding');
  assert.equal(initial[0].Commit, first);
  assert.match(initial[0].Fingerprint, new RegExp(`^${first}:fixture\\.env:generic-api-key:1$`));
  fs.writeFileSync(path.join(repo, '.gitleaksignore'), `${initial[0].Fingerprint}\n`);
  assert.equal(scan(0, 'ignored').length, 0);
  fs.writeFileSync(path.join(repo, 'fixture.env'), '# fixture removed\n');
  commit('remove synthetic fixture');
  fs.writeFileSync(path.join(repo, 'fixture.env'), fixture);
  const later = commit('reintroduce at the same path and line');
  const findings = scan(2, 'reintroduced');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].Commit, later);
  assert.equal(findings[0].File, 'fixture.env');
  assert.equal(findings[0].StartLine, 1);
  console.log('Gitleaks historical-ignore regression passed: 2 → 0 → 2; new commit detected at the same path/line (values withheld).');
} finally {
  fs.rmSync(repo, { recursive: true, force: true });
}
