import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { requireDisposableRunner, BASELINES, assertInstalledReport, assertCookieProtectionUnchanged, assertCookieStorageRow, summarizeMacTermination } from './verify-installed-rebrand.mjs';

test('installed upgrade acceptance refuses to modify a non-runner OS account', () => {
  const result = spawnSync(process.execPath, [path.join(import.meta.dirname, 'verify-installed-rebrand.mjs')], {
    env: { ...process.env, GITHUB_ACTIONS: '', RUNNER_TEMP: '', GITHUB_RUN_ID: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only on disposable GitHub-hosted runners/);
});

test('legacy recovery smoke cannot edit a personal profile either', () => {
  const result = spawnSync('bash', [path.join(import.meta.dirname, 'smoke-recovery.sh')], {
    env: { ...process.env, GITHUB_ACTIONS: '', RUNNER_ENVIRONMENT: '', VEYVOX_INSTALL_ACCEPTANCE: '' }, encoding: 'utf8',
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /only on disposable GitHub-hosted runners/);
});

const hosted = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', VEYVOX_INSTALL_ACCEPTANCE: '1', GITHUB_RUN_ID: '123', RUNNER_TEMP: '/runner/temp', GITHUB_WORKSPACE: '/runner/workspace', RUNNER_OS: 'Linux' };
test('requires every independent runner/opt-in guard and a matching OS', () => {
  assert.doesNotThrow(() => requireDisposableRunner(hosted, 'linux'));
  for (const key of Object.keys(hosted)) assert.throws(() => requireDisposableRunner({ ...hosted, [key]: '' }, 'linux'));
  assert.throws(() => requireDisposableRunner({ ...hosted, RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux'));
  assert.throws(() => requireDisposableRunner(hosted, 'win32'));
  assert.equal(Object.keys(BASELINES).length, 6);
  for (const [suffix, digest] of Object.values(BASELINES)) { assert.match(suffix, /\.(exe|deb|dmg)$/); assert.match(digest, /^[a-f0-9]{64}$/); }
});
test('acceptance rejects any lost state rather than reseeding the candidate', () => {
  const report = { ok: true, phase: 'upgrade', version: '1.17.0', token: 'synthetic-session', language: 'auto', pending: 'synthetic-pending', cookie: 'synthetic-session', instances: 'synthetic-peer', scale: 200, music: 20, legacy: true, canonical: true, documentVisibility: 'visible', startup: { openAtLogin: true, startMinimized: true } };
  assert.doesNotThrow(() => assertInstalledReport(report, 'upgrade', '1.17.0', true));
  for (const key of Object.keys(report)) assert.throws(() => assertInstalledReport({ ...report, [key]: null }, 'upgrade', '1.17.0', true), key);
  assert.throws(() => assertInstalledReport({ ...report, startup: { openAtLogin: false, startMinimized: true } }, 'upgrade', '1.17.0', true));
  assert.doesNotThrow(() => assertInstalledReport({ ...report, documentVisibility: 'hidden' }, 'upgrade', '1.17.0', true));
  assert.throws(() => assertInstalledReport({ ...report, cookie: 'must-not-appear-in-errors' }, 'upgrade', '1.17.0', true), error => /failed checks: cookie$/.test(error.message) && !error.message.includes('must-not-appear'));
});

test('preserves measured cookie protection without enabling or downgrading encryption', () => {
  for (const mode of ['plaintext', 'encrypted']) assert.doesNotThrow(() => assertCookieProtectionUnchanged(mode, mode));
  for (const [before, after] of [['plaintext', 'encrypted'], ['encrypted', 'plaintext'], ['unknown', 'unknown'], [undefined, undefined]]) {
    assert.throws(() => assertCookieProtectionUnchanged(before, after));
  }
  const plain = { value: 'synthetic-session', encrypted_value: new Uint8Array() };
  const encrypted = { value: '', encrypted_value: Buffer.from('v11synthetic-ciphertext') };
  assert.doesNotThrow(() => assertCookieStorageRow(plain, 'plaintext', 'linux'));
  assert.doesNotThrow(() => assertCookieStorageRow(encrypted, 'encrypted', 'linux'));
  assert.throws(() => assertCookieStorageRow(plain, 'encrypted', 'linux'));
  assert.throws(() => assertCookieStorageRow(encrypted, 'plaintext', 'linux'));
  assert.throws(() => assertCookieStorageRow({ ...encrypted, encrypted_value: Buffer.from('v10basic-fallback') }, 'encrypted', 'linux'));
  assert.throws(() => assertCookieStorageRow(undefined, 'plaintext'));
  assert.throws(() => assertCookieStorageRow({ ...plain, value: 'lost-session' }, 'plaintext'));
});

test('macOS failure evidence reports only the owned process termination fields', () => {
  const report = { pid: 123, termination: { namespace: 'CODESIGNING', code: 2, indicator: 'must-not-log-arbitrary-content' } };
  assert.deepEqual(summarizeMacTermination(report, 123), { namespace: 'CODESIGNING', code: 2 });
  assert.equal(summarizeMacTermination(report, 456), null);
  assert.equal(summarizeMacTermination({ ...report, pid: undefined }, 123), null);
  assert.deepEqual(summarizeMacTermination({ pid: 123, termination: { namespace: 'must-not-log', code: 'must-not-log' } }, 123), { namespace: 'OTHER', code: null });
});

test('installer paths stay argument data and never share the shell interpreter helper', () => {
  const source = readFileSync(new URL('./verify-installed-rebrand.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\brun\(\s*['"](?:sh|bash|cmd(?:\.exe)?|powershell(?:\.exe)?)['"]/i);
  const declaration = source.match(/^const run = .+;$/m)?.[0];
  assert.ok(declaration);
  const parameters = { file: 'hdiutil', args: ['attach', '/fixture/space \';$(not-a-command)/app.dmg'], cwd: '/fixture/working directory' };
  let call;
  runInNewContext(`${declaration}\nrun(parameters.file, parameters.args, parameters.cwd);`, {
    parameters, execFileSync: (...args) => { call = args; return '  success\n'; },
  });
  assert.equal(call[0], parameters.file);
  assert.deepEqual(call[1], parameters.args);
  assert.equal(call[2].cwd, parameters.cwd);
  assert.equal(call[2].shell, false);
});
