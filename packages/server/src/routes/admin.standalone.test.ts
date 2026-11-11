import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { signJwt, verifyPassword } from '../utils/auth.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: vi.fn(), forceDisconnectUser: vi.fn(), announceUserAccessChange: vi.fn() } }));
vi.mock('../ws/events.js', () => ({ checkVoicePermissions: vi.fn() }));
import { connectionManager } from '../ws/handler.js';
function auth(id = 'admin') { return { authorization: `Bearer ${signJwt({ userId: id, username: id })}` }; }
beforeEach(async () => {
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  for (const id of ['admin', 'native', 'other']) seedNativeUser(sqlite, id);
  sqlite.exec("UPDATE users SET is_admin=1 WHERE id='admin'; UPDATE users SET username='legacy@old.invalid' WHERE id='native'");
  app = Fastify(); const { adminRoutes } = await import('./admin.js'); await app.register(adminRoutes); await app.ready(); vi.clearAllMocks();
});
afterEach(async () => { await app.close(); sqlite.close(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('native admin account management and retired routes', () => {
  it.each([
    { method: 'GET', url: '/api/admin/users/instances' },
    { method: 'GET', url: '/api/admin/blocked-bots' },
    { method: 'DELETE', url: '/api/admin/blocked-bots/unused.invalid/foreign' },
    { method: 'POST', url: '/api/admin/test/seed-peer' },
    { method: 'POST', url: '/api/admin/test/bot-revocations/run' },
    { method: 'POST', url: '/api/admin/test/federation/resync' },
  ] as const)('$method $url is absent even with test routes enabled and a valid admin JWT', async target => {
    vi.stubEnv('ENABLE_TEST_ROUTES', '1');
    const before = sqlite.prepare('SELECT * FROM users ORDER BY id').all(), fetch = vi.spyOn(globalThis, 'fetch');
    const result = await app.inject({ ...target, headers: auth() });
    expect(result.statusCode).toBe(404); expect(sqlite.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });
  it('lists native accounts without obsolete home metadata or foreign filtering', async () => {
    const result = await app.inject({ url: '/api/admin/users?homeInstance=unused.invalid', headers: auth() });
    expect(result.statusCode).toBe(200); const body = result.json<{ total: number; users: unknown[] }>(); expect(body.total).toBe(3);
    for (const user of body.users) expect(user).not.toHaveProperty('homeInstance');
  });
  it('retains actual admin authorization and supports a sovereign account\'s role/password without contacting its old host', async () => {
    const before = sqlite.prepare("SELECT * FROM users WHERE id='native'").get(), fetch = vi.spyOn(globalThis, 'fetch');
    expect((await app.inject({ method: 'POST', url: '/api/admin/users/native/reset-password', headers: auth('other') })).statusCode).toBe(403);
    expect(sqlite.prepare("SELECT * FROM users WHERE id='native'").get()).toEqual(before);
    expect((await app.inject({ method: 'PATCH', url: '/api/admin/users/native/role', headers: auth(), payload: { isAdmin: true } })).statusCode).toBe(200);
    const result = await app.inject({ method: 'POST', url: '/api/admin/users/native/reset-password', headers: auth() });
    expect(result.statusCode).toBe(200); const temporary = result.json<{ temporaryPassword: string }>().temporaryPassword; expect(temporary).toHaveLength(16);
    const row = sqlite.prepare("SELECT password_hash,is_admin FROM users WHERE id='native'").get() as { password_hash: string; is_admin: number };
    expect(row.is_admin).toBe(1); expect(await verifyPassword(temporary, row.password_hash)).toBe(true);
    expect(connectionManager.forceDisconnectUser).toHaveBeenCalledWith('native'); expect(fetch).not.toHaveBeenCalled();
  });
});
