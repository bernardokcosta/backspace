import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import vm from 'node:vm';
import { createCompatibilityProbe, readProbeOptions } from './probe-desktop-compatibility.mjs';

async function probe(t) {
  const directory = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'desktop-probe-test-'));
  const output = path.join(directory, 'evidence.jsonl');
  const instance = createCompatibilityProbe({ listen: '127.0.0.1', port: 0, output });
  await instance.start();
  t.after(async () => { await instance.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { ...instance, output, records: () => fs.readFileSync(output, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line)) };
}

test('probe binds only loopback and never overwrites existing evidence', async (t) => {
  const p = await probe(t);
  assert.equal(p.server.address().address, '127.0.0.1');
  assert.throws(() => createCompatibilityProbe({ listen: '0.0.0.0', port: 3088, output: p.output }), /loopback/);
  assert.throws(() => createCompatibilityProbe({ listen: '127.0.0.1', port: 3088, output: p.output }), /EEXIST/);
  assert.throws(() => readProbeOptions(['--listen', '0.0.0.0', '--output', p.output]), /loopback/);
  assert.throws(() => readProbeOptions(['--output', 'relative.jsonl']), /absolute/);
});

test('records only identity metadata, never credentials, query strings or arbitrary request content', async (t) => {
  const p = await probe(t);
  const response = await fetch(`${p.origin}/?token=secret-query`, { headers: {
    authorization: 'Bearer secret-auth', cookie: 'session=secret-cookie', 'user-agent': 'ControlledProbe/1.15.0 Electron/45.0.0',
  } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-security-policy'), /connect-src 'self'/);
  const report = await fetch(`${p.origin}/probe/report`, { method: 'POST', headers: { origin: p.origin, 'content-type': 'application/json' },
    body: JSON.stringify({ version: '1.15.0', platform: 'win32', bridgeMethods: { getVersion: true, getUpdateStatus: true, openReleasePage: true, checkForUpdates: true, secret: 'secret-body' },
      updateMode: 'auto', token: 'secret-payload', text: 'secret-message', error: 'secret-error' }) });
  assert.equal(report.status, 204);
  const records = p.records();
  assert.equal(records[0].userAgent, 'ControlledProbe/1.15.0 Electron/45.0.0');
  assert.deepEqual(records[1].client, { version: '1.15.0', platform: 'win32', bridgeMethods: { getVersion: true, getUpdateStatus: true, checkForUpdates: true, openReleasePage: true }, updateMode: 'auto' });
  assert.doesNotMatch(fs.readFileSync(p.output, 'utf8'), /secret-|authorization|cookie|token|text|error/);
});

test('refuses cross-origin reports and malformed metadata without logging body values', async (t) => {
  const p = await probe(t);
  assert.equal((await fetch(`${p.origin}/probe/report`, { method: 'POST', headers: { origin: 'https://foreign.test' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${p.origin}/probe/report`, { method: 'POST', headers: { origin: p.origin }, body: 'secret-invalid-json' })).status, 400);
  assert.equal((await fetch(`${p.origin}/probe/report`, { method: 'POST', headers: { origin: p.origin }, body: JSON.stringify({ version: 'secret-version', platform: 'secret-platform' }) })).status, 204);
  assert.deepEqual(p.records().at(-1).client, { version: null, platform: null, bridgeMethods: {}, updateMode: null });
  assert.doesNotMatch(fs.readFileSync(p.output, 'utf8'), /secret-/);
});

test('observes a WebSocket handshake without accepting or recording authentication/content frames', async (t) => {
  const p = await probe(t);
  const socket = new WebSocket(`${p.origin.replace('http:', 'ws:')}/probe/ws?token=secret-websocket`);
  await once(socket, 'close');
  const handshake = p.records().find((record) => record.transport === 'websocket');
  assert.ok(handshake);
  assert.equal(handshake.clientFrames, 'not-read');
  assert.doesNotMatch(fs.readFileSync(p.output, 'utf8'), /secret-websocket/);
});

test('fixture reads the existing updater snapshot capability without invoking recovery/update actions', async () => {
  const code = fs.readFileSync(new URL('./fixtures/desktop-compatibility/probe.js', import.meta.url), 'utf8');
  let statusReads = 0;
  let report;
  let done;
  const completed = new Promise((resolve) => { done = resolve; });
  const status = { value: '', set textContent(value) { this.value = value; if (value.startsWith('Sanitized')) done(); } };
  const forbidden = () => { throw new Error('The probe must never invoke an update/recovery action'); };
  vm.runInNewContext(code, {
    setTimeout, clearTimeout,
    document: { getElementById: (id) => id === 'result' ? status : { addEventListener() {} } },
    window: { location: { origin: 'http://127.0.0.1:3088' }, backspace: {
      platform: 'win32', getVersion: async () => '1.15.0',
      getUpdateStatus: async () => { statusReads++; return { capability: 'manual', status: { phase: 'error', error: { message: 'secret-updater-error' } } }; },
      openReleasePage: forbidden, checkForUpdates: forbidden, installUpdate: forbidden,
    } },
    fetch: async (_url, options) => { report = JSON.parse(options.body); return { ok: true }; },
    WebSocket: class { addEventListener(name, callback) { if (name === 'close') queueMicrotask(callback); } },
  }, { filename: 'compatibility-probe-fixture.js' });
  let deadline;
  try { await Promise.race([completed, new Promise((_resolve, reject) => { deadline = setTimeout(() => reject(new Error('Fixture did not complete')), 1000); })]); }
  finally { clearTimeout(deadline); }
  assert.equal(statusReads, 1);
  assert.equal(report.updateMode, 'manual');
  assert.equal(report.bridgeMethods.getUpdateStatus, true);
  assert.equal(report.bridgeMethods.openReleasePage, true);
  assert.doesNotMatch(JSON.stringify(report), /secret-|getUpdateCapability|getUpdateSnapshot|openReleasesPage/);
});
