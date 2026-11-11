import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase } from '../testing/standaloneUpgrade.js';
import { setWorkerId } from '../utils/snowflake.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let caller='owner';
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>sqlite,schema}));
vi.mock('../utils/auth.js',()=>({authenticate:async(request:{userId:string})=>{request.userId=caller;}}));
vi.mock('../ws/handler.js',()=>({connectionManager:{sendToUser:vi.fn(),sendToDmMembers:vi.fn(),getRoom:()=>undefined,getUserRoom:()=>undefined}}));
import { connectionManager } from '../ws/handler.js';

function group(id='group',members=['owner','bob','carol']): void {
  sqlite.prepare('INSERT INTO dm_channels (id,owner_id,created_at) VALUES (?,\'owner\',1)').run(id);
  for (const user of members) sqlite.prepare('INSERT INTO dm_members (dm_channel_id,user_id) VALUES (?,?)').run(id,user);
}
function owner(id='group'): unknown { return sqlite.prepare('SELECT owner_id FROM dm_channels WHERE id=?').get(id); }
function unchangedState(): unknown {
  return {channels:sqlite.prepare('SELECT * FROM dm_channels').all(),members:sqlite.prepare('SELECT * FROM dm_members').all(),messages:sqlite.prepare('SELECT * FROM dm_messages').all()};
}
beforeEach(async()=>{
  setWorkerId(1); caller='owner'; sqlite=new Database(':memory:'); buildNativeDatabase(sqlite); db=drizzle(sqlite,{schema});
  for (const [id,name] of [['owner','Alice'],['bob','Bob'],['carol','Carol'],['outsider','Dan']]) {
    sqlite.prepare("INSERT INTO users (id,username,display_name,password_hash,created_at) VALUES (?,?,?,'synthetic',1)").run(id,id,name);
  }
  vi.clearAllMocks(); app=Fastify(); const {dmRoutes}=await import('./dm.js'); await app.register(dmRoutes); await app.ready();
});
afterEach(async()=>{await app.close(); sqlite.close(); vi.restoreAllMocks();});

describe('POST /api/dm/:id/transfer — native ownership',()=>{
  it('updates the native owner atomically with the correctly authored system message and broadcasts to all members',async()=>{
    group(); const result=await app.inject({method:'POST',url:'/api/dm/group/transfer',payload:{newOwnerId:'bob'}});
    expect(result.statusCode).toBe(200); expect(owner()).toEqual({owner_id:'bob'});
    const messages=sqlite.prepare('SELECT user_id,type,content FROM dm_messages').all() as Array<{user_id:string;type:string;content:string}>;
    expect(messages).toHaveLength(1); expect(messages[0]).toMatchObject({user_id:'owner',type:'system'});
    expect(JSON.parse(messages[0]!.content)).toEqual({event:'owner_changed',newOwnerId:'bob',newOwnerDisplayName:'Bob'});
    for (const member of ['owner','bob','carol']) expect(connectionManager.sendToUser).toHaveBeenCalledWith(member,{type:'dm_owner_updated',dmChannelId:'group',newOwnerId:'bob'});
    expect(connectionManager.sendToDmMembers).toHaveBeenCalledWith('group',expect.objectContaining({type:'dm_message_created',message:expect.objectContaining({userId:'owner'})}));
  });

  it.each([
    {caller:'bob',target:'carol',status:403,code:'dm_owner_only'},
    {caller:'owner',target:'owner',status:400,code:'already_owner'},
    {caller:'owner',target:'outsider',status:400,code:'target_not_dm_member'},
  ])('refuses $code without mutating owner, membership or system history',async scenario=>{
    group(); caller=scenario.caller; const before=unchangedState();
    const result=await app.inject({method:'POST',url:'/api/dm/group/transfer',payload:{newOwnerId:scenario.target}});
    expect(result.statusCode).toBe(scenario.status); expect(result.json<{code:string}>().code).toBe(scenario.code); expect(unchangedState()).toEqual(before);
  });

  it('never transfers a one-on-one channel',async()=>{
    group(); sqlite.exec("UPDATE dm_channels SET owner_id=NULL WHERE id='group'"); const before=unchangedState();
    expect((await app.inject({method:'POST',url:'/api/dm/group/transfer',payload:{newOwnerId:'bob'}})).statusCode).toBe(400);
    expect(unchangedState()).toEqual(before);
  });

  it('returns 404 for an absent channel and 400 for a missing target',async()=>{
    expect((await app.inject({method:'POST',url:'/api/dm/missing/transfer',payload:{newOwnerId:'bob'}})).statusCode).toBe(404);
    group(); const before=unchangedState();
    expect((await app.inject({method:'POST',url:'/api/dm/group/transfer',payload:{}})).statusCode).toBe(400);
    expect(unchangedState()).toEqual(before);
  });

  it('cannot resolve a foreign-only body or create an account from it',async()=>{
    group(); const before=unchangedState(); const fetch=vi.spyOn(globalThis,'fetch');
    const result=await app.inject({method:'POST',url:'/api/dm/group/transfer',payload:{homeUserId:'bob',homeInstance:'https://unused.invalid'}});
    expect(result.statusCode).toBe(400); expect(unchangedState()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the native target even when obsolete extras name another member',async()=>{
    group();
    const result=await app.inject({method:'POST',url:'/api/dm/group/transfer',payload:{newOwnerId:'bob',homeUserId:'carol',homeInstance:'https://unused.invalid'}});
    expect(result.statusCode).toBe(200); expect(owner()).toEqual({owner_id:'bob'});
  });

  it('shares the same native ownership transaction when an owner leaves a non-empty group',async()=>{
    group();
    expect((await app.inject({method:'DELETE',url:'/api/dm/group/members'})).statusCode).toBe(200);
    expect(owner()).toEqual({owner_id:'bob'});
    expect(sqlite.prepare("SELECT user_id FROM dm_members WHERE dm_channel_id='group' ORDER BY user_id").all()).toEqual([{user_id:'bob'},{user_id:'carol'}]);
    const contents=sqlite.prepare('SELECT content FROM dm_messages ORDER BY rowid').all() as Array<{content:string}>;
    expect(contents.map(row=>JSON.parse(row.content).event)).toEqual(['member_removed','owner_changed']);
  });
});
