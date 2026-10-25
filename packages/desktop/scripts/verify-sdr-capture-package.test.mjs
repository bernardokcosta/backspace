import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { verifySdrCapturePackage, builderSdrArchitecture } from './verify-sdr-capture-package.mjs';

function pe(arch) {
  const bytes = Buffer.alloc(512);
  bytes.write('MZ'); bytes.writeUInt32LE(128, 60); bytes.write('PE\0\0', 128);
  bytes.writeUInt16LE({ x64: 0x8664, arm64: 0xaa64 }[arch], 132);
  return bytes;
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(process.env.TEMP || os.tmpdir(), 'sdr-package-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const resources = path.join(directory, 'resources');
  const native = path.join(resources, 'sdr-capture');
  fs.mkdirSync(native, { recursive: true });
  return { resources, native, binary: path.join(native, 'sdr_capture.node') };
}

test('packaged SDR addon must be present and match each Windows target', (t) => {
  const f = fixture(t);
  assert.throws(() => verifySdrCapturePackage(f.resources, 'x64'), /sdr_capture.node/);
  for (const arch of ['x64', 'arm64']) {
    fs.writeFileSync(f.binary, pe(arch));
    assert.equal(verifySdrCapturePackage(f.resources, arch).arch, arch);
    assert.throws(() => verifySdrCapturePackage(f.resources, arch === 'x64' ? 'arm64' : 'x64'), /architecture/);
  }
});

test('rejects extra payload, foreign architecture, malformed PE and directory masquerading as addon', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.binary, pe('x64'));
  assert.throws(() => verifySdrCapturePackage(f.resources, 'ia32'), /architecture/);
  fs.writeFileSync(path.join(f.native, 'foreign.node'), pe('arm64'));
  assert.throws(() => verifySdrCapturePackage(f.resources, 'x64'), /only sdr_capture.node/);
  fs.unlinkSync(path.join(f.native, 'foreign.node'));
  fs.writeFileSync(f.binary, 'not a native module');
  assert.throws(() => verifySdrCapturePackage(f.resources, 'x64'), /PE/);
  fs.unlinkSync(f.binary); fs.mkdirSync(f.binary);
  assert.throws(() => verifySdrCapturePackage(f.resources, 'x64'), /regular file/);
});

test('afterPack uses the target enum rather than the build host architecture', () => {
  assert.equal(builderSdrArchitecture(1), 'x64');
  assert.equal(builderSdrArchitecture(3), 'arm64');
  for (const value of [0, 2, 4, 'x64', undefined]) assert.throws(() => builderSdrArchitecture(value), /architecture/);
});

test('afterPack fails before fuses when the Windows payload is absent or mismatched', async (t) => {
  const f = fixture(t);
  const { default: hook } = await import('./afterPack.js');
  const context = { electronPlatformName: 'win32', appOutDir: path.dirname(f.resources), arch: 3,
    packager: { appInfo: { productFilename: 'Backspace Fork' } } };
  await assert.rejects(hook.default(context), /sdr_capture.node/);
  fs.writeFileSync(f.binary, pe('x64'));
  await assert.rejects(hook.default(context), /architecture/);
});

test('CLI refuses missing/unknown options and reports verified architecture without claiming runtime load', (t) => {
  const f = fixture(t);
  fs.writeFileSync(f.binary, pe('x64'));
  const script = fileURLToPath(new URL('./verify-sdr-capture-package.mjs', import.meta.url));
  for (const args of [[], ['--resources', f.resources], ['--resources', f.resources, '--arch', 'ia32'], ['--resources', f.resources, '--arch', 'x64', '--skip']]) {
    assert.notEqual(spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' }).status, 0);
  }
  const result = spawnSync(process.execPath, [script, '--resources', f.resources, '--arch', 'x64'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { arch: 'x64', binary: f.binary, runtimeLoad: 'not-tested' });
});
