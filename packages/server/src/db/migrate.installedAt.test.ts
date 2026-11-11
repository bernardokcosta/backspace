import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureDefaults } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function applyMigrations(db: Database.Database): void {
  const dir = path.resolve(__dirname, '../../drizzle');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), 'utf8').split(/-->\s*statement-breakpoint/)) {
      const clean = stmt.trim();
      if (clean) db.exec(clean);
    }
  }
}

let db: Database.Database;
beforeEach(() => {
  db = new Database(':memory:');
  applyMigrations(db);
});

describe('ensureDefaults installed_at', () => {
  it('backfills installed_at from the oldest local non-deleted user', () => {
    db.prepare(`INSERT INTO users (id, username, password_hash, is_deleted, created_at)
      VALUES ('a', 'a', 'x', 0, 1000), ('b', 'b', 'x', 1, 500)`).run();
    ensureDefaults(db);
    const row = db.prepare('SELECT installed_at FROM instance_settings WHERE id = 1').get() as { installed_at: number };
    expect(row.installed_at).toBe(1000);
  });

  it('uses now when there is no local user, and never overwrites an existing value', () => {
    const before = Date.now();
    ensureDefaults(db);
    const first = (db.prepare('SELECT installed_at FROM instance_settings WHERE id = 1').get() as { installed_at: number }).installed_at;
    expect(first).toBeGreaterThanOrEqual(before);
    db.prepare(`INSERT INTO users (id, username, password_hash, is_deleted, created_at) VALUES ('a', 'a', 'x', 0, 1)`).run();
    ensureDefaults(db);
    const second = (db.prepare('SELECT installed_at FROM instance_settings WHERE id = 1').get() as { installed_at: number }).installed_at;
    expect(second).toBe(first);
  });
});
afterEach(() => db.close());
