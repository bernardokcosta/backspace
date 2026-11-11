import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { backfillOneOnOneKeys, findOrCreateOneOnOne, isGroupConversation, oneOnOneKey, reconcileDmChannelPairKey } from './dmConversation.js';
import { setWorkerId } from './snowflake.js';

setWorkerId(3);

const opened: Database.Database[] = [];
afterEach(() => { for (const db of opened.splice(0)) db.close(); });
function fixture(): Database.Database {
  const db = new Database(':memory:'); opened.push(db);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE users (id text PRIMARY KEY, is_deleted integer DEFAULT 0);
    INSERT INTO users (id) VALUES ('alice'), ('bob'), ('carol');
    CREATE TABLE dm_channels (id text PRIMARY KEY, pair_key text, owner_id text,
      deleted_at integer, created_at integer NOT NULL);
    CREATE UNIQUE INDEX idx_dm_pair_key ON dm_channels(pair_key) WHERE pair_key IS NOT NULL;
    CREATE TABLE dm_members (dm_channel_id text REFERENCES dm_channels(id) ON DELETE CASCADE,
      user_id text REFERENCES users(id), closed integer DEFAULT 0, closed_changed_at integer DEFAULT 0,
      PRIMARY KEY(dm_channel_id,user_id));
    CREATE TABLE dm_messages (id text PRIMARY KEY, dm_channel_id text REFERENCES dm_channels(id) ON DELETE CASCADE,
      user_id text REFERENCES users(id), content text);
    CREATE TABLE attachments (id text PRIMARY KEY, dm_message_id text REFERENCES dm_messages(id), filename text);
    CREATE TABLE dm_reactions (id text PRIMARY KEY, dm_message_id text REFERENCES dm_messages(id), user_id text REFERENCES users(id));
    CREATE TABLE read_states (user_id text REFERENCES users(id), channel_id text, last_read_message_id text,
      updated_at integer, PRIMARY KEY(user_id,channel_id));
    CREATE TABLE interactions (id text PRIMARY KEY, dm_channel_id text);
  `);
  return db;
}
function channel(db: Database.Database, id: string, key: string | null, members: string[], at = 1, owner: string | null = null): void {
  db.prepare('INSERT INTO dm_channels (id,pair_key,owner_id,created_at) VALUES (?,?,?,?)').run(id,key,owner,at);
  for (const member of members) db.prepare('INSERT INTO dm_members (dm_channel_id,user_id) VALUES (?,?)').run(id,member);
}
const alice = { id: 'alice' }, bob = { id: 'bob' }, carol = { id: 'carol' };

describe('one local transactional DM pair identity', () => {
  it('hashes only sorted local ids, never obsolete extra identity fields', () => {
    const obsolete = { id: 'alice', homeUserId: 'wrong-identity' };
    const obsoleteBob = { ...bob, homeUserId: null };
    const expected = createHash('sha256').update('alice:bob').digest('hex').slice(0,32);
    expect(oneOnOneKey(obsolete, obsoleteBob)).toBe(expected);
    expect(oneOnOneKey(bob, alice)).toBe(expected);
  });

  it('creates one private-keyed pair and respects first/both opening rules', () => {
    const db = fixture();
    const first = findOrCreateOneOnOne({ $client: db }, alice, bob, { open: 'first' });
    expect(first.created).toBe(true);
    expect(db.prepare('SELECT user_id,closed FROM dm_members ORDER BY user_id').all()).toEqual([{ user_id: 'alice', closed: 0 }, { user_id: 'bob', closed: 1 }]);
    expect(findOrCreateOneOnOne({ $client: db }, bob, alice, { open: 'both' }).channelId).toBe(first.channelId);
    expect(db.prepare('SELECT pair_key FROM dm_channels').get()).toEqual({ pair_key: oneOnOneKey(alice,bob) });
    expect(db.prepare('SELECT COUNT(*) AS count FROM dm_channels').get()).toEqual({ count: 1 });
  });

  it('keeps a tombstoned native participant and adds only a missing member of the pair', () => {
    const db = fixture(); db.prepare("UPDATE users SET is_deleted=1 WHERE id='bob'").run();
    channel(db, 'existing', oneOnOneKey(alice,bob), ['bob']);
    expect(findOrCreateOneOnOne({ $client: db }, alice, bob, { open: 'first' }).channelId).toBe('existing');
    expect(db.prepare('SELECT user_id FROM dm_members ORDER BY user_id').all()).toEqual([{ user_id: 'alice' }, { user_id: 'bob' }]);
  });

  it('does not merge a group with the same two members or use an obsolete group-copy key', () => {
    const db = fixture(); channel(db, 'group', null, ['alice','bob'], 1, 'alice');
    const created = findOrCreateOneOnOne({ $client: db }, alice, bob, { open: 'both' });
    expect(created.channelId).not.toBe('group');
    expect(isGroupConversation({ owner_id: 'alice' })).toBe(true);
    const native = { owner_id: null, federated_id: '00000000-0000-4000-8000-000000000001' };
    expect(isGroupConversation(native)).toBe(false);
  });

  it('merges duplicate native history, reactions, attachments, open state, numeric read pointers and pending interactions', () => {
    const db = fixture(); channel(db, 'kept', oneOnOneKey(alice,bob), ['alice','bob']); channel(db, 'merged', null, ['alice','bob'], 2);
    db.prepare("UPDATE dm_members SET closed=1 WHERE dm_channel_id='kept'").run();
    db.exec(`INSERT INTO dm_messages VALUES ('900','kept','alice','old native bytes'), ('1000','merged','bob','new native bytes');
      INSERT INTO attachments VALUES ('file','1000','native.webp');
      INSERT INTO dm_reactions VALUES ('reaction','1000','alice');
      INSERT INTO read_states VALUES ('alice','kept','900',1), ('alice','merged','1000',2);
      INSERT INTO interactions VALUES ('pending','merged');`);
    backfillOneOnOneKeys(db);
    expect(db.prepare('SELECT id,dm_channel_id,content FROM dm_messages ORDER BY id').all()).toEqual([
      { id:'1000',dm_channel_id:'kept',content:'new native bytes' }, { id:'900',dm_channel_id:'kept',content:'old native bytes' },
    ]);
    expect(db.prepare('SELECT * FROM attachments').all()).toEqual([{ id:'file',dm_message_id:'1000',filename:'native.webp' }]);
    expect(db.prepare('SELECT * FROM dm_reactions').all()).toEqual([{ id:'reaction',dm_message_id:'1000',user_id:'alice' }]);
    expect(db.prepare('SELECT channel_id,last_read_message_id FROM read_states').all()).toEqual([{ channel_id:'kept',last_read_message_id:'1000' }]);
    expect(db.prepare('SELECT dm_channel_id FROM interactions').get()).toEqual({ dm_channel_id:'kept' });
    expect(db.prepare("SELECT closed FROM dm_members WHERE dm_channel_id='kept' AND user_id='alice'").get()).toEqual({ closed:0 });
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('rekeys a drifted pair without handing its private history to another pair', () => {
    const db = fixture(); channel(db,'drifted',oneOnOneKey(alice,bob),['alice','carol']);
    db.exec("INSERT INTO dm_messages VALUES ('private','drifted','carol','carol private bytes')");
    const result = findOrCreateOneOnOne({ $client: db },alice,bob,{ open:'first' });
    expect(result.channelId).not.toBe('drifted');
    expect(db.prepare("SELECT pair_key FROM dm_channels WHERE id='drifted'").get()).toEqual({ pair_key:oneOnOneKey(alice,carol) });
    expect(db.prepare("SELECT dm_channel_id,content FROM dm_messages WHERE id='private'").get()).toEqual({ dm_channel_id:'drifted',content:'carol private bytes' });
  });

  it('refuses unclassifiable third-party history and rolls all pair mutations back', () => {
    const db = fixture(); channel(db,'ambiguous',oneOnOneKey(alice,bob),['alice','bob']);
    db.exec("INSERT INTO dm_messages VALUES ('private','ambiguous','carol','must not expose')");
    const before = db.serialize();
    expect(() => findOrCreateOneOnOne({ $client:db },alice,bob,{open:'first'})).toThrow(/history|participant|integrity/i);
    expect(db.serialize()).toEqual(before);
  });

  it('requires explicit transaction ownership for low-level reconciliation and rejects self-DMs', () => {
    const db = fixture(); channel(db,'legacy',null,['alice','bob']);
    expect(() => reconcileDmChannelPairKey(db,'legacy')).toThrow(/transaction/i);
    expect(() => findOrCreateOneOnOne({$client:db},alice,alice,{open:'both'})).toThrow(/distinct|self/i);
    const reconciled = db.transaction(() => reconcileDmChannelPairKey(db,'legacy'))();
    expect(reconciled.action).toBe('rekeyed');
  });
});
