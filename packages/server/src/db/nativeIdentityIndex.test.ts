import { afterEach, describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { buildNativeDatabase } from '../testing/standaloneUpgrade.js';

const opened: Database.Database[]=[];
afterEach(()=>{for (const db of opened.splice(0)) db.close();});
function fixture(): Database.Database {
  const db=new Database(':memory:'); opened.push(db); buildNativeDatabase(db); return db;
}
function plan(db: Database.Database, sql: string): string[] {
  return (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{detail:string}>).map(row=>row.detail);
}

describe('native identity indexes',()=>{
  it('resolves a native user directly through its primary key, without scanning',()=>{
    const db=fixture();
    const query=plan(db,"SELECT * FROM users WHERE id='native' AND is_deleted=0");
    expect(query.some(line=>line.includes('SEARCH users USING INDEX') && line.includes('(id=?)'))).toBe(true);
    expect(query.some(line=>line.startsWith('SCAN'))).toBe(false);
  });
  it('uses the private unique pair index for native conversation lookup',()=>{
    const db=fixture();
    expect(plan(db,"SELECT * FROM dm_channels WHERE pair_key='native-pair'")).toEqual(['SEARCH dm_channels USING INDEX idx_dm_pair_key (pair_key=?)']);
  });
});
