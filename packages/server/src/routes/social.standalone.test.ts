import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { setWorkerId } from '../utils/snowflake.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let caller = 'alice';
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (request: { userId: string }) => { request.userId = caller; } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: vi.fn() } }));
vi.mock('../ws/presence.js', () => ({ exchangeFriendPresence: vi.fn() }));
import { connectionManager } from '../ws/handler.js';
import { exchangeFriendPresence } from '../ws/presence.js';

beforeEach(async () => {
  setWorkerId(1); caller = 'alice'; sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  for (const id of ['alice', 'bob', 'carol', 'deleted', 'hidden', 'bot']) seedNativeUser(sqlite, id);
  sqlite.exec("UPDATE users SET is_deleted=1 WHERE id='deleted'; UPDATE users SET discoverable=0 WHERE id='hidden'; UPDATE users SET is_bot=1 WHERE id='bot'");
  vi.clearAllMocks(); app = Fastify(); const { socialRoutes } = await import('./social.js'); await app.register(socialRoutes); await app.ready();
});
afterEach(async () => { await app.close(); sqlite.close(); vi.restoreAllMocks(); });
function state(): unknown {
  return { users: sqlite.prepare('SELECT * FROM users ORDER BY id').all(), requests: sqlite.prepare('SELECT * FROM friend_requests ORDER BY id').all(), friends: sqlite.prepare('SELECT * FROM friends').all() };
}
function send(payload: Record<string, unknown>) { return app.inject({ method: 'POST', url: '/api/social/requests', payload }); }

describe('native social graph and absence of remote lookup', () => {
  it('finds the exact local username despite hostile old identity fields, with no HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const result = await send({ username: ' BOB ', homeUserId: 'carol', homeInstance: 'https://unused.invalid' });
    expect(result.statusCode).toBe(201);
    expect(sqlite.prepare('SELECT from_id,to_id,status FROM friend_requests').all()).toEqual([{ from_id: 'alice', to_id: 'bob', status: 'pending' }]);
    expect(fetch).not.toHaveBeenCalled();
    expect(connectionManager.sendToUser).toHaveBeenCalledWith('bob', expect.objectContaining({ type: 'friend_request_received', request: expect.objectContaining({ user: expect.objectContaining({ id: 'alice' }) }) }));
    expect(connectionManager.sendToUser).toHaveBeenCalledWith('alice', expect.objectContaining({ type: 'friend_request_sent', request: expect.objectContaining({ user: expect.objectContaining({ id: 'bob' }) }) }));
  });

  it.each([
    { homeUserId: 'foreign', homeInstance: 'https://unused.invalid' },
    { username: 'bob@unused.invalid' },
  ])('cannot provision or remotely look up a target from $username', async payload => {
    const before = state(), fetch = vi.spyOn(globalThis, 'fetch');
    const result = await send(payload); expect(result.statusCode).toBeGreaterThanOrEqual(400); expect(result.statusCode).toBeLessThan(500);
    expect(state()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it('finds a retained sovereign handle by its full exact local username rather than stripping its suffix', async () => {
    sqlite.exec("UPDATE users SET username='legacy@old.invalid' WHERE id='carol'");
    const fetch = vi.spyOn(globalThis, 'fetch'); const result = await send({ username: 'legacy@old.invalid' });
    expect(result.statusCode).toBe(201); expect(sqlite.prepare('SELECT to_id FROM friend_requests').get()).toEqual({ to_id: 'carol' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['alice', 'deleted', 'bot', 'absent'])('refuses target %s without a mutation', async username => {
    const before = state(); expect((await send({ username })).statusCode).toBeGreaterThanOrEqual(400); expect(state()).toEqual(before);
  });

  it('preserves recipient-only acceptance and the atomic local friendship plus request status', async () => {
    const sent = await send({ username: 'bob' }), id = sent.json<{ requestId: string }>().requestId;
    caller = 'carol'; const before = state();
    expect((await app.inject({ method: 'PATCH', url: `/api/social/requests/${id}`, payload: { status: 'accepted' } })).statusCode).toBe(403);
    expect(state()).toEqual(before); caller = 'bob';
    const accepted = await app.inject({ method: 'PATCH', url: `/api/social/requests/${id}`, payload: { status: 'accepted' } });
    expect(accepted.statusCode).toBe(200); expect(sqlite.prepare('SELECT user_id,friend_id FROM friends').all()).toEqual([{ user_id: 'alice', friend_id: 'bob' }]);
    expect(exchangeFriendPresence).toHaveBeenCalledWith('alice', 'bob');
    expect((await app.inject({ url: '/api/social/friends' })).json<Array<{ id: string }>>().map(user => user.id)).toEqual(['alice']);
  });

  it('cannot turn an answered declined request into a friendship', async () => {
    const id = (await send({ username: 'bob' })).json<{ requestId: string }>().requestId; caller = 'bob';
    expect((await app.inject({ method: 'PATCH', url: `/api/social/requests/${id}`, payload: { status: 'declined' } })).statusCode).toBe(200);
    const before = state();
    expect((await app.inject({ method: 'PATCH', url: `/api/social/requests/${id}`, payload: { status: 'accepted' } })).statusCode).toBe(400);
    expect(state()).toEqual(before);
  });

  it('keeps bot restriction, symmetric pending checks and sender-only cancellation', async () => {
    caller = 'bot'; const before = state(); expect((await send({ username: 'bob' })).statusCode).toBe(403); expect(state()).toEqual(before);
    caller = 'alice'; const id = (await send({ username: 'bob' })).json<{ requestId: string }>().requestId;
    caller = 'bob'; expect((await send({ username: 'alice' })).statusCode).toBe(400);
    expect((await app.inject({ method: 'DELETE', url: `/api/social/requests/${id}` })).statusCode).toBe(403);
    caller = 'alice'; expect((await app.inject({ method: 'DELETE', url: `/api/social/requests/${id}` })).statusCode).toBe(200);
    expect(sqlite.prepare('SELECT * FROM friend_requests').all()).toEqual([]);
  });

  it('only removes the authenticated local friendship in either orientation', async () => {
    sqlite.exec("INSERT INTO friends VALUES ('bob','alice',1),('bob','carol',1)");
    expect((await app.inject({ method: 'DELETE', url: '/api/social/friends/bob' })).statusCode).toBe(200);
    expect(sqlite.prepare('SELECT user_id,friend_id FROM friends').all()).toEqual([{ user_id: 'bob', friend_id: 'carol' }]);
    expect(connectionManager.sendToUser).toHaveBeenCalledWith('bob', { type: 'friend_removed', userId: 'alice' });
  });

  it('discovers/searches only opted-in live local accounts and omits provenance', async () => {
    const result = await app.inject({ url: '/api/social/discover?q=bo' }); expect(result.statusCode).toBe(200);
    const found = result.json<{ users: Array<{ id: string }> }>().users;
    expect(found.map(user => user.id)).toEqual(['bob', 'bot']);
    for (const user of found) for (const field of ['homeUserId', 'homeInstance', 'replicatedInstances', 'passwordHash']) expect(user).not.toHaveProperty(field);
    expect((await app.inject({ url: '/api/social/search?q=hidden' })).json()).toEqual([]);
    expect((await app.inject({ url: '/api/social/search?q=deleted' })).json()).toEqual([]);
  });
});
