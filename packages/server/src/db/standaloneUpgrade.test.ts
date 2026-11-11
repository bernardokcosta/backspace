import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runMigrations } from './migrationRunner.js';
import { oneOnOneKey } from '../utils/dmConversation.js';
import { retryRetirementFiles } from './retirementFiles.js';
import { buildOldDatabase, migrationsFolder, seedNativeDm, seedNativeUser, snapshotDatabase } from '../testing/standaloneUpgrade.js';

const opened: Database.Database[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const db of opened.splice(0)) db.close();
  for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive:true, force:true });
});
function fixture(options: Parameters<typeof buildOldDatabase>[1] = {}, fresh = false) {
  const root = path.join(os.tmpdir(),'opencode'); fs.mkdirSync(root,{recursive:true});
  const directory = fs.mkdtempSync(path.join(root,'veyvox-standalone-upgrade-')); directories.push(directory);
  const dbPath = path.join(directory,'native.db'), uploadDir = path.join(directory,'uploads'); fs.mkdirSync(uploadDir);
  const db = new Database(dbPath); opened.push(db); db.pragma('foreign_keys = ON');
  if (!fresh) buildOldDatabase(db,options);
  const beforeChanges = vi.fn();
  const upgrade = () => runMigrations(db,{migrationsFolder,beforeChanges,retirementFiles:{dbPath,uploadDir}});
  return {db,dbPath,uploadDir,beforeChanges,upgrade};
}
function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{name:string}>).map(row=>row.name);
}
const key = oneOnOneKey({id:'alice'},{id:'bob'});

