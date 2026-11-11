import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { setWorkerId } from '../utils/snowflake.js';

let raw: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
let caller='alice';
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>raw,schema}));
vi.mock('../utils/auth.js',()=>({authenticate:async(request:{userId:string})=>{request.userId=caller;}}));
vi.mock('../ws/handler.js',()=>({connectionManager:{
  sendToUser:vi.fn(),sendToDmMembers:vi.fn(),getRoom:()=>undefined,getUserRoom:()=>undefined,
}}));
vi.mock('../utils/embedResolver.js',()=>({
  resolveEmbeds:vi.fn(async()=>{}),reResolveEmbeds:vi.fn(async()=>{}),
  fetchDmEmbedsForMessages:()=>new Map(),embedRowToEmbed:vi.fn(),
}));

beforeEach(async()=>{
  setWorkerId(3); caller='alice'; raw=new Database(':memory:'); buildNativeDatabase(raw); db=drizzle(raw,{schema});
  for(const id of ['alice','bob','carol','outsider']) seedNativeUser(raw,id);
  app=Fastify(); const {dmRoutes}=await import('./dm.js'); await app.register(dmRoutes); await app.ready();
});
afterEach(async()=>{ await app?.close(); raw?.close(); vi.restoreAllMocks(); });
function state(): unknown {
  return {users:raw.prepare('SELECT * FROM users ORDER BY id').all(),channels:raw.prepare('SELECT * FROM dm_channels ORDER BY id').all(),members:raw.prepare('SELECT * FROM dm_members ORDER BY dm_channel_id,user_id').all()};
}

describe('native DM REST contracts without remote identity resolution',()=>{
  it('opens a single private-keyed pair in either direction without returning private/provenance fields',async()=>{
    const first=await app.inject({method:'POST',url:'/api/dm',payload:{userId:'bob'}});
    expect(first.statusCode).toBe(201); const wire=first.json<{id:string;members:unknown[]}>();
    caller='bob'; const second=await app.inject({method:'POST',url:'/api/dm',payload:{userId:'alice'}});
    expect(second.statusCode).toBe(200); expect(second.json<{id:string}>().id).toBe(wire.id);
    for(const field of ['pairKey','pair_key','federatedId','ownerHomeUserId','ownerHomeInstance']) expect(wire).not.toHaveProperty(field);
    expect(raw.prepare('SELECT COUNT(*) AS count FROM dm_channels').get()).toEqual({count:1});
  });

  it('refuses a foreign-only target without creating a stub, writing a conversation or sending HTTP',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch'); const before=state();
    const result=await app.inject({method:'POST',url:'/api/dm',payload:{homeUserId:'foreign',homeInstance:'https://unused.invalid'}});
    expect(result.statusCode).toBe(400); expect(state()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it('uses only the existing local target even if obsolete identity extras are hostile',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch');
    const result=await app.inject({method:'POST',url:'/api/dm',payload:{userId:'bob',homeUserId:'carol',homeInstance:'https://unused.invalid'}});
    expect(result.statusCode).toBe(201);
    expect(raw.prepare('SELECT user_id FROM dm_members ORDER BY user_id').all()).toEqual([{user_id:'alice'},{user_id:'bob'}]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('retains group friendship, native owner and membership checks',async()=>{
    const before=state();
    const denied=await app.inject({method:'POST',url:'/api/dm/group',payload:{users:[{id:'bob'},{id:'carol'}]}});
    expect(denied.statusCode).toBe(403); expect(state()).toEqual(before);
    raw.exec("INSERT INTO friends (user_id,friend_id,created_at) VALUES ('alice','bob',1),('alice','carol',1)");
    const created=await app.inject({method:'POST',url:'/api/dm/group',payload:{users:[{id:'bob'},{id:'carol'}]}});
    expect(created.statusCode).toBe(201); const id=created.json<{id:string}>().id;
    expect(raw.prepare('SELECT owner_id,pair_key FROM dm_channels WHERE id=?').get(id)).toEqual({owner_id:'alice',pair_key:null});
    caller='outsider'; const stable=state();
    expect((await app.inject({method:'POST',url:`/api/dm/${id}/transfer`,payload:{newOwnerId:'bob'}})).statusCode).toBe(403);
    expect(state()).toEqual(stable);
  });
});
