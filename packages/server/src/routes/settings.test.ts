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

setWorkerId(4);
let sqlite: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => testDb, getRawDb: () => sqlite, schema }));
const sendToAll = vi.fn();
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToAll } }));
vi.mock('../utils/auth.js', () => ({
  authenticate: async (req: { userId?: string }) => { req.userId = 'admin-1'; },
  requireAdmin: async () => {},
}));

beforeEach(async () => {
  sendToAll.mockReset();
  sqlite = new Database(':memory:'); sqlite.pragma('foreign_keys = ON');
  const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
  for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) {
    for (const sql of fs.readFileSync(path.join(dir, file), 'utf8').split(/-->\s*statement-breakpoint/)) if (sql.trim()) sqlite.exec(sql);
  }
  testDb = drizzle(sqlite, { schema });
  testDb.insert(schema.instanceSettings).values({ id: 1, updatedAt: 1 }).run();
  testDb.insert(schema.users).values({ id: 'admin-1', username: 'admin', passwordHash: 'x', isAdmin: 1, createdAt: 1 }).run();
  app = Fastify(); const { settingsRoutes } = await import('./settings.js'); await app.register(settingsRoutes);
});
afterEach(async () => { await app.close(); sqlite.close(); });
function setSettings(values: Partial<typeof schema.instanceSettings.$inferInsert>) {
  testDb.update(schema.instanceSettings).set(values).where(eq(schema.instanceSettings.id, 1)).run();
}
function readSettings() { return testDb.select().from(schema.instanceSettings).where(eq(schema.instanceSettings.id, 1)).get(); }

describe('retained federated registration settings', () => {
  it('defaults to true and reads the stored false value', async () => {
    expect((await app.inject('/api/settings/instance')).json().federatedRegistrationOpen).toBe(true);
    setSettings({ federatedRegistrationOpen: 0 });
    expect((await app.inject('/api/settings/instance')).json().federatedRegistrationOpen).toBe(false);
  });
  it.each([false, true])('persists %s through PATCH', async value => {
    setSettings({ federatedRegistrationOpen: value ? 0 : 1 });
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/instance', payload: { federatedRegistrationOpen: value } });
    expect(res.statusCode).toBe(200); expect(res.json().federatedRegistrationOpen).toBe(value);
    expect(readSettings()?.federatedRegistrationOpen).toBe(value ? 1 : 0);
  });
  it('keeps a stored false when a partial PATCH omits it', async () => {
    setSettings({ federatedRegistrationOpen: 0 });
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/instance', payload: { instanceName: 'NewName' } });
    expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ instanceName: 'NewName', federatedRegistrationOpen: false });
    expect(readSettings()?.federatedRegistrationOpen).toBe(0);
  });
});

describe('spaceCreationOpen settings and broadcast', () => {
  it('defaults to true and reads the stored false value', async () => {
    expect((await app.inject('/api/settings/instance')).json().spaceCreationOpen).toBe(true);
    setSettings({ spaceCreationOpen: 0 });
    expect((await app.inject('/api/settings/instance')).json().spaceCreationOpen).toBe(false);
  });
  it.each([false, true])('persists %s through PATCH and broadcasts instance_settings_updated', async value => {
    setSettings({ spaceCreationOpen: value ? 0 : 1 });
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/instance', payload: { spaceCreationOpen: value } });
    expect(res.statusCode).toBe(200);
    expect(res.json().spaceCreationOpen).toBe(value);
    expect(readSettings()?.spaceCreationOpen).toBe(value ? 1 : 0);
    expect(sendToAll).toHaveBeenCalledWith({ type: 'instance_settings_updated', spaceCreationOpen: value });
  });
  it('keeps a stored false when a partial PATCH omits it without broadcasting', async () => {
    setSettings({ spaceCreationOpen: 0 });
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/instance', payload: { instanceName: 'NewName' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ instanceName: 'NewName', spaceCreationOpen: false });
    expect(readSettings()?.spaceCreationOpen).toBe(0);
    expect(sendToAll).not.toHaveBeenCalled();
  });
});

