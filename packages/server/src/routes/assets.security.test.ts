import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser, snapshotDatabase } from '../testing/standaloneUpgrade.js';
import { signJwt } from '../utils/auth.js';
import { setWorkerId } from '../utils/snowflake.js';
const uploadDir = await vi.hoisted(async () => {
  const fs = await import('node:fs'), os = await import('node:os'), path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-native-assets-')); process.env.UPLOAD_DIR = dir; return dir;
});
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { sendToUser: vi.fn(), sendToSpace: vi.fn(), sendToDmMembers: vi.fn(),
  addUserSpace: vi.fn(), forceDisconnectUser: vi.fn(), removeUserSpace: vi.fn() } }));
vi.mock('../utils/thumbnail.js', async original => ({ ...await original<typeof import('../utils/thumbnail.js')>(), resizeProfileImage: vi.fn(async () => undefined) }));
import { resizeProfileImage, thumbFilename } from '../utils/thumbnail.js';
import { deleteAttachmentByFilename, deleteAttachmentFiles } from '../utils/fileCleanup.js';
import { cleanupStorage } from '../utils/storageJanitor.js';
beforeEach(async () => {
  setWorkerId(1); sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  seedNativeUser(sqlite, 'native'); seedNativeUser(sqlite, 'other'); seedNativeUser(sqlite, 'bot');
  sqlite.exec(`UPDATE users SET is_bot=1,bot_owner_id='native',password_hash='!bot' WHERE id='bot';
    INSERT INTO spaces (id,name,owner_id,created_at) VALUES ('space','Native','native',1);
    INSERT INTO space_members (space_id,user_id,joined_at) VALUES ('space','native',1);
    INSERT INTO channels (id,space_id,name,type,position,created_at) VALUES ('channel','space','Native','text',0,1);
    INSERT INTO messages (id,channel_id,user_id,content,created_at) VALUES ('message','channel','native','preserve',1);
    INSERT INTO dm_channels (id,owner_id,created_at) VALUES ('dm','native',1);
    INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('dm','native'),('dm','other');`);
  vi.clearAllMocks(); app = Fastify();
  const [{ spaceRoutes }, { dmRoutes }, { botRoutes }] = await Promise.all([import('./spaces.js'), import('./dm.js'), import('./bots.js')]);
  await app.register(spaceRoutes); await app.register(dmRoutes); await app.register(botRoutes); await app.ready();
});
afterEach(async () => { await app.close(); sqlite.close(); for (const filename of fs.readdirSync(uploadDir)) fs.unlinkSync(path.join(uploadDir, filename)); });
afterAll(() => fs.rmdirSync(uploadDir));
const mutate = (method: 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown, userId = 'native') => app.inject({ method, url,
  headers: { authorization: `Bearer ${signJwt({ userId, username: userId })}`, ...(payload === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }) });
