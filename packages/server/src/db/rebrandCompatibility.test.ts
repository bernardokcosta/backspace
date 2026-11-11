import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { ensureDefaults } from './migrate.js';

const databases: Database.Database[] = [];
afterEach(() => { for (const db of databases.splice(0)) db.close(); });
function fixture(): Database.Database {
  const db = new Database(':memory:');
  databases.push(db);
  // Minimal real SQL contract consumed by ensureDefaults; no checkout data/env.
  db.exec(`CREATE TABLE instance_settings (
    id INTEGER PRIMARY KEY, instance_name TEXT DEFAULT 'Backspace',
    max_bitrate_kbps INTEGER, min_bitrate_kbps INTEGER, bitrate_step_kbps INTEGER,
    allowed_resolutions TEXT, allowed_framerates TEXT, max_resolution INTEGER,
    max_framerate INTEGER, updated_at INTEGER, worker_id INTEGER,
    installed_at INTEGER
  ); CREATE TABLE users (id TEXT PRIMARY KEY, is_deleted INTEGER DEFAULT 0, created_at INTEGER, is_admin INTEGER);`);
  return db;
}
describe('Veyvox boot defaults and existing instance ownership', () => {
  it('uses Veyvox only when inserting a fresh instance settings row', () => {
    const db = fixture();
    ensureDefaults(db);
    expect(db.prepare('SELECT instance_name FROM instance_settings WHERE id = 1').get()).toEqual({ instance_name: 'Veyvox' });
    const first = db.prepare('SELECT * FROM instance_settings').get();
    ensureDefaults(db);
    expect(db.prepare('SELECT * FROM instance_settings').get()).toEqual(first);
  });
  it.each(['Backspace', 'Backspace Fork', 'My community'])('never renames an existing instance named %s or replaces its identities', name => {
    const db = fixture();
    db.prepare('INSERT INTO instance_settings (id, instance_name, worker_id, installed_at) VALUES (1, ?, 42, 123)').run(name);
    db.prepare('INSERT INTO users (id, created_at, is_admin) VALUES (?, 10, 1)').run('synthetic-owner');
    const settings = db.prepare('SELECT * FROM instance_settings').get();
    const owner = db.prepare('SELECT * FROM users').get();
    ensureDefaults(db); ensureDefaults(db);
    expect(db.prepare('SELECT * FROM instance_settings').get()).toEqual(settings);
    expect(db.prepare('SELECT * FROM users').get()).toEqual(owner);
  });
});
