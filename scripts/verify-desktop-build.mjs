import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readBuildYaml, validateDesktopBuildGroup } from './desktop-release-assets.mjs';
import { verifySdrCapturePackage } from '../packages/desktop/scripts/verify-sdr-capture-package.mjs';

export function verifyUpdaterPublisher(text) {
  const config = readBuildYaml(text);
  if (config?.provider !== 'github' || config.owner !== 'bernardokcosta' || config.repo !== 'backspace'
    || config.token || config.url || config.private) throw new Error('Packaged updater must target the public fork without credentials/alternate feed');
}
export async function verifyDesktopBuild(directory, version, group) {
  const inventory = await validateDesktopBuildGroup(directory, version, group);
  const resourcePaths = {
    'release-windows': ['win-unpacked/resources', 'win-arm64-unpacked/resources'],
    'release-mac': ['mac/Backspace Fork.app/Contents/Resources', 'mac-arm64/Backspace Fork.app/Contents/Resources'],
    'release-linux-x64': ['linux-unpacked/resources'],
    'release-linux-arm64': ['linux-arm64-unpacked/resources'],
  }[group];
  for (const [index, relative] of resourcePaths.entries()) {
    const resources = path.join(directory, relative);
    verifyUpdaterPublisher(await fs.readFile(path.join(resources, 'app-update.yml'), 'utf8'));
    if (group === 'release-windows') verifySdrCapturePackage(resources, index === 0 ? 'x64' : 'arm64');
  }
  return inventory;
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { directory: { type: 'string' }, group: { type: 'string' } }, strict: true, allowPositionals: false });
  if (!values.directory || !values.group) throw new Error('Usage: --directory <build output> --group release-windows|release-mac|release-linux-x64|release-linux-arm64');
  const { version } = JSON.parse(await fs.readFile(new URL('../packages/desktop/package.json', import.meta.url), 'utf8'));
  const inventory = await verifyDesktopBuild(values.directory, version, values.group);
  console.log(`Verified ${values.group}: ${inventory.assets.length} assets, fork updater config and target resources`);
}
