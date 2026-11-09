import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { readDesktopCatalogs } from './i18n/desktop.mjs';
import { readBuildYaml } from './desktop-release-assets.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = name => fs.readFileSync(path.join(ROOT, name), 'utf8').replaceAll('\r\n', '\n');
const json = name => JSON.parse(read(name));
test('uses Veyvox workspace names without changing third-party resolutions', () => {
  assert.equal(json('package.json').name, 'veyvox');
  for (const name of ['shared', 'server', 'web', 'desktop']) {
    const manifest = json(`packages/${name}/package.json`);
    assert.equal(manifest.name, `@veyvox/${name}`);
    for (const dependencies of [manifest.dependencies, manifest.devDependencies]) {
      for (const key of Object.keys(dependencies ?? {})) assert.ok(!key.startsWith('@backspace/'), key);
    }
  }
  const lock = read('pnpm-lock.yaml').replaceAll('\r\n', '\n');
  const start = lock.indexOf('\npackages:\n');
  assert.ok(start > 0);
  assert.equal(createHash('sha256').update(lock.slice(start)).digest('hex'), 'cbf9066fcf73dd5a68b6d2861e7bba94c0ce74b7df4321a9a84c23ef36a0adf9');
  assert.match(read('package.json'), /@veyvox\/shared build && pnpm --filter @veyvox\/server build && pnpm --filter @veyvox\/web build/);
});

test('retains installed desktop, storage and operational identities', () => {
  const builder = read('packages/desktop/electron-builder.yml');
  assert.match(builder, /^appId: io\.github\.bernardokcosta\.backspacefork$/m);
  assert.match(builder, /^productName: Veyvox$/m);
  assert.match(builder, /^executableName: Backspace Fork$/m);
  assert.match(builder, /extraMetadata:\r?\n  name: '@backspace\/desktop'/);
  assert.match(builder, /CFBundleName: Backspace Fork/);
  assert.match(builder, /CFBundleDisplayName: Veyvox/);
  assert.equal(json('packages/desktop/package.json').desktopName, 'io.github.bernardokcosta.backspacefork.desktop');
  const compose = read('docker-compose.yml');
  for (const required of ['  backspace:', 'container_name: backspace', './data:/app/data', '/app/data/backspace.db', 'BACKSPACE_IMAGE']) assert.ok(compose.includes(required));
  assert.match(read('packages/shared/src/types.ts'), /X-Backspace-Paging/);
  assert.match(read('packages/web/src/stores/authStore.ts'), /backspace_token/);
  assert.match(read('packages/web/src/stores/junoPreferences.ts'), /backspace-juno-preferences/);
});

test('all 25 complete catalogs and native surfaces use the current product name', () => {
  assert.match(read('packages/desktop/resources/instance-picker.html'), /placeholder="instance\.example\.com"/);
  const languages = fs.readdirSync(path.join(ROOT, 'packages/web/src/locales'));
  assert.equal(languages.length, 25);
  for (const language of languages) {
    const folder = `packages/web/src/locales/${language}`;
    assert.equal(fs.readdirSync(path.join(ROOT, folder)).filter(n => n.endsWith('.json')).length, 15);
    assert.equal(json(`${folder}/common.json`).appName, 'Veyvox');
    // The actual Backspace keyboard key and retained code/env tokens are not branding.
    for (const name of fs.readdirSync(path.join(ROOT, folder))) {
      const visit = (object, prefix = '') => {
        for (const [key, value] of Object.entries(object)) {
          const full = prefix ? `${prefix}.${key}` : key;
          if (typeof value === 'string' && full !== 'soundboard.shortcutHint') assert.doesNotMatch(value, /Backspace/, `${language}/${name}:${full}`);
          else if (value && typeof value === 'object') visit(value, full);
        }
      };
      visit(json(`${folder}/${name}`));
    }
  }
  for (const catalog of readDesktopCatalogs(ROOT).catalogs) {
    for (const value of Object.values(catalog.values)) assert.doesNotMatch(value, /Backspace/);
  }
});

test('keeps the public legacy container channel while advertising Veyvox source', () => {
  const workflow = read('.github/workflows/docker-publish.yml');
  assert.match(workflow, /images: ghcr\.io\/bernardokcosta\/backspace/);
  assert.match(workflow, /org\.opencontainers\.image\.title=Veyvox/);
  assert.match(workflow, /org\.opencontainers\.image\.source=https:\/\/github\.com\/bernardokcosta\/veyvox/);
  for (const required of ['linux/amd64,linux/arm64', 'sbom: true', 'provenance: true', 'BACKSPACE_COMMIT']) assert.ok(workflow.includes(required));
});

test('retains the baseline Compose graphs, including project service/mount/env identities', () => {
  // JSON serialization of js-yaml JSON_SCHEMA output measured at baseline
  // 8ee1b4b4; comments do not influence either graph. No .env or daemon read.
  for (const [file, expected] of Object.entries({
    'docker-compose.yml': '79f3d84fe9521d361f94b49de9a858f63b9a0a6d08ccc6d491525877a350bc9a',
    'docker-compose.proxy.yml': '5e8864652a9c772eb1955986aee9475fbae07153af81993c63b8be5a9261e67d',
  })) assert.equal(createHash('sha256').update(JSON.stringify(readBuildYaml(read(file)))).digest('hex'), expected, file);
});
