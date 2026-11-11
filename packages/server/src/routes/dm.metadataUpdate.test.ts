import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let currentUserId = 'owner-A';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => {
    req.userId = currentUserId;
  },
}));

vi.mock('../ws/handler.js', () => ({
  connectionManager: {
    sendToUser: vi.fn(),
    sendToDmMembers: vi.fn(),
    sendToAdmins: vi.fn(),
    getAllOnlineUserIds: () => [],
    getRoom: () => undefined,
    getUserRoom: () => undefined,
  },
}));

// Mock fileCleanup so we can observe icon-deletion calls without touching disk.
vi.mock('../utils/fileCleanup.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/fileCleanup.js')>('../utils/fileCleanup.js');
  return {
    ...actual,
    deleteUploadFile: vi.fn(),
    deleteAttachmentByFilename: vi.fn(),
    deleteAttachmentFiles: vi.fn(),
    deleteUnreferencedUploadFiles: vi.fn(),
  };
});
import { deleteUploadFile, deleteAttachmentByFilename, deleteUnreferencedUploadFiles } from '../utils/fileCleanup.js';

// Connection manager mock retrieval for spy assertions
import { connectionManager } from '../ws/handler.js';

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const statements = sqlText.split(/-->\s*statement-breakpoint/);
    for (const stmt of statements) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

function seedUsers(): void {
  testDb.insert(schema.users).values({
    id: 'owner-A',
    username: 'alice',
    displayName: 'Alice',
    passwordHash: 'x',
    createdAt: Date.now(),
  }).run();

  testDb.insert(schema.users).values({
    id: 'member-B',
    username: 'bob',
    displayName: 'Bob',
    passwordHash: 'x',
    createdAt: Date.now(),
  }).run();

  testDb.insert(schema.users).values({
    id: 'member-C',
    username: 'carol',
    displayName: 'Carol',
    passwordHash: 'x',
    createdAt: Date.now(),
  }).run();

  testDb.insert(schema.users).values({
    id: 'stranger-D',
    username: 'dan',
    displayName: 'Dan',
    passwordHash: 'x',
    createdAt: Date.now(),
  }).run();
}

function seedInstanceSettings(): void {
  testDb.insert(schema.instanceSettings).values({
    id: 1,
    updatedAt: Date.now(),
  }).run();
}

interface GroupSeed {
  id: string;
  ownerId: string;
  members: string[];
  name?: string | null;
  icon?: string | null;
  metadataUpdatedAt?: number;
}

function seedGroupDm(opts: GroupSeed): void {
  testDb.insert(schema.dmChannels).values({
    id: opts.id,
    ownerId: opts.ownerId,
    name: opts.name ?? null,
    icon: opts.icon ?? null,
    metadataUpdatedAt: opts.metadataUpdatedAt ?? 0,
    createdAt: Date.now(),
  }).run();
  for (const userId of opts.members) {
    testDb.insert(schema.dmMembers).values({
      dmChannelId: opts.id,
      userId,
    }).run();
  }
}

function seed1on1Dm(id: string, a: string, b: string): void {
  testDb.insert(schema.dmChannels).values({
    id,
    ownerId: null,
    createdAt: Date.now(),
  }).run();
  testDb.insert(schema.dmMembers).values({ dmChannelId: id, userId: a }).run();
  testDb.insert(schema.dmMembers).values({ dmChannelId: id, userId: b }).run();
}

function seedAttachment(opts: {
  id: string;
  filename: string;
  uploaderId: string;
  mimetype: string;
  size: number;
}): void {
  testDb.insert(schema.attachments).values({
    id: opts.id,
    uploaderId: opts.uploaderId,
    filename: opts.filename,
    originalName: opts.filename,
    mimetype: opts.mimetype,
    size: opts.size,
    createdAt: Date.now(),
  }).run();
}

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  const { dmRoutes } = await import('./dm.js');
  await app.register(dmRoutes);
  await app.ready();
  return app;
}

