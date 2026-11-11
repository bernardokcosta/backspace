import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { tombstoneUser } from './userDeletion.js';
import { issueBotToken, verifyBotToken } from './botTokens.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
const forceDisconnectUser = vi.fn();
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
vi.mock('../ws/handler.js', () => ({ connectionManager: { forceDisconnectUser } }));
beforeEach(() => {
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema });
  seedNativeUser(sqlite, 'owner'); seedNativeUser(sqlite, 'bot'); seedNativeUser(sqlite, 'other');
  sqlite.exec("UPDATE users SET username='legacy@old.invalid',avatar='native-avatar.webp',banner='native-banner.webp' WHERE id='owner'; UPDATE users SET is_bot=1,bot_owner_id='owner' WHERE id='bot'");
  forceDisconnectUser.mockReset();
});
afterEach(() => { sqlite.close(); vi.restoreAllMocks(); });
describe('native account and owned-bot deletion', () => {
  it('tombstones the stable local id, clears profile bytes and revokes/disconnects its owned bot without HTTP', async () => {
    const token = issueBotToken('bot', null).token;
    const other = sqlite.prepare("SELECT * FROM users WHERE id='other'").get(), fetch = vi.spyOn(globalThis, 'fetch');
    const files = tombstoneUser('owner', { purgeContent: false });
    await vi.waitFor(() => expect(forceDisconnectUser).toHaveBeenCalledWith('bot'));
    expect(files.sort()).toEqual(['native-avatar.webp', 'native-banner.webp']);
    expect(sqlite.prepare("SELECT id,username,is_deleted,avatar,banner,status FROM users WHERE id='owner'").get()).toEqual({ id: 'owner', username: '!deleted:owner', is_deleted: 1, avatar: null, banner: null, status: 'offline' });
    expect(sqlite.prepare("SELECT is_deleted FROM users WHERE id='bot'").get()).toEqual({ is_deleted: 1 });
    expect(verifyBotToken(token)).toBe('invalid'); expect(sqlite.prepare("SELECT * FROM users WHERE id='other'").get()).toEqual(other);
    expect(fetch).not.toHaveBeenCalled(); expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });
  it('ignores an absent account without changing other native rows', () => {
    const before = sqlite.prepare('SELECT * FROM users ORDER BY id').all();
    expect(tombstoneUser('absent')).toEqual([]); expect(sqlite.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(before);
  });
});
