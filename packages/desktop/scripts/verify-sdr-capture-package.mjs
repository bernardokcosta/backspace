import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { verifyPeArchitecture } from './sdr-capture-build-config.mjs';

/** electron-builder 26's Arch enum; never use process.arch for a target. */
export function builderSdrArchitecture(arch) {
  const target = { 1: 'x64', 3: 'arm64' }[arch];
  if (typeof arch !== 'number' || !target) throw new Error('Unsupported Windows SDR package architecture');
  return target;
}

export function verifySdrCapturePackage(resources, arch) {
  if (!['x64', 'arm64'].includes(arch)) throw new Error('Unsupported Windows SDR package architecture');
  if (typeof resources !== 'string' || !resources) throw new Error('A resources directory is required');
  const directory = path.resolve(resources, 'sdr-capture');
  const binary = path.join(directory, 'sdr_capture.node');
  const folder = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (!folder?.isDirectory() || folder.isSymbolicLink()) throw new Error(`Missing regular SDR directory for ${binary}`);
  const entries = fs.readdirSync(directory);
  if (entries.length !== 1 || entries[0] !== 'sdr_capture.node') throw new Error(`SDR resources must contain only sdr_capture.node: ${directory}`);
  const file = fs.lstatSync(binary, { throwIfNoEntry: false });
  if (!file?.isFile() || file.isSymbolicLink()) throw new Error(`SDR addon must be a regular file: ${binary}`);
  verifyPeArchitecture(fs.readFileSync(binary), arch);
  return { arch, binary, runtimeLoad: 'not-tested' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { resources: { type: 'string' }, arch: { type: 'string' } }, strict: true, allowPositionals: false });
  console.log(JSON.stringify(verifySdrCapturePackage(values.resources, values.arch)));
}