describe('retained settings error contracts', () => {
  it.each([
    ['streaming', { maxBitrateKbps: 10 }, 'streaming_max_bitrate_out_of_range', { min: 500, max: 1000000 }],
    ['streaming', { minBitrateKbps: 5000, maxBitrateKbps: 5000 }, 'streaming_min_bitrate_not_below_max', undefined],
    ['streaming', { bitrateMatrixOverrides: { bogus: 100 } }, 'streaming_bitrate_matrix_key_invalid', { key: 'bogus' }],
    ['instance', { instanceName: 'x'.repeat(33) }, 'instance_name_length', { min: 1, max: 32 }],
    ['instance', { federatedRegistrationOpen: 'yes' }, 'field_not_boolean', { field: 'federatedRegistrationOpen' }],
    ['instance', { spaceCreationOpen: 'no' }, 'field_not_boolean', { field: 'spaceCreationOpen' }],
    ['instance', { federationRelayTtlDays: 0 }, 'relay_ttl_out_of_range', { min: 1, max: 365 }],
  ] as const)('rejects %s input with %s', async (route, payload, code, details) => {
    const before = readSettings();
    const res = await app.inject({ method: 'PATCH', url: `/api/settings/${route}`, payload });
    expect(res.statusCode).toBe(400); expect(res.json().code).toBe(code);
    if (details) expect(res.json().details).toEqual(details);
    if (code === 'streaming_max_bitrate_out_of_range') expect(res.json().error).toBe('maxBitrateKbps must be between 500 and 1000000');
    if (code === 'field_not_boolean' && details && 'field' in details) expect(res.json().error).toContain(String(details.field));
    expect(readSettings()).toEqual(before);
  });
  it('names offending resolutions and retains the allowed native value', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/streaming', payload: { allowedResolutions: [999, 720] } });
    expect(res.statusCode).toBe(400); expect(res.json().code).toBe('streaming_resolutions_invalid');
    expect(res.json().details.invalid).toBe('999'); expect(res.json().details.allowed).toMatch(/native/);
  });
});

const retiredFields = ['discoveryEnabled', 'directoryEnabled', 'directoryBrowseEnabled', 'directoryConfigured', 'directoryAvailable',
  'directoryDirty', 'directoryLastPingAt', 'directoryLastError', 'directoryListedSpaceCount', 'supportCardEnabled'];
describe.each([0, 1])('legacy directory settings stored as %i', value => {
  beforeEach(() => { setSettings({ discoveryEnabled: value, directoryEnabled: value, directoryBrowseEnabled: value,
    directoryDirty: value, directoryLastPingAt: 42, directoryLastError: 'historical', supportCardEnabled: !!value }); });
  it.each(['instance', 'streaming'])('omits retired fields from GET /settings/%s', async route => {
    const before = readSettings(); const res = await app.inject(`/api/settings/${route}`);
    expect(res.statusCode).toBe(200); for (const key of retiredFields) expect(res.json()).not.toHaveProperty(key);
    expect(readSettings()).toEqual(before);
  });
  it.each(['instance', 'streaming'])('ignores every legacy key and preserves data on PATCH /settings/%s', async route => {
    const before = readSettings();
    const payload = Object.fromEntries(retiredFields.map(key => [key, { ignored: 'not a boolean' }]));
    const res = await app.inject({ method: 'PATCH', url: `/api/settings/${route}`, payload });
    expect(res.statusCode).toBe(200); for (const key of retiredFields) expect(res.json()).not.toHaveProperty(key);
    const after = readSettings(); expect(after).toEqual({ ...before, updatedAt: after?.updatedAt });
  });
  it('keeps ordinary instance and streaming edits independent of all retired flags', async () => {
    const before = readSettings();
    const res = await app.inject({ method: 'PATCH', url: '/api/settings/instance', payload: { instanceName: 'Renamed', federatedRegistrationOpen: false } });
    expect(res.statusCode).toBe(200); expect(res.json()).toMatchObject({ instanceName: 'Renamed', federatedRegistrationOpen: false });
    const stream = await app.inject({ method: 'PATCH', url: '/api/settings/streaming', payload: { maxFramerate: 30 } });
    expect(stream.statusCode).toBe(200); expect(stream.json().maxFramerate).toBe(30);
    expect(readSettings()).toEqual({ ...before, instanceName: 'Renamed', federatedRegistrationOpen: 0, maxFramerate: 30, updatedAt: readSettings()?.updatedAt });
  });
});
