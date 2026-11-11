import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import jwt from 'jsonwebtoken';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { connectionManager } from './handler.js';
import { handleDmCallStartForTest as start } from './events.js';
import type { WebSocket } from 'ws';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let caller = 'alice';
const livekit = vi.hoisted(() => ({ url: 'wss://media.invalid/livekit', apiKey: 'synthetic-api-key', apiSecret: 'synthetic-secret-at-least-thirty-two-bytes' }));
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../config.js', async importActual => ({ ...(await importActual<typeof import('../config.js')>()), config: { livekit } }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (request: { userId: string; username: string }) => { request.userId = caller; request.username = caller; } }));
const sockets = new Map<string, WebSocket>();
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema }); caller = 'alice';
  for (const id of ['alice', 'bob', 'outsider']) {
    seedNativeUser(sqlite, id);
    const socket = { readyState: 1, send: vi.fn(), close: vi.fn() } as unknown as WebSocket;
    sockets.set(id, socket); connectionManager.addConnection(id, socket);
  }
  sqlite.exec("INSERT INTO dm_channels (id,pair_key,created_at) VALUES ('pair','private-pair-key',1); INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('pair','alice'),('pair','bob')");
  app = Fastify(); const { livekitRoutes } = await import('../routes/livekit.js'); await app.register(livekitRoutes); await app.ready();
});
afterEach(async () => {
  await app.close(); connectionManager.destroyRoom('pair');
  for (const [id, socket] of sockets) { connectionManager.clearVoiceWs(id); connectionManager.removeConnection(socket); }
  sockets.clear(); vi.clearAllTimers(); vi.useRealTimers(); sqlite.close(); vi.restoreAllMocks();
});
function decode(token: string): jwt.JwtPayload & { video: { room: string; canPublishSources: string[] } } {
  return jwt.verify(token, livekit.apiSecret, { issuer: livekit.apiKey }) as jwt.JwtPayload & { video: { room: string; canPublishSources: string[] } };
}
describe('native call tokens stay scoped to authenticated user and room', () => {
  it('rings only local members, never broadcasts a bearer token or private pair key, and does not call HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); await start({ dmChannelId: 'pair' }, 'alice', 'alice', sockets.get('alice')!);
    const events = vi.mocked(sockets.get('bob')!.send).mock.calls.map(([data]) => JSON.parse(String(data)) as Record<string, unknown>);
    expect(events).toContainEqual({ type: 'dm_call_incoming', dmChannelId: 'pair', callerId: 'alice', callerName: 'alice' });
    expect(JSON.stringify(events)).not.toContain('private-pair-key');
    for (const event of events) for (const field of ['livekitToken', 'tokens', 'federatedCallId', 'callOrigin']) expect(event).not.toHaveProperty(field);
    expect(sockets.get('outsider')!.send).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
  it('mints only the requesting local identity, in dm-<id>, never a client-selected identity or private uniqueness key', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    for (const id of ['alice', 'bob']) {
      caller = id;
      const result = await app.inject({ method: 'POST', url: '/api/livekit/token', payload: { dmChannelId: 'pair', identity: 'outsider', room: 'private-pair-key', homeUserId: 'outsider' } });
      expect(result.statusCode).toBe(200); expect(result.json().url).toBe(livekit.url);
      const payload = decode(result.json<{ token: string }>().token);
      expect(payload.sub).toBe(`${id}:${id}`); expect(payload.exp! - payload.nbf!).toBe(3600);
      expect(payload.video).toMatchObject({ room: 'dm-pair', roomJoin: true, canPublish: true, canSubscribe: true });
      expect(payload.video.canPublishSources).toEqual(['microphone', 'camera', 'screen_share', 'screen_share_audio']);
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('refuses a nonmember without issuing a token or changing local state', async () => {
    caller = 'outsider'; const before = sqlite.serialize();
    const result = await app.inject({ method: 'POST', url: '/api/livekit/token', payload: { dmChannelId: 'pair' } });
    expect(result.statusCode).toBe(403); expect(result.json()).toMatchObject({ code: 'not_dm_member' });
    expect(result.json()).not.toHaveProperty('token'); expect(sqlite.serialize()).toEqual(before);
  });
  it('has no alternate federated token factory', async () => {
    expect(await import('../routes/livekit.js')).not.toHaveProperty('generateFederatedCallToken');
  });
});