describe('generated standalone upgrade with transactional retirement', () => {
  it.each(['pre-core', 'post-core', 'pre-squash'] as const)('drops inert columns from %s while preserving native settings and repeated boots', shape => {
    const f = fixture({ through: shape === 'post-core' ? 50 : 49, legacy: shape === 'pre-squash', omitPrefix: shape === 'pre-squash' ? 7 : 0 });
    seedNativeUser(f.db, 'native');
    f.db.exec(`UPDATE users SET last_active_day='obsolete',last_client='obsolete' WHERE id='native';
      INSERT INTO instance_settings (id,instance_name,worker_id,installed_at,max_bitrate_kbps,max_upload_size_bytes,max_sticker_size_bytes,
        space_creation_open,registration_open,gif_api_key,telemetry_id,directory_last_error,support_card_enabled,updated_at)
        VALUES (1,'Preserved title',41,123,32000,888888,77777,0,0,'synthetic-key','retired-id','retired-error',0,456);
      INSERT INTO spaces (id,name,owner_id,directory_listed,created_at) VALUES ('native-space','Native','native',1,1);`);
    const user = f.db.prepare('SELECT id,username,password_hash,created_at FROM users').all();
    const settingsSql = 'SELECT instance_name,worker_id,installed_at,max_bitrate_kbps,max_upload_size_bytes,max_sticker_size_bytes,space_creation_open,registration_open,gif_api_key,updated_at FROM instance_settings';
    const settings = f.db.prepare(settingsSql).all(); f.upgrade();
    for (const [table, retired] of Object.entries({ users: ['last_active_day', 'last_client'], spaces: ['directory_listed'], dm_members: ['closed_changed_at'],
      instance_settings: ['telemetry_enabled', 'telemetry_id', 'telemetry_last_day', 'telemetry_last_error', 'telemetry_declined_version',
        'discovery_enabled', 'directory_enabled', 'directory_dirty', 'directory_last_ping_at', 'directory_last_error', 'directory_browse_enabled', 'support_card_enabled'] })) {
      for (const column of retired) expect(columns(f.db, table), `${table}.${column}`).not.toContain(column);
    }
    expect(f.db.prepare(settingsSql).all()).toEqual(settings); expect(f.db.prepare('SELECT id,username,password_hash,created_at FROM users').all()).toEqual(user);
    expect(f.db.prepare('SELECT id,name,owner_id FROM spaces').get()).toEqual({ id: 'native-space', name: 'Native', owner_id: 'native' });
    expect(columns(f.db, 'dm_channels')).toContain('metadata_updated_at'); expect(columns(f.db, 'dm_messages')).not.toContain('encryption_version');
    expect(f.db.pragma('foreign_key_check')).toEqual([]); const after = snapshotDatabase(f.db); f.beforeChanges.mockClear(); f.upgrade();
    expect(f.beforeChanges).not.toHaveBeenCalled(); expect(snapshotDatabase(f.db)).toEqual(after);
  });
  it('rolls pending core and cleanup SQL back together when generated inert cleanup fails', () => {
    const f = fixture(); seedNativeUser(f.db, 'native'); const before = snapshotDatabase(f.db), execute = f.db.exec.bind(f.db);
    vi.spyOn(f.db, 'exec').mockImplementation(sql => {
      if (sql.includes('DROP COLUMN `last_active_day`')) throw new Error('synthetic cleanup failure');
      return execute(sql);
    });
    expect(f.upgrade).toThrow('synthetic cleanup failure'); expect(snapshotDatabase(f.db)).toEqual(before); expect(f.db.pragma('foreign_keys', { simple: true })).toBe(1);
  });
  it.each(['fresh','current','legacy'] as const)('removes all eighteen dedicated tables and provenance columns from %s schema', shape => {
    const f = fixture({legacy:shape==='legacy',omitPrefix:shape==='legacy'?7:0},shape==='fresh');
    f.upgrade();
    const names = (f.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>).map(row=>row.name);
    expect(names.filter(name=>/federation|peer_approval|sticker_peer|bot_revocations|blocked_bots/.test(name))).toEqual([]);
    expect(columns(f.db,'users')).not.toContain('home_instance');
    expect(columns(f.db,'dm_channels')).toContain('pair_key');
    expect(columns(f.db,'dm_channels')).not.toContain('federated_id');
    expect(columns(f.db,'instance_settings')).not.toContain('instance_id');
    expect(columns(f.db,'sticker_packs')).not.toContain('origin_type');
    expect(f.db.pragma('foreign_key_check')).toEqual([]);
    expect(f.db.pragma('foreign_keys',{simple:true})).toBe(1);
    const before = snapshotDatabase(f.db); f.beforeChanges.mockClear(); f.upgrade();
    expect(f.beforeChanges).not.toHaveBeenCalled(); expect(snapshotDatabase(f.db)).toEqual(before);
  });

  it('preserves native/detached/tombstone/bot credentials, local content, settings and sticker moderation', () => {
    const f=fixture();
    for (const id of ['alice','bob','detached','tombstone','bot']) seedNativeUser(f.db,id);
    f.db.exec(`UPDATE users SET federation_home_orphaned=1,home_instance='old.test',home_user_id='old-detached' WHERE id='detached';
      UPDATE users SET is_deleted=1 WHERE id='tombstone'; UPDATE users SET is_bot=1,bot_owner_id='alice' WHERE id='bot';
      INSERT INTO instance_settings (id,instance_name,worker_id,installed_at,updated_at) VALUES (1,'Native title',42,100,7);
      INSERT INTO spaces (id,name,owner_id,created_at) VALUES ('space','Native space','alice',1);
      INSERT INTO channels (id,space_id,name,type,created_at) VALUES ('channel','space','Native channel','text',1);
      INSERT INTO messages (id,channel_id,user_id,content,created_at) VALUES ('message','channel','alice','native bytes',1);
      INSERT INTO bot_tokens (id,bot_id,token_hash,created_at) VALUES ('token','bot','synthetic-token-hash',1);
      INSERT INTO sticker_packs (id,name,creator_id,status,reviewed_by,reviewed_at,created_at,updated_at)
        VALUES ('pack','Native pack','alice','approved','bob',3,1,3);`);
    const users=f.db.prepare('SELECT id,username,password_hash,is_deleted,is_bot,bot_owner_id FROM users ORDER BY id').all();
    const settings=f.db.prepare('SELECT instance_name,worker_id,installed_at,updated_at FROM instance_settings').all();
    const pack=f.db.prepare('SELECT id,name,status,reviewed_by,reviewed_at FROM sticker_packs').all();
    f.upgrade();
    expect(f.db.prepare('SELECT id,username,password_hash,is_deleted,is_bot,bot_owner_id FROM users ORDER BY id').all()).toEqual(users);
    expect(f.db.prepare('SELECT instance_name,worker_id,installed_at,updated_at FROM instance_settings').all()).toEqual(settings);
    expect(f.db.prepare('SELECT id,name,status,reviewed_by,reviewed_at FROM sticker_packs').all()).toEqual(pack);
    expect(f.db.prepare('SELECT content FROM messages').get()).toEqual({content:'native bytes'});
    expect(f.db.prepare('SELECT token_hash FROM bot_tokens').get()).toEqual({token_hash:'synthetic-token-hash'});
  });

  it('prefers a valid native key holder over older duplicate pairs and preserves every message and local pointer', () => {
    const f=fixture(); seedNativeUser(f.db,'alice'); seedNativeUser(f.db,'bob');
    seedNativeDm(f.db,'earliest',null,['alice','bob'],1); seedNativeDm(f.db,'holder',key,['alice','bob'],2);
    f.db.exec(`UPDATE dm_members SET closed=1 WHERE dm_channel_id='holder';
      INSERT INTO dm_messages (id,dm_channel_id,user_id,content,created_at) VALUES ('900','holder','alice','old bytes',1),('1000','earliest','bob','new bytes',2);
      INSERT INTO read_states VALUES ('alice','holder','900',1),('alice','earliest','1000',2);
      INSERT INTO interactions (id,bot_id,user_id,dm_channel_id,command,created_at,expires_at) VALUES ('pending','alice','alice','earliest','command',1,3);
      INSERT INTO attachments (id,dm_message_id,filename,original_name,mimetype,size,created_at) VALUES ('file','1000','native.webp','Native','image/webp',1,1);
      INSERT INTO dm_reactions (id,dm_message_id,user_id,emoji,created_at) VALUES ('reaction','1000','alice','x',1);`);
    f.upgrade();
    expect(f.db.prepare('SELECT id,pair_key FROM dm_channels').all()).toEqual([{id:'holder',pair_key:key}]);
    expect(f.db.prepare('SELECT id,dm_channel_id,content FROM dm_messages ORDER BY id').all()).toEqual([
      {id:'1000',dm_channel_id:'holder',content:'new bytes'},{id:'900',dm_channel_id:'holder',content:'old bytes'},
    ]);
    expect(f.db.prepare('SELECT channel_id,last_read_message_id FROM read_states').get()).toEqual({channel_id:'holder',last_read_message_id:'1000'});
    expect(f.db.prepare('SELECT dm_channel_id FROM interactions').get()).toEqual({dm_channel_id:'holder'});
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM attachments').get()).toEqual({count:1});
    expect(f.db.prepare('SELECT COUNT(*) AS count FROM dm_reactions').get()).toEqual({count:1});
  });

  it('chooses earliest created/id when no native key holder exists, without changing a group channel', () => {
    const f=fixture(); seedNativeUser(f.db,'alice'); seedNativeUser(f.db,'bob');
    seedNativeDm(f.db,'b',null,['alice','bob']); seedNativeDm(f.db,'a',null,['alice','bob']);
    seedNativeDm(f.db,'group','00000000-0000-4000-8000-000000000001',['alice','bob'],1,'alice');
    f.upgrade();
    expect(f.db.prepare('SELECT id,owner_id,pair_key FROM dm_channels ORDER BY id').all()).toEqual([
      {id:'a',owner_id:null,pair_key:key},{id:'group',owner_id:'alice',pair_key:null},
    ]);
  });

  it.each(['mixed','ownerless','third-party'] as const)('refuses %s data and rolls back pending historical SQL, rows and journal together', kind => {
    const f=fixture({through:48});
    for (const id of ['alice','bob','remote']) seedNativeUser(f.db,id);
    if (kind==='mixed') {
      f.db.exec("UPDATE users SET home_instance='elsewhere.test',home_user_id='remote-home' WHERE id='remote'");
      seedNativeDm(f.db,'mixed',null,['alice','remote']);
    } else if (kind==='ownerless') seedNativeDm(f.db,'ambiguous','00000000-0000-4000-8000-000000000001',['alice','bob']);
    else {
      seedNativeDm(f.db,'native',null,['alice','bob']);
      f.db.exec("INSERT INTO dm_messages (id,dm_channel_id,user_id,content,created_at) VALUES ('private','native','remote','third-party private bytes',1)");
    }
    const before=snapshotDatabase(f.db);
    expect(f.upgrade).toThrow(/mixed|unclassifiable|history|integrity/i);
    expect(snapshotDatabase(f.db)).toEqual(before);
    expect(f.db.pragma('foreign_keys',{simple:true})).toBe(1);
  });

  it('deletes only disjoint remote data, stages files before commit and cleans only its committed candidates', () => {
    const f=fixture(); seedNativeUser(f.db,'alice'); seedNativeUser(f.db,'remote');
    f.db.exec("UPDATE users SET home_instance='elsewhere.test',home_user_id='remote-home',avatar='remote.webp' WHERE id='remote'");
    fs.writeFileSync(path.join(f.uploadDir,'remote.webp'),'remote bytes'); fs.writeFileSync(path.join(f.uploadDir,'native.webp'),'native bytes');
    f.upgrade();
    expect(f.db.prepare('SELECT id FROM users').all()).toEqual([{id:'alice'}]);
    expect(fs.existsSync(path.join(f.uploadDir,'remote.webp'))).toBe(true);
    expect(retryRetirementFiles(f.db,{dbPath:f.dbPath,uploadDir:f.uploadDir})).toEqual({deleted:1,pending:0});
    expect(fs.readFileSync(path.join(f.uploadDir,'native.webp'),'utf8')).toBe('native bytes');
  });

  it('fails before all rewrites if the pre-migration snapshot fails', () => {
    const f=fixture(); const before=snapshotDatabase(f.db);
    f.beforeChanges.mockImplementation(()=>{throw new Error('synthetic snapshot failure');});
    expect(f.upgrade).toThrow(/snapshot/); expect(snapshotDatabase(f.db)).toEqual(before);
  });

  it('restores only a provably missing native tombstone membership before keying its old thread',()=>{
    const f=fixture(); seedNativeUser(f.db,'alice'); seedNativeUser(f.db,'bob');
    f.db.exec("UPDATE users SET is_deleted=1 WHERE id='bob'"); seedNativeDm(f.db,'broken',null,['alice']);
    f.db.exec("INSERT INTO dm_messages (id,dm_channel_id,user_id,content,created_at) VALUES ('private','broken','bob','preserved deleted-user history',1)");
    f.upgrade();
    expect(f.db.prepare('SELECT user_id FROM dm_members ORDER BY user_id').all()).toEqual([{user_id:'alice'},{user_id:'bob'}]);
    expect(f.db.prepare('SELECT pair_key FROM dm_channels').get()).toEqual({pair_key:key});
    expect(f.db.prepare('SELECT content FROM dm_messages').get()).toEqual({content:'preserved deleted-user history'});
  });

  it('detects an unexpected native rewrite during generated SQL and rolls the entire retirement back',()=>{
    const f=fixture(); seedNativeUser(f.db,'alice'); const before=snapshotDatabase(f.db);
    const execute=f.db.exec.bind(f.db);
    vi.spyOn(f.db,'exec').mockImplementation(sql=>{
      const result=execute(sql);
      if(sql.includes('ALTER TABLE `attachments` DROP COLUMN `federation_meta`')) execute("UPDATE users SET password_hash='must roll back' WHERE id='alice'");
      return result;
    });
    expect(f.upgrade).toThrow(/native data/i); expect(snapshotDatabase(f.db)).toEqual(before);
    expect(f.db.pragma('foreign_keys',{simple:true})).toBe(1);
  });

  it('a generated SQL failure leaves the old data and journal, without unlinking a candidate',()=>{
    const f=fixture(); seedNativeUser(f.db,'remote');
    f.db.exec("UPDATE users SET home_instance='elsewhere.test',avatar='remote.webp' WHERE id='remote'");
    fs.writeFileSync(path.join(f.uploadDir,'remote.webp'),'remote bytes'); const before=snapshotDatabase(f.db);
    const execute=f.db.exec.bind(f.db);
    vi.spyOn(f.db,'exec').mockImplementation(sql=>{
      if(sql.includes('ALTER TABLE `dm_channels` ADD `pair_key`')) throw new Error('synthetic SQL failure');
      return execute(sql);
    });
    expect(f.upgrade).toThrow(/SQL failure/); expect(snapshotDatabase(f.db)).toEqual(before);
    expect(fs.readFileSync(path.join(f.uploadDir,'remote.webp'),'utf8')).toBe('remote bytes');
  });

  it('does not commit data deletion without the required file-cleanup context',()=>{
    const f=fixture(); seedNativeUser(f.db,'remote');
    f.db.exec("UPDATE users SET home_instance='elsewhere.test',avatar='remote.webp' WHERE id='remote'");
    const before=snapshotDatabase(f.db);
    expect(()=>runMigrations(f.db,{migrationsFolder,beforeChanges:()=>{}})).toThrow(/cleanup context/);
    expect(snapshotDatabase(f.db)).toEqual(before);
  });

  it('real boot refuses incomplete post-commit IO before defaults, then retries exactly that manifest',async()=>{
    const f=fixture(); seedNativeUser(f.db,'remote');
    f.db.exec("UPDATE users SET home_instance='elsewhere.test',avatar='remote.webp' WHERE id='remote'");
    const filename=path.join(f.uploadDir,'remote.webp'); fs.writeFileSync(filename,'remote bytes');
    vi.stubEnv('DB_PATH',f.dbPath); vi.stubEnv('UPLOAD_DIR',f.uploadDir); vi.stubEnv('BACKUP_DISABLED','true');
    vi.resetModules();
    const {initDatabase,closeDatabase}=await import('./index.js');
    const unlink=fs.unlinkSync;
    const failure=vi.spyOn(fs,'unlinkSync').mockImplementation(file=>{
      if(String(file)===filename) throw Object.assign(new Error('synthetic EACCES'),{code:'EACCES'});
      return unlink(file);
    });
    try { expect(initDatabase).toThrow(/cleanup incomplete/); } finally { closeDatabase(); }
    expect(f.db.prepare('SELECT * FROM instance_settings').all()).toEqual([]);
    expect(fs.existsSync(`${f.dbPath}.standalone-cleanup.json`)).toBe(true);
    expect(fs.readFileSync(filename,'utf8')).toBe('remote bytes'); failure.mockRestore();
    try { initDatabase(); } finally { closeDatabase(); }
    expect(fs.existsSync(filename)).toBe(false);
    expect(fs.existsSync(`${f.dbPath}.standalone-cleanup.json`)).toBe(false);
    expect(f.db.prepare('SELECT instance_name FROM instance_settings').get()).toEqual({instance_name:'Veyvox'});
  });
});
