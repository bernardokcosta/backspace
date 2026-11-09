import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { readBuildYaml } from '../../../scripts/desktop-release-assets.mjs';
import macSigning from './macSign.js';

const { alignMacHelperNames, verifyMacHelperLayout } = macSigning;
const desktop = path.resolve(import.meta.dirname, '..');
const require = createRequire(path.join(desktop, 'package.json'));
const builder = createRequire(require.resolve('electron-builder/package.json'));
const buildLib = createRequire(builder.resolve('app-builder-lib/package.json'));
// Use the package's normal entry order before its internal macOS seam; a direct
// first import of electronMac.js hits the builder's PlatformPackager cycle.
buildLib('./out/index.js');
const { AppInfo } = require(path.join(path.dirname(builder.resolve('app-builder-lib/package.json')), 'out/appInfo.js'));
const { createMacApp } = buildLib('./out/electron/electronMac.js');
const plistCodec = buildLib('plist');
const config = readBuildYaml(fs.readFileSync(path.join(desktop, 'electron-builder.yml'), 'utf8'));
const info = new AppInfo({ config, metadata: { ...JSON.parse(fs.readFileSync(path.join(desktop, 'package.json'), 'utf8')), ...config.extraMetadata } }, undefined, config.mac);
const suffixes = [' Helper', ' Helper (Renderer)', ' Helper (GPU)', ' Helper (Plugin)'];

function snapshot(root) {
  return fs.readdirSync(root, { recursive: true }).filter(name => fs.statSync(path.join(root, name)).isFile())
    .sort().map(name => [name, fs.readFileSync(path.join(root, name), 'utf8')]);
}