describe('PATCH /api/dm/:id — group metadata update', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    sqlite = new Database(':memory:');
    testDb = drizzle(sqlite, { schema });
    applyMigrations(sqlite);
    seedInstanceSettings();
    seedUsers();
    currentUserId = 'owner-A';
    vi.clearAllMocks();
    app = await buildApp();
  });
  afterEach(async () => { await app.close(); sqlite.close(); });

  it('owner rename succeeds with the native channel, broadcast and system message', async () => {
    seedGroupDm({
      id: 'dm-1',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B', 'member-C'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-1',
      payload: { name: 'My Group' },
    });
    expect(res.statusCode).toBe(200);

    // Channel row updated
    const updated = testDb.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, 'dm-1')).get();
    expect(updated?.name).toBe('My Group');
    expect(updated?.icon).toBeNull();
    expect(updated?.metadataUpdatedAt).toBeGreaterThan(0);

    // dm_channel_updated broadcast
    const sendCalls = (connectionManager.sendToDmMembers as ReturnType<typeof vi.fn>).mock.calls;
    const updatedBroadcast = sendCalls.find((c) => c[1]?.type === 'dm_channel_updated');
    expect(updatedBroadcast).toBeDefined();
    expect(updatedBroadcast?.[1]).toMatchObject({ type: 'dm_channel_updated', dmChannelId: 'dm-1', name: 'My Group', icon: null });

    // Single system message for name change
    const sysRows = testDb.select().from(schema.dmMessages).where(eq(schema.dmMessages.dmChannelId, 'dm-1')).all();
    expect(sysRows.length).toBe(1);
    expect(sysRows[0]!.type).toBe('system');
    const parsed = JSON.parse(sysRows[0]!.content!);
    expect(parsed).toEqual({ event: 'name_changed', oldName: null, newName: 'My Group' });
    expect(sysRows[0]).not.toHaveProperty('sourceMessageId');
    expect(sendCalls.find(call => call[1]?.type === 'dm_message_created')?.[1].message.content).toBe(sysRows[0]!.content);
  });

  it('owner sets an uploaded icon and the native broadcast keeps its local filename', async () => {
    seedGroupDm({
      id: 'dm-2',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B', 'member-C'],
    });
    seedAttachment({
      id: 'att-1',
      filename: 'icon123.png',
      uploaderId: 'owner-A',
      mimetype: 'image/png',
      size: 1024,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-2',
      payload: { icon: 'icon123.png' },
    });
    expect(res.statusCode).toBe(200);

    expect(connectionManager.sendToDmMembers).toHaveBeenCalledWith('dm-2',expect.objectContaining({type:'dm_channel_updated',icon:'icon123.png'}));

    // Bare filename stored in DB (not absolute URL)
    const updated = testDb.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, 'dm-2')).get();
    expect(updated?.icon).toBe('icon123.png');
  });

  it('non-owner → 403', async () => {
    seedGroupDm({
      id: 'dm-3',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
    });
    currentUserId = 'member-B';

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-3',
      payload: { name: 'Nope' },
    });
    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.error).toMatch(/owner/i);
  });

  it('1-on-1 DM → 400', async () => {
    seed1on1Dm('dm-1on1', 'owner-A', 'member-B');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-1on1',
      payload: { name: 'Cant' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/1-on-1/i);
  });

  it('name length 0 (after trim) → cleared (stored null), system message reflects oldName/newName', async () => {
    seedGroupDm({
      id: 'dm-4',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
      name: 'Old Name',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-4',
      payload: { name: '   ' },
    });
    expect(res.statusCode).toBe(200);

    const updated = testDb.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, 'dm-4')).get();
    expect(updated?.name).toBeNull();

    const sys = testDb.select().from(schema.dmMessages).where(eq(schema.dmMessages.dmChannelId, 'dm-4')).all();
    expect(sys.length).toBe(1);
    expect(JSON.parse(sys[0]!.content!)).toEqual({ event: 'name_changed', oldName: 'Old Name', newName: null });
  });

  it('name length 51 → 400', async () => {
    seedGroupDm({
      id: 'dm-5',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-5',
      payload: { name: 'x'.repeat(51) },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/between 1 and 50/i);
  });

  it('icon clear (icon: null) → row updated, icon_changed system message, old local file deletion called', async () => {
    seedGroupDm({
      id: 'dm-6',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
      icon: 'oldicon.png',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-6',
      payload: { icon: null },
    });
    expect(res.statusCode).toBe(200);

    const updated = testDb.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, 'dm-6')).get();
    expect(updated?.icon).toBeNull();

    const sys = testDb.select().from(schema.dmMessages).where(eq(schema.dmMessages.dmChannelId, 'dm-6')).all();
    expect(sys.length).toBe(1);
    expect(JSON.parse(sys[0]!.content!)).toEqual({ event: 'icon_changed' });
    expect(sys[0]).not.toHaveProperty('sourceMessageId');

    expect(deleteUnreferencedUploadFiles).toHaveBeenCalledWith(['oldicon.png']);
    expect(deleteAttachmentByFilename).not.toHaveBeenCalledWith('oldicon.png');
  });

  it('icon filename uploaded by another user → 403', async () => {
    seedGroupDm({
      id: 'dm-7',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
    });
    seedAttachment({
      id: 'att-2',
      filename: 'someoneelse.png',
      uploaderId: 'stranger-D',
      mimetype: 'image/png',
      size: 1024,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-7',
      payload: { icon: 'someoneelse.png' },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toMatch(/own/i);
  });

  it('icon filename with non-image mimetype → 400', async () => {
    seedGroupDm({
      id: 'dm-8',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
    });
    seedAttachment({
      id: 'att-3',
      filename: 'notanimage.txt',
      uploaderId: 'owner-A',
      mimetype: 'text/plain',
      size: 100,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-8',
      payload: { icon: 'notanimage.txt' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/image/i);
  });

  it('icon filename oversize → 400', async () => {
    seedGroupDm({
      id: 'dm-9',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
    });
    seedAttachment({
      id: 'att-4',
      filename: 'huge.png',
      uploaderId: 'owner-A',
      mimetype: 'image/png',
      size: 9 * 1024 * 1024, // > 8 MB cap
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-9',
      payload: { icon: 'huge.png' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/MB/i);
  });

  it('icon absolute URL accepted (no attachment lookup attempted)', async () => {
    seedGroupDm({
      id: 'dm-10',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B'],
    });
    // Note: NO attachment seeded — proves no lookup happens for absolute URLs.

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-10',
      payload: { icon: 'https://remote.test/api/uploads/icon999.png' },
    });
    expect(res.statusCode).toBe(200);

    const updated = testDb.select().from(schema.dmChannels).where(eq(schema.dmChannels.id, 'dm-10')).get();
    expect(updated?.icon).toBe('https://remote.test/api/uploads/icon999.png');
  });

  it('no-op (same name + same icon) produces no messages, broadcast or cleanup', async () => {
    seedGroupDm({
      id: 'dm-11',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B', 'member-C'],
      name: 'Stable',
      icon: 'stable.png',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-11',
      payload: { name: 'Stable', icon: 'stable.png' },
    });
    expect(res.statusCode).toBe(200);

    // No system messages
    const sys = testDb.select().from(schema.dmMessages).where(eq(schema.dmMessages.dmChannelId, 'dm-11')).all();
    expect(sys.length).toBe(0);

    // No broadcast
    const sendCalls = (connectionManager.sendToDmMembers as ReturnType<typeof vi.fn>).mock.calls;
    expect(sendCalls.length).toBe(0);

    // No icon deletion
    expect(deleteUploadFile).not.toHaveBeenCalled();
  });

  it('changing both fields writes two distinct native system messages atomically', async () => {
    seedGroupDm({
      id: 'dm-12',
      ownerId: 'owner-A',
      members: ['owner-A', 'member-B', 'member-C'],
      name: 'Old',
      icon: 'old.png',
    });
    seedAttachment({
      id: 'att-12',
      filename: 'newicon.png',
      uploaderId: 'owner-A',
      mimetype: 'image/png',
      size: 2048,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/dm/dm-12',
      payload: { name: 'New Name', icon: 'newicon.png' },
    });
    expect(res.statusCode).toBe(200);

    const sys = testDb.select().from(schema.dmMessages).where(eq(schema.dmMessages.dmChannelId, 'dm-12')).all();
    expect(sys.length).toBe(2);

    const nameRow = sys.find((r) => JSON.parse(r.content!).event === 'name_changed');
    const iconRow = sys.find((r) => JSON.parse(r.content!).event === 'icon_changed');
    expect(nameRow).toBeDefined();
    expect(iconRow).toBeDefined();

    expect(nameRow!.id).not.toBe(iconRow!.id);
    expect(nameRow!.createdAt).toBe(iconRow!.createdAt);

    // Old icon was a local filename — cleanup should fire
    expect(deleteUnreferencedUploadFiles).toHaveBeenCalledWith(['old.png']);
    expect(deleteAttachmentByFilename).not.toHaveBeenCalledWith('old.png');
  });
});
