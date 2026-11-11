import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { setWorkerId } from '../utils/snowflake.js';
import { hashPassword, verifyPassword, verifyJwt, signJwt } from '../utils/auth.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>sqlite,schema}));

beforeEach(async()=>{
  setWorkerId(1); sqlite=new Database(':memory:'); buildNativeDatabase(sqlite); db=drizzle(sqlite,{schema});
  sqlite.exec('INSERT INTO instance_settings (id,registration_open,updated_at) VALUES (1,0,1)');
  app=Fastify(); const {authRoutes}=await import('./auth.js'); await app.register(authRoutes); await app.ready();
});
afterEach(async()=>{await app.close(); sqlite.close(); vi.restoreAllMocks();});

describe('standalone authentication and native admission',()=>{
  it('obsolete identity fields cannot bypass closed local registration',async()=>{
    const fetch=vi.spyOn(globalThis,'fetch'); const before=sqlite.prepare('SELECT * FROM users').all();
    const result=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'native_name',password:'synthetic-password',homeInstance:'unused.invalid',homeUserId:'foreign'}});
    expect(result.statusCode).toBe(403); expect(result.json<{code:string}>().code).toBe('invite_required');
    expect(sqlite.prepare('SELECT * FROM users').all()).toEqual(before); expect(fetch).not.toHaveBeenCalled();
  });

  it('open signup creates only a native human, ignoring requested bot/admin/home identity authority',async()=>{
    sqlite.exec('UPDATE instance_settings SET registration_open=1'); const fetch=vi.spyOn(globalThis,'fetch');
    const result=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'native_name',password:'synthetic-password',isBot:true,isAdmin:false,homeInstance:'unused.invalid',homeUserId:'foreign',botProof:'a'.repeat(64)}});
    expect(result.statusCode).toBe(201);
    const body=result.json<{token:string;user:{id:string;isBot:boolean;isAdmin:boolean}}>();
    expect(body.user.isBot).toBe(false); expect(body.user.isAdmin).toBe(true); expect(verifyJwt(body.token).userId).toBe(body.user.id);
    for (const field of ['passwordHash','homeInstance','homeUserId','replicatedInstances','federationHomeOrphaned','detachedHomeInstance']) expect(body.user).not.toHaveProperty(field);
    const row=sqlite.prepare('SELECT password_hash,is_bot FROM users WHERE id=?').get(body.user.id) as {password_hash:string;is_bot:number};
    expect(await verifyPassword('synthetic-password',row.password_hash)).toBe(true); expect(row.is_bot).toBe(0); expect(fetch).not.toHaveBeenCalled();
  });

  it('retains strict native username validation even when old registration fields are supplied',async()=>{
    sqlite.exec('UPDATE instance_settings SET registration_open=1');
    const result=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'person@unused.invalid',password:'synthetic-password',homeInstance:'unused.invalid'}});
    expect(result.statusCode).toBe(400); expect(sqlite.prepare('SELECT * FROM users').all()).toEqual([]);
  });

  it('a closed signup with a valid local invite consumes exactly one redemption without granting supplied privilege',async()=>{
    seedNativeUser(sqlite,'admin');
    const token='a'.repeat(22);
    sqlite.prepare('INSERT INTO invite_links (id,token,name,created_by,created_at,max_uses) VALUES (?,?,?,?,1,1)').run('invite',token,'Native invitation','admin');
    const result=await app.inject({method:'POST',url:'/api/auth/register',payload:{username:'invited',password:'synthetic-password',inviteToken:token,homeInstance:'unused.invalid',isAdmin:true}});
    expect(result.statusCode).toBe(201); expect(result.json<{user:{isAdmin:boolean}}>().user.isAdmin).toBe(false);
    expect(sqlite.prepare('SELECT used_count FROM invite_links').get()).toEqual({used_count:1});
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM invite_redemptions').get()).toEqual({count:1});
  });

  it('preserves login for a retained sovereign legacy handle and never forwards a failed password',async()=>{
    const passwordHash=await hashPassword('synthetic-password');
    sqlite.prepare('INSERT INTO users (id,username,password_hash,created_at) VALUES (?,?,?,1)').run('retained','legacy@old.invalid',passwordHash);
    const fetch=vi.spyOn(globalThis,'fetch');
    const failed=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'legacy@old.invalid',password:'wrong-password'}});
    expect(failed.statusCode).toBe(401);
    expect(sqlite.prepare("SELECT password_hash FROM users WHERE id='retained'").get()).toEqual({password_hash:passwordHash});
    const success=await app.inject({method:'POST',url:'/api/auth/login',payload:{username:'legacy@old.invalid',password:'synthetic-password'}});
    expect(success.statusCode).toBe(200); expect(success.json<{user:{id:string}}>().user.id).toBe('retained'); expect(fetch).not.toHaveBeenCalled();
  });

  it('does not register attach-proof endpoints for authenticated or anonymous callers',async()=>{
    seedNativeUser(sqlite,'native');
    const token=signJwt({userId:'native',username:'native'});
    for (const headers of [{},{authorization:`Bearer ${token}`}]) {
      const result=await app.inject({method:'POST',url:'/api/auth/attach-proof',headers,payload:{targetDomain:'unused.invalid'}});
      expect(result.statusCode).toBe(404); expect(result.json<{statusCode:number}>().statusCode).toBe(404);
    }
  });
});
