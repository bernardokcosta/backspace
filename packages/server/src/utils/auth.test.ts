import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { authenticate, requireAdmin, signJwt, verifyAccessToken } from './auth.js';
import { issueBotToken } from './botTokens.js';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
let app: FastifyInstance;
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>sqlite,schema}));
beforeEach(async()=>{
  sqlite=new Database(':memory:'); buildNativeDatabase(sqlite); db=drizzle(sqlite,{schema});
  seedNativeUser(sqlite,'admin'); seedNativeUser(sqlite,'member'); seedNativeUser(sqlite,'bot');
  sqlite.exec("UPDATE users SET is_admin=1 WHERE id='admin'; UPDATE users SET is_bot=1,bot_owner_id='admin' WHERE id='bot'");
  app=Fastify();
  app.get('/identity',{preHandler:authenticate},async request=>({userId:request.userId,username:request.username}));
  app.get('/admin',{preHandler:[authenticate,requireAdmin]},async()=>({ok:true}));
  await app.ready();
});
afterEach(async()=>{await app.close(); sqlite.close(); vi.restoreAllMocks();});
function token(userId:string): string { return signJwt({userId,username:userId}); }

describe('native access token and authority checks',()=>{
  it('revokes a session minted earlier in the same second while a newly issued session works',async()=>{
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_100);
    const old = token('member'); sqlite.prepare("UPDATE users SET password_changed_at=? WHERE id='member'").run(1_700_000_000_200);
    await expect(verifyAccessToken(old)).rejects.toMatchObject({ statusCode: 401 });
    now.mockReturnValue(1_700_000_000_300); expect((await verifyAccessToken(token('member'))).userId).toBe('member');
  });
  it.each([
    { userId: 'member' }, { userId: 'member', username: '' }, { userId: 'member', username: 42 },
    { userId: 'member', username: 'member', noTimestamp: true },
  ])('refuses incomplete signed session claims %j before granting REST authority',async input=>{
    const { noTimestamp, ...claims } = input;
    const signed = jwt.sign(claims, config.jwtSecret, { expiresIn: '1h', ...(noTimestamp ? { noTimestamp: true } : {}) });
    await expect(verifyAccessToken(signed)).rejects.toMatchObject({ statusCode: 401, code: 'unauthorized' });
    expect((await app.inject({ url: '/identity', headers: { authorization: `Bearer ${signed}` } })).statusCode).toBe(401);
  });
  it('requires a bounded session expiry rather than accepting a signed timeless token',async()=>{
    const signed = jwt.sign({ userId: 'member', username: 'member' }, config.jwtSecret);
    await expect(verifyAccessToken(signed)).rejects.toMatchObject({ statusCode: 401 });
  });
  it.each(['HS384', 'HS512', 'none'] as const)('refuses a signed session using %s',async algorithm=>{
    const signed = jwt.sign({ userId: 'member', username: 'member' }, config.jwtSecret, { algorithm, expiresIn: '1h' });
    await expect(verifyAccessToken(signed)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('rejects expired sessions and malformed token bytes',async()=>{
    const expired = jwt.sign({ userId: 'member', username: 'member' }, config.jwtSecret, { expiresIn: -1 });
    for (const value of [expired, 'malformed', '']) await expect(verifyAccessToken(value)).rejects.toMatchObject({ statusCode: 401 });
  });
  it('resolves a local JWT without obsolete home identity metadata',async()=>{
    expect(await verifyAccessToken(token('member'))).toEqual({userId:'member',username:'member',isBot:false});
  });
  it('resolves a native bot token by its stored hash and account',async()=>{
    const issued=issueBotToken('bot',null);
    expect(await verifyAccessToken(issued.token)).toEqual({tokenId:issued.id,userId:'bot',username:'bot',isBot:true});
  });
  it('retains authentication and actual admin checks after removing the old local-user predicate',async()=>{
    expect((await app.inject({url:'/admin'})).statusCode).toBe(401);
    expect((await app.inject({url:'/admin',headers:{authorization:`Bearer ${token('member')}`}})).statusCode).toBe(403);
    expect((await app.inject({url:'/admin',headers:{authorization:`Bearer ${token('admin')}`}})).statusCode).toBe(200);
  });
  it('rejects deleted or missing accounts even when the token signature is valid',async()=>{
    const original=token('member'); sqlite.exec("UPDATE users SET is_deleted=1 WHERE id='member'");
    await expect(verifyAccessToken(original)).rejects.toMatchObject({statusCode:401,code:'account_deleted'});
    await expect(verifyAccessToken(token('absent'))).rejects.toMatchObject({statusCode:401});
  });
  it('retains password-change revocation and signature verification',async()=>{
    const old=signJwt({userId:'member',username:'member',iat:1});
    sqlite.prepare("UPDATE users SET password_changed_at=? WHERE id='member'").run(Date.now());
    await expect(verifyAccessToken(old)).rejects.toMatchObject({statusCode:401});
    const valid=token('admin');
    await expect(verifyAccessToken(`${valid.slice(0,-5)}xxxxx`)).rejects.toMatchObject({statusCode:401});
  });
  it('retires a native bot\'s legacy JWT on its first hashed token without affecting human sessions',async()=>{
    const legacy=token('bot'); expect((await verifyAccessToken(legacy)).isBot).toBe(true);
    const issued=issueBotToken('bot',null);
    await expect(verifyAccessToken(legacy)).rejects.toMatchObject({statusCode:401});
    expect((await verifyAccessToken(issued.token)).isBot).toBe(true);
    expect((await verifyAccessToken(token('member'))).isBot).toBe(false);
  });
});
