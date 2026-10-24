import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import * as stickerEncoding from './stickers.js';
import { request as httpRequest } from 'node:http';
import { eq } from 'drizzle-orm';
import * as schema from '../db/index.js';
import { stickerRoutes } from './stickers.js';
import { stickerStoreRoutes } from './stickerStore.js';
import { registerStickerFederationRoutes } from './federation/handlers/stickerSync.js';
import { syncRemotePack } from '../utils/stickerSync.js';
import { cleanupUnusedStickerAssets, STICKER_ASSET_GRACE_MS } from '../utils/stickerAssets.js';
import { access } from 'node:fs/promises';
import { stickerAssetPath } from '../utils/stickerAssets.js';

const settings = vi.hoisted(() => ({ uploadDir: '' }));
let db: ReturnType<typeof drizzle<typeof schema.schema>>;
let sqlite: Database.Database;
let app: FastifyInstance;
const parsedPackUpload = vi.fn();

vi.mock('../db/index.js', async () => {
  const actualSchema = await vi.importActual('../db/schema.js');
  return {
    getDb: () => db,
    schema: actualSchema,
  };
});

vi.mock('../config.js', () => ({ config: settings }));
vi.mock('../utils/federationAuth.js', () => ({
  getOurOrigin: () => 'https://chat.test',
  buildFederationHeaders: () => ({
    'x-federation-signature': 'sig',
    'x-federation-origin': 'https://remote.test',
    'x-federation-timestamp': String(Date.now()),
    'x-federation-nonce': 'nonce-1',
  }),
}));

vi.mock('../utils/auth.js', () => ({
  tokenFromAuthHeader: (header?: string) => header?.startsWith('Bearer ') ? header.slice(7) : header?.startsWith('Bot ') ? header.slice(4) : null,
  authenticate: async (request: { userId?: string; username?: string; headers: Record<string, string> }, reply: { code: (code: number) => { send: (body?: unknown) => void } }) => {
    const auth = request.headers.authorization;
    if (!auth) return reply.code(401).send({ error: 'unauthorized' });
    request.userId = auth;
    request.username = auth;
  },
  requireAdmin: async (request: { userId?: string }, reply: { code: (code: number) => { send: (body?: unknown) => void } }) => {
    if (request.userId !== 'admin') {
      return reply.code(403).send({ error: 'forbidden' });
    }
  },
  verifyAccessToken: async (token: string) => ({
    userId: token,
    username: token,
    homeInstance: null,
  }),
}));

vi.mock('./federation/handlers/s2sAuth.js', () => ({
  authenticateS2SPeer: () => ({ ok: true, peer: { origin: 'https://peer.test' }, nonce: 'nonce-123' }),
}));

beforeEach(async () => {
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'backspace-sticker-store-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema: schema.schema });
  migrate(db, { migrationsFolder: path.resolve('drizzle') });

  // Seed users: alice, bob, admin
  for (const id of ['alice', 'bob', 'admin']) {
    db.insert(schema.schema.users).values({
      id,
      username: id,
      passwordHash: 'test',
      isAdmin: id === 'admin' ? 1 : 0,
      createdAt: 1,
    }).run();
  }

  app = Fastify();
  parsedPackUpload.mockClear();
  app.addHook('preValidation', async request => { if (request.url.endsWith('/items') && request.method === 'POST') parsedPackUpload(); });
  await app.register(stickerRoutes);
  await app.register(stickerStoreRoutes);
  registerStickerFederationRoutes(app);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
  await rm(settings.uploadDir, { recursive: true, force: true });
});

async function makeTestImage(color = 'blue'): Promise<string> {
  const buf = await sharp({ create: { width: 16, height: 16, channels: 4, background: color } }).png().toBuffer();
  return buf.toString('base64');
}

