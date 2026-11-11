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
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) if (sql.trim()) sqlite.exec(sql);
  }
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, updatedAt: 1 }).run();
  app = Fastify(); const { instanceRoutes } = await import('./instance.js'); await app.register(instanceRoutes);
});
afterEach(async () => { await app.close(); sqlite.close(); });

describe('GET /api/instance/info', () => {
  it('does not advertise a desktop version requirement', async () => {
    expect((await app.inject('/api/instance/info')).json()).not.toHaveProperty('minimumDesktopVersion');
  });
  it('omits obsolete peer epoch and registration metadata rather than disabling a mode', async () => {
    const result = await app.inject('/api/instance/info'); expect(result.statusCode).toBe(200);
    expect(result.json()).not.toHaveProperty('federatedRegistrationOpen'); expect(result.json()).not.toHaveProperty('instanceId');
  });
  it('reports spaceCreationOpen default true and stored false override', async () => {
    expect((await app.inject('/api/instance/info')).json().spaceCreationOpen).toBe(true);
    testDb.update(schema.instanceSettings).set({ spaceCreationOpen: 0 }).where(eq(schema.instanceSettings.id, 1)).run();
    expect((await app.inject('/api/instance/info')).json().spaceCreationOpen).toBe(false);
  });
  it('retains the real version, source offer and upload limits', async () => {
    const res = await app.inject('/api/instance/info'); expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.name).toBe('string');
    // config.version reads the package manifest, not a hardcoded test version.
    expect(body.version).toBe(config.version); expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof body.registrationOpen).toBe('boolean');
    expect(body.sourceCodeUrl).toMatch(/^https?:\/\//); expect(body.commit === null || typeof body.commit === 'string').toBe(true);
    expect(body.maxStickerSizeMb).toBeGreaterThan(0);
  });
  it('omits all retired metadata with no inert persistence columns', async () => {
    const before = testDb.select().from(schema.instanceSettings).get();
    const res = await app.inject('/api/instance/info'); expect(res.statusCode).toBe(200);
    for (const key of ['discoveryEnabled', 'directoryConfigured', 'directoryAvailable', 'directoryEnabled', 'directoryBrowseEnabled', 'supportCardEnabled']) {
      expect(res.json()).not.toHaveProperty(key);
    }
    expect(testDb.select().from(schema.instanceSettings).get()).toEqual(before);
    const columns = sqlite.pragma('table_info(instance_settings)') as Array<{ name: string }>;
    expect(columns.map(column => column.name)).not.toContain('support_card_enabled');
  });
});
