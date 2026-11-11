import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
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
import { buildNativeDatabase } from '../testing/standaloneUpgrade.js';

const settings = vi.hoisted(() => ({ uploadDir: '', publicOrigin: 'https://chat.test' }));
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
  }),
}));

beforeEach(async () => {
  settings.uploadDir = await mkdtemp(path.join(tmpdir(), 'backspace-sticker-store-'));
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  db = drizzle(sqlite, { schema: schema.schema });
  buildNativeDatabase(sqlite);

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

describe('Native Sticker Store', () => {
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
    for (const field of ['originType', 'sourceInstance', 'sourcePackId', 'syncedAt']) expect(storePacks[0]).not.toHaveProperty(field);

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

  it.each([
    { method: 'GET', url: '/api/admin/federation/stickers/peers' },
    { method: 'PUT', url: '/api/admin/federation/stickers/peers/unused.invalid/policy' },
    { method: 'GET', url: '/api/admin/federation/stickers/remote-packs?peerOrigin=https://unused.invalid' },
    { method: 'POST', url: '/api/admin/federation/stickers/sync' },
  ] as const)('$method $url is unregistered, not an alternate admin/network path', async target => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    try {
      for (const headers of [{}, { authorization: 'admin' }]) {
        expect((await app.inject({ ...target, headers })).statusCode).toBe(404);
      }
      expect(fetch).not.toHaveBeenCalled(); expect(db.select().from(schema.schema.stickerPacks).all()).toEqual([]);
    } finally { fetch.mockRestore(); }
  });
});

