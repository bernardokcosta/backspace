import path from 'node:path';
import { parseArgs } from 'node:util';

export function readBuildOptions(args, host = process) {
  const { values } = parseArgs({ args, options: { arch: { type: 'string' }, test: { type: 'boolean', default: false } }, allowPositionals: false, strict: true });
  if (!['x64', 'arm64'].includes(values.arch)) throw new Error('Usage: build-sdr-capture.mjs --arch x64|arm64 [--test]');
  if (host.platform !== 'win32') throw new Error('Native SDR capture builds require Windows and its SDK');
  if (values.test && host.arch !== values.arch) throw new Error(`Runtime tests need a matching ${values.arch} Node host; this host is ${host.arch}`);
  if (!/^v24\.\d+\.\d+$/.test(host.version)) throw new Error('Build native SDR capture with the supported Node 24 toolchain');
  return { arch: values.arch, test: values.test };
}

export function checksumFor(manifest, filename) {
  const matches = manifest.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).filter((parts) => parts[1] === filename);
  if (matches.length !== 1 || !/^[0-9a-f]{64}$/.test(matches[0][0])) throw new Error(`No unique official checksum for ${filename}`);
  return matches[0][0];
}

export function windowsTarExecutable(systemRoot) {
  if (!path.win32.isAbsolute(systemRoot)) throw new Error('Windows SystemRoot must be absolute');
  return path.win32.join(systemRoot, 'System32/tar.exe');
}

export function verifyPeArchitecture(bytes, arch) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 64 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid native SDR PE image');
  const offset = bytes.readUInt32LE(60);
  if (offset < 64 || offset + 24 > bytes.length || bytes.toString('ascii', offset, offset + 4) !== 'PE\0\0') throw new Error('Invalid native SDR PE header');
  const expected = { x64: 0x8664, arm64: 0xaa64 }[arch];
  if (!expected || bytes.readUInt16LE(offset + 4) !== expected) throw new Error(`Native SDR PE architecture does not match ${arch}`);
}
