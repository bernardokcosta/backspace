import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from '../db/schema.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';
import { getLocalInvitePreview, getLocalInviteSnapshot } from './spaceInviteSnapshot.js';

let sqlite: Database.Database;
let db: ReturnType<typeof drizzle<typeof schema>>;
vi.mock('../db/index.js',()=>({getDb:()=>db,getRawDb:()=>sqlite,schema}));
beforeEach(()=>{
  sqlite=new Database(':memory:'); buildNativeDatabase(sqlite); db=drizzle(sqlite,{schema}); seedNativeUser(sqlite,'owner');
});
afterEach(()=>{sqlite.close(); vi.restoreAllMocks();});
function space(): void {
  sqlite.exec("INSERT INTO spaces (id,name,owner_id,invite_code,avatar_color,description,visibility,created_at) VALUES ('space','Aether','owner','code','mint','a calm space','private',1)");
}
describe('native space invite snapshots',()=>{
  it('reads the native snapshot and member count directly without external requests',()=>{
    space(); sqlite.exec("INSERT INTO space_members (space_id,user_id,joined_at) VALUES ('space','owner',1); INSERT INTO instance_settings (id,instance_name,updated_at) VALUES (1,'Test host',1)");
    const fetch=vi.spyOn(globalThis,'fetch');
    expect(getLocalInviteSnapshot('code')).toEqual({spaceId:'space',spaceName:'Aether',description:'a calm space',icon:null,avatarColor:'mint',memberCount:1,instanceName:'Test host'});
    expect(fetch).not.toHaveBeenCalled();
  });
  it('returns null for an unknown code',()=>{expect(getLocalInviteSnapshot('absent')).toBeNull();});
  it('retains the Veyvox fallback and zero-member count without settings',()=>{
    space(); expect(getLocalInviteSnapshot('code')).toMatchObject({instanceName:'Veyvox',memberCount:0});
  });
  it('reads the current visibility on every preview without changing snapshot payloads',()=>{
    space(); expect(getLocalInvitePreview('code')?.visibility).toBe('private');
    sqlite.exec("UPDATE spaces SET visibility='request' WHERE id='space'");
    expect(getLocalInvitePreview('code')?.visibility).toBe('request'); expect(getLocalInviteSnapshot('code')).not.toHaveProperty('visibility');
  });
});
