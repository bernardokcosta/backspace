import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { setWorkerId } from '../utils/snowflake.js';
import { parseDmSystemEvent } from '@veyvox/shared/src/dmSystemEvents.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>sqlite,schema}));
vi.mock('../utils/auth.js',()=>({authenticate:async(request:{userId:string})=>{request.userId='alice';}}));
vi.mock('../ws/handler.js',()=>({connectionManager:{sendToUser:vi.fn(),sendToDmMembers:vi.fn()}}));
vi.mock('../config.js',async importOriginal=>{
  const actual=await importOriginal<typeof import('../config.js')>();
  return {...actual,config:{...actual.config,publicOrigin:'https://local.test'}};
});

beforeEach(async()=>{
  setWorkerId(1); sqlite=new Database(':memory:'); buildNativeDatabase(sqlite); db=drizzle(sqlite,{schema});
  for (const id of ['alice','bob','outsider']) seedNativeUser(sqlite,id);
  sqlite.exec(`INSERT INTO instance_settings (id,instance_name,updated_at) VALUES (1,'Local host',1);
    INSERT INTO friends VALUES ('alice','bob',1);
    INSERT INTO spaces (id,name,owner_id,invite_code,avatar_color,description,visibility,created_at) VALUES ('space','Aether','alice','code','mint','native description','private',1);
    INSERT INTO space_members (space_id,user_id,joined_at) VALUES ('space','alice',1);`);
  app=Fastify(); const {dmRoutes}=await import('./dm.js'); await app.register(dmRoutes); await app.ready();
});
afterEach(async()=>{await app.close(); sqlite.close(); vi.restoreAllMocks();});
function invite(overrides: Record<string,unknown>={}) {
  return app.inject({method:'POST',url:'/api/dm/space-invite',payload:{target:{userId:'bob'},spaceId:'space',inviteCode:'code',spaceInstanceOrigin:'',...overrides}});
}
function messages(): unknown[] { return sqlite.prepare('SELECT * FROM dm_messages').all(); }

describe('POST /api/dm/space-invite — current instance only',()=>{
  it.each([
    {payload:{target:{userId:'outsider'}},code:'not_a_friend'},
    {payload:{inviteCode:'absent'},code:'invite_invalid'},
    {payload:{spaceId:'wrong'},code:'invite_invalid'},
    {payload:{target:{userId:'alice'}},code:'cannot_invite_self'},
  ])('refuses $code without creating a conversation or message',async scenario=>{
    const result=await invite(scenario.payload);
    expect(result.statusCode).toBe(400); expect(result.json<{code:string}>().code).toBe(scenario.code);
    expect(messages()).toEqual([]); expect(sqlite.prepare('SELECT * FROM dm_channels').all()).toEqual([]);
  });

  it('rejects a local snapshot that would not form valid system content',async()=>{
    sqlite.exec("UPDATE spaces SET name='' WHERE id='space'");
    const result=await invite(); expect(result.statusCode).toBe(400); expect(messages()).toEqual([]);
  });

  it('persists a parseable, correctly authored native system message with server-owned snapshot values',async()=>{
    const result=await invite({snapshot:{spaceName:'untrusted client data'}});
    expect(result.statusCode).toBe(200);
    const body=result.json<{dmChannelId:string;messageId:string;message:{type:string}}>();
    expect(body.message.type).toBe('system');
    const stored=sqlite.prepare('SELECT dm_channel_id,user_id,type,content FROM dm_messages WHERE id=?').get(body.messageId) as {dm_channel_id:string;user_id:string;type:string;content:string};
    expect(stored).toMatchObject({dm_channel_id:body.dmChannelId,user_id:'alice',type:'system'});
    expect(parseDmSystemEvent(stored.content)).toEqual({
      event:'space_invite',spaceId:'space',spaceInstanceOrigin:'https://local.test',inviteCode:'code',
      snapshot:{spaceName:'Aether',icon:null,avatarColor:'mint',memberCount:1,description:'native description',instanceName:'Local host'},
    });
  });

  it('allows an invitation card for request-to-join spaces without bypassing their separate join gate',async()=>{
    sqlite.exec("UPDATE spaces SET visibility='request' WHERE id='space'");
    expect((await invite()).statusCode).toBe(200);
    expect(sqlite.prepare("SELECT user_id FROM space_members WHERE space_id='space'").all()).toEqual([{user_id:'alice'}]);
  });

  it('reuses the same native pair while keeping distinct message ids',async()=>{
    const first=await invite(),second=await invite();
    expect(first.statusCode).toBe(200); expect(second.statusCode).toBe(200);
    const a=first.json<{dmChannelId:string;messageId:string}>(),b=second.json<{dmChannelId:string;messageId:string}>();
    expect(a.dmChannelId).toBe(b.dmChannelId); expect(a.messageId).not.toBe(b.messageId); expect(messages()).toHaveLength(2);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM dm_channels').get()).toEqual({count:1});
  });

  it.each(['','https://local.test','https://LOCAL.test/'])('reads the local DB without HTTP for current origin %s',async origin=>{
    const fetch=vi.spyOn(globalThis,'fetch');
    expect((await invite({spaceInstanceOrigin:origin})).statusCode).toBe(200); expect(fetch).not.toHaveBeenCalled();
  });

  it.each(['https://foreign.invalid','not a URL'])('refuses origin %s without stripping its host to use a colliding local code',async origin=>{
    const fetch=vi.spyOn(globalThis,'fetch');
    const result=await invite({spaceInstanceOrigin:origin});
    expect(result.statusCode).toBe(400); expect(messages()).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT * FROM dm_channels').all()).toEqual([]);
  });

  it('cannot provision a foreign target identity from the invitation endpoint',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch');
    const result=await invite({target:{homeUserId:'foreign',homeInstance:'https://foreign.invalid'}});
    expect(result.statusCode).toBe(400); expect(messages()).toEqual([]); expect(fetch).not.toHaveBeenCalled();
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({count:3});
  });
});
