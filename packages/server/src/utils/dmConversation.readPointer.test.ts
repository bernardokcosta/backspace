import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { backfillOneOnOneKeys, keepNewerReadPointer, oneOnOneKey } from './dmConversation.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';

let sqlite: Database.Database;
const key=oneOnOneKey({id:'alice'},{id:'bob'});
function channel(id: string, pairKey: string|null): void {
  sqlite.prepare('INSERT INTO dm_channels (id,pair_key,created_at) VALUES (?,?,1)').run(id,pairKey);
  for (const user of ['alice','bob']) sqlite.prepare('INSERT INTO dm_members (dm_channel_id,user_id) VALUES (?,?)').run(id,user);
}
function pointer(user: string, channelId: string, last: string): void {
  sqlite.prepare('INSERT INTO read_states (user_id,channel_id,last_read_message_id,updated_at) VALUES (?,?,?,1)').run(user,channelId,last);
}
function pointers(): unknown[] { return sqlite.prepare('SELECT user_id,channel_id,last_read_message_id FROM read_states ORDER BY user_id,channel_id').all(); }
beforeEach(()=>{
  sqlite=new Database(':memory:'); buildNativeDatabase(sqlite);
  seedNativeUser(sqlite,'alice'); seedNativeUser(sqlite,'bob');
});
afterEach(()=>sqlite.close());

describe('native read pointers follow merged conversations',()=>{
  it.each([['900','1000'],['1000','900']])('keeps the numerically newer of %s and %s', (held,moving)=>{
    channel('target',key); channel('merged',null);
    pointer('alice','target',held); pointer('alice','merged',moving);
    backfillOneOnOneKeys(sqlite);
    expect(pointers()).toEqual([{user_id:'alice',channel_id:'target',last_read_message_id:'1000'}]);
  });

  it('moves a pointer even when the surviving conversation had none',()=>{
    channel('target',key); channel('merged',null); pointer('bob','merged','1000');
    backfillOneOnOneKeys(sqlite);
    expect(pointers()).toEqual([{user_id:'bob',channel_id:'target',last_read_message_id:'1000'}]);
  });

  it('preserves each native account\'s pointer independently',()=>{
    channel('target',key); channel('merged',null);
    pointer('alice','target','900'); pointer('bob','merged','1000');
    backfillOneOnOneKeys(sqlite);
    expect(pointers()).toEqual([
      {user_id:'alice',channel_id:'target',last_read_message_id:'900'},
      {user_id:'bob',channel_id:'target',last_read_message_id:'1000'},
    ]);
  });

  it('a same-row move is a no-op rather than deleting its pointer',()=>{
    channel('target',key); pointer('alice','target','1000'); const before=pointers();
    keepNewerReadPointer(sqlite,{userId:'alice',channelId:'target'},{userId:'alice',channelId:'target'});
    expect(pointers()).toEqual(before);
  });
});
