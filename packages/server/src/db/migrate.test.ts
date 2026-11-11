import { afterEach, describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { ensureDefaults } from './migrate.js';
import { buildNativeDatabase, seedNativeUser } from '../testing/standaloneUpgrade.js';

const databases: Database.Database[]=[];
afterEach(()=>{for(const db of databases.splice(0)) db.close();});
function fixture(): Database.Database {
  const db=new Database(':memory:'); databases.push(db); buildNativeDatabase(db); return db;
}

describe('native boot defaults',()=>{
  it('initializes only native settings and keeps the same worker/date on later boots',()=>{
    const db=fixture(); ensureDefaults(db);
    const first=db.prepare('SELECT * FROM instance_settings').get() as {worker_id:number;installed_at:number};
    expect(first.worker_id).toBeGreaterThanOrEqual(0); expect(first.worker_id).toBeLessThan(1024);
    expect(first.installed_at).toBeGreaterThan(0);
    expect(first).not.toHaveProperty('instance_id');
    ensureDefaults(db); expect(db.prepare('SELECT * FROM instance_settings').get()).toEqual(first);
  });

  it('uses the oldest retained live account for installed_at without filtering obsolete provenance',()=>{
    const db=fixture(); seedNativeUser(db,'native'); seedNativeUser(db,'deleted');
    db.exec("UPDATE users SET created_at=10 WHERE id='native'; UPDATE users SET is_deleted=1,created_at=1 WHERE id='deleted'");
    ensureDefaults(db);
    expect(db.prepare('SELECT installed_at FROM instance_settings').get()).toEqual({installed_at:10});
  });
});
