/* global AbortSignal */
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { isDeepStrictEqual } from 'node:util';
import { expectedDesktopAssets, validateDesktopRelease } from './desktop-release-assets.mjs';

const REPOSITORY = 'bernardokcosta/backspace';
function identity(options) {
  if (options.repository !== REPOSITORY || !/^v\d+\.\d+\.\d+$/.test(options.tag) || !/^[a-f0-9]{40}$/.test(options.commit)) throw new Error('Invalid release repository/tag/commit');
  expectedDesktopAssets(options.tag.slice(1));
}
async function releaseState(options, api) {
  identity(options);
  if (await api.resolveCommit(options.repository, options.tag) !== options.commit) throw new Error('Release tag/commit mismatch (tag may have moved)');
  const matches = (await api.listReleases(options.repository)).filter((release) => release.tag_name === options.tag);
  if (matches.length > 1) throw new Error('Ambiguous multiple releases for tag; manual reconciliation required');
  return matches[0] ?? null;
}
async function validateIdentity(options, release) {
  if (!release || release.tag_name !== options.tag || release.target_commitish !== options.commit || release.prerelease
    || (options.releaseId !== undefined && release.id !== options.releaseId)
    || typeof release.draft !== 'boolean' || !Number.isSafeInteger(release.id) || release.id <= 0) throw new Error('Release id/tag/target/state mismatch');
  const notes = await fs.readFile(options.notesPath, 'utf8');
  if (release.body !== notes) throw new Error('Release notes differ; preserve user edits and reconcile explicitly');
}

export async function prepareDesktopRelease(options, api) {
  const existing = await releaseState(options, api);
  if (existing) { await validateIdentity(options, existing); return existing.id; }
  const notes = await fs.readFile(options.notesPath, 'utf8');
  if (!notes.startsWith(`# Backspace Fork ${options.tag.slice(1)}\n\n`) || notes.length < 100) throw new Error('Missing versioned release notes and summary');
  const created = await api.createRelease(options.repository, { tag_name: options.tag, target_commitish: options.commit,
    name: `Backspace Fork ${options.tag.slice(1)}`, body: notes, draft: true, prerelease: false });
  await validateIdentity(options, created);
  return created.id;
}

export async function publishDesktopRelease(options, api) {
  identity(options);
  if (!Number.isSafeInteger(options.releaseId) || options.releaseId <= 0) throw new Error('An explicit bootstrap release id is required');
  const inventory = await validateDesktopRelease(options.directory, options.tag.slice(1));
  if (!isDeepStrictEqual(inventory, options.inventory)) throw new Error('Local release inventory mismatch');
  const release = await releaseState(options, api);
  if (release?.id !== options.releaseId) throw new Error('Bootstrap release id does not match the unique tag release');
  await validateIdentity(options, await api.getRelease(options.repository, options.releaseId));
  const expected = new Map(inventory.assets.map((asset) => [asset.name, asset]));
  const remote = new Map();
  async function verify(asset) {
    const local = expected.get(asset.name);
    if (!local || remote.has(asset.name)) throw new Error('Unexpected/duplicate remote release asset');
    const digest = await api.assetDigest(options.repository, asset);
    if (digest.size !== local.size || digest.sha256 !== local.sha256) throw new Error(`Remote asset has different bytes/hash/size: ${asset.name}`);
    remote.set(asset.name, asset);
  }
  // Verify every pre-existing asset before any upload. Never delete or replace.
  for (const asset of await api.listAssets(options.repository, options.releaseId)) await verify(asset);
  for (const asset of inventory.assets) {
    if (remote.has(asset.name)) continue;
    const current = await api.getRelease(options.repository, options.releaseId);
    await validateIdentity(options, current);
    if (!current.draft) throw new Error('Public release is incomplete; refusing to modify public assets');
    const uploaded = await api.uploadAsset(options.repository, options.releaseId, asset, path.join(options.directory, asset.name));
    await verify(uploaded);
  }
  // Re-list the exact id, recheck bytes and identity before making it public.
  remote.clear();
  for (const asset of await api.listAssets(options.repository, options.releaseId)) await verify(asset);
  if (remote.size !== expected.size) throw new Error('Incomplete remote release inventory');
  const final = await releaseState(options, api);
  if (final?.id !== options.releaseId) throw new Error('Release identity changed during upload');
  await validateIdentity(options, final);
  if (options.publish && final.draft) {
    const published = await api.publishRelease(options.repository, options.releaseId);
    await validateIdentity(options, published);
    if (published.draft) throw new Error('Release did not become public');
  }
  return { releaseId: options.releaseId, assets: remote.size, published: options.publish || !final.draft };
}

