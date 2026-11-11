import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { hashPassword, signJwt, verifyJwt, verifyPassword } from '../utils/auth.js';
import * as authUtils from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
const password = 'synthetic-password';
let hash: string;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: vi.fn(), sendToSpace: vi.fn(), forceDisconnectUser: vi.fn(), setUserShowActivity: vi.fn(), clearUserActivities: vi.fn(), getUserStatus: () => 'offline' } }));
vi.mock('../ws/presence.js', () => ({ applyChosenStatus: vi.fn() }));
import { connectionManager } from '../ws/handler.js';
const headers = () => ({ authorization: `Bearer ${signJwt({ userId: 'native', username: 'legacy@old.invalid' })}` });
beforeEach(async () => {
  setWorkerId(1); sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  seedNativeUser(sqlite, 'native'); seedNativeUser(sqlite, 'friend'); seedNativeUser(sqlite, 'other');
  hash = await hashPassword(password);
  sqlite.prepare("UPDATE users SET username='legacy@old.invalid',password_hash=?,developer_mode=1,show_activity=0 WHERE id='native'").run(hash);
  vi.clearAllMocks(); app = Fastify(); const { userRoutes } = await import('./users.js'); await app.register(userRoutes); await app.ready();
});
afterEach(async () => { await app.close(); sqlite.close(); vi.restoreAllMocks(); });
function row(): unknown { return sqlite.prepare("SELECT * FROM users WHERE id='native'").get(); }

