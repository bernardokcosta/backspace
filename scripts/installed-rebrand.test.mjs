import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { requireDisposableRunner, BASELINES, assertInstalledReport, assertCookieProtectionUnchanged, assertCookieStorageRow, summarizeMacTermination } from './verify-installed-rebrand.mjs';
import * as acceptance from './verify-installed-rebrand.mjs';

test('pins the available Veyvox upgrade baseline and all eight verified installer hashes', () => {
  assert.deepEqual(acceptance.BASELINE_RELEASE, { repository: 'bernardokcosta/veyvox', tag: 'v1.17.0', version: '1.17.0', prefix: 'Veyvox' });
  assert.equal(Object.isFrozen(acceptance.BASELINE_RELEASE), true);
  assert.deepEqual(Object.fromEntries([...Object.values(BASELINES), ...Object.values(acceptance.APPIMAGES)]), {
    'win-x64.exe': 'af0a9e97d0c5b073f074c8ed0639517650dbdadaab1ca19c0a5005e4be815ff7',
    'win-arm64.exe': '47618274b4a724dcf901b9ad4c41450d28ea529f876b9a8d3b44007138707ed0',
    'mac-x64.dmg': 'b54563d74b9662ec1dc18028c904524173b67be7c84f536d615d77207802b882',
    'mac-arm64.dmg': '893fd487634b80a8107d714ff07da2c15e3546d4ece2880fd0e14fd577e8e39b',
    'linux-amd64.deb': '7572b3ef8c5bcb093202dfb5cab801bc2a6d43a6ffbd6257bae382e33c5c4df4',
    'linux-arm64.deb': '981e5a8da0e4332542e68cef18e312bcdd3a6d006db3d957d3472bb2bf99f803',
    'linux-x86_64.AppImage': '43d6cf9b9ee8ab3d80faa2521a993af2d354e77d6eb371d6a5cc69e8f2e372d1',
    'linux-arm64.AppImage': 'ce1879b4a4d252e021707737461c49f876867be392d638e89d2c47434a817340',
  });
  const source = readFileSync(new URL('./verify-installed-rebrand.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /1\.16\.8|Backspace-Fork-|bernardokcosta\/backspace/);
  assert.equal([...source.matchAll(/BASELINE_RELEASE\.tag/g)].length, 2);
  assert.equal([...source.matchAll(/BASELINE_RELEASE\.repository/g)].length, 2);
  assert.equal([...source.matchAll(/BASELINE_RELEASE\.prefix/g)].length, 2);
});

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
  const report = { ok: true, phase: 'upgrade', version: '1.17.0', token: 'synthetic-session', language: 'auto', pending: 'synthetic-pending', cookie: 'synthetic-session', retiredKeys: [], nativeStorage: { ...acceptance.INSTALLED_NATIVE_WORK }, scale: 200, music: 20, legacy: true, canonical: true, documentVisibility: 'visible', startup: { openAtLogin: true, startMinimized: true } };
  assert.doesNotThrow(() => assertInstalledReport(report, 'upgrade', '1.17.0', true));
  for (const key of Object.keys(report)) assert.throws(() => assertInstalledReport({ ...report, [key]: null }, 'upgrade', '1.17.0', true), key);
  assert.throws(() => assertInstalledReport({ ...report, startup: { openAtLogin: false, startMinimized: true } }, 'upgrade', '1.17.0', true));
  assert.doesNotThrow(() => assertInstalledReport({ ...report, documentVisibility: 'hidden' }, 'upgrade', '1.17.0', true));
  assert.throws(() => assertInstalledReport({ ...report, cookie: 'must-not-appear-in-errors' }, 'upgrade', '1.17.0', true), error => /failed checks: cookie$/.test(error.message) && !error.message.includes('must-not-appear'));
  for (const key of Object.keys(acceptance.INSTALLED_NATIVE_WORK)) {
    assert.throws(() => assertInstalledReport({ ...report, nativeStorage: { ...report.nativeStorage, [key]: null } }, 'upgrade', '1.17.0', true));
  }
  for (const phase of ['upgrade', 'repeat', 'disable', 'appimage-upgrade', 'appimage-repeat']) {
    assert.throws(() => assertInstalledReport({ ...report, phase, retiredKeys: ['backspace_instances_synthetic-owner'] }, phase, '1.17.0', true));
  }
  for (const phase of ['seed', 'appimage-seed']) {
    const baseline = { ...report, phase, canonical: false, retiredKeys: [...acceptance.INSTALLED_RETIRED_KEYS] };
    assert.doesNotThrow(() => assertInstalledReport(baseline, phase, '1.17.0', true));
    assert.throws(() => assertInstalledReport({ ...baseline, retiredKeys: [] }, phase, '1.17.0', true));
  }
});

test('installed candidate imports the actual compiled retirement and preserves native work byte for byte', async () => {
  const code = await acceptance.compileInstalledRetirement();
  assert.match(code, /export function retireFederationStorage/);
  const values = new Map(Object.entries(acceptance.INSTALLED_NATIVE_WORK));
  for (const key of acceptance.INSTALLED_RETIRED_KEYS) values.set(key, '{malformed-synthetic-peer');
  const storage = { get length() { return values.size; }, key: index => [...values.keys()][index] ?? null, removeItem: key => values.delete(key) };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  try {
    const compiled = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
    assert.deepEqual(Object.fromEntries(values), acceptance.INSTALLED_NATIVE_WORK);
    compiled.retireFederationStorage(storage);
    assert.deepEqual(Object.fromEntries(values), acceptance.INSTALLED_NATIVE_WORK);
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before); else delete globalThis.localStorage;
  }
  const html = readFileSync(new URL('./fixtures/installed-rebrand.html', import.meta.url), 'utf8');
  assert.match(html, /if \(!seed\) await import\('\/retire-state\.js'\)/);
  assert.doesNotMatch(html, /removeItem\(|localStorage\.clear\(/);
  const source = readFileSync(new URL('./verify-installed-rebrand.mjs', import.meta.url), 'utf8');
  assert.match(source, /request\.url === '\/retire-state\.js'/);
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
