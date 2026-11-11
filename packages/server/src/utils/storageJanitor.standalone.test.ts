import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let dir: string;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../config.js', () => ({ config: { get uploadDir() { return dir; } } }));
beforeEach(() => {
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema }); dir = fs.mkdtempSync(path.join(os.tmpdir(), 'veyvox-native-gc-'));
  seedNativeUser(sqlite, 'alice'); seedNativeUser(sqlite, 'bob');
  const old = Date.now() - 48 * 60 * 60 * 1000;
  sqlite.prepare('INSERT INTO dm_channels (id,owner_id,created_at,deleted_at) VALUES (?,?,1,?)').run('expired', 'alice', old);
  sqlite.exec("INSERT INTO dm_channels (id,created_at) VALUES ('kept',1); INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('expired','alice'),('kept','alice'),('kept','bob'); INSERT INTO dm_messages (id,dm_channel_id,user_id,content,created_at) VALUES ('expired-msg','expired','alice','purge me',1),('kept-msg','kept','alice','native private content',1); INSERT INTO attachments (id,dm_message_id,uploader_id,filename,original_name,mimetype,size,created_at) VALUES ('expired-att','expired-msg','alice','expired.webp','old.webp','image/webp',1,1),('kept-att','kept-msg','alice','kept.webp','keep.webp','image/webp',1,1)");
  fs.writeFileSync(path.join(dir, 'expired.webp'), 'old'); fs.writeFileSync(path.join(dir, 'kept.webp'), 'native bytes');
});
afterEach(() => { sqlite.close(); fs.rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
describe('native DM cleanup without relay tables', () => {
  it('scans reference inventories per cleanup phase, not per candidate file', async () => {
    const selects: string[] = [];
    db = drizzle(sqlite, { schema, logger: { logQuery: query => { if (/^select .* from "attachments"/i.test(query)) selects.push(query); } } });
    const insert = sqlite.prepare('INSERT INTO attachments (id,dm_message_id,uploader_id,filename,original_name,mimetype,size,created_at) VALUES (?,?,?,?,?,?,1,?)');
    for (let i = 0; i < 100; i++) insert.run(`live-${i}`, 'kept-msg', 'alice', `live-${i}.webp`, 'live.webp', 'image/webp', Date.now());
    for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(dir, `orphan-${i}.webp`), 'orphan');
    for (let i = 0; i < 30; i++) {
      insert.run(`stale-${i}`, null, 'alice', `stale-${i}.webp`, 'stale.webp', 'image/webp', 1);
      fs.writeFileSync(path.join(dir, `stale-${i}.webp`), 'stale');
    }
    insert.run('shared-stale', null, 'alice', 'kept.webp', 'shared.webp', 'image/webp', 1);
    const { cleanupStorage } = await import('./storageJanitor.js');
    const result = cleanupStorage(false);
    expect(result.errors).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM attachments WHERE id LIKE 'stale-%' OR id='shared-stale'").get()).toEqual({ n: 0 });
    expect(fs.readdirSync(dir).sort()).toEqual(['expired.webp', 'kept.webp']);
    expect(fs.readFileSync(path.join(dir, 'kept.webp'), 'utf8')).toBe('native bytes');
    expect(selects.length).toBeLessThanOrEqual(6);
  });
  it('batches old-media reference checks after native attachment rows are removed', async () => {
    const selects: string[] = [];
    db = drizzle(sqlite, { schema, logger: { logQuery: query => { if (/^select .* from "attachments"/i.test(query)) selects.push(query); } } });
    const insert = sqlite.prepare('INSERT INTO attachments (id,dm_message_id,uploader_id,filename,original_name,mimetype,size,created_at) VALUES (?,?,?,?,?,?,1,1)');
    for (let i = 0; i < 40; i++) {
      insert.run(`old-${i}`, 'kept-msg', 'alice', `old-${i}.webp`, 'old.webp', 'image/webp');
      fs.writeFileSync(path.join(dir, `old-${i}.webp`), 'old');
    }
    const { cleanupOldMedia } = await import('./storageJanitor.js');
    expect(cleanupOldMedia(1, false).errors).toEqual([]);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(selects.length).toBeLessThanOrEqual(1);
  });
  it('purges only expired soft-deleted conversations, preserving native history/files and FK integrity with no HTTP', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch'); const { cleanupSoftDeletedDmChannels } = await import('./storageJanitor.js');
    expect(cleanupSoftDeletedDmChannels()).toBe(1);
    expect(sqlite.prepare('SELECT id,content FROM dm_messages').all()).toEqual([{ id: 'kept-msg', content: 'native private content' }]);
    expect(fs.existsSync(path.join(dir, 'expired.webp'))).toBe(false); expect(fs.readFileSync(path.join(dir, 'kept.webp'), 'utf8')).toBe('native bytes');
    expect(sqlite.pragma('foreign_key_check')).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    const before = sqlite.serialize(); expect(cleanupSoftDeletedDmChannels()).toBe(0); expect(sqlite.serialize()).toEqual(before);
  });
});