/** Fixed trusted endpoints; injected transport is used only by loopback tests. */
export function createGitHubReleaseApi({ token, fetch: transport = globalThis.fetch }) {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw new Error('GitHub credential is required');
  async function response(url, options = {}) {
    const target = new URL(url);
    if (target.protocol !== 'https:' || !['api.github.com', 'uploads.github.com'].includes(target.hostname) || target.port || target.username || target.password) throw new Error('Untrusted GitHub API endpoint');
    const result = await transport(url, { ...options, redirect: 'manual', signal: AbortSignal.timeout(600_000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...options.headers } });
    if (!result.ok) throw new Error(`GitHub release request failed (HTTP ${result.status})`);
    return result;
  }
  async function json(route, method = 'GET', body) {
    const result = await response(`https://api.github.com${route}`, { method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    return result.json();
  }
  async function list(route) {
    const all = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await json(`${route}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Invalid GitHub list response');
      all.push(...batch);
      if (batch.length < 100) return all;
    }
    throw new Error('GitHub listing exceeds safe pagination bound');
  }
  const repo = (repository) => { if (repository !== REPOSITORY) throw new Error('Wrong publishing repository'); return `/repos/${repository}`; };
  return {
    resolveCommit: async (repository, tag) => (await json(`${repo(repository)}/commits/${encodeURIComponent(tag)}`)).sha,
    listReleases: (repository) => list(`${repo(repository)}/releases`),
    getRelease: (repository, id) => json(`${repo(repository)}/releases/${id}`),
    createRelease: (repository, body) => json(`${repo(repository)}/releases`, 'POST', body),
    publishRelease: (repository, id) => json(`${repo(repository)}/releases/${id}`, 'PATCH', { draft: false, make_latest: 'true' }),
    listAssets: (repository, id) => list(`${repo(repository)}/releases/${id}/assets`),
    async uploadAsset(repository, id, asset, filename) {
      const result = await response(`https://uploads.github.com${repo(repository)}/releases/${id}/assets?name=${encodeURIComponent(asset.name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(asset.size) },
        body: createReadStream(filename), duplex: 'half',
      });
      return result.json();
    },
    async assetDigest(repository, asset) {
      if (!Number.isSafeInteger(asset.id) || asset.id <= 0 || !Number.isSafeInteger(asset.size) || asset.size <= 0) throw new Error('Invalid remote asset metadata');
      if (typeof asset.digest === 'string' && /^sha256:[a-f0-9]{64}$/.test(asset.digest)) return { size: asset.size, sha256: asset.digest.slice(7) };
      // Older GitHub assets lack digest. Follow only known CDN redirects, with
      // NO Authorization on any redirected request or token-bearing URL in logs.
      let url = `https://api.github.com${repo(repository)}/releases/assets/${asset.id}`;
      let result;
      for (let attempt = 0; attempt < 5; attempt++) {
        const target = new URL(url);
        const api = target.hostname === 'api.github.com';
        if (target.protocol !== 'https:' || !['api.github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(target.hostname)
          || target.port || target.username || target.password) throw new Error('Untrusted asset redirect');
        result = await transport(url, { redirect: 'manual', signal: AbortSignal.timeout(600_000), headers: { Accept: 'application/octet-stream', ...(api ? { Authorization: `Bearer ${token}` } : {}) } });
        if (result.status >= 300 && result.status < 400) { url = new URL(result.headers.get('location'), url).href; continue; }
        if (!result.ok) throw new Error(`Asset verification failed (HTTP ${result.status})`);
        const hash = createHash('sha256'); let size = 0;
        for await (const bytes of result.body) { size += bytes.length; if (size > asset.size) throw new Error('Remote asset size mismatch'); hash.update(bytes); }
        return { size, sha256: hash.digest('hex') };
      }
      throw new Error('Too many asset redirects');
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: {
    repository: { type: 'string' }, tag: { type: 'string' }, commit: { type: 'string' }, notes: { type: 'string' },
    directory: { type: 'string' }, inventory: { type: 'string' }, 'release-id': { type: 'string' },
    prepare: { type: 'boolean', default: false }, publish: { type: 'boolean', default: false }, 'output-id': { type: 'string' },
  }, strict: true, allowPositionals: false });
  const options = { repository: values.repository, tag: values.tag, commit: values.commit, notesPath: values.notes };
  identity(options);
  const api = createGitHubReleaseApi({ token: process.env.GH_TOKEN });
  if (values.prepare) {
    if (!values['output-id'] || values.publish) throw new Error('Prepare requires --output-id and cannot publish');
    const releaseId = await prepareDesktopRelease(options, api);
    await fs.writeFile(values['output-id'], JSON.stringify({ releaseId }) + '\n', { flag: 'wx' });
    console.log(`Selected release id ${releaseId}`);
  } else {
    if (!/^\d+$/.test(values['release-id'] ?? '') || !values.inventory || !values.directory) throw new Error('Explicit --release-id, --inventory and --directory are required');
    const result = await publishDesktopRelease({ ...options, releaseId: Number(values['release-id']), directory: values.directory,
      inventory: JSON.parse(await fs.readFile(values.inventory, 'utf8')), publish: values.publish }, api);
    console.log(JSON.stringify(result));
  }
}
