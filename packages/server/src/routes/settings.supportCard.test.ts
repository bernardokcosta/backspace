import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';

setWorkerId(5);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Module-level mutable state — see invites.test.ts for the rationale on why
// the `getDb` mock closes over a getter rather than the binding directly.
type TestDb = ReturnType<typeof drizzle<typeof schema>>;
let sqlite: Database.Database;
let testDb: TestDb;
let app: FastifyInstance;
const ADMIN_ID = 'admin-1';
const MEMBER_ID = 'member-1';

vi.mock('../db/index.js', () => ({
  getDb: () => testDb,
  getRawDb: () => sqlite,
  schema,
}));

// Only `authenticate` is replaced: it takes the caller from an `x-test-user`
// header instead of a JWT. `requireAdmin` stays real, so the non-admin case
// below is refused by the same check production runs, against the users table.
vi.mock('../utils/auth.js', async (orig) => ({
  ...(await orig<typeof import('../utils/auth.js')>()),
  authenticate: async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers['x-test-user'];
    if (typeof header !== 'string') {
      return reply.code(401).send({ error: 'Unauthorized', code: 'unauthorized', statusCode: 401 });
    }
    req.userId = header;
  },
}));

function applyMigrations(db: Database.Database): void {
  const migrationsDir = path.resolve(__dirname, '../../drizzle');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    const sqlText = fs.readFileSync(path.join(migrationsDir, f), 'utf8');
    const statements = sqlText.split(/-->\s*statement-breakpoint/);
    for (const stmt of statements) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

async function buildApp(): Promise<FastifyInstance> {
  const { settingsRoutes } = await import('./settings.js');
  const { instanceRoutes } = await import('./instance.js');
  const f = Fastify();
  await f.register(settingsRoutes);
  await f.register(instanceRoutes);
  return f;
}

beforeEach(async () => {
  sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = ON');
  applyMigrations(sqlite);
  testDb = drizzle(sqlite, { schema });

  // Seed the singleton instance_settings row (mirrors ensureDefaults at boot),
  // leaving every column at its schema default.
  testDb.insert(schema.instanceSettings).values({
    id: 1,
    instanceId: '123e4567-e89b-12d3-a456-426614174000',
    updatedAt: Date.now(),
  }).run();

  testDb.insert(schema.users).values([
    { id: ADMIN_ID, username: 'admin', passwordHash: 'x', isAdmin: 1, createdAt: Date.now() },
    { id: MEMBER_ID, username: 'member', passwordHash: 'x', isAdmin: 0, createdAt: Date.now() },
  ]).run();

  app = await buildApp();
});

afterEach(async () => { await app.close(); sqlite.close(); });

function storedSupportCardEnabled(): number {
  const row = sqlite.prepare('SELECT support_card_enabled AS v FROM instance_settings WHERE id = 1').get() as { v: number } | undefined;
  if (!row) throw new Error('instance_settings row missing');
  return row.v;
}

async function patchAs(userId: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: '/api/settings/instance',
    headers: { 'x-test-user': userId },
    payload,
  });
}

describe('retired support-card setting', () => {
  it('preserves the historical database default for rollback', () => {
    expect(storedSupportCardEnabled()).toBe(1);
  });

  describe.each([0, 1])('legacy stored value %i', (value) => {
    beforeEach(() => { sqlite.prepare('UPDATE instance_settings SET support_card_enabled = ? WHERE id = 1').run(value); });

    it.each(['/api/instance/info', '/api/settings/instance'])('omits the field from %s', async (url) => {
      const res = await app.inject({ method: 'GET', url, headers: { 'x-test-user': ADMIN_ID } });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('supportCardEnabled');
      expect(storedSupportCardEnabled()).toBe(value);
    });

    it.each([true, false, 'no', null])('ignores legacy PATCH value %s without changing stored data', async (input) => {
      const before = testDb.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
      const res = await patchAs(ADMIN_ID, { supportCardEnabled: input });
      expect(res.statusCode).toBe(200);
      expect(res.json()).not.toHaveProperty('supportCardEnabled');
      expect(storedSupportCardEnabled()).toBe(value);
      const after = testDb.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get();
      expect(after).toEqual({ ...before, updatedAt: after?.updatedAt });
    });

    it('keeps unrelated settings editable and the shared public sticker limits', async () => {
      const res = await patchAs(ADMIN_ID, { instanceName: 'Retained', supportCardEnabled: !value, maxStickerSizeMb: 42 });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ instanceName: 'Retained', maxStickerSizeMb: 42 });
      const info = await app.inject({ method: 'GET', url: '/api/instance/info' });
      expect(info.json()).toMatchObject({ name: 'Retained', maxStickerSizeMb: 42 });
      expect(storedSupportCardEnabled()).toBe(value);
    });

    it('still refuses non-admin settings writes', async () => {
      const res = await patchAs(MEMBER_ID, { supportCardEnabled: !value, instanceName: 'Forbidden' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ code: 'forbidden' });
      expect(storedSupportCardEnabled()).toBe(value);
    });
  });

  it('stays out of GET /api/settings/streaming', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/settings/streaming', headers: { 'x-test-user': MEMBER_ID } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('supportCardEnabled');
  });

});