function fixture(t) {
  const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'veyvox-mac-helpers-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const app = path.join(root, `${info.productFilename}.app`);
  const contents = path.join(app, 'Contents');
  fs.mkdirSync(contents, { recursive: true });
  fs.writeFileSync(path.join(contents, 'Info.plist'), JSON.stringify({ CFBundleName: config.mac.extendInfo.CFBundleName, CFBundleDisplayName: 'Veyvox' }));
  for (const suffix of suffixes) {
    // electronMac.js uses sanitizedProductName, NOT productFilename, for helpers.
    const helper = path.join(contents, 'Frameworks', `${info.sanitizedProductName}${suffix}.app`, 'Contents');
    fs.mkdirSync(path.join(helper, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(helper, 'MacOS', info.sanitizedProductName + suffix), 'unchanged Mach-O fixture');
    fs.writeFileSync(path.join(helper, 'Info.plist'), JSON.stringify({ CFBundleExecutable: info.sanitizedProductName + suffix,
      CFBundleIdentifier: info.id + '.helper' + suffix, CFBundleDisplayName: 'Veyvox' + suffix }));
  }
  // The real macOS gate uses plutil. This fixture models its structured fields,
  // not the application process, signing, crypto or a real installed profile.
  const execute = (file, args) => {
    assert.equal(file, 'plutil');
    const plist = args.at(-1), value = JSON.parse(fs.readFileSync(plist, 'utf8'));
    if (args[0] === '-extract') return value[args[1]];
    assert.deepEqual(args.slice(0, 3), ['-replace', 'CFBundleExecutable', '-string']);
    value.CFBundleExecutable = args[3];
    fs.writeFileSync(plist, JSON.stringify(value));
    return '';
  };
  return { root, app, contents, execute };
}

test('aligns actual builder helper names with the retained CFBundleName before signing', t => {
  assert.equal(info.sanitizedProductName, 'Veyvox');
  assert.equal(info.productFilename, 'Backspace Fork');
  const f = fixture(t);
  assert.throws(() => verifyMacHelperLayout(f.app, f.execute), /helper/i);
  assert.equal(alignMacHelperNames(f.app, info.sanitizedProductName, f.execute), 4);
  assert.equal(verifyMacHelperLayout(f.app, f.execute), 4);
  for (const suffix of suffixes) {
    const helper = path.join(f.contents, 'Frameworks', `Backspace Fork${suffix}.app`, 'Contents');
    const plist = JSON.parse(fs.readFileSync(path.join(helper, 'Info.plist'), 'utf8'));
    assert.equal(plist.CFBundleExecutable, 'Backspace Fork' + suffix);
    assert.equal(plist.CFBundleIdentifier, info.id + '.helper' + suffix);
    assert.equal(plist.CFBundleDisplayName, 'Veyvox' + suffix);
    assert.equal(fs.readFileSync(path.join(helper, 'MacOS', 'Backspace Fork' + suffix), 'utf8'), 'unchanged Mach-O fixture');
    assert.equal(fs.existsSync(path.join(f.contents, 'Frameworks', `Veyvox${suffix}.app`)), false);
  }
  assert.equal(alignMacHelperNames(f.app, info.sanitizedProductName, f.execute), 0);
});

test('refuses collisions and inconsistent executables before changing any helper', t => {
  for (const problem of ['collision', 'binary-collision', 'executable', 'unsafe-name']) {
    const f = fixture(t);
    if (problem === 'collision') fs.mkdirSync(path.join(f.contents, 'Frameworks', 'Backspace Fork Helper (Renderer).app'));
    if (problem === 'binary-collision') fs.writeFileSync(path.join(f.contents, 'Frameworks', 'Veyvox Helper.app', 'Contents', 'MacOS', 'Backspace Fork Helper'), 'must not overwrite');
    if (problem === 'executable') {
      const file = path.join(f.contents, 'Frameworks', 'Veyvox Helper (Renderer).app', 'Contents', 'Info.plist');
      const value = JSON.parse(fs.readFileSync(file, 'utf8')); value.CFBundleExecutable = 'unexpected';
      fs.writeFileSync(file, JSON.stringify(value));
    }
    if (problem === 'unsafe-name') fs.writeFileSync(path.join(f.contents, 'Info.plist'), '{"CFBundleName":"../outside"}');
    const before = snapshot(f.root);
    assert.throws(() => alignMacHelperNames(f.app, info.sanitizedProductName, f.execute));
    assert.deepEqual(snapshot(f.root), before);
  }
});

test('afterPack aligns helpers before fuse flipping and final signing', () => {
  const hook = fs.readFileSync(path.join(import.meta.dirname, 'afterPack.js'), 'utf8');
  const align = hook.lastIndexOf('alignMacHelperNames(');
  assert.ok(align >= 0);
  assert.ok(align < hook.lastIndexOf('await flipElectronFuses('));
  assert.ok(hook.lastIndexOf('await flipElectronFuses(') < hook.lastIndexOf('signMacAppIfUnsigned('));
});

test('repairs the layout emitted by the pinned real macOS packager without executing a Mac binary', async t => {
  const temp = process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Temp', 'opencode') : os.tmpdir();
  fs.mkdirSync(temp, { recursive: true });
  const root = fs.mkdtempSync(path.join(temp, 'veyvox-real-mac-packager-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const contents = path.join(root, 'Electron.app', 'Contents');
  const writePlist = (file, value) => fs.writeFileSync(file, plistCodec.build(value));
  fs.mkdirSync(path.join(contents, 'MacOS'), { recursive: true });
  fs.writeFileSync(path.join(contents, 'MacOS', 'Electron'), 'unexecuted fixture');
  writePlist(path.join(contents, 'Info.plist'), { CFBundleName: 'Electron', CFBundleExecutable: 'Electron' });
  for (const suffix of suffixes) {
    const helper = path.join(contents, 'Frameworks', `Electron${suffix}.app`, 'Contents');
    fs.mkdirSync(path.join(helper, 'MacOS'), { recursive: true });
    fs.writeFileSync(path.join(helper, 'MacOS', 'Electron' + suffix), 'unexecuted helper fixture');
    writePlist(path.join(helper, 'Info.plist'), { CFBundleExecutable: 'Electron' + suffix });
  }
  await createMacApp({ appInfo: info, config, platformSpecificBuildOptions: config.mac, fileAssociations: [],
    info: { framework: { distMacOsAppName: 'Electron.app' } },
    applyCommonInfo: async value => Object.assign(value, { CFBundleExecutable: info.productFilename,
      CFBundleVersion: info.version, CFBundleShortVersionString: info.version, ...config.mac.extendInfo }),
  }, root, null, false);
  const app = path.join(root, 'Backspace Fork.app');
  const mainBefore = fs.readFileSync(path.join(app, 'Contents/Info.plist'));
  const helperBefore = suffixes.map(suffix => plistCodec.parse(fs.readFileSync(path.join(app,
    'Contents', 'Frameworks', `Veyvox${suffix}.app`, 'Contents', 'Info.plist'), 'utf8')));
  const execute = (file, args) => {
    assert.equal(file, 'plutil');
    const target = args.at(-1), value = plistCodec.parse(fs.readFileSync(target, 'utf8'));
    if (args[0] === '-extract') return value[args[1]];
    assert.deepEqual(args.slice(0, 3), ['-replace', 'CFBundleExecutable', '-string']);
    value.CFBundleExecutable = args[3]; writePlist(target, value); return '';
  };
  assert.equal(execute('plutil', ['-extract', 'CFBundleName', 'raw', '-o', '-', path.join(app, 'Contents/Info.plist')]), 'Backspace Fork');
  assert.ok(fs.existsSync(path.join(app, 'Contents/Frameworks/Veyvox Helper.app')));
  assert.throws(() => verifyMacHelperLayout(app, execute), /Missing macOS helper/);
  assert.equal(alignMacHelperNames(app, info.sanitizedProductName, execute), 4);
  assert.equal(verifyMacHelperLayout(app, execute), 4);
  assert.ok(fs.readFileSync(path.join(app, 'Contents/Info.plist')).equals(mainBefore));
  for (const [index, suffix] of suffixes.entries()) {
    const actual = plistCodec.parse(fs.readFileSync(path.join(app, 'Contents', 'Frameworks', `Backspace Fork${suffix}.app`, 'Contents', 'Info.plist'), 'utf8'));
    assert.deepEqual(actual, { ...helperBefore[index], CFBundleExecutable: 'Backspace Fork' + suffix });
  }
  assert.equal(fs.readFileSync(path.join(app, 'Contents/Frameworks/Backspace Fork Helper.app/Contents/MacOS/Backspace Fork Helper'), 'utf8'), 'unexecuted helper fixture');
});
