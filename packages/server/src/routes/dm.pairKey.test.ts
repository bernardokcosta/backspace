import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { setWorkerId } from '../utils/snowflake.js';
import { oneOnOneKey } from '../utils/dmConversation.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>sqlite,schema}));
vi.mock('../utils/auth.js',()=>({authenticate:async(request:{userId:string})=>{request.userId='alice';}}));
vi.mock('../ws/handler.js',()=>({connectionManager:{sendToUser:vi.fn(),sendToDmMembers:vi.fn()}}));
beforeEach(async()=>{
  setWorkerId(1); sqlite=new Database(':memory:'); buildNativeDatabase(sqlite); db=drizzle(sqlite,{schema});
  for (const id of ['alice','bob','carol']) seedNativeUser(sqlite,id);
  app=Fastify(); const {dmRoutes}=await import('./dm.js'); await app.register(dmRoutes); await app.ready();
});
afterEach(async()=>{await app.close(); sqlite.close();});
function storedKey(id:string): unknown { return sqlite.prepare('SELECT pair_key FROM dm_channels WHERE id=?').get(id); }

describe('private pair keys on every native 1-on-1 insertion',()=>{
  it.each(['bob','carol'])('POST /api/dm keys the local pair with %s but never returns the key',async target=>{
    const response=await app.inject({method:'POST',url:'/api/dm',payload:{userId:target}});
    expect(response.statusCode).toBe(201); const channel=response.json<{id:string}>();
    expect(storedKey(channel.id)).toEqual({pair_key:oneOnOneKey({id:'alice'},{id:target})});
    expect(channel).not.toHaveProperty('pairKey'); expect(channel).not.toHaveProperty('federatedId');
  });
  it('returns the same channel id and private stored key when a caller opens it again',async()=>{
    const first=await app.inject({method:'POST',url:'/api/dm',payload:{userId:'bob'}});
    const second=await app.inject({method:'POST',url:'/api/dm',payload:{userId:'bob'}});
    expect(first.statusCode).toBe(201); expect(second.statusCode).toBe(200);
    const id=first.json<{id:string}>().id; expect(second.json<{id:string}>().id).toBe(id);
    expect(storedKey(id)).toEqual({pair_key:oneOnOneKey({id:'alice'},{id:'bob'})});
  });
  it('the existing invite helper uses the same insertion/keying path for both native targets',async()=>{
    const {ensureOneOnOneDmChannel}=await import('./dm.js');
    for(const target of db.select().from(schema.users).all().filter(user=>user.id!=='alice')) {
      const id=ensureOneOnOneDmChannel('alice',target,db);
      expect(storedKey(id)).toEqual({pair_key:oneOnOneKey({id:'alice'},target)});
    }
  });
  it('repairs a keyed row missing one native member without making another channel',async()=>{
    sqlite.prepare('INSERT INTO dm_channels (id,pair_key,created_at) VALUES (?,?,1)').run('existing',oneOnOneKey({id:'alice'},{id:'bob'}));
    sqlite.exec("INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('existing','bob')");
    const result=await app.inject({method:'POST',url:'/api/dm',payload:{userId:'bob'}});
    expect(result.statusCode).toBe(200); expect(result.json<{id:string}>().id).toBe('existing');
    expect(sqlite.prepare('SELECT user_id FROM dm_members ORDER BY user_id').all()).toEqual([{user_id:'alice'},{user_id:'bob'}]);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM dm_channels').get()).toEqual({count:1});
  });
});
