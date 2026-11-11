import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, cpSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readMigrationState, runMigrations } from './migrationRunner.js';

const fixtures: Array<{ db: Database.Database; folder: string }> = [];
afterEach(() => {
  for (const { db, folder } of fixtures.splice(0)) {
    db.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

function fixture(statements: string[] = [
  'CREATE TABLE native (id text PRIMARY KEY, value text); INSERT INTO native VALUES (\'local\', \'preserved\');',
  'ALTER TABLE native ADD tuning integer DEFAULT 42;',
]): { db: Database.Database; folder: string } {
  const root = path.join(tmpdir(), 'opencode');
  mkdirSync(root, { recursive: true });
  const folder = mkdtempSync(path.join(root, 'veyvox-migration-runner-'));
  mkdirSync(path.join(folder, 'meta'));
  const entries = statements.map((sql, idx) => {
    const tag = `${String(idx).padStart(4, '0')}_fixture`;
    writeFileSync(path.join(folder, `${tag}.sql`), sql);
    return { idx, when: 1_000 + idx, tag, breakpoints: true, version: '6' };
  });
  writeFileSync(path.join(folder, 'meta/_journal.json'), JSON.stringify({ version: '7', dialect: 'sqlite', entries }));
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  const result = { db, folder };
  fixtures.push(result);
  return result;
}

function ledger(db: Database.Database): unknown[] {
  return db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at').all();
}

describe('the single ordered migration transaction', () => {
  it('applies generated hashes/timestamps and repeat boot is a snapshot-free no-op', () => {
    const { db, folder } = fixture();
    const beforeChanges = vi.fn();
    runMigrations(db, { migrationsFolder: folder, beforeChanges });
    expect(db.prepare('SELECT * FROM native').get()).toEqual({ id: 'local', value: 'preserved', tuning: 42 });
    expect(ledger(db)).toEqual(readMigrationFiles({ migrationsFolder: folder }).map(m => ({ hash: m.hash, created_at: m.folderMillis })));
    runMigrations(db, { migrationsFolder: folder, beforeChanges });
    expect(beforeChanges).toHaveBeenCalledTimes(1);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('supports missing earliest history rows but refuses interior gaps, duplicate timestamps and unknown hashes', () => {
    const { db, folder } = fixture(['CREATE TABLE native (id text);', 'ALTER TABLE native ADD a text;', 'ALTER TABLE native ADD b text;']);
    runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} });
    db.prepare('DELETE FROM __drizzle_migrations WHERE created_at = 1000').run();
    expect(readMigrationState(db, folder).pending).toEqual([]);
    db.prepare('DELETE FROM __drizzle_migrations WHERE created_at = 1001').run();
    expect(readMigrationState(db, folder).pending).toEqual([]);
    const first = readMigrationFiles({ migrationsFolder: folder })[0]!;
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(first.hash, first.folderMillis);
    expect(() => readMigrationState(db, folder)).toThrow(/history/i);
    db.prepare('DELETE FROM __drizzle_migrations WHERE created_at = 1000').run();
    const last = readMigrationFiles({ migrationsFolder: folder })[2]!;
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run(last.hash, last.folderMillis);
    expect(() => readMigrationState(db, folder)).toThrow(/history/i);
    db.prepare('DELETE FROM __drizzle_migrations').run();
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('wrong', last.folderMillis);
    expect(() => readMigrationState(db, folder)).toThrow(/history/i);
  });

  it('refuses future history and malformed migration ordering without mutation', () => {
    const { db, folder } = fixture();
    runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} });
    const rows = ledger(db);
    db.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)').run('future', 99_999);
    expect(() => runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} })).toThrow(/history/i);
    expect(ledger(db).slice(0, 2)).toEqual(rows);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    const generatedPath = path.join(folder, 'meta/_journal.json');
    const generated = JSON.parse(readFileSync(generatedPath, 'utf8')) as { entries: Array<{ when: number }> };
    generated.entries[1]!.when = generated.entries[0]!.when;
    writeFileSync(generatedPath, JSON.stringify(generated));
    expect(() => readMigrationState(db, folder)).toThrow(/history/i);
  });

  it('snapshot failure writes neither data/schema nor a journal table', () => {
    const { db, folder } = fixture();
    expect(() => runMigrations(db, { migrationsFolder: folder, beforeChanges: () => { throw new Error('snapshot failed'); } })).toThrow('snapshot failed');
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it.each([
    'ALTER TABLE native ADD should_rollback text; INSERT INTO missing_table VALUES (1);',
    'CREATE TABLE child (parent text REFERENCES native(id)); INSERT INTO child VALUES (\'missing\');',
  ])('SQL/FK failure rolls data/schema/new ledger back together: %s', statement => {
    const { db, folder } = fixture(['CREATE TABLE native (id text PRIMARY KEY, value text); INSERT INTO native VALUES (\'local\', \'preserved\');', statement]);
    expect(() => runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} })).toThrow();
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
    expect(db.inTransaction).toBe(false);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('refuses an active transaction without changing its FK mode or committing caller work', () => {
    const { db, folder } = fixture();
    db.exec('BEGIN');
    expect(() => runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} })).toThrow(/transaction/i);
    expect(db.inTransaction).toBe(true);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    db.exec('ROLLBACK');
  });

  it('a failed upgrade preserves its earlier native data and already-applied journal', () => {
    const { db, folder } = fixture([
      "CREATE TABLE native (id text PRIMARY KEY, value text); INSERT INTO native VALUES ('local', 'preserved');",
      "UPDATE native SET value = 'must roll back'; ALTER TABLE native ADD partial text; INSERT INTO missing_table VALUES (1);",
    ]);
    const file = path.join(folder, 'meta/_journal.json');
    const full = readFileSync(file, 'utf8');
    const generated = JSON.parse(full) as { entries: unknown[] };
    writeFileSync(file, JSON.stringify({ ...generated, entries: generated.entries.slice(0, 1) }));
    runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} });
    const before = ledger(db);
    writeFileSync(file, full);
    expect(() => runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} })).toThrow();
    expect(db.prepare('SELECT * FROM native').all()).toEqual([{ id: 'local', value: 'preserved' }]);
    expect(ledger(db)).toEqual(before);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('the known partial sticker repair rolls back with a later failing migration', () => {
    const { db, folder } = fixture();
    cpSync(path.resolve('drizzle'), folder, { recursive: true });
    const file = path.join(folder, 'meta/_journal.json');
    const full = readFileSync(file, 'utf8');
    const generated = JSON.parse(full) as { entries: Array<{ idx: number; tag: string }> };
    writeFileSync(file, JSON.stringify({ ...generated, entries: generated.entries.filter(entry => entry.idx < 45) }));
    runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} });
    db.exec('ALTER TABLE instance_settings ADD max_sticker_size_bytes integer; INSERT INTO instance_settings (id, updated_at, max_sticker_size_bytes) VALUES (1, 1, 12345)');
    const before = ledger(db);
    writeFileSync(file, full);
    const last = path.join(folder, `${generated.entries.at(-1)!.tag}.sql`);
    writeFileSync(last, `${readFileSync(last, 'utf8')}\n--> statement-breakpoint\nINSERT INTO missing_table VALUES (1);`);
    expect(() => runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} })).toThrow();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'sticker_packs'").get()).toBeUndefined();
    expect(db.prepare('SELECT max_sticker_size_bytes FROM instance_settings').get()).toEqual({ max_sticker_size_bytes: 12345 });
    expect(ledger(db)).toEqual(before);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('rejects embedded transaction control before generated SQL can commit partial changes', () => {
    const { db, folder } = fixture(['CREATE TABLE native (id text); COMMIT;']);
    expect(() => runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} })).toThrow(/transaction control/i);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()).toEqual([]);
    expect(db.inTransaction).toBe(false);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('does not confuse quoted content with transaction control', () => {
    const { db, folder } = fixture(["CREATE TABLE native (value text); INSERT INTO native VALUES ('literal; COMMIT; text');"]);
    runMigrations(db, { migrationsFolder: folder, beforeChanges: () => {} });
    expect(db.prepare('SELECT value FROM native').get()).toEqual({ value: 'literal; COMMIT; text' });
  });
});
