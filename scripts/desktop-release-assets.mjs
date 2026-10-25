import fs from 'node:fs/promises';
import { createReadStream, constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

// Build-time only: use electron-builder 26's pinned js-yaml 4 dependency. This
// script is not shipped in the server or renderer; no runtime dependency added.
const desktop = createRequire(new URL('../packages/desktop/package.json', import.meta.url));
const builder = createRequire(desktop.resolve('electron-builder/package.json'));
const buildLib = createRequire(builder.resolve('app-builder-lib/package.json'));
const yaml = buildLib('js-yaml');
const GROUPS = new Set(['release-windows', 'release-mac', 'release-linux-x64', 'release-linux-arm64']);

export function readBuildYaml(text) { return yaml.load(text, { schema: yaml.JSON_SCHEMA }); }

function manifestGroups(version) {
  const base = `Backspace-Fork-${version}-`;
  return {
    'release-windows': { manifest: 'latest.yml', required: ['win-x64.exe', 'win-arm64.exe'].map((name) => base + name), optional: [] },
    'release-mac': { manifest: 'latest-mac.yml', required: ['mac-x64.dmg', 'mac-arm64.dmg'].map((name) => base + name), optional: [] },
    'release-linux-x64': { manifest: 'latest-linux.yml', required: [base + 'linux-x86_64.AppImage'], optional: [base + 'linux-amd64.deb'] },
    'release-linux-arm64': { manifest: 'latest-linux-arm64.yml', required: [base + 'linux-arm64.AppImage'], optional: [base + 'linux-arm64.deb'] },
  };
}
export function expectedDesktopGroupAssets(version, group) {
  const expected = expectedDesktopAssets(version);
  const config = manifestGroups(version)[group];
  if (!config) throw new Error('Unknown desktop artifact group');
  return expected.filter((name) => name === config.manifest || [...config.required, ...config.optional].some((installer) => name === installer || name === installer + '.blockmap'));
}

function validateManifest(value, version, group, byName) {
  const name = group.manifest;
  if (!value || value.version !== version || !Array.isArray(value.files) || !value.files.length || value.files.length > 8) throw new Error(`Invalid version/files in ${name}`);
  if (value.packages !== undefined) throw new Error(`Unexpected alternate package references in ${name}`);
  const allowed = [...group.required, ...group.optional]; const seen = new Set();
  for (const entry of value.files) {
    if (!entry || !allowed.includes(entry.url) || seen.has(entry.url)) throw new Error(`Unsafe/unexpected/duplicate reference in ${name}`);
    seen.add(entry.url);
    const actual = byName.get(entry.url);
    if (!Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size !== actual?.size || entry.sha512 !== actual.sha512) throw new Error(`Updater size/hash mismatch in ${name}: ${entry.url}`);
  }
  for (const installer of group.required) if (!seen.has(installer)) throw new Error(`Missing architecture reference in ${name}: ${installer}`);
  if (value.path !== group.required[0] || !seen.has(value.path) || value.sha512 !== byName.get(value.path)?.sha512) throw new Error(`Legacy path/hash mismatch in ${name}`);
}

/** Packaging output includes unpacked apps/debug logs; only this exact group is uploaded. */
export async function validateDesktopBuildGroup(directory, version, group) {
  const expected = expectedDesktopGroupAssets(version, group);
  for (const name of await fs.readdir(directory)) {
    if ((name.startsWith('Backspace-Fork-') || name.startsWith('latest')) && !expected.includes(name)) throw new Error(`Unexpected build output: ${name}`);
  }
  const assets = [];
  for (const name of expected) {
    const filename = path.join(directory, name); const stat = await fs.lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error(`Missing regular nonempty build asset: ${name}`);
    assets.push({ name, ...await hashReleaseFile(filename) });
  }
  const config = manifestGroups(version)[group];
  const text = await fs.readFile(path.join(directory, config.manifest), 'utf8');
  if (text.length > 65536) throw new Error('Oversized updater manifest');
  validateManifest(readBuildYaml(text), version, config, new Map(assets.map((asset) => [asset.name, asset])));
  return { assets };
}

export function expectedDesktopAssets(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version)) throw new Error('Release version must be stable bounded SemVer');
  const base = `Backspace-Fork-${version}-`;
  const mapped = ['win-x64.exe', 'win-arm64.exe', 'mac-x64.dmg', 'mac-arm64.dmg'];
  return [...mapped.flatMap((name) => [base + name, base + name + '.blockmap']),
    ...['linux-x86_64.AppImage', 'linux-amd64.deb', 'linux-arm64.AppImage', 'linux-arm64.deb'].map((name) => base + name),
    'latest.yml', 'latest-mac.yml', 'latest-linux.yml', 'latest-linux-arm64.yml'].sort();
}

