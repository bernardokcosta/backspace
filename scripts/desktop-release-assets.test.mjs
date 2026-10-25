import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { expectedDesktopAssets, validateDesktopRelease, assembleDesktopRelease, expectedDesktopGroupAssets, validateDesktopBuildGroup, readBuildYaml } from './desktop-release-assets.mjs';
import { verifyUpdaterPublisher } from './verify-desktop-build.mjs';
import { releaseFixture } from './fixtures/desktop-release.mjs';

const VERSION = '1.15.1';

test('exact inventory covers sixteen unique files and every updater reference', async (t) => {
  const directory = await releaseFixture(t);
  assert.equal(new Set(expectedDesktopAssets(VERSION)).size, 16);
  const inventory = await validateDesktopRelease(directory, VERSION);
  assert.equal(inventory.assets.length, 16);
  assert.ok(inventory.assets.every((asset) => asset.size > 0 && /^[a-f0-9]{64}$/.test(asset.sha256) && /^[A-Za-z0-9+/]{86}==$/.test(asset.sha512)));
  for (const version of ['v1.15.1', '1.15.1-beta', '../1.15.1', '']) assert.throws(() => expectedDesktopAssets(version));
});

test('build group fails if either architecture is missing and updater publisher remains fork-owned', async (t) => {
  const directory = await releaseFixture(t); const grouped = path.join(directory, 'candidate'); await fs.mkdir(grouped);
  for (const name of expectedDesktopGroupAssets(VERSION, 'release-windows')) await fs.copyFile(path.join(directory, name), path.join(grouped, name));
  assert.equal((await validateDesktopBuildGroup(grouped, VERSION, 'release-windows')).assets.length, 5);
  await fs.unlink(path.join(grouped, `Backspace-Fork-${VERSION}-win-arm64.exe`));
  await assert.rejects(validateDesktopBuildGroup(grouped, VERSION, 'release-windows'));
  verifyUpdaterPublisher('provider: github\nowner: bernardokcosta\nrepo: backspace\n');
  for (const text of ['provider: generic\nurl: https://foreign.test', 'provider: github\nowner: TheZwiss\nrepo: backspace', 'provider: github\nowner: bernardokcosta\nrepo: backspace\ntoken: secret']) assert.throws(() => verifyUpdaterPublisher(text));
});

