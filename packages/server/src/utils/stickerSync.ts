import { createHash, randomUUID } from 'node:crypto';
import { access, mkdir, rename, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { and, eq } from 'drizzle-orm';
import { STICKER_ID_PATTERN } from '@backspace/shared/src/stickers.js';
import { getDb, schema } from '../db/index.js';
import { getMaxStickerSizeBytes } from '../routes/stickers.js';
import { buildFederationHeaders, getOurOrigin } from './federationAuth.js';
import { assertPeerOriginAllowed, federationFetch } from './federationFetch.js';
import { stickerAssetPath } from './stickerAssets.js';
import { readBoundedResponse } from './boundedResponse.js';
import { MAX_STICKER_PACK_METADATA_BYTES, parseRemoteStickerPack } from './remoteStickerPack.js';

/** Downloads only content-addressed bytes, bounded by this instance's limit. */
export async function downloadAndVerifyAsset(peerOrigin: string, assetId: string): Promise<void> {
  if (!STICKER_ID_PATTERN.test(assetId)) throw new Error('Invalid sticker asset ID');
  const localPath = stickerAssetPath(assetId);
  const db = getDb();
  const assetRow = db.select().from(schema.stickerAssets).where(eq(schema.stickerAssets.id, assetId)).get();
  // Reserve the janitor's grace period BEFORE the first await, including a
  // cache hit or repair of a missing file. Until the replica transaction runs,
  // no pack item references these assets; cleanup could otherwise remove an
  // old reused row while we download the next asset.
  const reservedAt = Date.now();
  db.insert(schema.stickerAssets).values({ id: assetId, createdAt: reservedAt })
    .onConflictDoUpdate({ target: schema.stickerAssets.id, set: { createdAt: reservedAt } }).run();
  if (assetRow) {
    try { await access(localPath); return; } catch { /* Redownload a missing file. */ }
  }
  const response = await federationFetch(peerOrigin, `/api/stickers/assets/${assetId}.webp`, {
    method: 'GET', headers: { Accept: 'image/webp' }, signal: AbortSignal.timeout(30_000),
  }, 'approved');
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Failed to download sticker asset: ${response.status}`);
  }
  const buffer = await readBoundedResponse(response, getMaxStickerSizeBytes());
  const hash = createHash('sha256').update(buffer).digest('hex');
  if (hash !== assetId) throw new Error(`Sticker asset hash mismatch: expected ${assetId}, got ${hash}`);
  await mkdir(path.dirname(localPath), { recursive: true });
  const temporaryPath = `${localPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, buffer);
    await rename(temporaryPath, localPath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  db.insert(schema.stickerAssets).values({ id: assetId, createdAt: Date.now() })
    .onConflictDoUpdate({ target: schema.stickerAssets.id, set: { createdAt: Date.now() } }).run();
}

/** Download first; the complete validated replica replaces the old one in one
 * synchronous transaction. Any failed download/insert leaves it untouched. */
export async function syncRemotePack(input: {
  peerOrigin: string;
  packId: string;
}): Promise<{ packId: string; replicaId: string; itemCount: number }> {
  const { peerOrigin, packId } = input;
  const db = getDb();
  const checkPeer = () => {
    const policy = db.select().from(schema.stickerPeerPolicies).where(eq(schema.stickerPeerPolicies.peerOrigin, peerOrigin)).get();
    if (policy?.policy === 'block') throw new Error('sticker_peer_blocked');
    const peer = db.select().from(schema.federationPeers).where(and(
      eq(schema.federationPeers.origin, peerOrigin), eq(schema.federationPeers.status, 'active'),
    )).get();
    if (!peer) throw new Error('Peer not active or unknown');
    return peer;
  };
  const peer = checkPeer();
  await assertPeerOriginAllowed(peerOrigin, 'approved');
  const body = JSON.stringify({ packId });
  const response = await federationFetch(peerOrigin, '/api/federation/stickers/packs/get', {
    method: 'POST', headers: { ...buildFederationHeaders(body, peer.hmacSecret, getOurOrigin()), 'Content-Type': 'application/json' },
    body, signal: AbortSignal.timeout(15_000),
  }, 'approved');
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`Remote peer returned ${response.status} when querying sticker pack`);
  }
  const bytes = await readBoundedResponse(response, MAX_STICKER_PACK_METADATA_BYTES);
  const remote = parseRemoteStickerPack(JSON.parse(bytes.toString('utf8')) as unknown, packId);
  const assetIds = new Set(remote.items.map(item => item.assetId));
  if (remote.coverAssetId) assetIds.add(remote.coverAssetId);
  for (const assetId of assetIds) await downloadAndVerifyAsset(peerOrigin, assetId);

  return db.transaction(() => {
    checkPeer(); // An admin may have blocked it during the downloads.
    const existing = db.select().from(schema.stickerPacks).where(and(
      eq(schema.stickerPacks.sourceInstance, peerOrigin), eq(schema.stickerPacks.sourcePackId, packId),
    )).get();
    if (existing && existing.currentVersion > remote.currentVersion) throw new Error('Remote sticker version would downgrade the replica');
    const now = Date.now();
    const replicaId = existing?.id ?? randomUUID();
    const fields = {
      name: remote.name, description: remote.description, creatorName: remote.creatorName,
      coverAssetId: remote.coverAssetId, currentVersion: remote.currentVersion,
      status: existing && ['disabled', 'blocked', 'deleted'].includes(existing.status) ? existing.status : 'active',
      syncedAt: now, updatedAt: now,
    };
    if (existing) db.update(schema.stickerPacks).set(fields).where(eq(schema.stickerPacks.id, replicaId)).run();
    else db.insert(schema.stickerPacks).values({ ...fields, id: replicaId, creatorId: null, originType: 'replica', sourceInstance: peerOrigin, sourcePackId: packId, createdAt: now }).run();
    const version = db.select().from(schema.stickerPackVersions).where(and(
      eq(schema.stickerPackVersions.packId, replicaId), eq(schema.stickerPackVersions.version, remote.currentVersion),
    )).get();
    const versionId = version?.id ?? randomUUID();
    const versionFields = { name: remote.name, description: remote.description, coverAssetId: remote.coverAssetId, status: 'approved' };
    if (version) db.update(schema.stickerPackVersions).set(versionFields).where(eq(schema.stickerPackVersions.id, versionId)).run();
    else db.insert(schema.stickerPackVersions).values({ ...versionFields, id: versionId, packId: replicaId, version: remote.currentVersion, createdAt: now }).run();
    db.delete(schema.stickerPackItems).where(eq(schema.stickerPackItems.versionId, versionId)).run();
    for (const item of remote.items) {
      db.insert(schema.stickerPackItems).values({ ...item, id: randomUUID(), packId: replicaId, versionId, status: 'active', createdAt: now }).run();
    }
    return { packId, replicaId, itemCount: remote.items.length };
  }, { behavior: 'immediate' });
}
