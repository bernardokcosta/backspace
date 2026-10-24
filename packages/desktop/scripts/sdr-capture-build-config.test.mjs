import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readBuildOptions, checksumFor, verifyPeArchitecture, windowsTarExecutable } from './sdr-capture-build-config.mjs';

const host = { platform: 'win32', arch: 'x64', version: 'v24.21.0' };

test('native build options accept a target but only run tests on a matching host', () => {
  assert.deepEqual(readBuildOptions(['--arch', 'arm64'], host), { arch: 'arm64', test: false });
  assert.deepEqual(readBuildOptions(['--arch', 'x64', '--test'], host), { arch: 'x64', test: true });
  assert.throws(() => readBuildOptions(['--arch', 'arm64', '--test'], host), /matching/);
});

test('native build options reject unsupported architectures, runtimes and leftover arguments', () => {
  for (const args of [[], ['--arch', 'ia32'], ['--arch', 'x64', 'x64'], ['--arch', 'x64', '--unknown']]) {
    assert.throws(() => readBuildOptions(args, host));
  }
  assert.throws(() => readBuildOptions(['--arch', 'x64'], { ...host, platform: 'linux' }), /Windows/);
  assert.throws(() => readBuildOptions(['--arch', 'x64'], { ...host, version: 'v22.12.0' }), /Node 24/);
});

test('SDK downloads require exactly one valid checksum for the exact official filename', () => {
  const hash = 'a'.repeat(64);
  assert.equal(checksumFor(`${hash}  win-x64/node.lib\n`, 'win-x64/node.lib'), hash);
  assert.throws(() => checksumFor(`${hash}  win-arm64/node.lib`, 'win-x64/node.lib'));
  assert.throws(() => checksumFor(`invalid  win-x64/node.lib`, 'win-x64/node.lib'));
  assert.throws(() => checksumFor(`${hash}  win-x64/node.lib\n${hash}  win-x64/node.lib`, 'win-x64/node.lib'));
});

test('Windows extraction uses the native system tar rather than PATH GNU tar', () => {
  assert.equal(windowsTarExecutable('C:\\Windows'), 'C:\\Windows\\System32\\tar.exe');
  assert.throws(() => windowsTarExecutable('relative'));
});

test('compiled PE headers must match the requested architecture and be structurally valid', () => {
  const bytes = Buffer.alloc(128);
  bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64, 'ascii'); bytes.writeUInt16LE(0x8664, 68);
  assert.doesNotThrow(() => verifyPeArchitecture(bytes, 'x64'));
  assert.throws(() => verifyPeArchitecture(bytes, 'arm64'), /architecture/);
  bytes.writeUInt16LE(0xaa64, 68);
  assert.doesNotThrow(() => verifyPeArchitecture(bytes, 'arm64'));
  bytes.writeUInt32LE(120, 60);
  assert.throws(() => verifyPeArchitecture(bytes, 'arm64'), /PE/);
  assert.throws(() => verifyPeArchitecture(Buffer.alloc(5), 'x64'), /PE/);
});
