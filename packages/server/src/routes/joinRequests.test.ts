import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, and } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { PermissionBits, permissionsToString } from '../utils/permissions.js';
import { setWorkerId } from '../utils/snowflake.js';
import { connectionManager } from '../ws/handler.js';

setWorkerId(1);
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: FastifyRequest) => { req.userId = String(req.headers['x-test-user'] ?? 'caller'); } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: vi.fn(), sendToSpace: vi.fn(), addUserSpace: vi.fn() } }));

function member(userId: string) { db.insert(schema.spaceMembers).values({ spaceId: 's1', userId, joinedAt: 1 }).run(); }
function request(userId = 'caller', message?: string) {
  return app.inject({ method: 'POST', url: '/api/spaces/s1/request-join', headers: { 'x-test-user': userId }, payload: message ? { message } : {} });
}
function decide(id: string, action: string, userId = 'owner') {
  return app.inject({ method: 'PATCH', url: `/api/spaces/s1/join-requests/${id}`, headers: { 'x-test-user': userId }, payload: { action } });
}

beforeEach(async () => {
  vi.clearAllMocks(); sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) if (sql.trim()) sqlite.exec(sql);
  }
  db = drizzle(sqlite, { schema });
  for (const id of ['caller', 'owner', 'manager', 'other']) db.insert(schema.users).values({ id, username: id, passwordHash: 'secret', createdAt: 1 }).run();
  db.insert(schema.spaces).values({ id: 's1', name: 'Request space', ownerId: 'owner', visibility: 'request', createdAt: 1 }).run();
  member('owner');
  app = Fastify();
  const { joinRequestRoutes } = await import('./joinRequests.js');
  await app.register(joinRequestRoutes);
});
afterEach(async () => { await app?.close(); sqlite?.close(); });

describe('join request routes independent of discovery', () => {
  it('does not register discovery or public-join endpoints', async () => {
    expect((await app.inject('/api/spaces/explore')).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/spaces/s1/public-join' })).statusCode).toBe(404);
  });
  it('preserves unknown-space and non-requestable errors', async () => {
    const missing = await app.inject({ method: 'POST', url: '/api/spaces/nope/request-join', payload: {} });
    expect(missing.statusCode).toBe(404); expect(missing.json()).toMatchObject({ code: 'space_not_found', error: 'Space not found' });
    db.update(schema.spaces).set({ visibility: 'private' }).run();
    expect((await request()).json().code).toBe('space_not_requestable');
  });
  it('preserves bans, membership and duplicate-pending checks', async () => {
    db.insert(schema.bans).values({ spaceId: 's1', userId: 'caller', bannedBy: 'owner', createdAt: 1 }).run();
    expect((await request()).json().code).toBe('user_banned');
    db.delete(schema.bans).run(); member('caller');
    expect((await request()).json().code).toBe('already_member');
    db.delete(schema.spaceMembers).where(eq(schema.spaceMembers.userId, 'caller')).run();
    expect((await request()).statusCode).toBe(201);
    const duplicate = await request(); expect(duplicate.statusCode).toBe(409); expect(duplicate.json().code).toBe('join_request_pending');
  });
  it('bounds the note, notifies only managers and returns only the caller’s own requests', async () => {
    member('manager'); member('other');
    db.insert(schema.roles).values({ id: 'manager-role', spaceId: 's1', name: 'Manager', permissions: permissionsToString(PermissionBits.MANAGE_SPACE), createdAt: 1 }).run();
    db.insert(schema.memberRoles).values({ spaceId: 's1', userId: 'manager', roleId: 'manager-role' }).run();
    const res = await request('caller', `  ${'x'.repeat(600)}  `);
    expect(res.statusCode).toBe(201); expect(res.json().message).toHaveLength(500);
    expect(vi.mocked(connectionManager.sendToUser).mock.calls.map(([id]) => id).sort()).toEqual(['manager', 'owner']);
    expect(res.json().user).not.toHaveProperty('passwordHash');
    await request('other');
    const mine = await app.inject('/api/users/@me/join-requests?status=pending');
    expect(mine.json().requests).toHaveLength(1); expect(mine.json().requests[0].userId).toBe('caller');
  });
  it('requires MANAGE_SPACE to list or decide and validates inputs', async () => {
    const list = await app.inject('/api/spaces/s1/join-requests');
    expect(list.statusCode).toBe(403); expect(list.json()).toMatchObject({ code: 'missing_permission', details: { permission: 'MANAGE_SPACE' } });
    expect((await decide('r1', 'accept', 'caller')).json().code).toBe('missing_permission');
    expect((await decide('r1', 'maybe')).json().code).toBe('validation_failed');
    const bad = await app.inject({ url: '/api/spaces/s1/join-requests?status=bogus', headers: { 'x-test-user': 'owner' } });
    expect(bad.statusCode).toBe(400);
    expect((await decide('missing', 'decline')).json().code).toBe('join_request_not_found');
  });
  it('accepts atomically and sends only channels and role data permitted to the new member', async () => {
    db.insert(schema.channels).values([
      { id: 'visible', spaceId: 's1', name: 'welcome', type: 'text', createdAt: 1 },
      { id: 'hidden', spaceId: 's1', name: 'private', type: 'text', createdAt: 1 },
    ]).run();
    db.insert(schema.roles).values({ id: 's1', spaceId: 's1', name: '@everyone', permissions: permissionsToString(PermissionBits.VIEW_CHANNEL), createdAt: 1 }).run();
    db.insert(schema.channelOverrides).values({ channelId: 'hidden', targetType: 'role', targetId: 's1', allow: '0', deny: permissionsToString(PermissionBits.VIEW_CHANNEL) }).run();
    const submitted = await request(); const id = submitted.json().id;
    expect((await decide(id, 'accept')).json()).toMatchObject({ id, status: 'accepted', decidedBy: 'owner' });
    expect(db.select().from(schema.spaceMembers).where(and(eq(schema.spaceMembers.spaceId, 's1'), eq(schema.spaceMembers.userId, 'caller'))).get()).toBeDefined();
    const event = vi.mocked(connectionManager.sendToUser).mock.calls.find(([uid, event]) => uid === 'caller' && event.type === 'join_request_accepted')?.[1];
    expect(event).toMatchObject({ type: 'join_request_accepted', space: { channels: [{ id: 'visible' }] } });
    if (event?.type !== 'join_request_accepted') throw new Error('Acceptance event missing');
    for (const m of event.space.members) expect(m.user).not.toHaveProperty('passwordHash');
    for (const role of event.space.roles) expect(role).not.toHaveProperty('permissions');
    expect(connectionManager.addUserSpace).toHaveBeenCalledWith('caller', 's1');
    expect((await decide(id, 'decline')).json().code).toBe('join_request_decided');
  });
  it('declines without admitting the requester', async () => {
    const id = (await request()).json().id;
    expect((await decide(id, 'decline')).json().status).toBe('declined');
    expect(db.select().from(schema.spaceMembers).where(eq(schema.spaceMembers.userId, 'caller')).get()).toBeUndefined();
    expect(connectionManager.sendToUser).toHaveBeenCalledWith('caller', expect.objectContaining({ type: 'join_request_declined' }));
  });
});
