import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase } from '../testing/standaloneUpgrade.js';
import { resetStalePresenceOnBoot } from './presenceBoot.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock('../db/index.js', () => ({ getDb: () => db, getRawDb: () => sqlite, schema }));
beforeEach(() => { sqlite = new Database(':memory:'); buildNativeDatabase(sqlite); db = drizzle(sqlite, { schema }); });
afterEach(() => sqlite.close());
function user(id: string, status: string, isDeleted = 0, chosenStatus = 'online'): void {
  db.insert(schema.users).values({ id, username: id, passwordHash: 'synthetic', createdAt: 1, status, isDeleted, chosenStatus }).run();
}
function status(id: string): unknown { return sqlite.prepare('SELECT status,chosen_status FROM users WHERE id=?').get(id); }
describe('native stale presence boot reset', () => {
  it.each(['online', 'idle', 'dnd'])('resets stale %s while preserving the saved choice', stale => {
    user('native', stale, 0, 'dnd'); expect(resetStalePresenceOnBoot()).toBe(1);
    expect(status('native')).toEqual({ status: 'offline', chosen_status: 'dnd' });
  });
  it('resets sovereign legacy handles identically to all native accounts', () => {
    user('legacy@old.invalid', 'idle', 0, 'idle'); expect(resetStalePresenceOnBoot()).toBe(1);
    expect(status('legacy@old.invalid')).toEqual({ status: 'offline', chosen_status: 'idle' });
  });
  it('does not rewrite tombstoned or already-offline rows', () => {
    user('deleted', 'online', 1); user('offline', 'offline'); const before = sqlite.serialize();
    expect(resetStalePresenceOnBoot()).toBe(0); expect(sqlite.serialize()).toEqual(before);
  });
  it('is idempotent over a mixed native population', () => {
    user('online', 'online'); user('idle', 'idle'); user('offline', 'offline'); user('deleted', 'dnd', 1);
    expect(resetStalePresenceOnBoot()).toBe(2); const before = sqlite.serialize();
    expect(resetStalePresenceOnBoot()).toBe(0); expect(sqlite.serialize()).toEqual(before);
    expect(status('deleted')).toEqual({ status: 'dnd', chosen_status: 'online' });
  });
  it('handles more than a SQLite binding chunk without resetting choices', () => {
    for (let i = 0; i < 510; i++) user(`user-${i}`, 'dnd', 0, 'idle');
    expect(resetStalePresenceOnBoot()).toBe(510);
    expect(sqlite.prepare("SELECT COUNT(*) AS count FROM users WHERE status='offline' AND chosen_status='idle'").get()).toEqual({ count: 510 });
  });
});
