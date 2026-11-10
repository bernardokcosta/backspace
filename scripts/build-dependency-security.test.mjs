import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const web = createRequire(new URL('../packages/web/package.json', import.meta.url));
const pwa = createRequire(web.resolve('vite-plugin-pwa'));
const workbox = createRequire(pwa.resolve('workbox-build'));
const resolverPath = workbox.resolve('@rollup/plugin-node-resolve');
const resolver = createRequire(resolverPath);
const resolverRoot = path.resolve(path.dirname(resolverPath), '../..');
const cjs = resolver(resolverPath);
const esm = await import(pathToFileURL(path.join(resolverRoot, 'dist/es/index.js')).href);
const expectedDefaults = {
  dedupe: [], extensions: ['.mjs', '.js', '.json', '.node'], resolveOnly: [],
  moduleDirectories: ['node_modules'], modulePaths: [], ignoreSideEffectsForRoot: false,
  allowExportsFolderMapping: true,
};

test('removes the vulnerable deepmerge package instead of renaming or ignoring it', () => {
  const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(lock, /^\s+deepmerge(?:@|:)/m);
  assert.throws(() => resolver.resolve('deepmerge'), { code: 'MODULE_NOT_FOUND' });
  for (const file of ['dist/cjs/index.js', 'dist/es/index.js']) {
    const code = fs.readFileSync(path.join(resolverRoot, file), 'utf8');
    assert.doesNotMatch(code, /(?:require\(['"]deepmerge['"]\)|from ['"]deepmerge['"])/);
    assert.match(code, /deepFreeze\(structuredClone\(defaults\)\)/);
  }
});

for (const [format, module] of [['CJS', cjs], ['ESM', esm]]) {
  test(`${format} keeps the actual resolver defaults deeply frozen and instances independent`, () => {
    assert.deepEqual(module.DEFAULTS, expectedDefaults);
    assert.equal(Object.isFrozen(module.DEFAULTS), true);
    for (const value of Object.values(module.DEFAULTS)) if (Array.isArray(value)) assert.equal(Object.isFrozen(value), true);
    const extensions = ['.fixture'];
    const first = module.nodeResolve({ extensions });
    const second = module.nodeResolve();
    assert.equal(first.name, 'node-resolve'); assert.equal(second.name, 'node-resolve');
    assert.notEqual(first, second); assert.equal(Object.isFrozen(extensions), false);
    extensions.push('.js');
    assert.deepEqual(module.DEFAULTS, expectedDefaults);
  });

  test(`${format} resolves a real package through Rollup after the dependency removal`, async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-resolver-'));
    let bundle;
    try {
      const dependency = path.join(directory, 'node_modules', 'fixture-resolver');
      fs.mkdirSync(dependency, { recursive: true });
      fs.writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'fixture-resolver', type: 'module', exports: './entry.js' }));
      fs.writeFileSync(path.join(dependency, 'entry.js'), 'export const message = "safe resolver fixture";');
      const entry = path.join(directory, 'entry.js');
      fs.writeFileSync(entry, 'import {message} from "fixture-resolver"; console.log(message);');
      const { rollup } = workbox('rollup');
      bundle = await rollup({ input: entry, plugins: [module.nodeResolve({ rootDir: directory })], onwarn(warning) { throw new Error(warning.message); } });
      const { output } = await bundle.generate({ format: 'es' });
      assert.match(output[0].code, /safe resolver fixture/);
      assert.doesNotMatch(output[0].code, /from ['"]fixture-resolver/);
    } finally { await bundle?.close(); fs.rmSync(directory, { recursive: true, force: true }); }
  });
}

test('declares exactly the Node ranges required by jsdom31 and tests their boundaries', () => {
  const desktop = createRequire(new URL('../packages/desktop/package.json', import.meta.url));
  const builder = createRequire(desktop.resolve('electron-builder/package.json'));
  const buildLib = createRequire(builder.resolve('app-builder-lib/package.json'));
  const { satisfies } = buildLib('semver');
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const jsdom = web('jsdom/package.json');
  const range = '^22.22.2 || ^24.15.0 || >=26.0.0';
  assert.equal(jsdom.version.split('.')[0], '31');
  assert.equal(root.engines.node, range);
  assert.equal(jsdom.engines.node, range);
  for (const [version, supported] of [['22.12.0', false], ['22.22.1', false], ['22.22.2', true], ['23.0.0', false],
    ['24.0.0', false], ['24.14.9', false], ['24.15.0', true], ['24.21.0', true], ['25.0.0', false], ['26.0.0', true]]) {
    assert.equal(satisfies(version, root.engines.node), supported, version);
  }
  assert.equal(fs.readFileSync(path.join(ROOT, '.nvmrc'), 'utf8').trim(), '24');
});
