import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '../db/schema.js';
import { setWorkerId } from '../utils/snowflake.js';
import { config } from '../config.js';

setWorkerId(3);
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));

beforeEach(async () => {
  (config as { minimumDesktopVersion: string | null }).minimumDesktopVersion = null;
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) if (sql.trim()) sqlite.exec(sql);
  }
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, instanceId: '123e4567-e89b-12d3-a456-426614174000', updatedAt: 1 }).run();
  app = Fastify(); const { instanceRoutes } = await import('./instance.js'); await app.register(instanceRoutes);
});
afterEach(async () => { await app.close(); sqlite.close(); });

describe('GET /api/instance/info', () => {
  it('publicly reports a disabled or configured desktop minimum', async () => {
    expect((await app.inject('/api/instance/info')).json().minimumDesktopVersion).toBeNull();
    (config as { minimumDesktopVersion: string | null }).minimumDesktopVersion = '1.15.1';
    expect((await app.inject('/api/instance/info')).json().minimumDesktopVersion).toBe('1.15.1');
  });
  it('keeps federated registration default and stored override', async () => {
    expect((await app.inject('/api/instance/info')).json().federatedRegistrationOpen).toBe(true);
    testDb.update(schema.instanceSettings).set({ federatedRegistrationOpen: 0 }).where(eq(schema.instanceSettings.id, 1)).run();
    expect((await app.inject('/api/instance/info')).json().federatedRegistrationOpen).toBe(false);
  });
  it('retains the real version, source offer, identity and upload limits', async () => {
    const res = await app.inject('/api/instance/info'); expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.name).toBe('string');
    // config.version reads the package manifest, not a hardcoded test version.
    expect(body.version).toBe(config.version); expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof body.registrationOpen).toBe('boolean'); expect(typeof body.federatedRegistrationOpen).toBe('boolean');
    expect(body.sourceCodeUrl).toMatch(/^https?:\/\//); expect(body.commit === null || typeof body.commit === 'string').toBe(true);
    expect(body.instanceId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(body.maxStickerSizeMb).toBeGreaterThan(0);
  });
  it.each([0, 1])('omits all retired metadata with legacy flags stored as %i', async value => {
    testDb.update(schema.instanceSettings).set({ discoveryEnabled: value, directoryEnabled: value,
      directoryBrowseEnabled: value, directoryDirty: value, supportCardEnabled: !!value }).where(eq(schema.instanceSettings.id, 1)).run();
    const before = testDb.select().from(schema.instanceSettings).get();
    const res = await app.inject('/api/instance/info'); expect(res.statusCode).toBe(200);
    for (const key of ['discoveryEnabled', 'directoryConfigured', 'directoryAvailable', 'directoryEnabled', 'directoryBrowseEnabled', 'supportCardEnabled']) {
      expect(res.json()).not.toHaveProperty(key);
    }
    expect(testDb.select().from(schema.instanceSettings).get()).toEqual(before);
  });
});
