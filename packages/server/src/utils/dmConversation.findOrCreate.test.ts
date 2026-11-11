import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { setWorkerId } from './snowflake.js';
import { findOrCreateOneOnOne, oneOnOneKey, type LocalDmUser } from './dmConversation.js';
import { buildNativeDatabase } from '../testing/standaloneUpgrade.js';

setWorkerId(3);

/**
 * `findOrCreateOneOnOne` (ADR 0002, "Server find-or-create for 1-on-1s"): the
 * row holding the pair's key is the conversation; else a row whose members are
 * exactly the pair, keyed on the way out; else a new keyed row.
 */

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;

function seedUser(id: string): LocalDmUser {
  sqlite.prepare(`INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, 'h', 1)`)
    .run(id, id);
  return { id };
}
function seedChannel(id: string, key: string | null, members: string[], ownerId: string | null = null): void {
  sqlite.prepare(`INSERT INTO dm_channels (id, owner_id, pair_key, created_at) VALUES (?, ?, ?, 1)`).run(id, ownerId, key);
  for (const u of members) sqlite.prepare(`INSERT INTO dm_members (dm_channel_id, user_id, closed) VALUES (?, ?, 0)`).run(id, u);
}
function membersOf(id: string): Array<{ userId: string; closed: number }> {
  return sqlite.prepare('SELECT user_id AS userId, closed FROM dm_members WHERE dm_channel_id = ? ORDER BY user_id').all(id) as Array<{ userId: string; closed: number }>;
}
function keyOf(id: string): string | null {
  return (sqlite.prepare('SELECT pair_key AS key FROM dm_channels WHERE id = ?').get(id) as { key: string | null }).key;
}
function channelCount(): number {
  return (sqlite.prepare('SELECT count(*) AS n FROM dm_channels').get() as { n: number }).n;
}

let alice: LocalDmUser;
let bob: LocalDmUser;

beforeEach(() => {
  sqlite = new Database(':memory:');
  db = drizzle(sqlite, { schema });
  buildNativeDatabase(sqlite);
  alice = seedUser('alice');
  bob = seedUser('bob');
});
afterEach(() => sqlite.close());

describe('findOrCreateOneOnOne', () => {
  it('inserts a keyed row with both members open when the pair has none', () => {
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'both' });
    expect(r.created).toBe(true);
    expect(keyOf(r.channelId)).toBe(oneOnOneKey(alice, bob));
    expect(membersOf(r.channelId)).toEqual([{ userId: 'alice', closed: 0 }, { userId: 'bob', closed: 0 }]);
  });

  it('opened by the first party, inserts the other party\'s membership closed', () => {
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'first' });
    expect(r.created).toBe(true);
    expect(membersOf(r.channelId)).toEqual([{ userId: 'alice', closed: 0 }, { userId: 'bob', closed: 1 }]);
  });

  it('returns the row holding the key and adds the pair member it lacks', () => {
    seedChannel('existing', oneOnOneKey(alice, bob), ['bob']);
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'both' });
    expect(r).toEqual({ channelId: 'existing', created: false, reconciled: [] });
    expect(membersOf('existing')).toEqual([{ userId: 'alice', closed: 0 }, { userId: 'bob', closed: 0 }]);
  });

  it('adds a lacking other party closed when the first party opens it', () => {
    seedChannel('existing', oneOnOneKey(alice, bob), ['alice']);
    findOrCreateOneOnOne(db, alice, bob, { open: 'first' });
    expect(membersOf('existing')).toEqual([{ userId: 'alice', closed: 0 }, { userId: 'bob', closed: 1 }]);
  });

  it('never replaces another native account with the requested user', () => {
    const other = seedUser('other');
    seedChannel('existing', oneOnOneKey(alice, bob), ['alice', 'other']);
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'both' });
    expect(r.channelId).not.toBe('existing');
    expect(membersOf('existing').map(member => member.userId)).toEqual(['alice', 'other']);
    expect(keyOf('existing')).toBe(oneOnOneKey(alice, other));
    expect(channelCount()).toBe(2);
  });

  it('refuses an ownerless three-person channel without deleting membership', () => {
    seedUser('other');
    seedChannel('invalid', oneOnOneKey(alice, bob), ['alice', 'bob', 'other']);
    expect(() => findOrCreateOneOnOne(db, alice, bob, { open: 'both' })).toThrow(/integrity|participant/i);
    expect(membersOf('invalid').map(member => member.userId)).toEqual(['alice', 'bob', 'other']);
    expect(channelCount()).toBe(1);
  });

  it('keys and returns an unkeyed row whose members are exactly the pair', () => {
    seedChannel('legacy', null, ['alice', 'bob']);
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'first' });
    expect(r).toEqual({
      channelId: 'legacy',
      created: false,
      reconciled: [{ action: 'rekeyed', channelId: 'legacy', targetChannelId: 'legacy', affectedUserIds: ['alice', 'bob'] }],
    });
    expect(keyOf('legacy')).toBe(oneOnOneKey(alice, bob));
    expect(channelCount()).toBe(1);
  });

  it('never takes a group with the same two members for the 1-on-1', () => {
    seedChannel('group', null, ['alice', 'bob'], 'alice');
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'both' });
    expect(r.created).toBe(true);
    expect(r.channelId).not.toBe('group');
    expect(keyOf('group')).toBeNull();
  });

  it('refuses a soft-deleted row holding an active pair key instead of exposing it', () => {
    seedChannel('deleted', oneOnOneKey(alice, bob), ['alice', 'bob']);
    sqlite.prepare("UPDATE dm_channels SET deleted_at=1 WHERE id='deleted'").run();
    expect(() => findOrCreateOneOnOne(db, alice, bob, { open: 'both' })).toThrow(/invalid/i);
    expect(channelCount()).toBe(1);
  });

  it('moves a row that holds the key under other members to its own key, then creates the pair\'s row', () => {
    // Drift: the row carries the alice-bob key but its members are alice and carol.
    const carol = seedUser('carol');
    seedChannel('drifted', oneOnOneKey(alice, bob), ['alice', 'carol']);
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'both' });
    expect(r.created).toBe(true);
    expect(keyOf(r.channelId)).toBe(oneOnOneKey(alice, bob));
    expect(keyOf('drifted')).toBe(oneOnOneKey(alice, carol));
    expect(membersOf('drifted').map(m => m.userId)).toEqual(['alice', 'carol']);
  });

  it('reports the rows it re-keyed or merged on the way, so their members can be told', () => {
    const carol = seedUser('carol');
    // Drift: 'drifted' carries the alice-bob key under alice and carol, and
    // 'aliceCarol' already holds the alice-carol key, so 'drifted' is merged into it.
    seedChannel('drifted', oneOnOneKey(alice, bob), ['alice', 'carol']);
    seedChannel('aliceCarol', oneOnOneKey(alice, carol), ['alice', 'carol']);
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'both' });
    expect(r.reconciled).toEqual([
      { action: 'merged', channelId: 'drifted', targetChannelId: 'aliceCarol', affectedUserIds: ['alice', 'carol'] },
    ]);
  });

  it('reports nothing when no other row changed', () => {
    const r = findOrCreateOneOnOne(db, alice, bob, { open: 'both' });
    expect(r.reconciled).toEqual([]);
  });
});