async function scan(directory, expected) {
  const root = await fs.lstat(directory);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Artifact root must be a regular directory, not a symlink');
  const files = new Map(); let groups = 0; let direct = 0;
  async function add(folder, name) {
    const filename = path.join(folder, name); const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Artifact must be a regular file (no symlinks/directories): ${name}`);
    if (!expected.includes(name)) throw new Error(`Unexpected release asset: ${name}`);
    if (files.has(name)) throw new Error(`Duplicate release asset: ${name}`);
    if (!stat.size) throw new Error(`Empty release asset: ${name}`);
    files.set(name, filename);
  }
  for (const name of await fs.readdir(directory)) {
    const filename = path.join(directory, name); const stat = await fs.lstat(filename);
    if (stat.isSymbolicLink()) throw new Error(`Artifact symlink refused: ${name}`);
    if (stat.isDirectory()) {
      if (!GROUPS.has(name)) throw new Error(`Unexpected artifact directory: ${name}`);
      groups++;
      for (const child of await fs.readdir(filename)) await add(filename, child);
    } else { direct++; await add(directory, name); }
  }
  if (groups && (groups !== GROUPS.size || direct)) throw new Error('All four artifact directories are required, without mixed root files');
  for (const name of expected) if (!files.has(name)) throw new Error(`Missing release asset: ${name}`);
  return files;
}

export async function hashReleaseFile(filename) {
  const before = await fs.stat(filename);
  const sha256 = createHash('sha256'); const sha512 = createHash('sha512'); let size = 0;
  for await (const bytes of createReadStream(filename)) { size += bytes.length; sha256.update(bytes); sha512.update(bytes); }
  const after = await fs.stat(filename);
  if (size !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error('Artifact changed while hashing');
  return { size, sha256: sha256.digest('hex'), sha512: sha512.digest('base64') };
}

export async function validateDesktopRelease(directory, version) {
  const expected = expectedDesktopAssets(version);
  const files = await scan(directory, expected);
  const assets = [];
  for (const name of expected) assets.push({ name, ...await hashReleaseFile(files.get(name)) });
  const byName = new Map(assets.map((asset) => [asset.name, asset]));
  for (const group of Object.values(manifestGroups(version))) {
    const name = group.manifest;
    if (byName.get(name).size > 65536) throw new Error(`Oversized updater manifest: ${name}`);
    validateManifest(readBuildYaml(await fs.readFile(files.get(name), 'utf8')), version, group, byName);
  }
  return { assets };
}

export async function assembleDesktopRelease(directory, destination, version) {
  const inventory = await validateDesktopRelease(directory, version);
  const sources = await scan(directory, inventory.assets.map((asset) => asset.name));
  await fs.mkdir(destination); // Exclusive: never silently replace a prior run.
  for (const asset of inventory.assets) await fs.copyFile(sources.get(asset.name), path.join(destination, asset.name), constants.COPYFILE_EXCL);
  const copied = await validateDesktopRelease(destination, version);
  if (JSON.stringify(copied) !== JSON.stringify(inventory)) throw new Error('Artifact inventory changed during assembly');
  return inventory;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { directory: { type: 'string' }, version: { type: 'string' }, output: { type: 'string' }, assemble: { type: 'string' } }, strict: true, allowPositionals: false });
  if (!values.directory || !values.output) throw new Error('Usage: --directory <dir> --version <stable> --output <new inventory> [--assemble <new directory>]');
  const inventory = values.assemble ? await assembleDesktopRelease(values.directory, values.assemble, values.version) : await validateDesktopRelease(values.directory, values.version);
  await fs.writeFile(values.output, JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
  console.log(`Verified ${inventory.assets.length} desktop assets for ${values.version}`);
}
