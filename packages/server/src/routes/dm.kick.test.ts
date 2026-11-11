import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { setWorkerId } from '../utils/snowflake.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let caller='owner';
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>sqlite,schema}));
vi.mock('../utils/auth.js',()=>({authenticate:async(request:{userId:string})=>{request.userId=caller;}}));
vi.mock('../ws/handler.js',()=>({connectionManager:{sendToUser:vi.fn(),sendToDmMembers:vi.fn(),getRoom:()=>undefined,getUserRoom:()=>undefined}}));
import { connectionManager } from '../ws/handler.js';

function group(): void {
  sqlite.exec("INSERT INTO dm_channels (id,owner_id,created_at) VALUES ('group','owner',1); INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('group','owner'),('group','bob'),('group','carol')");
}
function state(): unknown {
  return {channels:sqlite.prepare('SELECT * FROM dm_channels').all(),members:sqlite.prepare('SELECT * FROM dm_members').all(),messages:sqlite.prepare('SELECT * FROM dm_messages').all()};
}
beforeEach(async()=>{
  setWorkerId(1); caller='owner'; sqlite=new Database(':memory:'); buildNativeDatabase(sqlite); db=drizzle(sqlite,{schema});
  for (const id of ['owner','bob','carol','outsider']) seedNativeUser(sqlite,id);
  vi.clearAllMocks(); app=Fastify(); const {dmRoutes}=await import('./dm.js'); await app.register(dmRoutes); await app.ready();
});
afterEach(async()=>{await app.close(); sqlite.close(); vi.restoreAllMocks();});

describe('DELETE /api/dm/:id/members/:targetUserId — native owner kick',()=>{
  it('removes only the target, preserves the owner/group and broadcasts the reason and membership change',async()=>{
    group(); sqlite.exec("INSERT INTO read_states VALUES ('bob','group','900',1)");
    const result=await app.inject({method:'DELETE',url:'/api/dm/group/members/bob'});
    expect(result.statusCode).toBe(200);
    expect(sqlite.prepare('SELECT user_id FROM dm_members ORDER BY user_id').all()).toEqual([{user_id:'carol'},{user_id:'owner'}]);
    expect(sqlite.prepare('SELECT owner_id,deleted_at FROM dm_channels').get()).toEqual({owner_id:'owner',deleted_at:null});
    expect(sqlite.prepare('SELECT * FROM read_states').all()).toEqual([]);
    const message=sqlite.prepare('SELECT content FROM dm_messages').get() as {content:string};
    expect(JSON.parse(message.content)).toEqual({event:'member_removed',targetUserId:'bob',targetDisplayName:'bob',reason:'kick'});
    for (const member of ['owner','carol']) expect(connectionManager.sendToUser).toHaveBeenCalledWith(member,{type:'dm_member_removed',dmChannelId:'group',userId:'bob'});
    expect(connectionManager.sendToUser).toHaveBeenCalledWith('bob',{type:'dm_channel_closed',dmChannelId:'group'});
  });

  it.each([
    {caller:'bob',target:'carol',status:403,code:'dm_owner_only'},
    {caller:'owner',target:'owner',status:400,code:'owner_cannot_kick_self'},
    {caller:'owner',target:'outsider',status:404,code:'target_not_dm_member'},
  ])('refuses $code without changing any membership/history',async scenario=>{
    group(); caller=scenario.caller; const before=state();
    const result=await app.inject({method:'DELETE',url:`/api/dm/group/members/${scenario.target}`});
    expect(result.statusCode).toBe(scenario.status); expect(result.json<{code:string}>().code).toBe(scenario.code); expect(state()).toEqual(before);
  });

  it('rejects one-on-one and absent channels without deleting membership',async()=>{
    group(); sqlite.exec("UPDATE dm_channels SET owner_id=NULL WHERE id='group'"); const before=state();
    expect((await app.inject({method:'DELETE',url:'/api/dm/group/members/bob'})).statusCode).toBe(400);
    expect((await app.inject({method:'DELETE',url:'/api/dm/missing/members/bob'})).statusCode).toBe(404);
    expect(state()).toEqual(before);
  });

  it('does not interpret a path id as a foreign identity or create any user',async()=>{
    group(); const before=state(); const fetch=vi.spyOn(globalThis,'fetch');
    const result=await app.inject({method:'DELETE',url:'/api/dm/group/members/unknown?homeInstance=https%3A%2F%2Funused.invalid'});
    expect(result.statusCode).toBe(404); expect(state()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({count:4});
  });

  it('extra query fields cannot redirect a native kick to another account',async()=>{
    group();
    const result=await app.inject({method:'DELETE',url:'/api/dm/group/members/bob?homeInstance=https%3A%2F%2Funused.invalid'});
    expect(result.statusCode).toBe(200);
    expect(sqlite.prepare('SELECT user_id FROM dm_members ORDER BY user_id').all()).toEqual([{user_id:'carol'},{user_id:'owner'}]);
  });
});
