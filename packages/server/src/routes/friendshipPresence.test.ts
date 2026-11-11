import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import type { Activity, ServerEvent } from '@veyvox/shared';
let sqlite: Database.Database, app: FastifyInstance;
let db: ReturnType<typeof drizzle<typeof schema>>;
const sent: Array<{ userId: string; payload: ServerEvent }> = [];
const activities = new Map<string, Activity[]>();
let presenceBroken = false;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (request: { userId: string }) => { request.userId = 'alice'; } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: {
  sendToUser: (userId: string, payload: ServerEvent) => sent.push({ userId, payload }),
  getUserActivities: (id: string) => { if (presenceBroken) throw new Error('synthetic presence failure'); return activities.get(id) ?? []; },
} }));
beforeEach(async () => {
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  seedNativeUser(sqlite, 'alice'); seedNativeUser(sqlite, 'bob');
  sqlite.exec("UPDATE users SET status='online'; INSERT INTO friend_requests (id,from_id,to_id,status,created_at) VALUES ('request','bob','alice','pending',1)");
  sent.length = 0; activities.clear(); presenceBroken = false;
  app = Fastify(); const { socialRoutes } = await import('./social.js'); await app.register(socialRoutes); await app.ready();
});
afterEach(async () => { await app.close(); sqlite.close(); vi.restoreAllMocks(); });
const answer = (status: 'accepted' | 'declined') => app.inject({ method: 'PATCH', url: '/api/social/requests/request', payload: { status } });
const presenceTo = (id: string) => sent.filter(event => event.userId === id && event.payload.type === 'presence_update').map(event => event.payload);
describe('native friendship presence snapshot on real acceptance', () => {
  it('tells both sides current status/activities once, using native ids and no HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); activities.set('alice', [{ type: 'playing', name: 'Factorio' }]); activities.set('bob', [{ type: 'listening', name: 'Radio' }]);
    expect((await answer('accepted')).statusCode).toBe(200);
    expect(presenceTo('alice')).toEqual([{ type: 'presence_update', userId: 'bob', status: 'online', activities: [{ type: 'listening', name: 'Radio' }] }]);
    expect(presenceTo('bob')).toEqual([{ type: 'presence_update', userId: 'alice', status: 'online', activities: [{ type: 'playing', name: 'Factorio' }] }]);
    expect((await answer('accepted')).statusCode).toBe(400); expect(presenceTo('alice')).toHaveLength(1); expect(fetch).not.toHaveBeenCalled();
  });
  it('still commits the friendship if the best-effort presence snapshot fails', async () => {
    presenceBroken = true; const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await answer('accepted')).statusCode).toBe(200);
    expect(sqlite.prepare('SELECT user_id,friend_id FROM friends').all()).toEqual([{ user_id: 'bob', friend_id: 'alice' }]);
    expect(warning).toHaveBeenCalled(); expect(sent.some(event => event.payload.type === 'friend_request_accepted')).toBe(true);
  });
  it('sends no presence and creates no friendship for a declined request', async () => {
    expect((await answer('declined')).statusCode).toBe(200);
    expect(presenceTo('alice')).toEqual([]); expect(presenceTo('bob')).toEqual([]); expect(sqlite.prepare('SELECT * FROM friends').all()).toEqual([]);
  });
});
