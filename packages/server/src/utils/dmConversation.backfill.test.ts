import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { backfillOneOnOneKeys, oneOnOneKey } from './dmConversation.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';

const pairKey = (a: string, b: string): string => oneOnOneKey({ id:a }, { id:b });
let sqlite: Database.Database;

function seedChannel(id: string, key: string | null, members: string[], options: {
  ownerId?: string; deletedAt?: number; closed?: Record<string,number>; createdAt?: number;
} = {}): void {
  sqlite.prepare('INSERT INTO dm_channels (id,owner_id,pair_key,deleted_at,created_at) VALUES (?,?,?,?,?)')
    .run(id,options.ownerId??null,key,options.deletedAt??null,options.createdAt??1);
  for (const user of members) sqlite.prepare('INSERT INTO dm_members (dm_channel_id,user_id,closed) VALUES (?,?,?)').run(id,user,options.closed?.[user]??0);
}
function seedMsg(id: string, channel: string, user: string, at: number): void {
  sqlite.prepare("INSERT INTO dm_messages (id,dm_channel_id,user_id,content,created_at) VALUES (?,?,?,'native bytes',?)").run(id,channel,user,at);
}
function keyOf(id: string): string | null | undefined {
  return (sqlite.prepare('SELECT pair_key AS key FROM dm_channels WHERE id=?').get(id) as {key:string|null}|undefined)?.key;
}
function channels(): string[] { return (sqlite.prepare('SELECT id FROM dm_channels ORDER BY id').all() as Array<{id:string}>).map(row=>row.id); }
function messages(channel: string): string[] { return (sqlite.prepare('SELECT id FROM dm_messages WHERE dm_channel_id=? ORDER BY created_at').all(channel) as Array<{id:string}>).map(row=>row.id); }

beforeEach(() => {
  sqlite = new Database(':memory:'); buildNativeDatabase(sqlite);
  for (const id of ['a','b','c']) seedNativeUser(sqlite,id);
});
afterEach(() => sqlite.close());

describe('backfillOneOnOneKeys for native conversations', () => {
  it('keys an unkeyed pair from its two local accounts', () => {
    seedChannel('pair',null,['a','b']); backfillOneOnOneKeys(sqlite);
    expect(keyOf('pair')).toBe(pairKey('a','b'));
  });

  it('merges into an existing correct key holder even when that holder was created later', () => {
    seedChannel('legacy',null,['a','b'],{createdAt:1}); seedMsg('m1','legacy','a',1);
    seedChannel('holder',pairKey('a','b'),['a','b'],{createdAt:2}); seedMsg('m2','holder','b',2);
    backfillOneOnOneKeys(sqlite);
    expect(channels()).toEqual(['holder']); expect(messages('holder')).toEqual(['m1','m2']);
    expect(sqlite.pragma('foreign_key_check')).toEqual([]);
  });

  it('keeps distinct local users in distinct conversations rather than aliasing identities', () => {
    seedChannel('first',null,['a','b']); seedMsg('m1','first','b',1);
    seedChannel('second',null,['a','c']); seedMsg('m2','second','c',2);
    backfillOneOnOneKeys(sqlite);
    expect(channels()).toEqual(['first','second']);
    expect(keyOf('first')).toBe(pairKey('a','b')); expect(keyOf('second')).toBe(pairKey('a','c'));
    expect(messages('first')).toEqual(['m1']); expect(messages('second')).toEqual(['m2']);
  });

  it('keeps a merged conversation open for a member who had either row open', () => {
    seedChannel('legacy',null,['a','b'],{closed:{a:0,b:1}});
    seedChannel('holder',pairKey('a','b'),['a','b'],{closed:{a:1,b:1}});
    backfillOneOnOneKeys(sqlite);
    expect(sqlite.prepare('SELECT user_id,closed FROM dm_members ORDER BY user_id').all()).toEqual([{user_id:'a',closed:0},{user_id:'b',closed:1}]);
  });

  it('heals a drifted label and leaves correct pairs untouched', () => {
    seedChannel('old',pairKey('a','c'),['a','b']); seedMsg('m1','old','a',1);
    seedChannel('correct',pairKey('a','b'),['a','b']); seedMsg('m2','correct','b',2);
    backfillOneOnOneKeys(sqlite);
    expect(channels()).toEqual(['correct']); expect(messages('correct')).toEqual(['m1','m2']);
  });

  it('leaves groups, soft-deleted rows and incomplete pairs unchanged', () => {
    seedChannel('group',null,['a','b','c'],{ownerId:'a'});
    seedChannel('small-group',null,['a','b'],{ownerId:'a'});
    seedChannel('deleted',null,['a','c'],{deletedAt:5}); seedChannel('incomplete',null,['a']);
    const before=sqlite.prepare('SELECT * FROM dm_channels ORDER BY id').all();
    backfillOneOnOneKeys(sqlite);
    expect(sqlite.prepare('SELECT * FROM dm_channels ORDER BY id').all()).toEqual(before);
  });

  it('calls beforeChanges once before its first write and not at all for a no-op', () => {
    seedChannel('correct',pairKey('a','c'),['a','c']);
    const calls: Array<string|null|undefined>=[];
    backfillOneOnOneKeys(sqlite,{beforeChanges:()=>calls.push(keyOf('legacy'))}); expect(calls).toEqual([]);
    seedChannel('legacy',null,['a','b']);
    backfillOneOnOneKeys(sqlite,{beforeChanges:()=>calls.push(keyOf('legacy'))});
    expect(calls).toEqual([null]); expect(keyOf('legacy')).toBe(pairKey('a','b'));
  });

  it('does not write if the required snapshot fails', () => {
    seedChannel('legacy',null,['a','b']);
    expect(()=>backfillOneOnOneKeys(sqlite,{beforeChanges:()=>{throw new Error('snapshot failed');}})).toThrow(/snapshot/);
    expect(keyOf('legacy')).toBeNull();
  });

  it('is idempotent including content and member state', () => {
    seedChannel('first',null,['a','b']); seedChannel('second',pairKey('a','c'),['a','c']);
    backfillOneOnOneKeys(sqlite);
    const before=sqlite.serialize(); backfillOneOnOneKeys(sqlite); expect(sqlite.serialize()).toEqual(before);
  });
});
