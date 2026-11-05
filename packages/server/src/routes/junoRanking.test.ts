import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { createJunoTestDb, seedJunoTestDb } from '../games/junoTestDb.js';
import * as schema from '../db/schema.js';
let fixture: ReturnType<typeof createJunoTestDb>;
vi.mock('../db/index.js', () => ({ getDb: () => fixture.db, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (request: { userId: string; headers: Record<string, string> }, reply: { code: (code: number) => { send: () => void } }) => {
  if (!request.headers.authorization) return reply.code(401).send();
  request.userId = request.headers.authorization;
} }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { getUserRoom: () => null, getVoiceWs: () => null, sendToChannel: vi.fn() } }));
import { junoRoutes } from './juno.js';
let app: FastifyInstance;
const url = '/api/spaces/space/juno/ranking';
beforeEach(async () => { fixture = createJunoTestDb(); seedJunoTestDb(fixture.db); app = Fastify(); await app.register(junoRoutes); });
afterEach(async () => { await app.close(); fixture.sqlite.close(); });
describe('authorized Juno ranking transport', () => {
  it('allows a human member without voice, but not anonymous or nonmembers', async () => {
    expect((await app.inject({ url })).statusCode).toBe(401);
    expect((await app.inject({ url, headers: { authorization: 'unknown' } })).statusCode).toBe(403);
    const response = await app.inject({ url, headers: { authorization: 'a' } });
    expect(response.statusCode).toBe(200); expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().me.user.id).toBe('a'); expect(response.json().me.totalXp).toBe(0);
    expect(JSON.stringify(response.json())).not.toContain('passwordHash');
    expect((await app.inject({ url: '/api/channels/voice/juno', headers: { authorization: 'a' } })).statusCode).toBe(403);
  });
  it.each([{ isBot: 1 }, { isDeleted: 1 }])('refuses ineligible accounts %j', async change => {
    fixture.db.update(schema.users).set(change).where(eq(schema.users.id, 'a')).run();
    expect((await app.inject({ url, headers: { authorization: 'a' } })).statusCode).toBe(403);
  });
  it('refuses banned members and malformed pagination', async () => {
    for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'offset=-1', 'offset=1000001', 'offset=NaN', 'limit=2&surprise=true']) {
      expect((await app.inject({ url: `${url}?${query}`, headers: { authorization: 'a' } })).statusCode).toBe(400);
    }
    fixture.db.insert(schema.bans).values({ spaceId: 'space', userId: 'a', createdAt: 1 }).run();
    expect((await app.inject({ url, headers: { authorization: 'a' } })).statusCode).toBe(403);
  });
});
