import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema.js';
import { MAX_PINS_PER_CHANNEL } from '@backspace/shared';
import { PermissionBits } from '../utils/permissions.js';
import { DEFAULT_EVERYONE_PERMISSIONS, permissionsToString } from '@backspace/shared/src/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let currentUserId = 'owner';
const sendToChannel = vi.fn();
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: { userId?: string }) => { req.userId = currentUserId; } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToChannel: (...args: unknown[]) => sendToChannel(...args) } }));

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  migrate(drizzle(sqlite), { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle') });
  testDb = drizzle(sqlite, { schema });
  currentUserId = 'owner';
  sendToChannel.mockClear();
  for (const id of ['owner', 'manager', 'member']) {
    testDb.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  }
  testDb.insert(schema.spaces).values({ id: 'space', name: 'space', ownerId: 'owner', createdAt: 1 }).run();
  for (const userId of ['owner', 'manager', 'member']) {
    testDb.insert(schema.spaceMembers).values({ spaceId: 'space', userId, joinedAt: 1 }).run();
  }
  testDb.insert(schema.channels).values([
    { id: 'chat', spaceId: 'space', name: 'chat', type: 'text', createdAt: 1 },
    { id: 'voice', spaceId: 'space', name: 'voice', type: 'voice', createdAt: 1 },
  ]).run();
  testDb.insert(schema.roles).values({ id: 'manager-role', spaceId: 'space', name: 'Manager', permissions: PermissionBits.MANAGE_MESSAGES.toString(), position: 1, createdAt: 1 }).run();
  testDb.insert(schema.roles).values({ id: 'space', spaceId: 'space', name: '@everyone', permissions: permissionsToString(DEFAULT_EVERYONE_PERMISSIONS), position: 0, createdAt: 1 }).run();
  testDb.insert(schema.memberRoles).values({ spaceId: 'space', userId: 'manager', roleId: 'manager-role' }).run();
  const { pinRoutes } = await import('./pins.js');
  app = Fastify();
  await app.register(pinRoutes);
});

afterEach(async () => {
  await app.close();
  sqlite.close();
});

const headers = (user = 'owner') => ({ authorization: user });
const as = (user: string) => { currentUserId = user; };
const msg = (id: string, userId = 'member') => {
  testDb.insert(schema.messages).values({ id, channelId: 'chat', userId, content: 'x', createdAt: 1 }).run();
};

describe('channel pins', () => {
  it('pins, lists oldest-first, and unpins', async () => {
    as('manager');
    msg('m1'); msg('m2');
    expect((await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: 'm2' } })).statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: 'm1' } })).statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: '/api/channels/chat/pins', headers: headers('member') });
    expect(list.statusCode).toBe(200);
    expect(list.json().pins.map((p: { messageId: string }) => p.messageId)).toEqual(['m2', 'm1']);
    expect(sendToChannel).toHaveBeenCalledWith('space', 'chat', expect.objectContaining({ type: 'message_pinned', messageId: 'm1' }));
    const unpin = await app.inject({ method: 'DELETE', url: '/api/channels/chat/pins/m1', headers: headers('manager') });
    expect(unpin.statusCode).toBe(200);
    expect(sendToChannel).toHaveBeenCalledWith('space', 'chat', expect.objectContaining({ type: 'message_unpinned', messageId: 'm1' }));
  });

  it('pinning twice is idempotent', async () => {
    as('manager');
    msg('m1');
    expect((await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: 'm1' } })).statusCode).toBe(201);
    const again = await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: 'm1' } });
    expect(again.statusCode).toBe(200);
    expect(testDb.select().from(schema.pinnedMessages).all()).toHaveLength(1);
  });

  it('requires MANAGE_MESSAGES to pin; the pinner may unpin their own', async () => {
    msg('m1');
    as('member');
    expect((await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('member'), payload: { messageId: 'm1' } })).statusCode).toBe(403);
    as('manager');
    expect((await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: 'm1' } })).statusCode).toBe(201);
    // A member who did not pin and holds no MANAGE_MESSAGES cannot unpin.
    as('member');
    expect((await app.inject({ method: 'DELETE', url: '/api/channels/chat/pins/m1', headers: headers('member') })).statusCode).toBe(403);
  });

  it('refuses unknown channels, foreign messages and full boards', async () => {
    as('manager');
    expect((await app.inject({ method: 'POST', url: '/api/channels/nope/pins', headers: headers('manager'), payload: { messageId: 'm1' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: 'ghost' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'DELETE', url: '/api/channels/chat/pins/ghost', headers: headers('manager') })).statusCode).toBe(404);
    for (let i = 0; i < MAX_PINS_PER_CHANNEL; i++) {
      msg(`bulk-${i}`);
      const res = await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: `bulk-${i}` } });
      expect(res.statusCode).toBe(201);
    }
    msg('extra');
    const full = await app.inject({ method: 'POST', url: '/api/channels/chat/pins', headers: headers('manager'), payload: { messageId: 'extra' } });
    expect(full.statusCode).toBe(409);
    expect(full.json().code).toBe('pin_limit_reached');
  });
});
