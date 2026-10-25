import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readBuildOptions, checksumFor, verifyPeArchitecture, windowsTarExecutable } from './sdr-capture-build-config.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native/sdr-capture');
const { arch, test } = readBuildOptions(process.argv.slice(2));

function run(command, arguments_) {
  const result = spawnSync(command, arguments_, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} exited ${result.status}`);
}

const vswhere = path.join(process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)', 'Microsoft Visual Studio/Installer/vswhere.exe');
const found = spawnSync(vswhere, ['-all', '-products', '*', '-property', 'installationPath'], { encoding: 'utf8', windowsHide: true });
if (found.error || found.status !== 0 || !found.stdout.trim()) throw new Error('MSVC C++ Build Tools are required for native SDR capture');
const targetPlatform = arch === 'arm64' ? 'ARM64' : 'x64';
let msbuild;
let platformToolset;
for (const installation of found.stdout.trim().split(/\r?\n/)) {
  const candidate = path.join(installation, 'MSBuild/Current/Bin/MSBuild.exe');
  const vcTargets = path.join(installation, 'MSBuild/Microsoft/VC');
  if (!fs.existsSync(candidate) || !fs.existsSync(vcTargets)) continue;
  const targetVersions = fs.readdirSync(vcTargets).filter((name) => /^v\d+$/.test(name)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
  for (const version of targetVersions) {
    const directory = path.join(vcTargets, version, 'Platforms', targetPlatform, 'PlatformToolsets');
    if (!fs.existsSync(directory)) continue;
    platformToolset = fs.readdirSync(directory).filter((name) => /^v\d+$/.test(name)).sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)))[0];
    if (platformToolset) { msbuild = candidate; break; }
  }
  if (platformToolset) break;
}
if (!platformToolset) throw new Error(`The installed MSVC toolchain has no ${targetPlatform} platform toolset`);
const sdk = path.join(root, 'build/sdk', process.version);
fs.mkdirSync(sdk, { recursive: true });
const distribution = `https://nodejs.org/download/release/${process.version}/`;
const response = await fetch(new URL('SHASUMS256.txt', distribution), { signal: globalThis.AbortSignal.timeout(45000) });
if (!response.ok) throw new Error(`Node checksum manifest failed: HTTP ${response.status}`);
const checksums = await response.text();

async function download(name, destination) {
  const expected = checksumFor(checksums, name);
  if (fs.existsSync(destination)) {
    if (createHash('sha256').update(fs.readFileSync(destination)).digest('hex') !== expected) throw new Error(`Cached SDK checksum mismatch: ${name}`);
    return;
  }
  const result = await fetch(new URL(name, distribution), { signal: globalThis.AbortSignal.timeout(120000) });
  if (!result.ok) throw new Error(`Node SDK download failed: ${name} HTTP ${result.status}`);
  const bytes = Buffer.from(await result.arrayBuffer());
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw new Error(`Downloaded SDK checksum mismatch: ${name}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
}

const headers = `node-${process.version}-headers.tar.gz`;
const archive = path.join(sdk, headers);
await download(headers, archive);
await download(`win-${arch}/node.lib`, path.join(sdk, arch, 'node.lib'));
// Git Bash can put GNU tar first on PATH, where a Windows drive prefix is
// interpreted as a remote host. Use Windows' SDK-compatible native tar.
const tar = windowsTarExecutable(process.env.SystemRoot ?? 'C:/Windows');
if (!fs.existsSync(tar)) throw new Error('Windows native tar.exe is required to extract the verified Node SDK');
run(tar, ['-xzf', archive, '-C', sdk, '--strip-components=1']);
const project = path.join(root, 'sdr-capture.vcxproj');
const properties = [`/p:Platform=${targetPlatform}`, `/p:PlatformToolset=${platformToolset}`, `/p:TargetArch=${arch}`, `/p:NodeSdkRoot=${sdk}`];
run(msbuild, [project, '/nologo', '/verbosity:minimal', '/p:Configuration=Release', ...properties]);
verifyPeArchitecture(fs.readFileSync(path.join(root, `build/win32-${arch}/sdr_capture.node`)), arch);
if (test) {
  run(msbuild, [project, '/nologo', '/verbosity:minimal', '/p:Configuration=Tests', ...properties]);
  run(path.join(root, `build/win32-${arch}/sdr_texture_test.exe`), []);
}
console.log(`Native SDR ${arch} build${test ? ' and runtime tests' : ' (compile only)'} passed`);
