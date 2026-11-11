import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser, snapshotDatabase } from '../testing/standaloneUpgrade.js';
import { signJwt } from '../utils/auth.js';
const uploadDir = await vi.hoisted(async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-profile-security-')); process.env.UPLOAD_DIR = dir; return dir;
});
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: vi.fn() } }));
vi.mock('../utils/thumbnail.js', async original => ({ ...await original<typeof import('../utils/thumbnail.js')>(), resizeProfileImage: vi.fn(async () => undefined) }));
import { resizeProfileImage } from '../utils/thumbnail.js';
beforeEach(async () => {
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema }); seedNativeUser(sqlite, 'native'); seedNativeUser(sqlite, 'other');
  sqlite.exec(`INSERT INTO spaces (id,name,owner_id,created_at) VALUES ('space','Native','native',1);
    INSERT INTO channels (id,space_id,name,type,position,created_at) VALUES ('channel','space','Native','text',0,1);
    INSERT INTO messages (id,channel_id,user_id,content,created_at) VALUES ('message','channel','native','preserve attachment',1);`);
  vi.clearAllMocks(); app = Fastify(); const { userRoutes } = await import('./users.js'); await app.register(userRoutes); await app.ready();
});
afterEach(async () => { await app.close(); sqlite.close(); for (const name of fs.readdirSync(uploadDir)) fs.unlinkSync(path.join(uploadDir, name)); });
afterAll(() => fs.rmdirSync(uploadDir));
const save = (payload: unknown) => app.inject({ method: 'PATCH', url: '/api/users/@me', headers: { authorization: `Bearer ${signJwt({ userId: 'native', username: 'native' })}`, 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
function upload(filename: string, uploaderId: string, messageId: string | null = null): void {
  fs.writeFileSync(path.join(uploadDir, filename), 'preserved-bytes');
  db.insert(schema.attachments).values({ id: filename, filename, originalName: filename, uploaderId, messageId, mimetype: 'image/png', size: 15, createdAt: 1 }).run();
}
describe('native profile asset ownership and cleanup', () => {
  it.each(['avatar', 'banner'] as const)('rejects another account %s upload before database, resize or file changes', async field => {
    upload('foreign.png', 'other'); const before = snapshotDatabase(sqlite); const response = await save({ [field]: '/api/uploads/foreign.png' });
    expect(response.statusCode).toBe(400); expect(response.json()).toMatchObject({ code: `${field}_url_invalid` }); expect(snapshotDatabase(sqlite)).toEqual(before);
    expect(fs.readFileSync(path.join(uploadDir, 'foreign.png'), 'utf8')).toBe('preserved-bytes'); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it.each(['avatar', 'banner'] as const)('rejects an owned %s upload already held by a message', async field => {
    upload('held.png', 'native', 'message'); const before = snapshotDatabase(sqlite); const response = await save({ [field]: '/api/uploads/held.png' });
    expect(response.statusCode).toBe(400); expect(snapshotDatabase(sqlite)).toEqual(before); expect(fs.existsSync(path.join(uploadDir, 'held.png'))).toBe(true); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it.each(['avatar', 'banner'] as const)('claims an owned loose %s once and treats normalized same-file repeats as no-ops', async field => {
    upload('mine.png', 'native'); const first = await save({ [field]: ' /api/uploads/mine.png ' });
    expect(first.statusCode).toBe(200); expect(first.json()[field]).toBe('mine.png'); expect(sqlite.prepare("SELECT * FROM attachments WHERE filename='mine.png'").get()).toBeUndefined();
    expect(resizeProfileImage).toHaveBeenCalledExactlyOnceWith(path.join(uploadDir, 'mine.png'), field);
    vi.mocked(resizeProfileImage).mockClear(); expect((await save({ [field]: '/api/uploads/mine.png' })).statusCode).toBe(200);
    expect(fs.existsSync(path.join(uploadDir, 'mine.png'))).toBe(true); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it.each([{}, 42, '/api/uploads/../foreign.png', '/api/uploads/x/foreign.png', '/api/uploads/foreign.png?ignored', '/api/uploads/%2e%2e%2fforeign.png'])('refuses malformed local assets %j without side effects', async avatar => {
    upload('foreign.png', 'other'); const before = snapshotDatabase(sqlite); const response = await save({ avatar });
    expect(response.statusCode).toBe(400); expect(snapshotDatabase(sqlite)).toEqual(before); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it('preserves an old file still held by another native profile on replacement or clear', async () => {
    fs.writeFileSync(path.join(uploadDir, 'shared.png'), 'shared-profile'); sqlite.exec("UPDATE users SET avatar='shared.png'");
    expect((await save({ avatar: null })).statusCode).toBe(200); expect(fs.readFileSync(path.join(uploadDir, 'shared.png'), 'utf8')).toBe('shared-profile');
    expect(sqlite.prepare("SELECT avatar FROM users WHERE id='other'").get()).toEqual({ avatar: 'shared.png' });
  });
  it('preserves an old file still held by its own banner when the avatar is cleared', async () => {
    fs.writeFileSync(path.join(uploadDir, 'shared.png'), 'shared-profile'); sqlite.exec("UPDATE users SET avatar='shared.png',banner='shared.png' WHERE id='native'");
    expect((await save({ avatar: null })).statusCode).toBe(200); expect(fs.existsSync(path.join(uploadDir, 'shared.png'))).toBe(true);
  });
  it('does not resize an upload already referenced by another native profile', async () => {
    upload('already-used.png', 'native'); sqlite.exec("UPDATE users SET avatar='already-used.png' WHERE id='other'");
    const before = snapshotDatabase(sqlite); expect((await save({ banner: 'already-used.png' })).statusCode).toBe(400);
    expect(snapshotDatabase(sqlite)).toEqual(before); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it('does not delete a historical profile file still registered as message content', async () => {
    upload('held.png', 'native', 'message'); sqlite.exec("UPDATE users SET avatar='held.png' WHERE id='native'");
    expect((await save({ avatar: null })).statusCode).toBe(200); expect(fs.existsSync(path.join(uploadDir, 'held.png'))).toBe(true);
    expect(sqlite.prepare("SELECT message_id FROM attachments WHERE filename='held.png'").get()).toEqual({ message_id: 'message' });
  });
  it('allows a normal external asset reference without claiming, resizing or deleting local bytes', async () => {
    expect((await save({ avatar: 'https://images.example/image.png' })).statusCode).toBe(200);
    expect((await save({ avatar: null })).statusCode).toBe(200); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it('deletes only a replaced unreferenced profile file and keeps native content', async () => {
    fs.writeFileSync(path.join(uploadDir, 'old.png'), 'old-avatar'); sqlite.exec("UPDATE users SET avatar='old.png' WHERE id='native'"); upload('new.png', 'native');
    expect((await save({ avatar: 'new.png' })).statusCode).toBe(200); expect(fs.existsSync(path.join(uploadDir, 'old.png'))).toBe(false);
    expect(fs.existsSync(path.join(uploadDir, 'new.png'))).toBe(true); expect(sqlite.prepare('SELECT content FROM messages').get()).toEqual({ content: 'preserve attachment' });
  });
});