describe('Federated Sticker Store', () => {
  it('supports full pack creation, item upload, review submission and admin approval', async () => {
    // 1. Alice creates a pack
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs',
      headers: { authorization: 'alice' },
      payload: { name: 'Cool Cats', description: 'Cute cat stickers' },
    });
    expect(createRes.statusCode).toBe(200);
    const pack = createRes.json();
    expect(pack.name).toBe('Cool Cats');
    expect(pack.status).toBe('draft');
    expect(pack.currentVersion).toBe(1);

    // 2. Alice adds sticker items
    const img1 = await makeTestImage('blue');
    const addItemRes = await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/items`,
      headers: { authorization: 'alice' },
      payload: { name: 'Cat Wave', image: img1 },
    });
    expect(addItemRes.statusCode).toBe(200);
    const item = addItemRes.json();
    expect(item.name).toBe('Cat Wave');
    expect(item.token).toContain('/api/stickers/assets/');

    // 3. Alice submits pack for review
    const submitRes = await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/submit`,
      headers: { authorization: 'alice' },
    });
    expect(submitRes.statusCode).toBe(200);
    expect(submitRes.json().status).toBe('pending_review');

    // 4. Admin reviews pending packs
    const reviewListRes = await app.inject({
      method: 'GET',
      url: '/api/admin/sticker-packs/reviews',
      headers: { authorization: 'admin' },
    });
    expect(reviewListRes.statusCode).toBe(200);
    const reviews = reviewListRes.json();
    expect(reviews.length).toBe(1);
    expect(reviews[0].id).toBe(pack.id);
    expect(reviews[0].itemCount).toBe(1);

    // 5. Admin approves pack
    const approveRes = await app.inject({
      method: 'POST',
      url: `/api/admin/sticker-packs/${pack.id}/approve`,
      headers: { authorization: 'admin' },
    });
    expect(approveRes.statusCode).toBe(200);
    expect(approveRes.json().status).toBe('approved');

    // 6. Pack now visible in public sticker store
    const storeRes = await app.inject({
      method: 'GET',
      url: '/api/sticker-store/packs',
    });
    expect(storeRes.statusCode).toBe(200);
    const storePacks = storeRes.json();
    expect(storePacks.length).toBe(1);
    expect(storePacks[0].name).toBe('Cool Cats');

    // 7. Bob installs the pack
    const installRes = await app.inject({
      method: 'POST',
      url: `/api/sticker-store/packs/${pack.id}/install`,
      headers: { authorization: 'bob' },
    });
    expect(installRes.statusCode).toBe(200);

    // 8. Bob checks his installed packs
    const myPacksRes = await app.inject({
      method: 'GET',
      url: '/api/sticker-store/my-packs',
      headers: { authorization: 'bob' },
    });
    expect(myPacksRes.statusCode).toBe(200);
    const bobPacks = myPacksRes.json();
    expect(bobPacks.length).toBe(1);
    expect(bobPacks[0].items.length).toBe(1);
    expect(bobPacks[0].items[0].name).toBe('Cat Wave');
  });

  it('enforces versioning: editing an approved pack requires creating a new version', async () => {
    // 1. Create and approve a pack
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs',
      headers: { authorization: 'alice' },
      payload: { name: 'Versioned Pack' },
    });
    const pack = createRes.json();

    const img1 = await makeTestImage('yellow');
    await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/items`,
      headers: { authorization: 'alice' },
      payload: { name: 'Item 1', image: img1 },
    });

    await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/submit`,
      headers: { authorization: 'alice' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/admin/sticker-packs/${pack.id}/approve`,
      headers: { authorization: 'admin' },
    });

    // 2. Direct modification on approved pack is rejected
    const directAddRes = await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/items`,
      headers: { authorization: 'alice' },
      payload: { name: 'Item 2', image: img1 },
    });
    expect(directAddRes.statusCode).toBe(400);

    // 3. Create new version
    const newVerRes = await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/new-version`,
      headers: { authorization: 'alice' },
    });
    expect(newVerRes.statusCode).toBe(200);
    expect(newVerRes.json().newVersion).toBe(2);

    // 4. In new version, adding items works
    const img2 = await makeTestImage('purple');
    const addVer2ItemRes = await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/items`,
      headers: { authorization: 'alice' },
      payload: { name: 'Item 2', image: img2 },
    });
    expect(addVer2ItemRes.statusCode).toBe(200);

    // 5. Meanwhile, the public store still serves Version 1 with 1 item!
    const storeRes = await app.inject({
      method: 'GET',
      url: `/api/sticker-store/packs/${pack.id}`,
    });
    expect(storeRes.statusCode).toBe(200);
    expect(storeRes.json().currentVersion).toBe(1);
    expect(storeRes.json().items.length).toBe(1);
  });

  async function draft() {
    const res = await app.inject({ method: 'POST', url: '/api/sticker-packs', headers: { authorization: 'alice' }, payload: { name: 'Published', description: 'Original' } });
    expect(res.statusCode).toBe(200);
    const pack = res.json<{ id: string }>();
    await app.inject({ method: 'POST', url: `/api/sticker-packs/${pack.id}/items`, headers: { authorization: 'alice' }, payload: { name: 'First', image: await makeTestImage() } });
    return pack;
  }
  const action = (id: string, suffix: string, admin = false) => app.inject({ method: 'POST', url: admin ? `/api/admin/sticker-packs/${id}/${suffix}` : `/api/sticker-packs/${id}/${suffix}`, headers: { authorization: admin ? 'admin' : 'alice' } });

  it('keeps the published version available through candidate submit, rejection and approval', async () => {
    const { id } = await draft();
    await action(id, 'submit'); await action(id, 'approve', true);
    await app.inject({ method: 'POST', url: `/api/sticker-store/packs/${id}/install`, headers: { authorization: 'bob' } });
    await action(id, 'new-version');
    const edit = await app.inject({ method: 'PATCH', url: `/api/sticker-packs/${id}`, headers: { authorization: 'alice' }, payload: { name: 'Candidate', description: 'Updated' } });
    expect(edit.statusCode).toBe(200);
    expect((await action(id, 'submit')).statusCode).toBe(200);
    const assertPublished = async () => {
      const publicRes = await app.inject({ url: `/api/sticker-store/packs/${id}` });
      expect(publicRes.statusCode).toBe(200);
      expect(publicRes.json()).toMatchObject({ name: 'Published', description: 'Original', currentVersion: 1 });
      const installed = await app.inject({ url: '/api/sticker-store/my-packs', headers: { authorization: 'bob' } });
      expect(installed.json()).toHaveLength(1);
      const list = await app.inject({ url: '/api/sticker-store/packs' });
      expect(list.json()[0]).toMatchObject({ name: 'Published', currentVersion: 1, itemCount: 1 });
    };
    await assertPublished();
    const reviews = await app.inject({ url: '/api/admin/sticker-packs/reviews', headers: { authorization: 'admin' } });
    expect(reviews.json()).toEqual([expect.objectContaining({ id, name: 'Candidate', editingVersion: 2 })]);
    await action(id, 'reject', true);
    await assertPublished();
    const created = await app.inject({ url: '/api/sticker-packs/created', headers: { authorization: 'alice' } });
    expect(created.json()[0]).toMatchObject({ editingVersion: 2, editingStatus: 'rejected' });
    expect((await action(id, 'new-version')).statusCode).toBe(409);
    await action(id, 'submit'); await action(id, 'approve', true);
    const publishedV2 = await app.inject({ url: `/api/sticker-store/packs/${id}` });
    expect(publishedV2.json()).toMatchObject({ name: 'Candidate', description: 'Updated', currentVersion: 2 });
  });

  it('limits concurrent uploads at the final write to 100 items', async () => {
    const { id } = await draft();
    const version = db.select().from(schema.schema.stickerPackVersions).get()!;
    const item = db.select().from(schema.schema.stickerPackItems).get()!;
    for (let i = 1; i < 99; i++) db.insert(schema.schema.stickerPackItems).values({ ...item, id: `seed-${i}`, sortOrder: i }).run();
    const image = await makeTestImage();
    const results = await Promise.all([1, 2].map(i => app.inject({ method: 'POST', url: `/api/sticker-packs/${id}/items`, headers: { authorization: 'alice' }, payload: { name: `Concurrent ${i}`, image } })));
    expect(results.map(r => r.statusCode).sort()).toEqual([200, 400]);
    expect(db.select().from(schema.schema.stickerPackItems).where(eq(schema.schema.stickerPackItems.versionId, version.id)).all()).toHaveLength(100);
  });

  it('rejects an upload whose version is submitted while encoding is pending', async () => {
    const { id } = await draft();
    const realEncode = stickerEncoding.encodeSticker;
    let release!: () => void;
    let started!: () => void;
    const entered = new Promise<void>(resolve => { started = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const spy = vi.spyOn(stickerEncoding, 'encodeSticker').mockImplementationOnce(async (...args) => { started(); await gate; return realEncode(...args); });
    try {
      const uploading = app.inject({ method: 'POST', url: `/api/sticker-packs/${id}/items`, headers: { authorization: 'alice' }, payload: { name: 'Never reviewed', image: await makeTestImage('red') } }).then(r => r);
      await entered;
      await action(id, 'submit'); await action(id, 'approve', true);
      release();
      expect((await uploading).statusCode).toBe(400);
      const published = await app.inject({ url: `/api/sticker-store/packs/${id}` });
      expect(published.json().items.map((i: { name: string }) => i.name)).toEqual(['First']);
    } finally { release(); spy.mockRestore(); }
  });

  it('refuses reorder of reviewed items and validates candidate IDs without partial writes', async () => {
    const { id } = await draft();
    const item = db.select().from(schema.schema.stickerPackItems).get()!;
    const reorder = (ids: unknown[]) => app.inject({ method: 'PUT', url: `/api/sticker-packs/${id}/items/order`, headers: { authorization: 'alice' }, payload: { itemIds: ids } });
    expect((await reorder([item.id, 'foreign'])).statusCode).toBe(400);
    await action(id, 'submit'); await action(id, 'approve', true);
    expect((await reorder([item.id])).statusCode).toBe(400);
    await action(id, 'new-version');
    expect((await reorder([item.id])).statusCode).toBe(400);
    expect(db.select().from(schema.schema.stickerPackItems).where(eq(schema.schema.stickerPackItems.id, item.id)).get()?.sortOrder).toBe(0);
  });

  it('optional auth accepts Bot as well as Bearer without exposing drafts anonymously', async () => {
    const { id } = await draft();
    for (const scheme of ['Bearer', 'Bot']) {
      expect((await app.inject({ url: `/api/sticker-store/packs/${id}`, headers: { authorization: `${scheme} alice` } })).statusCode).toBe(200);
    }
    expect((await app.inject({ url: `/api/sticker-store/packs/${id}` })).statusCode).toBe(404);
  });

  it('enforces the pack upload stream budget before parsing, including unauthenticated requests', async () => {
    db.insert(schema.schema.instanceSettings).values({ id: 1, maxStickerSizeBytes: 1024, updatedAt: 1 }).run();
    const origin = await app.listen({ host: '127.0.0.1', port: 0 });
    const chunked = (authorized: boolean) => new Promise<number>((resolve, reject) => {
      const req = httpRequest(`${origin}/api/sticker-packs/unknown/items`, { method: 'POST', headers: {
        'content-type': 'application/json', 'transfer-encoding': 'chunked', ...(authorized ? { authorization: 'alice' } : {}),
      } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
      req.on('error', reject); req.write('{"name":"x","image":"'); req.write('A'.repeat(12_000)); req.end('"}');
    });
    expect(await chunked(true)).toBe(413);
    expect(await chunked(false)).toBe(401);
    expect(parsedPackUpload).not.toHaveBeenCalled();
  });

  it('implements soft delete lifecycle without deleting physical assets', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs',
      headers: { authorization: 'alice' },
      payload: { name: 'To Be Deleted' },
    });
    const pack = createRes.json();

    const img = await makeTestImage('green');
    const itemRes = await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/items`,
      headers: { authorization: 'alice' },
      payload: { name: 'Green Sticker', image: img },
    });
    const item = itemRes.json();

    // Delete pack
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/sticker-packs/${pack.id}`,
      headers: { authorization: 'alice' },
    });
    expect(delRes.statusCode).toBe(200);

    // Pack is no longer in store
    const storeRes = await app.inject({
      method: 'GET',
      url: `/api/sticker-store/packs/${pack.id}`,
    });
    expect(storeRes.statusCode).toBe(404);

    // But the asset file still exists and can be served for history!
    const assetRes = await app.inject({
      method: 'GET',
      url: `/api/stickers/assets/${item.assetId}.webp`,
    });
    expect(assetRes.statusCode).toBe(200);
  });

  it('serves S2S federation pack listing and details', async () => {
    // Create & approve pack
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/sticker-packs',
      headers: { authorization: 'alice' },
      payload: { name: 'Federated Pack', description: 'Available across servers' },
    });
    const pack = createRes.json();
    const img = await makeTestImage('pink');
    await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/items`,
      headers: { authorization: 'alice' },
      payload: { name: 'Pink Sticker', image: img },
    });
    await app.inject({
      method: 'POST',
      url: `/api/sticker-packs/${pack.id}/submit`,
      headers: { authorization: 'alice' },
    });
    await app.inject({
      method: 'POST',
      url: `/api/admin/sticker-packs/${pack.id}/approve`,
      headers: { authorization: 'admin' },
    });

    // S2S list
    const listRes = await app.inject({
      method: 'POST',
      url: '/api/federation/stickers/packs/list',
    });
    expect(listRes.statusCode).toBe(200);
    const listData = listRes.json();
    expect(listData.packs.length).toBe(1);
    expect(listData.packs[0].name).toBe('Federated Pack');

    // S2S get
    const getRes = await app.inject({
      method: 'POST',
      url: '/api/federation/stickers/packs/get',
      payload: { packId: pack.id },
    });
    expect(getRes.statusCode).toBe(200);
    const getData = getRes.json();
    expect(getData.name).toBe('Federated Pack');
    expect(getData.items.length).toBe(1);
    expect(getData.items[0].name).toBe('Pink Sticker');
  });

  it('allows admin to set peer policy to block and auto-updates replica status', async () => {
    // Set policy for peer to block
    const setPolicyRes = await app.inject({
      method: 'PUT',
      url: `/api/admin/federation/stickers/peers/${encodeURIComponent('https://evil.test')}/policy`,
      headers: { authorization: 'admin' },
      payload: { policy: 'block' },
    });
    expect(setPolicyRes.statusCode).toBe(200);

    const pol = db.select().from(schema.schema.stickerPeerPolicies)
      .where(eq(schema.schema.stickerPeerPolicies.peerOrigin, 'https://evil.test')).get();
    expect(pol?.policy).toBe('block');
  });

  it('syncs remote sticker pack, downloads and verifies content-addressed assets', async () => {
    const peerOrigin = 'https://peer.test';
    // Register active peer
    db.insert(schema.schema.federationPeers).values({
      id: 'peer-1',
      origin: peerOrigin,
      hmacSecret: 'secret',
      status: 'active',
      createdAt: 1,
    }).run();

    const testBuf = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'orange' } }).png().toBuffer();
    const { createHash } = await import('node:crypto');
    const assetId = createHash('sha256').update(testBuf).digest('hex');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/federation/stickers/packs/get')) {
        return new Response(JSON.stringify({
          id: 'rem-pack-1',
          name: 'Remote Orange Pack',
          description: 'From peer',
          creatorName: 'remote_user',
          coverAssetId: null,
          currentVersion: 1,
          items: [{ assetId, name: 'Orange Star', sortOrder: 0 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes(`/api/stickers/assets/${assetId}.webp`)) {
        return new Response(testBuf, { status: 200, headers: { 'Content-Type': 'image/webp' } });
      }
      return new Response(null, { status: 404 });
    });

    try {
      const syncResult = await syncRemotePack({ peerOrigin, packId: 'rem-pack-1' });
      expect(syncResult.packId).toBe('rem-pack-1');
      expect(syncResult.itemCount).toBe(1);

      // Verify replica pack is stored locally
      const replica = db.select().from(schema.schema.stickerPacks)
        .where(eq(schema.schema.stickerPacks.id, syncResult.replicaId)).get();
      expect(replica).toBeDefined();
      expect(replica?.originType).toBe('replica');
      expect(replica?.sourceInstance).toBe(peerOrigin);
      expect(replica?.status).toBe('active');

      // Verify asset exists locally in sticker_assets
      const asset = db.select().from(schema.schema.stickerAssets)
        .where(eq(schema.schema.stickerAssets.id, assetId)).get();
      expect(asset).toBeDefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('rejects remote asset download when content-addressed hash does not match', async () => {
    const peerOrigin = 'https://peer.test';
    db.insert(schema.schema.federationPeers).values({
      id: 'peer-2',
      origin: peerOrigin,
      hmacSecret: 'secret',
      status: 'active',
      createdAt: 1,
    }).onConflictDoNothing().run();

    const fakeAssetId = 'a'.repeat(64);
    const tamperedBuf = Buffer.from('not matching bytes');

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/federation/stickers/packs/get')) {
        return new Response(JSON.stringify({
          id: 'rem-pack-tampered',
          name: 'Tampered Pack',
          description: null,
          creatorName: 'hacker',
          coverAssetId: null,
          currentVersion: 1,
          items: [{ assetId: fakeAssetId, name: 'Fake', sortOrder: 0 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes(`/api/stickers/assets/${fakeAssetId}.webp`)) {
        return new Response(tamperedBuf, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    try {
      await expect(syncRemotePack({ peerOrigin, packId: 'rem-pack-tampered' }))
        .rejects.toThrow(/hash mismatch/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses a remote asset bigger than the local sticker size limit', async () => {
    const peerOrigin = 'https://peer.test';
    db.insert(schema.schema.federationPeers).values({
      id: 'peer-3',
      origin: peerOrigin,
      hmacSecret: 'secret',
      status: 'active',
      createdAt: 1,
    }).onConflictDoNothing().run();

    const fakeAssetId = 'b'.repeat(64);
    // Default limit is 5 MiB; serve 6 MiB so the stream budget trips even
    // though the peer omits Content-Length.
    const bigBuf = Buffer.alloc(6 * 1024 * 1024, 7);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('/api/federation/stickers/packs/get')) {
        return new Response(JSON.stringify({
          id: 'rem-pack-big',
          name: 'Big Pack',
          description: null,
          creatorName: 'remote_user',
          coverAssetId: null,
          currentVersion: 1,
          items: [{ assetId: fakeAssetId, name: 'Big', sortOrder: 0 }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes(`/api/stickers/assets/${fakeAssetId}.webp`)) {
        return new Response(bigBuf, { status: 200 });
      }
      return new Response(null, { status: 404 });
    });

    try {
      await expect(syncRemotePack({ peerOrigin, packId: 'rem-pack-big' }))
        .rejects.toThrow(/exceeds the local size limit/);
      // Nothing persisted: no pack row, no asset row.
      expect(db.select().from(schema.schema.stickerPacks)
        .where(eq(schema.schema.stickerPacks.sourcePackId, 'rem-pack-big')).get()).toBeUndefined();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('refuses remote packs that break local bounds', async () => {
    const peerOrigin = 'https://peer.test';
    db.insert(schema.schema.federationPeers).values({
      id: 'peer-4',
      origin: peerOrigin,
      hmacSecret: 'secret',
      status: 'active',
      createdAt: 1,
    }).onConflictDoNothing().run();

    const meta = (over: Record<string, unknown>) => ({
      id: 'rem-pack-bad',
      name: 'Bad Pack',
      description: null,
      creatorName: 'remote_user',
      coverAssetId: null,
      currentVersion: 1,
      items: [{ assetId: 'c'.repeat(64), name: 'Ok', sortOrder: 0 }],
      ...over,
    });

    const cases: Array<[string, Record<string, unknown>]> = [
      ['too many items', { items: Array.from({ length: 101 }, (_, i) => ({ assetId: 'c'.repeat(64), name: `S${i}`, sortOrder: i })) }],
      ['overlong pack name', { name: 'x'.repeat(101) }],
      ['overlong item name', { items: [{ assetId: 'c'.repeat(64), name: 'y'.repeat(101), sortOrder: 0 }] }],
      ['non-integer sort order', { items: [{ assetId: 'c'.repeat(64), name: 'Ok', sortOrder: 1.5 }] }],
      ['zero version', { currentVersion: 0 }],
    ];

    for (const [label, over] of cases) {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('/api/federation/stickers/packs/get')) {
          return new Response(JSON.stringify(meta(over)), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response(null, { status: 404 });
      });
      try {
        await expect(syncRemotePack({ peerOrigin, packId: 'rem-pack-bad' }), label).rejects.toThrow();
      } finally {
        globalThis.fetch = originalFetch;
      }
    }
  });

  it('keeps a valid replica intact on malformed metadata, oversize JSON and write failure', async () => {
    const peerOrigin = 'https://peer.test';
    db.insert(schema.schema.federationPeers).values({ id: 'peer-safe', origin: peerOrigin, hmacSecret: 'secret', status: 'active', createdAt: 1 }).run();
    const buffer = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'blue' } }).webp().toBuffer();
    const { createHash } = await import('node:crypto');
    const assetId = createHash('sha256').update(buffer).digest('hex');
    const base = { id: 'remote-safe', name: 'Original', description: null, creatorName: null, coverAssetId: null, currentVersion: 1, items: [{ assetId, name: 'Original item', sortOrder: 0 }] };
    let metadata: unknown = base;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => String(url).includes('/packs/get')
      ? new Response(JSON.stringify(metadata)) : new Response(buffer));
    try {
      const result = await syncRemotePack({ peerOrigin, packId: base.id });
      const assertIntact = () => {
        expect(db.select().from(schema.schema.stickerPacks).where(eq(schema.schema.stickerPacks.id, result.replicaId)).get()?.name).toBe('Original');
        expect(db.select().from(schema.schema.stickerPackItems).all().map(i => i.name)).toEqual(['Original item']);
      };
      for (const name of [null, undefined, '\u200b', 'a\nb']) {
        metadata = { ...base, name: 'Changed', items: [{ assetId, name, sortOrder: 0 }] };
        await expect(syncRemotePack({ peerOrigin, packId: base.id })).rejects.toThrow();
        assertIntact();
      }
      metadata = { ...base, ignored: 'x'.repeat(256 * 1024) };
      await expect(syncRemotePack({ peerOrigin, packId: base.id })).rejects.toThrow(/limit/);
      assertIntact();
      metadata = { ...base, name: 'Changed', items: [{ assetId, name: 'explode', sortOrder: 0 }] };
      sqlite.exec("CREATE TRIGGER fail_sync BEFORE INSERT ON sticker_pack_items WHEN NEW.name = 'explode' BEGIN SELECT RAISE(ABORT, 'injected failure'); END");
      await expect(syncRemotePack({ peerOrigin, packId: base.id })).rejects.toThrow(/injected failure/);
      assertIntact();
    } finally { globalThis.fetch = originalFetch; }
  });

  it.each(['cached', 'missing-file'] as const)('protects an old %s asset from cleanup during another asset download', async state => {
    const peerOrigin = 'https://peer.test';
    db.insert(schema.schema.federationPeers).values({ id: 'peer-cleanup', origin: peerOrigin, hmacSecret: 'secret', status: 'active', createdAt: 1 }).run();
    const a = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'blue' } }).webp().toBuffer();
    const b = await sharp({ create: { width: 8, height: 8, channels: 4, background: 'red' } }).webp().toBuffer();
    const { createHash } = await import('node:crypto');
    const aId = await stickerEncoding.saveStickerAsset(a);
    const bId = createHash('sha256').update(b).digest('hex');
    db.update(schema.schema.stickerAssets).set({ createdAt: Date.now() - STICKER_ASSET_GRACE_MS - 1000 }).where(eq(schema.schema.stickerAssets.id, aId)).run();
    if (state === 'missing-file') await rm(stickerAssetPath(aId));
    const originalFetch = globalThis.fetch;
    let cleanupRuns = 0;
    globalThis.fetch = vi.fn(async (url: string | URL | Request) => {
      const path = String(url);
      if (path.includes('/packs/get')) return new Response(JSON.stringify({
        id: 'cleanup-pack', name: 'Cleanup pack', description: null, creatorName: null, coverAssetId: null, currentVersion: 1,
        items: [{ assetId: aId, name: 'A', sortOrder: 0 }, { assetId: bId, name: 'B', sortOrder: 1 }],
      }));
      cleanupRuns++;
      cleanupUnusedStickerAssets(false);
      expect(db.select().from(schema.schema.stickerAssets).where(eq(schema.schema.stickerAssets.id, aId)).get()).toBeDefined();
      return new Response(path.includes(aId) ? a : b);
    });
    try {
      await expect(syncRemotePack({ peerOrigin, packId: 'cleanup-pack' })).resolves.toMatchObject({ itemCount: 2 });
      expect(cleanupRuns).toBeGreaterThan(0);
      await expect(access(stickerAssetPath(aId))).resolves.toBeUndefined();
      expect(db.select().from(schema.schema.stickerPackItems).all()).toHaveLength(2);
    } finally { globalThis.fetch = originalFetch; }
  });
});

