import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser, snapshotDatabase } from '../testing/standaloneUpgrade.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: vi.fn() } }));
const headers = () => ({ authorization: `Bearer ${signJwt({ userId: 'native', username: 'native' })}` });
beforeEach(async () => {
  setWorkerId(1); sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  seedNativeUser(sqlite, 'native'); seedNativeUser(sqlite, 'other');
  sqlite.exec(`INSERT INTO spaces (id,name,owner_id,created_at) VALUES ('mine','Mine','native',1),('theirs','Theirs','other',1);
    INSERT INTO space_members (space_id,user_id,joined_at) VALUES ('mine','native',1),('theirs','other',1);
    INSERT INTO space_folders (id,user_id,name,position,created_at) VALUES ('own-folder','native','Own',0,1),('foreign-folder','other','Other',0,1);
    INSERT INTO space_folder_members (folder_id,space_id,position) VALUES ('own-folder','mine',0),('foreign-folder','theirs',0);
    INSERT INTO user_space_layout (user_id,layout,updated_at) VALUES ('native','[{"t":"f","id":"own-folder"}]',1);`);
  app = Fastify(); const { userRoutes } = await import('./users.js'); await app.register(userRoutes); await app.ready();
});
afterEach(async () => { await app.close(); sqlite.close(); vi.restoreAllMocks(); });
const save = (payload: unknown) => app.inject({ method: 'PUT', url: '/api/users/@me/space-layout', headers: { ...headers(), 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
describe('native sidebar layout trust boundary', () => {
  it.each(['unknown-folder', 'foreign-folder'])('refuses non-owned existing folder ID %s without altering any layout', async id => {
    const before = snapshotDatabase(sqlite);
    const response = await save({ items: [{ t: 'f', id }], folders: { [id]: { name: 'Stolen', color: null, spaceIds: ['mine'] } }, updatedAt: 2 });
    expect(response.statusCode).toBe(400); expect(response.json()).toMatchObject({ code: 'validation_failed' }); expect(snapshotDatabase(sqlite)).toEqual(before);
  });
  it.each([
    { items: [{ t: 's', id: 'theirs' }], folders: {} },
    { items: [{ t: 'f', id: 'new:folder' }], folders: { 'new:folder': { name: 'Mine', color: null, spaceIds: ['theirs'] } } },
    { items: [{ t: 'f', id: 'foreign-folder' }], folders: {} },
    { items: [], folders: { 'own-folder': null } },
    { items: [], folders: [] },
    { items: [], folders: { 'own-folder': { name: {}, color: null, spaceIds: ['mine'] } } },
    { items: [], folders: { 'own-folder': { name: 'Mine', color: null, spaceIds: [42] } } },
    { items: [], folders: {}, updatedAt: 'invalid' },
  ])('rejects malformed or unauthorized references %# before any write', async payload => {
    const before = snapshotDatabase(sqlite); const response = await save(payload);
    expect(response.statusCode).toBe(400); expect(snapshotDatabase(sqlite)).toEqual(before);
  });
  it('creates only server-generated folder IDs for current native memberships', async () => {
    const response = await save({ items: [{ t: 'f', id: 'new:folder' }], folders: { 'new:folder': { name: 'Native', color: 'mint', spaceIds: ['mine'] } }, updatedAt: 2 });
    expect(response.statusCode).toBe(200); const result = response.json<{ items: Array<{ id: string }>; folders: Array<{ id: string; userId: string; spaceIds: string[] }> }>();
    expect(result.items[0]?.id).toMatch(/^\d+$/); expect(result.folders).toEqual([expect.objectContaining({ id: result.items[0]?.id, userId: 'native', spaceIds: ['mine'] })]);
    expect(sqlite.prepare("SELECT name FROM space_folders WHERE id='foreign-folder'").get()).toEqual({ name: 'Other' }); expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('updates an owned native folder and preserves last-write-wins stale response behavior', async () => {
    const body = { items: [{ t: 'f', id: 'own-folder' }], folders: { 'own-folder': { name: 'Renamed', color: null, spaceIds: ['mine'] } }, updatedAt: 10 };
    const response = await save(body); expect(response.statusCode).toBe(200);
    const before = snapshotDatabase(sqlite); const stale = await save({ ...body, updatedAt: 2 });
    expect(stale.statusCode).toBe(200); expect(stale.json()).toEqual(response.json()); expect(snapshotDatabase(sqlite)).toEqual(before);
  });
});
