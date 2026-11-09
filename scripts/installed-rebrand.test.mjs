import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { requireDisposableRunner, BASELINES, assertInstalledReport } from './verify-installed-rebrand.mjs';

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
