import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { PermissionBits } from '../utils/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let currentUserId = 'owner';
const sendToSpace = vi.fn();
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { announceSpaceAccessChange: vi.fn(), sendToSpace: (...args: unknown[]) => sendToSpace(...args) } }));

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const file of fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    sqlite.exec(fs.readFileSync(path.join(migrationsDir, file), 'utf8'));
  }
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  sendToSpace.mockClear();
  for (const id of ['owner', 'manager', 'member']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: 'space', name: 'space', ownerId: 'owner', createdAt: 1 }).run();
  testDb.insert(schema.spaces).values({ id: 'other', name: 'other', ownerId: 'owner', createdAt: 1 }).run();
  for (const userId of ['owner', 'manager', 'member']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId, joinedAt: 1 }).run();
  }
  testDb.insert(schema.channels).values([
    { id: 'voice', spaceId: 'space', name: 'voice', type: 'voice', createdAt: 1 },
    { id: 'text', spaceId: 'space', name: 'text', type: 'text', createdAt: 1 },
    { id: 'foreign-voice', spaceId: 'other', name: 'voice', type: 'voice', createdAt: 1 },
  ]).run();
  testDb.insert(schema.roles).values({ id: 'manager-role', spaceId: 'space', name: 'Manager', permissions: PermissionBits.MANAGE_SPACE.toString(), position: 1, createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: 'space', userId: 'manager', roleId: 'manager-role' }).run();
  const { spaceRoutes } = await import('./spaces.js');
  app = Fastify();
  await app.register(spaceRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const patch = (body: Record<string, unknown>, user = 'owner') =>
  app.inject({ method: 'PATCH', url: '/api/spaces/space', headers: { authorization: user }, payload: body });

describe('space AFK settings', () => {
  it('defaults to disabled with a 300s timeout', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/spaces/space', headers: { authorization: 'owner' }, payload: { name: 'space' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ afkChannelId: null, afkTimeoutSeconds: 300 });
  });

  it('sets a same-space voice channel and a listed timeout', async () => {
    const res = await patch({ afkChannelId: 'voice', afkTimeoutSeconds: 900 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ afkChannelId: 'voice', afkTimeoutSeconds: 900 });
  });

  it('refuses text channels, foreign channels and unknown ids', async () => {
    for (const afkChannelId of ['text', 'foreign-voice', 'nope']) {
      const res = await patch({ afkChannelId });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('space_afk_invalid_channel');
    }
  });

  it('refuses unlisted timeouts and non-numbers', async () => {
    for (const afkTimeoutSeconds of [0, 7, 61, 3601, 'fast', null]) {
      const res = await patch({ afkTimeoutSeconds });
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('space_afk_invalid_timeout');
    }
    for (const afkTimeoutSeconds of [60, 300, 900, 1800, 3600]) {
      expect((await patch({ afkTimeoutSeconds })).statusCode).toBe(200);
    }
  });

  it('null clears the channel and disables the feature', async () => {
    expect((await patch({ afkChannelId: 'voice' })).statusCode).toBe(200);
    const res = await patch({ afkChannelId: null });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ afkChannelId: null });
  });

  it('requires MANAGE_SPACE', async () => {
    currentUserId = 'member';
    const res = await app.inject({ method: 'PATCH', url: '/api/spaces/space', headers: { authorization: 'member' }, payload: { afkChannelId: 'voice' } });
    expect(res.statusCode).toBe(403);
  });
});
