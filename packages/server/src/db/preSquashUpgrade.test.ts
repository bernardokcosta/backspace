import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { buildOldDatabase, migrationsFolder } from '../testing/standaloneUpgrade.js';

// Real boot upgrades, retaining reaction deduplication and pre-squash native
// constraints. The old queue is now retired, never imported as runtime support.
const reactions = [
  {id:'late',user:'one',emoji:'👍',at:200,kept:false},
  {id:'early',user:'one',emoji:'👍',at:100,kept:true},
  {id:'twin',user:'one',emoji:'👍',at:100,kept:false},
  {id:'other-user',user:'two',emoji:'👍',at:300,kept:true},
  {id:'other-emoji',user:'one',emoji:'🎉',at:400,kept:true},
];
const reactionTables = [
  {table:'reactions',messageColumn:'message_id',index:'idx_reactions_message_user_emoji'},
  {table:'dm_reactions',messageColumn:'dm_message_id',index:'idx_dm_reactions_message_user_emoji'},
] as const;

function seed(db: Database.Database, duplicates: boolean): void {
  db.exec(`INSERT INTO users (id,username,password_hash,created_at) VALUES ('one','native_one','synthetic-one',1),('two','native_two','synthetic-two',2);
    INSERT INTO spaces (id,name,owner_id,created_at) VALUES ('space','Native reactions','one',1);
    INSERT INTO channels (id,space_id,name,type,created_at) VALUES ('channel','space','Native','text',1);
    INSERT INTO messages (id,channel_id,user_id,content,created_at) VALUES ('message','channel','one','native bytes',1);
    INSERT INTO dm_channels (id,created_at) VALUES ('dm',1);
    INSERT INTO dm_members (dm_channel_id,user_id) VALUES ('dm','one'),('dm','two');
    INSERT INTO dm_messages (id,dm_channel_id,user_id,content,created_at) VALUES ('message','dm','one','native DM bytes',1);
    INSERT INTO federation_peers (id,origin,hmac_secret,created_at) VALUES ('retired-peer','https://unused.test','synthetic-secret',1);
    INSERT INTO federation_outbox (id,peer_id,context_id,entity_id,event_type,payload,next_retry_at,expires_at,created_at)
      VALUES ('retired-event','retired-peer','dm','message','create','{}',0,1,1);`);
  for (const {table,messageColumn} of reactionTables) {
    const insert=db.prepare(`INSERT INTO ${table} (id,${messageColumn},user_id,emoji,created_at) VALUES (?,'message',?,?,?)`);
    for (const row of reactions) if (duplicates || row.kept) insert.run(row.id,row.user,row.emoji,row.at);
  }
}

describe('upgrading through initDatabase from every supported database shape',()=>{
  let directory: string;
  const shapes: Record<'preSquash'|'squashed'|'empty',string>={preSquash:'',squashed:'',empty:''};
  const savedEnv={DB_PATH:process.env.DB_PATH,BACKUP_DISABLED:process.env.BACKUP_DISABLED,UPLOAD_DIR:process.env.UPLOAD_DIR};
  beforeAll(async()=>{
    const root=path.join(os.tmpdir(),'opencode'); fs.mkdirSync(root,{recursive:true});
    directory=fs.mkdtempSync(path.join(root,'veyvox-pre-squash-'));
    const uploads=path.join(directory,'uploads'); fs.mkdirSync(uploads); process.env.UPLOAD_DIR=uploads;
    for (const shape of ['preSquash','squashed','empty'] as const) {
      shapes[shape]=path.join(directory,`${shape}.db`);
      if (shape!=='empty') {
        const db=new Database(shapes[shape]);
        buildOldDatabase(db,{legacy:shape==='preSquash',through:21,omitPrefix:shape==='preSquash'?7:0});
        seed(db,shape==='squashed'); db.close();
      }
      vi.resetModules(); process.env.DB_PATH=shapes[shape]; process.env.BACKUP_DISABLED='true';
      const {initDatabase,closeDatabase}=await import('./index.js');
      try { initDatabase(); } finally { closeDatabase(); }
    }
  });
  afterAll(()=>{
    for (const [key,value] of Object.entries(savedEnv)) {
      if (value===undefined) delete process.env[key]; else process.env[key]=value;
    }
    vi.resetModules(); if(directory) fs.rmSync(directory,{recursive:true,force:true});
  });

  it.each(['preSquash','squashed','empty'] as const)('%s: records the final generated migration, has FK integrity and no retired tables',shape=>{
    const db=new Database(shapes[shape],{readonly:true});
    try {
      const last=readMigrationFiles({migrationsFolder}).at(-1)!;
      expect(db.prepare('SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1').get()).toEqual({hash:last.hash,created_at:last.folderMillis});
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE 'federation_%' OR name LIKE 'peer_approval_%')").all()).toEqual([]);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    } finally { db.close(); }
  });

  it.each(['preSquash','squashed'] as const)('%s: preserves native credentials/messages and earliest deduplicated reactions',shape=>{
    const db=new Database(shapes[shape],{readonly:true});
    try {
      expect(db.prepare('SELECT id,password_hash FROM users ORDER BY id').all()).toEqual([{id:'one',password_hash:'synthetic-one'},{id:'two',password_hash:'synthetic-two'}]);
      expect(db.prepare('SELECT content FROM messages').get()).toEqual({content:'native bytes'});
      expect(db.prepare('SELECT content FROM dm_messages').get()).toEqual({content:'native DM bytes'});
      for (const {table} of reactionTables) expect((db.prepare(`SELECT id FROM ${table} ORDER BY id`).all() as Array<{id:string}>).map(row=>row.id)).toEqual(reactions.filter(row=>row.kept).map(row=>row.id).sort());
    } finally { db.close(); }
  });

  it.each(['preSquash','squashed','empty'] as const)('%s: keeps the unique reaction indexes and enforces them',shape=>{
    const db=new Database(shapes[shape]); db.pragma('foreign_keys = OFF');
    try {
      for (const {table,messageColumn,index} of reactionTables) {
        expect((db.prepare(`PRAGMA index_list(${table})`).all() as Array<{name:string;unique:number}>).find(row=>row.name===index)?.unique).toBe(1);
        const insert=db.prepare(`INSERT INTO ${table} (id,${messageColumn},user_id,emoji,created_at) VALUES (?,'repeat','one','x',1)`);
        insert.run('first'); expect(()=>insert.run('duplicate')).toThrow(/UNIQUE constraint/);
      }
    } finally { db.close(); }
  });

  it('preserves pre-squash embed CHECKs and inline reaction UNIQUE, plus singleton settings CHECK',()=>{
    const db=new Database(shapes.preSquash,{readonly:true});
    try {
      const sql=(db.prepare("SELECT sql FROM sqlite_master WHERE name='embeds'").get() as {sql:string}).sql;
      expect(sql.match(/CHECK\s*\(/gi)).toHaveLength(2);
      const settings=(db.prepare("SELECT sql FROM sqlite_master WHERE name='instance_settings'").get() as {sql:string}).sql;
      expect(settings).toContain('instance_settings_singleton');
      for (const {table} of reactionTables) expect((db.prepare(`PRAGMA index_list(${table})`).all() as Array<{origin:string}>).filter(row=>row.origin==='u')).toHaveLength(1);
    } finally { db.close(); }
  });
});
