import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedDesktopAssets } from './desktop-release-assets.mjs';
import { verifyUpdaterPublisher } from './verify-desktop-build.mjs';

test('requires the exact Veyvox inventory and public canonical publisher', () => {
  const names = expectedDesktopAssets('1.17.0');
  assert.equal(names.length, 16);
  assert.ok(names.includes('Veyvox-1.17.0-win-arm64.exe'));
  assert.ok(names.includes('Veyvox-1.17.0-linux-amd64.deb'));
  assert.ok(names.includes('latest.yml'));
  assert.doesNotThrow(() => verifyUpdaterPublisher('provider: github\nowner: bernardokcosta\nrepo: veyvox\n'));
  assert.throws(() => verifyUpdaterPublisher('provider: github\nowner: bernardokcosta\nrepo: backspace\n'));
  assert.throws(() => verifyUpdaterPublisher('provider: github\nowner: bernardokcosta\nrepo: veyvox\nprivate: true\n'));
});

test('packaged updater and app metadata preserve the measured installed identity', async () => {
  const { verifyPackagedIdentity } = await import('./verify-desktop-build.mjs');
  const config = 'provider: github\nowner: bernardokcosta\nrepo: veyvox\nupdaterCacheDirName: "@backspacedesktop-updater"\n';
  assert.doesNotThrow(() => verifyPackagedIdentity(config, { name: '@backspace/desktop', version: '1.17.0' }, '1.17.0'));
  assert.throws(() => verifyPackagedIdentity(config.replace('@backspacedesktop-updater', 'veyvox-updater'), { name: '@backspace/desktop', version: '1.17.0' }, '1.17.0'));
  assert.throws(() => verifyPackagedIdentity(config, { name: '@veyvox/desktop', version: '1.17.0' }, '1.17.0'));
  assert.throws(() => verifyPackagedIdentity(config, { name: '@backspace/desktop', version: '1.16.8' }, '1.17.0'));
});

test('the eight web installer choices match the exact release inventory', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile(new URL('../packages/web/src/platform/desktopDownload.ts', import.meta.url), 'utf8');
  const choices = [...source.matchAll(/fileSuffix: '([^']+)', ext: '([^']+)'/g)].map(([, suffix, ext]) => `Veyvox-1.17.0${suffix}.${ext}`).sort();
  assert.equal(choices.length, 8);
  assert.deepEqual(choices, expectedDesktopAssets('1.17.0').filter(name => /\.(exe|dmg|deb|AppImage)$/.test(name)).sort());
});
