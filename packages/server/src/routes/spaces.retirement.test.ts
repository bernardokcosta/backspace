import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(1);
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../utils/auth.js', () => ({ authenticate: async (req: FastifyRequest) => { req.userId = String(req.headers['x-test-user'] ?? 'owner'); } }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { addUserSpace: vi.fn(), sendToSpace: vi.fn(), sendToUser: vi.fn() } }));

beforeEach(async () => {
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) if (sql.trim()) sqlite.exec(sql);
  }
  db = drizzle(sqlite, { schema });
  for (const id of ['owner', 'member']) db.insert(schema.users).values({ id, username: id, passwordHash: 'x', createdAt: 1 }).run();
  db.insert(schema.instanceSettings).values({ id: 1, directoryDirty: 0, updatedAt: 1 }).run();
  app = Fastify();
  const { spaceRoutes } = await import('./spaces.js'); await app.register(spaceRoutes);
});
afterEach(async () => { await app.close(); sqlite.close(); });
function seed(listed: 0 | 1) {
  db.insert(schema.spaces).values({ id: 's1', name: 'Space', ownerId: 'owner', inviteCode: 'invite', visibility: 'public', directoryListed: listed, createdAt: 1 }).run();
  for (const userId of ['owner', 'member']) db.insert(schema.spaceMembers).values({ spaceId: 's1', userId, joinedAt: 1 }).run();
}
function stored() { return db.select().from(schema.spaces).where(eq(schema.spaces.id, 's1')).get(); }

describe.each([0, 1] as const)('retired listing flag stored as %i', listed => {
  beforeEach(() => { seed(listed); });
  it.each([true, false, 'yes', null])('ignores legacy input %s while updating core metadata', async input => {
    const res = await app.inject({ method: 'PATCH', url: '/api/spaces/s1', payload: { visibility: 'private', description: 'Invitation summary', directoryListed: input } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ visibility: 'private', description: 'Invitation summary' });
    expect(res.json()).not.toHaveProperty('directoryListed');
    expect(stored()?.directoryListed).toBe(listed);
    expect(db.select().from(schema.instanceSettings).get()?.directoryDirty).toBe(0);
  });
  it('treats a legacy-only PATCH like any unknown-only PATCH', async () => {
    const before = stored();
    const res = await app.inject({ method: 'PATCH', url: '/api/spaces/s1', payload: { directoryListed: !listed } });
    expect(res.statusCode).toBe(400); expect(res.json().code).toBe('no_fields_to_update');
    expect(stored()).toEqual(before);
  });
  it.each(['/api/spaces', '/api/spaces/s1'])('omits legacy metadata from %s', async url => {
    const res = await app.inject(url); expect(res.statusCode).toBe(200);
    const body = res.json(); for (const space of Array.isArray(body) ? body : [body]) expect(space).not.toHaveProperty('directoryListed');
    expect(stored()?.directoryListed).toBe(listed);
  });
  it('preserves permission checks for retained edits', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/spaces/s1', headers: { 'x-test-user': 'member' }, payload: { visibility: 'private', directoryListed: true } });
    expect(res.statusCode).toBe(403); expect(stored()?.visibility).toBe('public'); expect(stored()?.directoryListed).toBe(listed);
  });
  it('still deletes a space explicitly without scheduling directory work', async () => {
    expect((await app.inject({ method: 'DELETE', url: '/api/spaces/s1' })).statusCode).toBe(200);
    expect(stored()).toBeUndefined();
    expect(db.select().from(schema.instanceSettings).get()?.directoryDirty).toBe(0);
  });
});
