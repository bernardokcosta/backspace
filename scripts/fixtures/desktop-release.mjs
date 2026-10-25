import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expectedDesktopAssets } from '../desktop-release-assets.mjs';

/** Synthetic bytes only; never a real installer or release credential. */
export async function releaseFixture(t) {
  const version = '1.15.1';
  const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  const directory = await fs.mkdtemp(path.join(temp, 'desktop-release-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  for (const name of expectedDesktopAssets(version).filter((name) => !name.endsWith('.yml'))) await fs.writeFile(path.join(directory, name), `synthetic-${name}`);
  const groups = {
    'latest.yml': ['win-x64.exe', 'win-arm64.exe'],
    'latest-mac.yml': ['mac-x64.dmg', 'mac-arm64.dmg'],
    'latest-linux.yml': ['linux-x86_64.AppImage', 'linux-amd64.deb'],
    'latest-linux-arm64.yml': ['linux-arm64.AppImage', 'linux-arm64.deb'],
  };
  for (const [manifest, suffixes] of Object.entries(groups)) {
    const files = [];
    for (const suffix of suffixes) {
      const url = `Backspace-Fork-${version}-${suffix}`;
      const bytes = await fs.readFile(path.join(directory, url));
      files.push({ url, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') });
    }
    // JSON is a strict subset of YAML; fixtures need no additional parser.
    await fs.writeFile(path.join(directory, manifest), JSON.stringify({ version, files, path: files[0].url, sha512: files[0].sha512 }));
  }
  return directory;
}