test('workflow keeps matrix read-only, fuses/signature before artifact upload and one gated publisher', async () => {
  const workflow = readBuildYaml(await fs.readFile(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8'));
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const build = workflow.jobs.build;
  assert.equal(build.permissions.contents, 'read'); assert.doesNotMatch(JSON.stringify(build), /GH_TOKEN|publish always/);
  assert.ok(build.steps.find((step) => step.run?.includes('electron-builder') && step.run.includes('--publish never')));
  const fuseIndex = build.steps.findIndex((step) => step.name === 'Verify Electron security fuses');
  const signIndex = build.steps.findIndex((step) => step.name === 'Verify macOS code signature');
  const uploadIndex = build.steps.findIndex((step) => step.uses?.startsWith('actions/upload-artifact@'));
  assert.ok(fuseIndex >= 0 && signIndex > fuseIndex && uploadIndex > signIndex);
  assert.match(build.steps[fuseIndex].run, /if \[ "\$failed" -ne 0 \]/);
  assert.deepEqual(workflow.jobs.publish.needs, ['build', 'native-sdr', 'validate']);
  assert.match(workflow.jobs.publish.if, /github.event_name == 'push'.*refs\/tags\//);
  assert.equal(workflow.jobs.validate.needs, 'build');
  assert.ok(workflow.on.pull_request && Object.hasOwn(workflow.on, 'workflow_dispatch'));
  assert.ok(workflow.jobs.publish.steps.some((step) => step.run?.includes('ci.yml/runs?head_sha=$COMMIT')));
  assert.equal(Object.values(workflow.jobs).filter((job) => job.permissions?.contents === 'write').length, 1);
});

test('missing, empty and truncated assets fail before publication', async (t) => {
  const directory = await releaseFixture(t);
  const asset = path.join(directory, `Backspace-Fork-${VERSION}-win-arm64.exe`);
  const bytes = await fs.readFile(asset);
  await fs.writeFile(asset, bytes.subarray(0, 3));
  await assert.rejects(validateDesktopRelease(directory, VERSION), /hash|size/i);
  await fs.writeFile(asset, ''); await assert.rejects(validateDesktopRelease(directory, VERSION), /empty/i);
  await fs.unlink(asset); await assert.rejects(validateDesktopRelease(directory, VERSION), /missing/i);
});

test('rejects wrong versions, unsafe references and a missing ARM updater entry', async (t) => {
  const directory = await releaseFixture(t); const file = path.join(directory, 'latest.yml');
  const original = JSON.parse(await fs.readFile(file, 'utf8'));
  for (const bad of ['../x.exe', '/absolute.exe', 'C:\\x.exe', '%2e%2e%2fx.exe', 'https://other.test/x.exe', 'file.exe?token=x']) {
    const manifest = structuredClone(original); manifest.files[1].url = bad;
    await fs.writeFile(file, JSON.stringify(manifest)); await assert.rejects(validateDesktopRelease(directory, VERSION));
  }
  for (const mutation of [
    (value) => { value.version = '1.15.0'; },
    (value) => { value.files.pop(); },
    (value) => { value.files[1].size = -1; },
    (value) => { value.files[1].sha512 = value.files[0].sha512; },
    (value) => { value.sha512 = value.files[1].sha512; },
    (value) => { value.path = value.files[1].url; value.sha512 = value.files[1].sha512; },
    (value) => { value.packages = { arm64: { path: 'https://foreign.test/package' } }; },
    (value) => { value.files.push(value.files[0]); },
  ]) {
    const manifest = structuredClone(original); mutation(manifest);
    await fs.writeFile(file, JSON.stringify(manifest)); await assert.rejects(validateDesktopRelease(directory, VERSION));
  }
});

test('rejects unexpected files, nested/duplicate basenames and symlink escapes', async (t) => {
  const directory = await releaseFixture(t);
  await fs.mkdir(path.join(directory, 'hidden'));
  await fs.copyFile(path.join(directory, 'latest.yml'), path.join(directory, 'hidden', 'latest.yml'));
  await assert.rejects(validateDesktopRelease(directory, VERSION), /directory|duplicate/i);
  await fs.rm(path.join(directory, 'hidden'), { recursive: true });
  await fs.writeFile(path.join(directory, 'unexpected.zip'), 'x');
  await assert.rejects(validateDesktopRelease(directory, VERSION), /unexpected/i);
  await fs.unlink(path.join(directory, 'unexpected.zip'));
  const outside = await fs.mkdtemp(path.join(path.dirname(directory), 'release-outside-'));
  t.after(() => fs.rm(outside, { recursive: true, force: true }));
  await fs.symlink(outside, path.join(directory, 'release-windows'), 'junction');
  await assert.rejects(validateDesktopRelease(directory, VERSION), /symlink|regular/i);
});

test('assembles four immutable artifacts only after collision validation', async (t) => {
  const directory = await releaseFixture(t);
  const grouped = `${directory}-grouped`; const assembled = `${directory}-assembled`;
  t.after(() => Promise.all([fs.rm(grouped, { recursive: true, force: true }), fs.rm(assembled, { recursive: true, force: true })]));
  await fs.mkdir(grouped);
  for (const name of expectedDesktopAssets(VERSION)) {
    const group = name.includes('win-') || name === 'latest.yml' ? 'windows'
      : name.includes('mac-') || name === 'latest-mac.yml' ? 'mac'
      : name.includes('arm64') ? 'linux-arm64' : 'linux-x64';
    const folder = path.join(grouped, `release-${group}`);
    await fs.mkdir(folder, { recursive: true }); await fs.copyFile(path.join(directory, name), path.join(folder, name));
  }
  await assembleDesktopRelease(grouped, assembled, VERSION);
  assert.equal((await validateDesktopRelease(assembled, VERSION)).assets.length, 16);
  await assert.rejects(assembleDesktopRelease(grouped, assembled, VERSION), /exist/i);
  await fs.copyFile(path.join(directory, 'latest.yml'), path.join(grouped, 'release-mac', 'latest.yml'));
  await assert.rejects(validateDesktopRelease(grouped, VERSION), /duplicate/i);
});