describe('native account self-service and retired endpoint absence', () => {
  it('keeps password changes available to a preserved native account with a nullable deletion flag', async () => {
    sqlite.exec("UPDATE users SET is_deleted=NULL WHERE id='native'");
    expect(sqlite.prepare("SELECT is_deleted FROM users WHERE id='native'").get()).toEqual({ is_deleted: null });
    expect((await app.inject({ url: '/api/users/@me', headers: headers() })).statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: headers(),
      payload: { currentPassword: password, newPassword: 'new-nullable-account-password' } });
    expect(response.statusCode).toBe(200);
    expect(verifyJwt(response.json<{ token: string }>().token).userId).toBe('native');
    expect(await verifyPassword('new-nullable-account-password', (row() as { password_hash: string }).password_hash)).toBe(true);
    expect(sqlite.prepare("SELECT is_deleted FROM users WHERE id='native'").get()).toEqual({ is_deleted: null });
    expect(connectionManager.forceDisconnectUser).toHaveBeenCalledWith('native');
  });
  it.each(['password', 'deleted'] as const)('cannot mint a replacement session over a concurrent %s change', async change => {
    const replacementHash = await hashPassword('admin-replacement-password');
    const realHash = authUtils.hashPassword;
    let reached!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { reached = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const hashWork = vi.spyOn(authUtils, 'hashPassword').mockImplementationOnce(async value => {
      const result = await realHash(value); reached(); await held; return result;
    });
    const pending = app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: headers(),
      payload: { currentPassword: password, newPassword: 'requested-new-password' } }).then(result => result);
    try {
      await ready;
      sqlite.prepare("UPDATE users SET password_hash=?,password_changed_at=?,is_deleted=? WHERE id='native'").run(replacementHash, Date.now(), change === 'deleted' ? 1 : 0);
      const before = row(); release(); const result = await pending;
      expect(result.statusCode).toBe(401); expect(result.json()).not.toHaveProperty('token');
      expect(row()).toEqual(before); expect(connectionManager.forceDisconnectUser).not.toHaveBeenCalled();
    } finally { release(); await pending; hashWork.mockRestore(); }
  });
  it.each([
    { method: 'GET', url: '/api/users/@me/federation-registry' },
    { method: 'PUT', url: '/api/users/@me/federation-registry' },
    { method: 'POST', url: '/api/users/@me/federation-credential' },
    { method: 'POST', url: '/api/users/@me/federation-identity/delete' },
  ] as const)('$method $url is unregistered even for a real local JWT', async target => {
    const before = row(), fetch = vi.spyOn(globalThis, 'fetch');
    const result = await app.inject({ ...target, headers: headers() });
    expect(result.statusCode).toBe(404); expect(row()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps exact native self identity and preferences without credential or provenance fields', async () => {
    const result = await app.inject({ url: '/api/users/@me', headers: headers() }); expect(result.statusCode).toBe(200);
    const profile = result.json(); expect(profile).toMatchObject({ id: 'native', username: 'legacy@old.invalid', developerMode: true, showActivity: false });
    for (const field of ['homeUserId', 'homeInstance', 'replicatedInstances', 'passwordHash', 'detachedHomeInstance']) expect(profile).not.toHaveProperty(field);
  });

  it('ignores obsolete identity extras without mutating any stored authority', async () => {
    const result = await app.inject({ method: 'PATCH', url: '/api/users/@me', headers: headers(), payload: { displayName: ' Native ', homeUserId: 'other', homeInstance: 'unused.invalid', replicatedInstances: [{ origin: 'https://unused.invalid', username: 'foreign' }], isAdmin: true } });
    expect(result.statusCode).toBe(200); expect(result.json()).toMatchObject({ id: 'native', displayName: 'Native', isAdmin: false });
    expect(sqlite.prepare("SELECT password_hash,is_admin FROM users WHERE id='native'").get()).toEqual({ password_hash: hash, is_admin: 0 });
  });

  it('does not leak self-only preferences to friends on an ordinary profile update', async () => {
    sqlite.exec("INSERT INTO friends VALUES ('native','friend',1)");
    const result = await app.inject({ method: 'PATCH', url: '/api/users/@me', headers: headers(), payload: { displayName: 'Native' } });
    expect(result.statusCode).toBe(200);
    const calls = vi.mocked(connectionManager.sendToUser).mock.calls;
    const friend = calls.find(call => call[0] === 'friend')?.[1];
    expect(friend).toMatchObject({ type: 'user_updated', user: { id: 'native', displayName: 'Native' } });
    if (friend?.type === 'user_updated') {
      expect(friend.user).not.toHaveProperty('developerMode'); expect(friend.user).not.toHaveProperty('showActivity');
    }
    expect(calls.find(call => call[0] === 'native')?.[1]).toMatchObject({ type: 'user_updated', user: { developerMode: true, showActivity: false } });
  });

  it('cannot change a password without its current local password, regardless of submitted home fields', async () => {
    for (const currentPassword of [undefined, 'wrong']) {
      const before = row(); const result = await app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: headers(), payload: { newPassword: 'new-synthetic-password', currentPassword, homeInstance: 'unused.invalid' } });
      expect(result.statusCode).toBe(currentPassword ? 403 : 400); expect(row()).toEqual(before);
    }
    const success = await app.inject({ method: 'POST', url: '/api/users/@me/change-password', headers: headers(), payload: { currentPassword: password, newPassword: 'new-synthetic-password' } });
    expect(success.statusCode).toBe(200); expect(verifyJwt(success.json<{ token: string }>().token).userId).toBe('native');
    expect(await verifyPassword('new-synthetic-password', (row() as { password_hash: string }).password_hash)).toBe(true);
  });

  it('requires a local deletion password and preserves a surviving friend\'s private archive', async () => {
    sqlite.exec("INSERT INTO dm_channels (id,created_at) VALUES ('archive',1); INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('archive','native'),('archive','friend'); INSERT INTO dm_messages (id,dm_channel_id,user_id,content,created_at) VALUES ('message','archive','native','preserved private history',1)");
    for (const supplied of [undefined, 'wrong']) {
      const before = row(); const result = await app.inject({ method: 'DELETE', url: '/api/users/@me', headers: headers(), payload: { username: 'legacy@old.invalid', password: supplied, homeInstance: 'unused.invalid' } });
      expect(result.statusCode).toBe(supplied ? 403 : 400); expect(row()).toEqual(before);
    }
    expect((await app.inject({ method: 'DELETE', url: '/api/users/@me', headers: headers(), payload: { username: 'legacy@old.invalid', password } })).statusCode).toBe(200);
    expect(sqlite.prepare('SELECT content FROM dm_messages').get()).toEqual({ content: 'preserved private history' });
    expect(sqlite.prepare('SELECT user_id FROM dm_members ORDER BY user_id').all()).toEqual([{ user_id: 'friend' }, { user_id: 'native' }]);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('mutuals never interprets an absent target id through an obsolete identity query', async () => {
    sqlite.exec("INSERT INTO friends VALUES ('native','friend',1),('other','friend',1)");
    const native = await app.inject({ url: '/api/users/other/mutuals', headers: headers() });
    expect(native.json<{ mutualFriends: Array<{ id: string }> }>().mutualFriends.map(user => user.id)).toEqual(['friend']);
    const absent = await app.inject({ url: '/api/users/absent/mutuals?homeUserId=other', headers: headers() });
    expect(absent.statusCode).toBe(200); expect(absent.json()).toEqual({ mutualFriends: [], mutualSpaces: [] });
  });
});