function file(filename: string): void { fs.writeFileSync(path.join(uploadDir, filename), 'native-preserved-bytes'); }
function upload(filename: string, uploaderId = 'native', messageId: string | null = null): void {
  file(filename); db.insert(schema.attachments).values({ id: filename, filename, originalName: filename, uploaderId, messageId, mimetype: 'image/png', size: 22, createdAt: 1 }).run();
}
const exists = (filename: string) => fs.existsSync(path.join(uploadDir, filename));
describe('space asset mutation uses native upload authority', () => {
  it.each(['POST', 'PATCH'] as const)('refuses foreign and message-held images on %s without side effects', async method => {
    upload('foreign.png', 'other'); upload('held.png', 'native', 'message');
    for (const filename of ['foreign.png', 'held.png']) {
      const before = snapshotDatabase(sqlite);
      const res = await mutate(method, method === 'POST' ? '/api/spaces' : '/api/spaces/space', { name: 'Attempt', icon: `/api/uploads/${filename}` });
      expect(res.statusCode).toBe(400); expect(snapshotDatabase(sqlite)).toEqual(before); expect(exists(filename)).toBe(true);
      expect(resizeProfileImage).not.toHaveBeenCalled();
    }
  });
  it.each([{}, 42, '../x.png', '/api/uploads/../x.png', '/api/uploads/x.png?x', 'https://user:secret@images.example/a.png'])('refuses malformed space assets %j', async icon => {
    const before = snapshotDatabase(sqlite); const res = await mutate('POST', '/api/spaces', { name: 'Attempt', icon });
    expect(res.statusCode).toBe(400); expect(snapshotDatabase(sqlite)).toEqual(before); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it('claims a native icon only once, normalizes prefixes and never resizes its same-file repeat', async () => {
    upload('owned.png'); const created = await mutate('POST', '/api/spaces', { name: 'Created', icon: ' /api/uploads/owned.png ' });
    expect(created.statusCode).toBe(201); expect(created.json().icon).toBe('owned.png');
    expect(sqlite.prepare("SELECT id FROM attachments WHERE filename='owned.png'").get()).toBeUndefined();
    vi.mocked(resizeProfileImage).mockClear(); const same = await mutate('PATCH', `/api/spaces/${created.json().id}`, { icon: '/api/uploads/owned.png' });
    expect(same.statusCode).toBe(200); expect(exists('owned.png')).toBe(true); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it('refuses sharing a new mutable image with another profile or both space fields', async () => {
    upload('shared.png'); sqlite.exec("UPDATE users SET avatar='shared.png' WHERE id='other'"); const before = snapshotDatabase(sqlite);
    expect((await mutate('PATCH', '/api/spaces/space', { banner: 'shared.png' })).statusCode).toBe(400); expect(snapshotDatabase(sqlite)).toEqual(before);
    upload('both.png'); expect((await mutate('POST', '/api/spaces', { name: 'Both', icon: 'both.png', banner: 'both.png' })).statusCode).toBe(400);
  });
  it.each(['PATCH', 'DELETE'] as const)('preserves historical shared icons/banners on space %s', async method => {
    file('shared.png'); sqlite.exec("UPDATE spaces SET icon='/api/uploads/shared.png',banner='shared.png'; UPDATE users SET avatar='shared.png' WHERE id='other'");
    expect((await mutate(method, '/api/spaces/space', method === 'PATCH' ? { icon: null, banner: null } : undefined)).statusCode).toBe(200);
    expect(exists('shared.png')).toBe(true); expect(sqlite.prepare("SELECT avatar FROM users WHERE id='other'").get()).toEqual({ avatar: 'shared.png' });
  });
  it('keeps authorization before asset work on another account space', async () => {
    upload('mine.png', 'other'); const before = snapshotDatabase(sqlite);
    expect((await mutate('PATCH', '/api/spaces/space', { icon: 'mine.png' }, 'other')).statusCode).toBe(403);
    expect(snapshotDatabase(sqlite)).toEqual(before); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
});
describe('DM and bot assets preserve native shared content', () => {
  it('cannot claim a message attachment as a group icon', async () => {
    upload('held.png', 'native', 'message'); const before = snapshotDatabase(sqlite);
    expect((await mutate('PATCH', '/api/dm/dm', { icon: 'held.png' })).statusCode).toBe(400);
    expect(snapshotDatabase(sqlite)).toEqual(before); expect(exists('held.png')).toBe(true);
  });
  it('retains a former group icon still used by a profile or message', async () => {
    upload('shared.png', 'native', 'message'); sqlite.exec("UPDATE dm_channels SET icon='shared.png'; UPDATE users SET avatar='shared.png' WHERE id='other'");
    expect((await mutate('PATCH', '/api/dm/dm', { icon: null })).statusCode).toBe(200); expect(exists('shared.png')).toBe(true);
    expect(sqlite.prepare("SELECT message_id FROM attachments WHERE filename='shared.png'").get()).toEqual({ message_id: 'message' });
  });
  it('cannot resize a bot upload already referenced by another profile', async () => {
    upload('shared.png'); sqlite.exec("UPDATE users SET avatar='shared.png' WHERE id='other'"); const before = snapshotDatabase(sqlite);
    expect((await mutate('PATCH', '/api/bots/bot', { avatar: 'shared.png' })).statusCode).toBe(400);
    expect(snapshotDatabase(sqlite)).toEqual(before); expect(resizeProfileImage).not.toHaveBeenCalled();
  });
  it.each(['PATCH', 'DELETE'] as const)('retains a shared historical bot avatar on %s', async method => {
    file('shared.png'); sqlite.exec("UPDATE users SET avatar='shared.png' WHERE id IN ('bot','other')");
    expect((await mutate(method, '/api/bots/bot', method === 'PATCH' ? { avatar: null } : undefined)).statusCode).toBe(200); expect(exists('shared.png')).toBe(true);
  });
  it('deletes unreferenced former bot and space images normally', async () => {
    file('bot.png'); file('space.png'); sqlite.exec("UPDATE users SET avatar='bot.png' WHERE id='bot'; UPDATE spaces SET icon='space.png'");
    expect((await mutate('PATCH', '/api/bots/bot', { avatar: null })).statusCode).toBe(200); expect(exists('bot.png')).toBe(false);
    expect((await mutate('PATCH', '/api/spaces/space', { icon: null })).statusCode).toBe(200); expect(exists('space.png')).toBe(false);
  });
  it('keeps message deletion cleanup from removing a historically shared profile file or referenced thumbnail', () => {
    file('main.png'); file('main_thumb.jpg'); sqlite.exec("UPDATE users SET avatar='main.png',banner='main_thumb.jpg' WHERE id='other'");
    deleteAttachmentFiles([{ filename: 'main.png' }]); expect(exists('main.png')).toBe(true); expect(exists('main_thumb.jpg')).toBe(true);
  });
  it('claims an attachment without deleting a thumbnail another native profile still holds', () => {
    upload('main.png'); file('saved-thumb.png'); sqlite.exec("UPDATE attachments SET thumbnail_filename='saved-thumb.png'; UPDATE users SET avatar='main.png',banner='saved-thumb.png' WHERE id='other'");
    deleteAttachmentByFilename('main.png'); expect(exists('main.png')).toBe(true); expect(exists('saved-thumb.png')).toBe(true);
    expect(sqlite.prepare('SELECT id FROM attachments').get()).toBeUndefined();
  });
  it('deletes an unreferenced main image while keeping its auto thumbnail used by a profile', () => {
    file('removed.png'); file(thumbFilename('removed.png'));
    sqlite.prepare("UPDATE users SET avatar=? WHERE id='other'").run(thumbFilename('removed.png'));
    deleteAttachmentFiles([{ filename: 'removed.png' }]); expect(exists('removed.png')).toBe(false); expect(exists(thumbFilename('removed.png'))).toBe(true);
  });
  it('preserves a profile image while deleting its historical dangling attachment record', () => {
    upload('dangling.png', 'native', 'message'); sqlite.pragma('foreign_keys = OFF');
    sqlite.exec("UPDATE attachments SET message_id='absent'; UPDATE users SET avatar='dangling.png' WHERE id='other'"); sqlite.pragma('foreign_keys = ON');
    cleanupStorage(false); expect(exists('dangling.png')).toBe(true); expect(sqlite.prepare("SELECT id FROM attachments WHERE filename='dangling.png'").get()).toBeUndefined();
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('never lets orphan main-file cleanup erase an auto thumbnail held by a profile', () => {
    file('orphan.png'); file(thumbFilename('orphan.png')); sqlite.prepare("UPDATE users SET avatar=? WHERE id='other'").run(thumbFilename('orphan.png'));
    cleanupStorage(false); expect(exists('orphan.png')).toBe(false); expect(exists(thumbFilename('orphan.png'))).toBe(true);
  });
});
